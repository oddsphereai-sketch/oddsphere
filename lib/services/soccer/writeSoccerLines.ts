/**
 * WC-4 Phase G — Soccer (FIFA WC) `lines` + `line_history` persistence.
 *
 * Brings the soccer pipeline up to parity with MLB/NBA/NHL on the
 * line-tracker side. Reads BDL FIFA odds + SharpAPI WC odds, normalizes
 * via the existing _soccerMarketNormalizer (single source of truth for
 * the four official WC markets — see [[project-wc-launch-contract]]),
 * filters per the Option A scope Daniel approved 2026-06-11, then
 * upserts to `lines` (current state) and appends to `line_history`
 * (with `is_opener` flagged via the shared helper).
 *
 * Scope (Option A — approved):
 *   • match_result, double_chance, btts → persist ALL provider rows.
 *   • total → main line per book + the immediately-adjacent alt line on
 *     each side. Full alt-line tree (the long ±N table from BDL/Bovada)
 *     is intentionally dropped so the line tracker stays trustworthy.
 *
 * Provider precedence on collision:
 *   When BDL and SharpAPI both report the same (book, market, side, line),
 *   the SharpAPI row wins because it's the de-vigged aggregator surface
 *   members care about. BDL stays as the breadth source — for any
 *   (book, market, side, line) tuple SharpAPI doesn't have, BDL's row
 *   is used.
 *
 * Two-key gate (mirrors the rest of the operator-level write surface):
 *   • SOCCER_LINES_DB_WRITES_ENABLED=true in env
 *   • opts.apply=true on the function input
 *   Either missing → dry-run only.
 *
 * Hard rules (encoded in tests):
 *   • NEVER fabricate `sharp_signals` rows. FIFA WC has empty_as_of_probe
 *     vendor coverage; the card's "Public split unavailable" is honest.
 *   • NEVER let one provider's row overwrite a richer row from another
 *     for the SAME canonical tuple. Merge, don't replace.
 *   • NEVER mix markets (match_result with double_chance, total with
 *     btts) or sides (home/away/draw, over/under) in a write.
 *   • Totals at different `line_value` are SEPARATE keys — not deduped.
 *
 * No model thresholds. No prediction_records writes. No middleware
 * change. No shell UI change. Soccer-only file.
 */
import { supabase } from "../../db/supabase";
import { flagOpenersInHistoryPayload } from "../_lineHistoryOpenerHelper";
import { BallDontLieFifaProvider } from "../../providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../providers/real_api/_bdlFifaClient";
import { SharpApiSoccerOddsProvider, type SharpApiOddsRow } from "../../providers/real_api/SharpApiSoccerOddsProvider";
import { SharpApiClient } from "../../providers/real_api/_sharpApiClient";
import type { NormalizedSoccerOddsRecord } from "../../providers/real_api/_soccerMarketNormalizer";

const SOCCER_LINES_GATE_ENV = "SOCCER_LINES_DB_WRITES_ENABLED";

// ─── Types ──────────────────────────────────────────────────────────

export type WriteSoccerLinesOptions = {
  /** ET sports-day in YYYY-MM-DD. */
  slateDate: string;
  /** false = read-only dry-run; true = perform writes (also requires the env gate). */
  apply: boolean;
  /** Inject providers (tests). Default = real clients via env keys. */
  providers?: {
    bdl: BallDontLieFifaProvider;
    sharp: SharpApiSoccerOddsProvider;
  };
  /** Sink for human-readable progress lines. Default = no-op. */
  logger?: (msg: string) => void;
};

export type WriteSoccerLinesResult = {
  mode: "dry-run" | "write" | "no-games";
  slateDate: string;
  gamesProcessed: number;
  /** Rows considered after Option-A filtering, before any DB write. */
  linesProposed: number;
  linesWritten: number;
  historyProposed: number;
  historyWritten: number;
  openersFlagged: number;
  errors: string[];
};

type DbGame = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
};

type DbTeam = { id: number; abbreviation: string; display_name: string | null };

// ─── Pure helpers (no DB, no HTTP — exhaustively unit-tested) ──────

/** Stable tuple key for line / line_history merge and dedup. */
function tupleKey(r: {
  market: string;
  selection: string;
  sportsbook: string | null;
  line: number | null;
}): string {
  return `${r.market}|${r.selection}|${r.sportsbook ?? "?"}|${r.line ?? "null"}`;
}

/**
 * Merge BDL + SharpAPI rows on `(market, side, book, line)`. SharpAPI
 * wins on collision because it's the de-vigged aggregator surface. BDL
 * fills the holes SharpAPI doesn't cover. Pure.
 */
export function mergeProviderRows(
  bdl: ReadonlyArray<NormalizedSoccerOddsRecord>,
  sharp: ReadonlyArray<NormalizedSoccerOddsRecord>,
): NormalizedSoccerOddsRecord[] {
  const byKey = new Map<string, NormalizedSoccerOddsRecord>();
  // BDL first so SharpAPI overrides.
  for (const r of bdl) byKey.set(tupleKey(r), r);
  for (const r of sharp) byKey.set(tupleKey(r), r);
  return [...byKey.values()];
}

/**
 * Pick the MAIN total line per book. Heuristic: among all rows for a
 * (book, market=total), the line whose Over (or Under) odds are closest
 * to fair (|odds_american + 100| minimized) on either side. Returns a
 * Map<book, mainLineValue>.
 *
 * Important: a book's main is decided per book — we do NOT collapse to
 * a slate-wide main. Soccer providers genuinely disagree on the main
 * line (FanDuel main = 2.5 while DraftKings main may = 3.0) and that
 * disagreement IS valuable signal for the WC-3 hold logic. Don't paper
 * over it.
 */
export function pickMainTotalPerBook(
  rows: ReadonlyArray<NormalizedSoccerOddsRecord>,
): Map<string, number> {
  const totalsByBook = new Map<string, NormalizedSoccerOddsRecord[]>();
  for (const r of rows) {
    if (r.market !== "total" || r.line === null) continue;
    const book = r.sportsbook ?? "?";
    if (!totalsByBook.has(book)) totalsByBook.set(book, []);
    totalsByBook.get(book)!.push(r);
  }

  const main = new Map<string, number>();
  for (const [book, rs] of totalsByBook) {
    let bestLine: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const r of rs) {
      if (r.line === null || r.odds_american === null) continue;
      const dist = Math.abs(r.odds_american + 100);
      if (dist < bestDist) {
        bestDist = dist;
        bestLine = r.line;
      }
    }
    if (bestLine !== null) main.set(book, bestLine);
  }
  return main;
}

/**
 * For each (book, market=total), the main line + the immediately-
 * adjacent alt line on each side (one step above, one step below in
 * the sorted set of distinct line values offered by that book).
 *
 * Returns the FILTERED set of total rows we should persist. Both
 * over and under at each kept line stay together — partial-side
 * persistence makes the line tracker confusing.
 *
 * If a book offers only the main line, nothing else is kept for
 * that book (no extrapolation, no fabrication).
 */
export function selectMainAndAdjacentTotals(
  rows: ReadonlyArray<NormalizedSoccerOddsRecord>,
): NormalizedSoccerOddsRecord[] {
  const totalsByBook = new Map<string, NormalizedSoccerOddsRecord[]>();
  for (const r of rows) {
    if (r.market !== "total") continue;
    const book = r.sportsbook ?? "?";
    if (!totalsByBook.has(book)) totalsByBook.set(book, []);
    totalsByBook.get(book)!.push(r);
  }
  const mainPerBook = pickMainTotalPerBook(rows);
  const kept: NormalizedSoccerOddsRecord[] = [];
  for (const [book, rs] of totalsByBook) {
    const main = mainPerBook.get(book);
    if (main === undefined) continue;
    const distinctLines = [
      ...new Set(rs.map((r) => r.line).filter((n): n is number => n !== null)),
    ].sort((a, b) => a - b);
    const mainIdx = distinctLines.indexOf(main);
    const allowed = new Set<number>([main]);
    if (mainIdx > 0) allowed.add(distinctLines[mainIdx - 1]);
    if (mainIdx >= 0 && mainIdx < distinctLines.length - 1) allowed.add(distinctLines[mainIdx + 1]);
    for (const r of rs) {
      if (r.line !== null && allowed.has(r.line)) kept.push(r);
    }
  }
  return kept;
}

/**
 * Apply Option-A filter across all four markets:
 *   • match_result, double_chance, btts → ALL rows pass
 *   • total → main + ±1 adjacent alt per book
 * Pure.
 */
export function filterToPersistableRows(
  rows: ReadonlyArray<NormalizedSoccerOddsRecord>,
): NormalizedSoccerOddsRecord[] {
  const nonTotal = rows.filter((r) => r.market !== "total");
  const total = selectMainAndAdjacentTotals(rows);
  return [...nonTotal, ...total];
}

// ─── DB row shape (lines + line_history) ────────────────────────────

export type LinesRow = {
  game_id: number;
  market_type: string;
  side: string;
  sportsbook: string;
  player_id: number | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  fetched_at: string;
};

/**
 * `line_history` schema differs from `lines` — it uses `recorded_at`
 * as the timestamp column and does NOT have `fetched_at` or
 * `odds_decimal`. So we omit both here. Schema (from schema.sql §4.2):
 *   id, game_id, market_type, player_id, sportsbook, side, line_value,
 *   odds_american, is_opener, recorded_at, created_at.
 *
 * Caught 2026-06-12: tonight's apply wrote 125 `lines` rows successfully
 * but `line_history` insert failed with "Could not find the 'fetched_at'
 * column" then "Could not find the 'odds_decimal' column" because the
 * spread copied non-existent columns into the history payload.
 */
export type LineHistoryRow = Omit<LinesRow, "fetched_at" | "odds_decimal"> & {
  recorded_at: string;
  is_opener?: boolean;
};

/**
 * Map a normalized provider record into a `lines` row keyed for our
 * schema. Pure.
 */
export function toLinesRow(
  game_id: number,
  r: NormalizedSoccerOddsRecord,
  capturedAtIso: string,
): LinesRow {
  return {
    game_id,
    market_type: r.market,
    side: r.selection,
    sportsbook: r.sportsbook ?? "consensus",
    player_id: null,
    line_value: r.line ?? null,
    odds_american: r.odds_american,
    odds_decimal: r.odds_decimal,
    fetched_at: capturedAtIso,
  };
}

export function toLineHistoryRow(linesRow: LinesRow, capturedAtIso: string): LineHistoryRow {
  // Strip `fetched_at` + `odds_decimal` — both are on `lines` only, not on `line_history`.
  const { fetched_at: _fetched_at, odds_decimal: _odds_decimal, ...rest } = linesRow;
  void _fetched_at;
  void _odds_decimal;
  return {
    ...rest,
    recorded_at: capturedAtIso,
  };
}

// ─── Providers ──────────────────────────────────────────────────────

function buildProviders(): {
  bdl: BallDontLieFifaProvider;
  sharp: SharpApiSoccerOddsProvider;
} {
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  const sharpKey = process.env.SHARPAPI_KEY;
  if (bdlKey === undefined || bdlKey.length === 0) {
    throw new Error("BALLDONTLIE_API_KEY missing");
  }
  if (sharpKey === undefined || sharpKey.length === 0) {
    throw new Error("SHARPAPI_KEY missing");
  }
  return {
    bdl: new BallDontLieFifaProvider(new BdlFifaClient(bdlKey)),
    sharp: new SharpApiSoccerOddsProvider(new SharpApiClient(sharpKey)),
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────

export async function writeSoccerLines(
  opts: WriteSoccerLinesOptions,
): Promise<WriteSoccerLinesResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];

  // Two-key gate.
  const envGateOn = process.env[SOCCER_LINES_GATE_ENV] === "true";
  const effectiveApply = opts.apply && envGateOn;
  if (opts.apply && !envGateOn) {
    log(
      `Refusing to apply: ${SOCCER_LINES_GATE_ENV} not set to "true". Falling back to dry-run.`,
    );
  }

  // 1. Load soccer games for the slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id")
    .eq("sport", "soccer")
    .eq("slate_date", opts.slateDate);
  if (gamesErr !== null) throw new Error(`load soccer games: ${gamesErr.message}`);
  const games = (gamesData as DbGame[] | null) ?? [];
  if (games.length === 0) {
    log(`(no soccer games on slate ${opts.slateDate})`);
    return {
      mode: "no-games",
      slateDate: opts.slateDate,
      gamesProcessed: 0,
      linesProposed: 0,
      linesWritten: 0,
      historyProposed: 0,
      historyWritten: 0,
      openersFlagged: 0,
      errors,
    };
  }

  // 2. Team abbreviations — needed for SharpAPI event filtering.
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation, display_name")
    .in("id", [...teamIds]);
  const teamById = new Map<number, DbTeam>(
    ((teamsData as DbTeam[] | null) ?? []).map((t) => [t.id, t]),
  );

  // 3. Providers + slate-wide fetch.
  const providers = opts.providers ?? buildProviders();
  log(`Fetching BDL FIFA tournament fixtures…`);
  const allBdlMatches = await providers.bdl.listMatches({ per_page: 25 });
  log(`Fetching SharpAPI WC soccer odds…`);
  const allSharpRaw = await providers.sharp.listRawOdds({ maxPages: 2, limit: 200 });

  const capturedAtIso = new Date().toISOString();
  const allLinesPayload: LinesRow[] = [];
  const allHistoryPayload: LineHistoryRow[] = [];

  for (const g of games) {
    const homeName = g.home_team_id !== null ? teamById.get(g.home_team_id)?.display_name ?? "?" : "?";
    const awayName = g.away_team_id !== null ? teamById.get(g.away_team_id)?.display_name ?? "?" : "?";
    const homeAbbr = g.home_team_id !== null ? teamById.get(g.home_team_id)?.abbreviation ?? "?" : "?";
    const awayAbbr = g.away_team_id !== null ? teamById.get(g.away_team_id)?.abbreviation ?? "?" : "?";
    const matchup = `${awayAbbr} @ ${homeAbbr}`;

    // BDL — pull per-match raw odds, normalize.
    const bdlMatch = allBdlMatches.find((m) => m.provider_match_id === g.external_id);
    if (bdlMatch === undefined) {
      log(`  ⏭ ${matchup}: no BDL fixture for game ext=${g.external_id}`);
      continue;
    }
    const bdlRaw = await providers.bdl.listRawOdds({
      match_id: bdlMatch.provider_match_id,
      per_page: 25,
    });
    // 2026-06-13 P0 fix: the BDL odds endpoint returns the FULL WC odds pool
    // (it does not honor the match_id query param), and normalizeOdds blindly
    // normalizes every row it's given. Without this scope every other match's
    // odds were relabeled with THIS game's teams and written to it — the source
    // of the cross-contamination (6/7 books byte-identical across fixtures).
    // Each BDL odds row carries its own match_id; keep only this match's rows.
    const bdlForGame = bdlRaw.filter((r) => r.match_id === bdlMatch.provider_match_id);
    const bdlNorm = bdlForGame.flatMap((r) =>
      providers.bdl.normalizeOdds(r, { home_team: bdlMatch.home_team_name, away_team: bdlMatch.away_team_name }),
    );

    // SharpAPI — match each raw row to THIS game by its OWN per-event team
    // fields (home_team / away_team), then include every row sharing a matched
    // event_id.
    //
    // 2026-06-13 P0 fix: the previous predicate scanned `JSON.stringify(r)` —
    // the WHOLE row — for both team names. Whenever a SharpAPI row carried more
    // than its own event's data, that substring test matched MULTIPLE fixtures,
    // stamping one event's odds onto several games (observed: 6/7 books showed
    // byte-identical match_result lines across MAR@BRA / SCO@HAI / SUI@QAT —
    // SCO@HAI even read "Haiti favored", backwards). Comparing the row's short
    // home_team/away_team fields instead cannot bleed across fixtures. A
    // neutral-site WC has no real home/away, so accept either orientation;
    // names are normalized (accent/punctuation-insensitive) with exact-or-
    // containment matching on the team field only — never the full row.
    const norm = (s: string): string =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    const nameMatch = (a: string, b: string): boolean => {
      const na = norm(a);
      const nb = norm(b);
      if (na.length === 0 || nb.length === 0) return false;
      return na === nb || na.includes(nb) || nb.includes(na);
    };
    const rowMatchesGame = (r: SharpApiOddsRow): boolean => {
      const rh = r.home_team ?? "";
      const ra = r.away_team ?? "";
      return (
        (nameMatch(rh, homeName) && nameMatch(ra, awayName)) ||
        (nameMatch(rh, awayName) && nameMatch(ra, homeName))
      );
    };
    const eventIds = new Set<string>();
    for (const r of allSharpRaw) {
      if (rowMatchesGame(r) && typeof r.event_id === "string") eventIds.add(r.event_id);
    }
    const sharpForGame = allSharpRaw.filter(
      (r) => typeof r.event_id === "string" && eventIds.has(r.event_id),
    );
    const sharpNorm = providers.sharp.normalizeOdds(sharpForGame);

    // Merge providers (SharpAPI wins ties), filter per Option A.
    const merged = mergeProviderRows(bdlNorm, sharpNorm);
    const filtered = filterToPersistableRows(merged);

    log(
      `\n${matchup} (game.id=${g.id}, ext=${g.external_id})  ` +
        `bdl=${bdlNorm.length} sharp=${sharpNorm.length} merged=${merged.length} ` +
        `after-Option-A=${filtered.length}`,
    );

    for (const r of filtered) {
      const linesRow = toLinesRow(g.id, r, capturedAtIso);
      allLinesPayload.push(linesRow);
      allHistoryPayload.push(toLineHistoryRow(linesRow, capturedAtIso));
    }
  }

  // Opener flagging (does its own DB pre-fetch).
  const flaggedHistory = await flagOpenersInHistoryPayload(allHistoryPayload);
  const openersFlagged = flaggedHistory.filter((r) => r.is_opener === true).length;

  // Per-market breakdown so the operator can confirm Option A is shaping
  // the payload correctly (no zero-counts on Double Chance / BTTS, totals
  // trimmed to main + ±1).
  const byMarket = new Map<string, number>();
  for (const r of allLinesPayload) byMarket.set(r.market_type, (byMarket.get(r.market_type) ?? 0) + 1);
  const marketLines = ["match_result", "double_chance", "total", "btts"]
    .map((m) => `    ${m.padEnd(15)} ${byMarket.get(m) ?? 0}`)
    .join("\n");

  log(
    `\n─── Summary ─────────────────────────────────────────────\n` +
      `  games_processed:       ${games.length}\n` +
      `  lines proposed:        ${allLinesPayload.length}\n` +
      `  line_history proposed: ${flaggedHistory.length}\n` +
      `  is_opener=true rows:   ${openersFlagged}\n` +
      `  per market:\n${marketLines}\n` +
      `  mode:                  ${effectiveApply ? "APPLY" : "DRY-RUN"}`,
  );

  if (!effectiveApply) {
    return {
      mode: "dry-run",
      slateDate: opts.slateDate,
      gamesProcessed: games.length,
      linesProposed: allLinesPayload.length,
      linesWritten: 0,
      historyProposed: flaggedHistory.length,
      historyWritten: 0,
      openersFlagged,
      errors,
    };
  }

  // Apply: upsert lines, insert line_history.
  let linesWritten = 0;
  let historyWritten = 0;
  if (allLinesPayload.length > 0) {
    const { error } = await supabase
      .from("lines")
      .upsert(allLinesPayload as unknown as Record<string, unknown>[], {
        // PostgREST will use the table's existing unique constraint /
        // index — we don't specify onConflict so it falls back to the
        // table's default. If the table has no unique index covering
        // (game_id, market_type, side, sportsbook, line_value), all
        // rows insert. That's the migration follow-up.
      });
    if (error !== null) {
      errors.push(`lines upsert: ${error.message}`);
    } else {
      linesWritten = allLinesPayload.length;
    }
  }
  if (flaggedHistory.length > 0) {
    const { error } = await supabase
      .from("line_history")
      .insert(flaggedHistory as unknown as Record<string, unknown>[]);
    if (error !== null) {
      errors.push(`line_history insert: ${error.message}`);
    } else {
      historyWritten = flaggedHistory.length;
    }
  }

  return {
    mode: "write",
    slateDate: opts.slateDate,
    gamesProcessed: games.length,
    linesProposed: allLinesPayload.length,
    linesWritten,
    historyProposed: flaggedHistory.length,
    historyWritten,
    openersFlagged,
    errors,
  };
}
