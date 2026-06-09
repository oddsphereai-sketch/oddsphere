/**
 * Phase 7L Phase 1 — NHL lines refresh service.
 *
 * Mirrors the NBA pattern with the Phase 7K Fix 1 baked in from the
 * start: input is ET slate_date; DB lookup filters by games.slate_date
 * equality; SharpAPI's UTC date(s) are derived internally from matched
 * games' game_date column. Late tips that live in UTC the next day are
 * found cleanly.
 *
 * Scope:
 *   • Reads:  SharpAPI /odds (NHL), our games + teams (sport='nhl').
 *   • Writes: lines (sport-agnostic via game_id FK), line_history
 *             (append-only intraday snapshots).
 *   • NEVER writes any other table.
 *   • SHARPAPI_KEY received by argument; never logged.
 *
 * Markets: moneyline + total_goals + puck_line (the three game-line
 * markets confirmed in the probe). Skips alternate / non-main lines.
 */

import { supabase } from "../../db/supabase";
import { fetchSharpNhlOdds, type SharpNhlOddsRow } from "../../providers/nhl/_sharpApiNhlClient";
import { normalizeNhlTeamName, type NhlTeamAbbrev } from "../../providers/nhl/_teamNameNormalizer";

export type RefreshNhlLinesOptions = {
  /** ET sports-day in YYYY-MM-DD. Filters games.slate_date directly. */
  slateDate: string;
  /** SharpAPI bearer token. NEVER logged. */
  sharpApiKey: string;
  dryRun: boolean;
  logger?: (msg: string) => void;
};

export type RefreshNhlLinesResult = {
  mode: "dry-run" | "write" | "no-games";
  gamesInDb: number;
  oddsRowsFetched: number;
  matched: number;
  unmatched: number;
  parsed: number;
  linesWritten: number;
  lineHistoryWritten: number;
  errors: string[];
};

type GameRow = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
};

type TeamRow = { id: number; abbreviation: string };

type LinePayload = {
  game_id: number;
  market_type: string;
  player_id: null;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  ev_percent: number | null;
  fair_odds: number | null;
};

type LineHistoryPayload = {
  game_id: number;
  market_type: string;
  player_id: null;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  is_opener: false;
  recorded_at: string;
};

function asNumberOrNull(x: number | string | null | undefined): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = typeof x === "number" ? x : Number.parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

function americanFromDecimal(decimal: number | null): number | null {
  if (decimal === null || decimal <= 1) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function decimalFromAmerican(american: number | null): number | null {
  if (american === null || american === 0) return null;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function impliedProbability(american: number | null): number | null {
  if (american === null || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * NHL market normalization: SharpAPI uses `moneyline`, `total_goals`,
 * and `puck_line`. We keep "total" and "spread" as our internal
 * canonical (matching MLB/NBA) so the lines table is sport-uniform.
 */
function normalizeMarket(raw: string | undefined): "moneyline" | "spread" | "total" | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/\b(period|1st_|2nd_|3rd_)/.test(s)) return null;
  if (s === "moneyline" || s === "ml" || s === "h2h") return "moneyline";
  if (s === "puck_line" || s === "puckline" || s === "spread" || s === "handicap" || s === "point_spread") return "spread";
  if (s === "total_goals" || s === "totalgoals" || s === "total" || s === "ou" || s === "overunder") return "total";
  return null;
}

function normalizeSide(
  rawSide: string | undefined,
  selection: string | undefined,
  homeAbbr: NhlTeamAbbrev,
  awayAbbr: NhlTeamAbbrev,
): "home" | "away" | "over" | "under" | null {
  const s = (rawSide ?? "").toLowerCase();
  if (s === "home" || s === "away" || s === "over" || s === "under") return s;
  if (selection !== undefined && selection !== null) {
    const sel = selection.toLowerCase();
    if (sel.includes("over")) return "over";
    if (sel.includes("under")) return "under";
    if (sel.includes(homeAbbr.toLowerCase())) return "home";
    if (sel.includes(awayAbbr.toLowerCase())) return "away";
    const teamAbbr = normalizeNhlTeamName(selection);
    if (teamAbbr === homeAbbr) return "home";
    if (teamAbbr === awayAbbr) return "away";
  }
  return null;
}

async function loadNhlGamesForSlateDate(slateDate: string): Promise<GameRow[]> {
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date")
    .eq("sport", "nhl")
    .eq("slate_date", slateDate);
  if (error !== null) throw new Error(`load NHL games failed: ${error.message}`);
  return ((data as unknown) ?? []) as GameRow[];
}

async function loadNhlTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", "nhl");
  if (error !== null) throw new Error(`load NHL teams failed: ${error.message}`);
  return ((data as unknown) ?? []) as TeamRow[];
}

function sharpApiDatesForGames(games: GameRow[]): string[] {
  const set = new Set<string>();
  for (const g of games) set.add(g.game_date.slice(0, 10));
  return [...set].sort();
}

function buildPayload(
  row: SharpNhlOddsRow,
  gameId: number,
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
): LinePayload | null {
  const sportsbook = (row.sportsbook ?? "").toLowerCase();
  if (sportsbook === "") return null;
  const american =
    asNumberOrNull(row.odds_american) ??
    americanFromDecimal(asNumberOrNull(row.odds_decimal));
  const decimal =
    asNumberOrNull(row.odds_decimal) ??
    decimalFromAmerican(american);
  const lineValue = asNumberOrNull(row.line);
  const implied = impliedProbability(american);
  return {
    game_id: gameId,
    market_type: market,
    player_id: null,
    sportsbook,
    side,
    line_value: lineValue,
    odds_american: american,
    odds_decimal: decimal,
    implied_probability: implied,
    ev_percent: null,
    fair_odds: null,
  };
}

export async function refreshNhlLines(
  opts: RefreshNhlLinesOptions,
): Promise<RefreshNhlLinesResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];

  const games = await loadNhlGamesForSlateDate(opts.slateDate);
  log(`NHL games on slate ${opts.slateDate}: ${games.length}`);
  if (games.length === 0) {
    log(`(no NHL games in DB for slate_date ${opts.slateDate}; run seed-nhl-games.ts first)`);
    return {
      mode: "no-games", gamesInDb: 0, oddsRowsFetched: 0,
      matched: 0, unmatched: 0, parsed: 0,
      linesWritten: 0, lineHistoryWritten: 0,
      errors,
    };
  }

  const teams = await loadNhlTeams();
  const teamById = new Map<number, TeamRow>(teams.map((t) => [t.id, t]));
  // Resolve each game's canonical abbrs from team_id → teams.abbreviation.
  const gameAbbrs = new Map<number, { home: NhlTeamAbbrev; away: NhlTeamAbbrev }>();
  for (const g of games) {
    const home = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const away = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    if (!home || !away) continue;
    const homeAbbr = normalizeNhlTeamName(home.abbreviation);
    const awayAbbr = normalizeNhlTeamName(away.abbreviation);
    if (homeAbbr === null || awayAbbr === null) continue;
    gameAbbrs.set(g.id, { home: homeAbbr, away: awayAbbr });
  }

  const sharpApiDates = sharpApiDatesForGames(games);
  log(`SharpAPI fetch dates (UTC): ${sharpApiDates.join(", ")}`);
  const oddsRows: SharpNhlOddsRow[] = [];
  for (const d of sharpApiDates) {
    const batch = await fetchSharpNhlOdds(d, opts.sharpApiKey, log);
    oddsRows.push(...batch);
  }
  log(`SharpAPI /odds rows fetched: ${oddsRows.length}`);

  let matched = 0;
  let unmatched = 0;
  let parsed = 0;
  const payloads: LinePayload[] = [];

  for (const r of oddsRows) {
    if (r.is_alternate_line === true || r.is_main_line === false) continue;
    const homeAbbr = normalizeNhlTeamName(r.home_team);
    const awayAbbr = normalizeNhlTeamName(r.away_team);
    if (homeAbbr === null || awayAbbr === null) { unmatched++; continue; }
    // Find a DB game that matches this team-pair in either orientation.
    let gameId: number | null = null;
    let canonicalHome: NhlTeamAbbrev | null = null;
    let canonicalAway: NhlTeamAbbrev | null = null;
    for (const [gId, abbrs] of gameAbbrs) {
      if (abbrs.home === homeAbbr && abbrs.away === awayAbbr) {
        gameId = gId; canonicalHome = abbrs.home; canonicalAway = abbrs.away;
        break;
      }
      // SharpAPI sometimes flips orientation (`CAR home vs VGK away` AND `VGK home vs CAR away`)
      if (abbrs.home === awayAbbr && abbrs.away === homeAbbr) {
        gameId = gId; canonicalHome = abbrs.home; canonicalAway = abbrs.away;
        break;
      }
    }
    if (gameId === null || canonicalHome === null || canonicalAway === null) {
      unmatched++; continue;
    }
    matched++;
    const market = normalizeMarket(r.market_type);
    if (market === null) continue;
    // Side normalization relative to the row's stated home/away, then
    // re-orient to our canonical home/away if the row was flipped.
    const sideRaw = normalizeSide(r.selection_type, r.selection, homeAbbr, awayAbbr);
    if (sideRaw === null) continue;
    let side: "home" | "away" | "over" | "under" = sideRaw;
    if (sideRaw === "home" && homeAbbr !== canonicalHome) side = "away";
    else if (sideRaw === "away" && awayAbbr !== canonicalAway) side = "home";
    if ((market === "moneyline" || market === "spread") && side !== "home" && side !== "away") continue;
    if (market === "total" && side !== "over" && side !== "under") continue;
    const payload = buildPayload(r, gameId, market, side);
    if (payload === null) continue;
    parsed++;
    payloads.push(payload);
  }

  log(`\nProcessed: matched=${matched} unmatched=${unmatched} parsed=${parsed}`);

  if (opts.dryRun) {
    log(`\n[dry-run] would upsert ${payloads.length} lines row(s)`);
    for (const p of payloads.slice(0, 8)) {
      log(`    game_id=${p.game_id} ${p.market_type}/${p.side} book=${p.sportsbook} line=${p.line_value} odds=${p.odds_american}`);
    }
    if (payloads.length > 8) log(`    … and ${payloads.length - 8} more`);
    return {
      mode: "dry-run", gamesInDb: games.length, oddsRowsFetched: oddsRows.length,
      matched, unmatched, parsed,
      linesWritten: 0, lineHistoryWritten: 0,
      errors,
    };
  }

  // Apply: same delete-then-insert per (game_id, market_type, sportsbook)
  // pattern the NBA service uses. Plus append-only line_history snapshot.
  log(`\nApplying ${payloads.length} rows…`);
  const groups = new Map<string, LinePayload[]>();
  for (const p of payloads) {
    const k = `${p.game_id}|${p.market_type}|${p.sportsbook}`;
    const arr = groups.get(k) ?? [];
    arr.push(p);
    groups.set(k, arr);
  }
  let linesWritten = 0;
  for (const [key, group] of groups) {
    const [gameIdStr, market, book] = key.split("|");
    const gameId = Number.parseInt(gameIdStr, 10);
    const { error: delErr } = await supabase
      .from("lines")
      .delete()
      .eq("game_id", gameId)
      .eq("market_type", market)
      .eq("sportsbook", book)
      .is("player_id", null);
    if (delErr) {
      const msg = `  ✗ delete existing ${key}: ${delErr.message}`;
      log(msg); errors.push(msg); continue;
    }
    const { error: insErr } = await supabase.from("lines").insert(group);
    if (insErr) {
      const msg = `  ✗ insert ${key}: ${insErr.message}`;
      log(msg);
      for (let i = 0; i < group.length; i++) errors.push(msg);
      continue;
    }
    linesWritten += group.length;
  }

  const nowIso = new Date().toISOString();
  const historyRows: LineHistoryPayload[] = payloads.map((p) => ({
    game_id: p.game_id,
    market_type: p.market_type,
    player_id: null,
    sportsbook: p.sportsbook,
    side: p.side,
    line_value: p.line_value,
    odds_american: p.odds_american,
    is_opener: false,
    recorded_at: nowIso,
  }));
  let lineHistoryWritten = 0;
  if (historyRows.length > 0) {
    const { error: histErr } = await supabase.from("line_history").insert(historyRows);
    if (histErr) {
      const msg = `  ✗ line_history insert: ${histErr.message}`;
      log(msg);
      for (let i = 0; i < historyRows.length; i++) errors.push(msg);
    } else {
      lineHistoryWritten = historyRows.length;
    }
  }

  return {
    mode: "write",
    gamesInDb: games.length,
    oddsRowsFetched: oddsRows.length,
    matched, unmatched, parsed,
    linesWritten, lineHistoryWritten,
    errors,
  };
}
