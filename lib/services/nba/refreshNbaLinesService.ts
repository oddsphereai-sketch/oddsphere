/**
 * Phase 7K Service 3 — NBA odds/lines refresh service.
 *
 * Extracted from scripts/operator/nba/refresh-nba-lines.ts so the same
 * flow can be driven by the upcoming /api/cron/nba-daily-refresh route.
 * The operator stays as a thin CLI wrapper.
 *
 * What this does (preserved byte-for-byte from the pre-7K operator):
 *   • Loads NBA games + teams for the requested date.
 *   • Fetches NBA odds from SharpAPI /odds?league=nba&date=YYYY-MM-DD
 *     (limit-paginated). Skips alternate / non-main-line rows.
 *   • Matches each odds row to one of our `games` rows by team-name
 *     overlap (display_name + last-token fallback).
 *   • Normalizes market + side, builds (game_id, market_type,
 *     sportsbook, side) payloads.
 *   • Apply path: delete then insert per (game_id, market_type,
 *     sportsbook) triplet — matches the MLB linesService refresh
 *     pattern — and appends an intraday line_history snapshot.
 *   • NEVER writes any other table; NEVER touches MLB rows.
 *
 * Service contract (vs. CLI wrapper):
 *   • NO process.exit / process.argv / process.env access.
 *   • Caller passes `sharpApiKey` directly — service does NOT read
 *     SHARPAPI_KEY from env. NEVER logs the key.
 *   • Caller-supplied logger; service runs silent when omitted.
 *   • Returns a typed Result with per-step counts so the cron route
 *     can log structured outcomes to data_refresh_log.
 *   • mode="no-games" short-circuits before any SharpAPI fetch (saves
 *     a request when there's nothing to match against).
 */

import { supabase } from "../../db/supabase";
import { flagOpenersInHistoryPayload } from "../_lineHistoryOpenerHelper";

const SHARP_API_BASE = "https://api.sharpapi.io/api/v1";

export type RefreshNbaLinesOptions = {
  /**
   * ET sports-day in YYYY-MM-DD. Filters games.slate_date directly.
   * Late ET tips land in UTC the next day, so filtering by UTC
   * game_date misses them — slate_date is the product-correct join key.
   * SharpAPI's date convention is UTC, so the service derives the
   * SharpAPI query date(s) from the matched games' game_date column
   * internally — callers never have to think about it.
   */
  slateDate: string;
  /**
   * SharpAPI bearer token. Passed in by caller; service does not read
   * SHARPAPI_KEY from process.env. NEVER logged.
   */
  sharpApiKey: string;
  /** false = perform DB writes; true = dry-run (read-only). */
  dryRun: boolean;
  /** Sink for human-readable progress lines. Default no-op. */
  logger?: (msg: string) => void;
};

export type RefreshNbaLinesResult = {
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

type TeamRow = {
  id: number;
  display_name: string;
  abbreviation: string;
};

type SharpOddsRow = {
  event_id?: string;
  game_id?: number | string;
  sportsbook?: string;
  market?: string;
  market_type?: string;
  side?: string;
  selection_type?: string;
  selection?: string;
  outcome?: string;
  line?: number | string | null;
  line_value?: number | string | null;
  point?: number | string | null;
  price?: number | string | null;
  odds_american?: number | string | null;
  odds_decimal?: number | string | null;
  ev_percent?: number | string | null;
  fair_odds?: number | string | null;
  home_team?: string;
  away_team?: string;
  league?: string;
  sport?: string;
  is_main_line?: boolean;
  is_alternate_line?: boolean;
  last_seen_at?: string;
  wire_received_at?: string;
};

type LineUpsertPayload = {
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

function normalizeMarket(
  raw: string | undefined,
): "moneyline" | "spread" | "total" | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/\b(quarter|half|period|1st_|2nd_|3rd_|4th_)/.test(s)) return null;
  if (s === "moneyline" || s === "ml" || s === "h2h") return "moneyline";
  if (s === "point_spread" || s === "pointspread" || s === "spread" || s === "handicap") return "spread";
  if (s === "total_points" || s === "totalpoints" || s === "total" || s === "ou" || s === "overunder") return "total";
  return null;
}

function normalizeSide(
  rawSide: string | undefined,
  selection: string | undefined,
  homeTeam: string,
  awayTeam: string,
): "home" | "away" | "over" | "under" | null {
  const s = (rawSide ?? "").toLowerCase();
  if (s === "home" || s === "away" || s === "over" || s === "under") return s;
  if (selection !== undefined && selection !== null) {
    const sel = selection.toLowerCase();
    const home = homeTeam.toLowerCase();
    const away = awayTeam.toLowerCase();
    const homeShort = home.split(/\s+/).pop() ?? home;
    const awayShort = away.split(/\s+/).pop() ?? away;
    if (sel.includes(home) || (homeShort.length > 3 && sel.includes(homeShort))) return "home";
    if (sel.includes(away) || (awayShort.length > 3 && sel.includes(awayShort))) return "away";
  }
  return null;
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

async function fetchNbaOddsPaginated(
  date: string,
  apiKey: string,
  log: (msg: string) => void,
): Promise<SharpOddsRow[]> {
  const all: SharpOddsRow[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const url = `${SHARP_API_BASE}/odds?league=nba&date=${date}&limit=100&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      log(`  ✗ /odds page offset=${offset} HTTP ${res.status}`);
      break;
    }
    const j = (await res.json()) as { data?: SharpOddsRow[] };
    const items = j.data ?? [];
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

async function loadNbaGamesForSlateDate(slateDate: string): Promise<GameRow[]> {
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date")
    .eq("sport", "nba")
    .eq("slate_date", slateDate);
  if (error !== null) throw new Error(`load NBA games failed: ${error.message}`);
  return ((data as unknown) ?? []) as GameRow[];
}

/**
 * Derive the set of UTC dates (YYYY-MM-DD) that SharpAPI should be
 * queried for, given the matched games. SharpAPI's /odds endpoint
 * filters by UTC date, so a single ET slate with a late tip lives
 * under the NEXT UTC date. NBA evenings typically have one UTC date;
 * a mixed matinee + late-tip slate would have two.
 */
function sharpApiDatesForGames(games: GameRow[]): string[] {
  const set = new Set<string>();
  for (const g of games) set.add(g.game_date.slice(0, 10));
  return [...set].sort();
}

async function loadNbaTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, display_name, abbreviation")
    .eq("sport", "nba");
  if (error !== null) throw new Error(`load NBA teams failed: ${error.message}`);
  return ((data as unknown) ?? []) as TeamRow[];
}

function matchGame(
  homeTeamName: string,
  awayTeamName: string,
  games: GameRow[],
  teamById: Map<number, TeamRow>,
): GameRow | null {
  const homeLower = homeTeamName.toLowerCase();
  const awayLower = awayTeamName.toLowerCase();
  for (const g of games) {
    const home = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const away = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    if (!home || !away) continue;
    const homeMatches =
      home.display_name.toLowerCase().includes(homeLower) ||
      homeLower.includes(home.display_name.toLowerCase());
    const awayMatches =
      away.display_name.toLowerCase().includes(awayLower) ||
      awayLower.includes(away.display_name.toLowerCase());
    if (homeMatches && awayMatches) return g;
  }
  return null;
}

function buildLinePayload(
  row: SharpOddsRow,
  gameId: number,
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
): LineUpsertPayload | null {
  const sportsbook = (row.sportsbook ?? "").toLowerCase();
  if (sportsbook === "") return null;
  const american =
    asNumberOrNull(row.odds_american) ??
    americanFromDecimal(asNumberOrNull(row.odds_decimal) ?? asNumberOrNull(row.price));
  const decimal =
    asNumberOrNull(row.odds_decimal) ??
    asNumberOrNull(row.price) ??
    decimalFromAmerican(american);
  const lineValue =
    asNumberOrNull(row.line_value) ??
    asNumberOrNull(row.line) ??
    asNumberOrNull(row.point);
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
    ev_percent: asNumberOrNull(row.ev_percent),
    fair_odds: asNumberOrNull(row.fair_odds),
  };
}

/**
 * Refresh NBA lines from SharpAPI. See module docstring for the
 * service contract.
 */
export async function refreshNbaLines(
  opts: RefreshNbaLinesOptions,
): Promise<RefreshNbaLinesResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];

  // 1. Load NBA games for the ET slate-date.
  const games = await loadNbaGamesForSlateDate(opts.slateDate);
  log(`NBA games on slate ${opts.slateDate}: ${games.length}`);
  if (games.length === 0) {
    log(
      `(no NBA games in DB for slate_date ${opts.slateDate}; run seed-nba-finals.ts first)`,
    );
    return {
      mode: "no-games",
      gamesInDb: 0,
      oddsRowsFetched: 0,
      matched: 0,
      unmatched: 0,
      parsed: 0,
      linesWritten: 0,
      lineHistoryWritten: 0,
      errors,
    };
  }

  // 2. Load NBA teams for matching.
  const teams = await loadNbaTeams();
  const teamById = new Map<number, TeamRow>(teams.map((t) => [t.id, t]));

  // 3. Fetch SharpAPI odds for each distinct UTC date in the slate.
  // NBA evenings typically yield one UTC date; mixed matinee + late-tip
  // slates can span two. Distinct UTC dates are derived from the matched
  // games' game_date column.
  const sharpApiDates = sharpApiDatesForGames(games);
  log(`SharpAPI fetch dates (UTC): ${sharpApiDates.join(", ")}`);
  const oddsRows: SharpOddsRow[] = [];
  for (const sharpDate of sharpApiDates) {
    const batch = await fetchNbaOddsPaginated(sharpDate, opts.sharpApiKey, log);
    oddsRows.push(...batch);
  }
  log(`SharpAPI /odds rows fetched: ${oddsRows.length}`);

  // 4. Match + normalize + build payloads.
  let matched = 0;
  let unmatched = 0;
  let parsed = 0;
  const payloads: LineUpsertPayload[] = [];

  for (const r of oddsRows) {
    const home = r.home_team;
    const away = r.away_team;
    if (!home || !away) {
      unmatched++;
      continue;
    }
    const g = matchGame(home, away, games, teamById);
    if (g === null) {
      unmatched++;
      continue;
    }
    matched++;
    if (r.is_alternate_line === true) continue;
    // Note: NOT dropping rows with is_main_line === false. Some books (notably
    // onexbet) ship every line point with is_main_line=false and don't flag
    // any single row as "main". Dropping those silently loses real coverage —
    // the per-(market,side,sportsbook) dedupe pass below infers the listed
    // line by picking the row whose American odds are closest to -110 (the
    // central juice value), which mirrors how a human handicapper would
    // identify the main line in an un-flagged feed.
    const market = normalizeMarket(r.market ?? r.market_type);
    const side = normalizeSide(
      r.side ?? r.selection_type ?? r.outcome,
      r.selection,
      home,
      away,
    );
    if (market === null || side === null) continue;
    if ((market === "moneyline" || market === "spread") && side !== "home" && side !== "away") continue;
    if (market === "total" && side !== "over" && side !== "under") continue;
    const payload = buildLinePayload(r, g.id, market, side);
    if (payload === null) continue;
    // Track is_main_line flagging via a lightweight provenance tag so the
    // downstream dedupe can prefer flagged-main rows when the book DOES set
    // the flag (e.g. fliff), and fall back to odds-closest-to-110 only when
    // no row in the group is flagged.
    (payload as LineUpsertPayload & { _is_main_flag?: boolean | null })._is_main_flag =
      r.is_main_line === true ? true : r.is_main_line === false ? false : null;
    parsed++;
    payloads.push(payload);
  }

  // Dedupe per (game_id, market_type, side, sportsbook): SharpAPI ships
  // multiple line points per book for spread + total (no single "main"
  // designation when is_main_line is unset). Pick the row most likely to
  // represent the listed/main line:
  //   1. If any row in the group has is_main_line=true → take that.
  //   2. Otherwise → take the row with American odds closest to -110.
  //
  // This is intentionally lossy for line_history (we still archive all
  // observations via the line_history append below — that uses the same
  // `payloads` array). The dedupe applies only to the `lines` upsert path
  // where (game,market,side,sportsbook) needs a single canonical row.
  type Tagged = LineUpsertPayload & { _is_main_flag?: boolean | null };
  const dedupeByGroup = new Map<string, Tagged>();
  for (const p of payloads as Tagged[]) {
    const k = `${p.game_id}|${p.market_type}|${p.side}|${p.sportsbook}`;
    const existing = dedupeByGroup.get(k);
    if (existing === undefined) {
      dedupeByGroup.set(k, p);
      continue;
    }
    // Prefer flagged-main over anything else.
    if (existing._is_main_flag === true) continue;
    if (p._is_main_flag === true) { dedupeByGroup.set(k, p); continue; }
    // Tiebreak: row whose American odds are closest to -110.
    const dExisting = Math.abs((existing.odds_american ?? -110) + 110);
    const dNew = Math.abs((p.odds_american ?? -110) + 110);
    if (dNew < dExisting) dedupeByGroup.set(k, p);
  }
  const dedupedPayloads: LineUpsertPayload[] = [...dedupeByGroup.values()].map(
    (p) => {
      // Strip the tracking tag before write — schema doesn't have it.
      const { _is_main_flag: _unused, ...rest } = p as Tagged;
      return rest as LineUpsertPayload;
    },
  );

  log(
    `\nProcessed: matched=${matched} unmatched=${unmatched} parsed=${parsed}`,
  );

  log(
    `Dedupe per (game,market,side,sportsbook): kept ${dedupedPayloads.length} of ${payloads.length} parsed rows`,
  );

  // 5. Dry-run path: log a sample and exit.
  if (opts.dryRun) {
    log(`\n[dry-run] would upsert ${dedupedPayloads.length} lines row(s)`);
    for (const p of dedupedPayloads.slice(0, 6)) {
      log(
        `    game_id=${p.game_id} ${p.market_type}/${p.side} book=${p.sportsbook} line=${p.line_value} odds=${p.odds_american}`,
      );
    }
    if (dedupedPayloads.length > 6) log(`    … and ${dedupedPayloads.length - 6} more`);
    return {
      mode: "dry-run",
      gamesInDb: games.length,
      oddsRowsFetched: oddsRows.length,
      matched,
      unmatched,
      parsed,
      linesWritten: 0,
      lineHistoryWritten: 0,
      errors,
    };
  }

  // 6. Write path: delete then insert per (game_id, market_type, sportsbook).
  log(`\nApplying ${dedupedPayloads.length} rows…`);
  const groups = new Map<string, LineUpsertPayload[]>();
  for (const p of dedupedPayloads) {
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
      log(msg);
      errors.push(msg);
      continue;
    }
    const { error: insErr } = await supabase.from("lines").insert(group);
    if (insErr) {
      const msg = `  ✗ insert ${key}: ${insErr.message}`;
      log(msg);
      // Match pre-7K accounting: errors counter was incremented by
      // group.length on insert failure (one error per row in the group).
      for (let i = 0; i < group.length; i++) errors.push(msg);
      continue;
    }
    linesWritten += group.length;
  }

  // 7. line_history append-only snapshot (Phase v0c-DE).
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
    const flagged = await flagOpenersInHistoryPayload(historyRows);
    const { error: histErr } = await supabase.from("line_history").insert(flagged);
    if (histErr) {
      const msg = `  ✗ line_history insert: ${histErr.message}`;
      log(msg);
      for (let i = 0; i < flagged.length; i++) errors.push(msg);
    } else {
      lineHistoryWritten = flagged.length;
    }
  }

  return {
    mode: "write",
    gamesInDb: games.length,
    oddsRowsFetched: oddsRows.length,
    matched,
    unmatched,
    parsed,
    linesWritten,
    lineHistoryWritten,
    errors,
  };
}
