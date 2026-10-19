/**
 * Phase 7K Service 3 — NBA odds/lines refresh service.
 *
 * Extracted from scripts/operator/nba/refresh-nba-lines.ts so the same
 * flow can be driven by the upcoming /api/cron/nba-daily-refresh route.
 * The operator stays as a thin CLI wrapper.
 *
 * What this does:
 *   • Loads NBA games + teams for the requested date.
 *   • Fetches the current NBA board from SharpAPI /odds, one canonical
 *     game market at a time, using cursor pagination. SharpAPI does not
 *     document a `date` filter on this endpoint; slate isolation happens
 *     locally through exact home/away matching against the requested games.
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
import { normalizeTeamAbbr } from "../../providers/playbook/playbookTeamNormalizer";
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
  /** Optional bounded T-60 refresh; absent means the full slate. */
  externalIdsFilter?: readonly number[];
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
  /** Canonical main-line snapshot used by dry-run board-impact audits. */
  canonicalLines: Array<{
    gameId: number;
    marketType: "moneyline" | "spread" | "total";
    sportsbook: string;
    side: "home" | "away" | "over" | "under";
    lineValue: number | null;
    oddsAmerican: number | null;
  }>;
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
  is_stale_pregame_price?: boolean;
  is_live?: boolean;
  event_start_time?: string;
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
    const selectionAbbr = normalizeTeamAbbr("nba", selection);
    const homeAbbr = normalizeTeamAbbr("nba", homeTeam);
    const awayAbbr = normalizeTeamAbbr("nba", awayTeam);
    if (selectionAbbr !== null && selectionAbbr === homeAbbr) return "home";
    if (selectionAbbr !== null && selectionAbbr === awayAbbr) return "away";
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

const NBA_GAME_MARKETS = ["moneyline", "point_spread", "total_points"] as const;
const MAX_PAGES_PER_NBA_GAME_MARKET = 25;

type SharpEventRow = {
  id?: string;
  event_id?: string;
  home_team?: string;
  away_team?: string;
  event_start_time?: string;
  start_time?: string;
  league?: string;
};

export async function fetchNbaCurrentEvents(
  apiKey: string,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<SharpEventRow[]> {
  const all: SharpEventRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const cursorQuery = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await fetchImpl(
      `${SHARP_API_BASE}/events?league=nba&limit=100${cursorQuery}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!response.ok) {
      throw new Error(`SharpAPI NBA /events page=${page + 1} HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: SharpEventRow[];
      pagination?: { has_more?: boolean; next_cursor?: string | null };
    };
    all.push(...(body.data ?? []));
    const next = body.pagination?.next_cursor ?? null;
    if (!body.pagination?.has_more || next === null || next === "") return all;
    cursor = next;
  }
  log("  ✗ /events hit the 10-page safety cap");
  throw new Error("SharpAPI NBA /events exceeded the 10-page safety cap");
}

export async function fetchNbaCurrentOddsBoard(
  apiKey: string,
  log: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
  eventIds: readonly string[] = [],
): Promise<SharpOddsRow[]> {
  const all: SharpOddsRow[] = [];
  const targets: Array<{ market: typeof NBA_GAME_MARKETS[number]; eventId: string | null }> =
    eventIds.length > 0
      ? eventIds.flatMap((eventId) => NBA_GAME_MARKETS.map((market) => ({ market, eventId })))
      : NBA_GAME_MARKETS.map((market) => ({ market, eventId: null }));
  for (const { market, eventId } of targets) {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES_PER_NBA_GAME_MARKET; page++) {
      const cursorQuery = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
      const eventQuery = eventId === null ? "" : `&event_id=${encodeURIComponent(eventId)}`;
      const url = `${SHARP_API_BASE}/odds?league=nba&market_type=${market}${eventQuery}&limit=100${cursorQuery}`;
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) {
        log(`  ✗ /odds market=${market} event=${eventId ?? "all"} page=${page + 1} HTTP ${res.status}`);
        break;
      }
      const j = (await res.json()) as {
        data?: SharpOddsRow[];
        pagination?: { has_more?: boolean; next_cursor?: string | null };
      };
      const items = j.data ?? [];
      all.push(...items);
      const next = j.pagination?.next_cursor ?? null;
      if (!j.pagination?.has_more || next === null || next === "") break;
      cursor = next;
      if (page === MAX_PAGES_PER_NBA_GAME_MARKET - 1) {
        throw new Error(
          `SharpAPI NBA /odds market=${market} event=${eventId ?? "all"} exceeded the ${MAX_PAGES_PER_NBA_GAME_MARKET}-page safety cap`,
        );
      }
    }
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
  const providerHome = normalizeTeamAbbr("nba", homeTeamName);
  const providerAway = normalizeTeamAbbr("nba", awayTeamName);
  if (providerHome !== null && providerAway !== null) {
    for (const game of games) {
      const storedHome = game.home_team_id !== null ? teamById.get(game.home_team_id) : undefined;
      const storedAway = game.away_team_id !== null ? teamById.get(game.away_team_id) : undefined;
      if (!storedHome || !storedAway) continue;
      if (
        normalizeTeamAbbr("nba", storedHome.display_name) === providerHome &&
        normalizeTeamAbbr("nba", storedAway.display_name) === providerAway
      ) return game;
    }
    return null;
  }
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

export const __NBA_LINES_TEST__ = {
  eventIdsForGames,
  matchGame,
  normalizeSide,
};

function eventIdsForGames(
  events: readonly SharpEventRow[],
  games: GameRow[],
  teamById: Map<number, TeamRow>,
): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    const eventId = event.id ?? event.event_id;
    const home = event.home_team;
    const away = event.away_team;
    const startsAt = event.event_start_time ?? event.start_time;
    if (!eventId || !home || !away || !startsAt) continue;
    const game = matchGame(home, away, games, teamById);
    if (!game) continue;
    const distanceMs = Math.abs(Date.parse(startsAt) - Date.parse(game.game_date));
    if (!Number.isFinite(distanceMs) || distanceMs > 18 * 3_600_000) continue;
    ids.add(eventId);
  }
  return [...ids].sort();
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
  const allGames = await loadNbaGamesForSlateDate(opts.slateDate);
  const filter = opts.externalIdsFilter === undefined ? null : new Set(opts.externalIdsFilter);
  const games = filter === null ? allGames : allGames.filter((game) => filter.has(game.external_id));
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
      canonicalLines: [],
      errors,
    };
  }

  // 2. Load NBA teams for matching.
  const teams = await loadNbaTeams();
  const teamById = new Map<number, TeamRow>(teams.map((t) => [t.id, t]));

  // 3. Discover the provider's exact event ids, then fetch only those events'
  // three game markets. SharpAPI does not document a date filter; its old
  // ignored `date` query made this writer download an unrelated board. Event
  // identity plus team and start-time matching prevents future same-pair games
  // and thousands of alternate lines from exhausting global pagination.
  const events = await fetchNbaCurrentEvents(opts.sharpApiKey, log);
  const eventIds = eventIdsForGames(events, games, teamById);
  log(`SharpAPI matched event ids: ${eventIds.length}`);
  const oddsRows = eventIds.length === 0
    ? []
    : await fetchNbaCurrentOddsBoard(opts.sharpApiKey, log, fetch, eventIds);
  log(`SharpAPI /odds rows fetched: ${oddsRows.length}`);

  // 4. Match + normalize + build payloads.
  let matched = 0;
  let unmatched = 0;
  let parsed = 0;
  const payloads: LineUpsertPayload[] = [];

  for (const r of oddsRows) {
    if (r.is_live === true || r.is_stale_pregame_price === true) continue;
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
  // The same canonical snapshot is written to both `lines` and
  // `line_history`. Archiving every unflagged alternate as if it were the
  // main line makes an opening-to-current reader invent movement within a
  // single provider response. Alternate-line prices require their own
  // price-aware contract rather than contaminating main-line chronology.
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
      const rest = { ...p };
      delete rest._is_main_flag;
      return rest;
    },
  );
  const canonicalLines: RefreshNbaLinesResult["canonicalLines"] = dedupedPayloads.map((line) => ({
    gameId: line.game_id,
    marketType: line.market_type as "moneyline" | "spread" | "total",
    sportsbook: line.sportsbook,
    side: line.side as "home" | "away" | "over" | "under",
    lineValue: line.line_value,
    oddsAmerican: line.odds_american,
  }));

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
      canonicalLines,
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
  const historyRows: LineHistoryPayload[] = dedupedPayloads.map((p) => ({
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
    canonicalLines,
    errors,
  };
}
