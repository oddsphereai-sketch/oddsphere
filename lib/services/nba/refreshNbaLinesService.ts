/**
 * Phase 7K Service 3 — NBA odds/lines refresh service.
 *
 * Extracted from scripts/operator/nba/refresh-nba-lines.ts so the same
 * flow can be driven by the upcoming /api/cron/nba-daily-refresh route.
 * The operator stays as a thin CLI wrapper.
 *
 * What this does:
 *   • Loads NBA games + teams for the requested date.
 *   • Fetches the real consumer NBA board from BALLDONTLIE GOAT plus the
 *     Circa/Pinnacle sharp board from Owls. Slate isolation happens locally
 *     through exact home/away and start-time matching.
 *   • Matches each odds row to one of our `games` rows by team-name
 *     overlap (display_name + last-token fallback).
 *   • Normalizes market + side, builds (game_id, market_type,
 *     sportsbook, side) payloads.
 *   • Apply path: insert each complete current game/market snapshot, then
 *     remove the exact prior rows for that scope. A failed insert preserves
 *     the prior complete board; a successful cycle removes absent books.
 *     The service also appends an intraday line_history snapshot.
 *   • NEVER writes any other table; NEVER touches MLB rows.
 *
 * Service contract (vs. CLI wrapper):
 *   • NO process.exit / process.argv / process.env access.
 *   • Caller passes `owlsApiKey` directly — service does NOT read
 *     provider credentials from env. NEVER logs the key.
 *   • Caller-supplied logger; service runs silent when omitted.
 *   • Returns a typed Result with per-step counts so the cron route
 *     can log structured outcomes to data_refresh_log.
 *   • mode="no-games" short-circuits before any provider fetch (saves
 *     a request when there's nothing to match against).
 */

import { supabase } from "../../db/supabase";
import { normalizeTeamAbbr } from "../../providers/playbook/playbookTeamNormalizer";
import { OwlsInsightClient } from "../../providers/owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookOdds,
  type RawOwlsOddsResponse,
} from "../../providers/owls/owlsSharpBookOdds";
import { flagOpenersInHistoryPayload } from "../_lineHistoryOpenerHelper";
import { fetchNbaBdlRetailOdds } from "./balldontlieNbaRetailOdds";
import {
  isNbaConsumerExecutionSportsbook,
  isNbaSharpReaderSportsbook,
} from "./nbaMarketSourceEligibility";

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
  /** Owls is the active production source for complete Circa/Pinnacle pairs. */
  owlsApiKey?: string;
  /** BALLDONTLIE GOAT supplies the real multi-book consumer execution board. */
  ballDontLieApiKey?: string;
  /** Legacy operator-only fallback; active crons do not pass this. */
  sharpApiKey?: string;
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
  linesRemoved: number;
  lineHistoryWritten: number;
  scopesReconciled: number;
  incompleteBookGroupsDropped: number;
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
  provider_timestamp?: string;
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

type PreparedLineUpsertPayload = LineUpsertPayload & { source_timestamp: string | null };

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
const NBA_CURRENT_LINE_MARKETS = ["moneyline", "spread", "total"] as const;
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
        const message = `SharpAPI NBA /odds market=${market} event=${eventId ?? "all"} page=${page + 1} HTTP ${res.status}`;
        log(`  ✗ ${message}`);
        throw new Error(message);
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

type NbaEventTarget = { eventId: string; gameId: number; distanceMs: number };

function eventTargetsForGames(
  events: readonly SharpEventRow[],
  games: GameRow[],
  teamById: Map<number, TeamRow>,
): NbaEventTarget[] {
  const closestByGame = new Map<number, NbaEventTarget>();
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
    const previous = closestByGame.get(game.id);
    if (previous === undefined || distanceMs < previous.distanceMs) {
      closestByGame.set(game.id, { eventId, gameId: game.id, distanceMs });
    }
  }
  return [...closestByGame.values()].sort((left, right) => left.eventId.localeCompare(right.eventId));
}

function eventIdsForGames(
  events: readonly SharpEventRow[],
  games: GameRow[],
  teamById: Map<number, TeamRow>,
): string[] {
  return eventTargetsForGames(events, games, teamById).map((target) => target.eventId);
}

function isCompleteExecutableBookPair(rows: readonly LineUpsertPayload[]): boolean {
  if (rows.length !== 2 || rows.some((row) => row.odds_american === null)) return false;
  const market = rows[0]?.market_type;
  const bySide = new Map(rows.map((row) => [row.side, row]));
  if (market === "moneyline") return bySide.has("home") && bySide.has("away");
  if (market === "spread") {
    const home = bySide.get("home")?.line_value;
    const away = bySide.get("away")?.line_value;
    return home !== null && home !== undefined && away !== null && away !== undefined && Math.abs(home + away) < 0.01;
  }
  if (market === "total") {
    const over = bySide.get("over")?.line_value;
    const under = bySide.get("under")?.line_value;
    return over !== null && over !== undefined && under !== null && under !== undefined && Math.abs(over - under) < 0.01;
  }
  return false;
}

function selectCompleteExecutableBookPairs(payloads: readonly LineUpsertPayload[]): {
  rows: LineUpsertPayload[];
  incompleteGroups: number;
} {
  const byBookMarket = new Map<string, LineUpsertPayload[]>();
  for (const row of payloads) {
    const key = `${row.game_id}|${row.market_type}|${row.sportsbook}`;
    const group = byBookMarket.get(key) ?? [];
    group.push(row);
    byBookMarket.set(key, group);
  }
  const rows: LineUpsertPayload[] = [];
  let incompleteGroups = 0;
  for (const group of byBookMarket.values()) {
    if (!isCompleteExecutableBookPair(group)) {
      incompleteGroups++;
      continue;
    }
    rows.push(...group);
  }
  return { rows, incompleteGroups };
}

export const __NBA_LINES_TEST__ = {
  eventIdsForGames,
  eventTargetsForGames,
  matchGame,
  normalizeSide,
  selectCompleteExecutableBookPairs,
};

function buildLinePayload(
  row: SharpOddsRow,
  gameId: number,
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
): PreparedLineUpsertPayload | null {
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
    source_timestamp: row.provider_timestamp ?? row.last_seen_at ?? row.wire_received_at ?? null,
  };
}

/**
 * Refresh NBA lines from Owls. See module docstring for the
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
      linesRemoved: 0,
      lineHistoryWritten: 0,
      scopesReconciled: 0,
      incompleteBookGroupsDropped: 0,
      canonicalLines: [],
      errors,
    };
  }

  // 2. Load NBA teams for matching.
  const teams = await loadNbaTeams();
  const teamById = new Map<number, TeamRow>(teams.map((t) => [t.id, t]));

  // 3. Fetch one league-level Owls sharp board plus the date-scoped
  // BALLDONTLIE consumer board in production. The legacy SharpAPI
  // branch remains only for focused operator compatibility while the old
  // account is retired; active cron callers pass owlsApiKey exclusively.
  // three game markets. SharpAPI does not document a date filter; its old
  // ignored `date` query made this writer download an unrelated board. Event
  // identity plus team and start-time matching prevents future same-pair games
  // and thousands of alternate lines from exhausting global pagination.
  let oddsRows: SharpOddsRow[] = [];
  const sharpGameIds = new Set<number>();
  const retailGameIds = new Set<number>();
  if (opts.owlsApiKey) {
    const response = await new OwlsInsightClient(opts.owlsApiKey).odds<RawOwlsOddsResponse>("nba");
    const coverage = normalizeOwlsSharpBookOdds(response.body, "nba");
    oddsRows = coverage.prices.flatMap((row) => {
      const game = matchGame(row.homeTeam, row.awayTeam, games, teamById);
      const distanceMs = game === null || row.scheduledStart === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(Date.parse(row.scheduledStart) - Date.parse(game.game_date));
      if (game === null || !Number.isFinite(distanceMs) || distanceMs > 18 * 3_600_000) return [];
      sharpGameIds.add(game.id);
      return [{
        event_id: row.providerEventId,
        sportsbook: row.sportsbook,
        market_type: row.market,
        side: row.side,
        line: row.line,
        odds_american: row.americanPrice,
        odds_decimal: row.decimalPrice,
        home_team: row.homeTeam,
        away_team: row.awayTeam,
        event_start_time: row.scheduledStart ?? undefined,
        provider_timestamp: row.observedAt,
        is_main_line: true,
      }];
    });
    if (sharpGameIds.size < games.length) {
      errors.push(`Owls NBA event identity unavailable for ${games.length - sharpGameIds.size} of ${games.length} scoped game(s); unmatched games preserved.`);
    }
    log(`Owls /odds normalized rows: ${oddsRows.length}`);
  } else if (opts.sharpApiKey) {
    const events = await fetchNbaCurrentEvents(opts.sharpApiKey, log);
    const eventTargets = eventTargetsForGames(events, games, teamById);
    const eventIds = eventTargets.map((target) => target.eventId);
    eventTargets.forEach((target) => sharpGameIds.add(target.gameId));
    if (eventTargets.length < games.length) {
      errors.push(`Legacy SharpAPI NBA event identity unavailable for ${games.length - eventTargets.length} of ${games.length} scoped game(s); unmatched games preserved.`);
    }
    oddsRows = eventIds.length === 0
      ? []
      : await fetchNbaCurrentOddsBoard(opts.sharpApiKey, log, fetch, eventIds);
    log(`Legacy SharpAPI /odds rows fetched: ${oddsRows.length}`);
  } else {
    throw new Error("Owls NBA odds key missing");
  }

  if (opts.ballDontLieApiKey) {
    const retail = await fetchNbaBdlRetailOdds({
      slateDate: opts.slateDate,
      apiKey: opts.ballDontLieApiKey,
    });
    const providerGameById = new Map(retail.games.map((game) => [game.providerGameId, game]));
    const storedGameByProviderId = new Map<number, GameRow>();
    for (const providerGame of retail.games) {
      const storedGame = matchGame(providerGame.homeTeam, providerGame.awayTeam, games, teamById);
      const distanceMs = storedGame === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(Date.parse(providerGame.scheduledStart) - Date.parse(storedGame.game_date));
      if (storedGame === null || !Number.isFinite(distanceMs) || distanceMs > 18 * 3_600_000) continue;
      storedGameByProviderId.set(providerGame.providerGameId, storedGame);
      retailGameIds.add(storedGame.id);
    }
    const retailRows = retail.quotes.flatMap((quote): SharpOddsRow[] => {
      const providerGame = providerGameById.get(quote.providerGameId);
      const storedGame = storedGameByProviderId.get(quote.providerGameId);
      if (!providerGame || !storedGame) return [];
      return [{
        event_id: String(quote.providerGameId),
        sportsbook: quote.sportsbook,
        market_type: quote.market,
        side: quote.side,
        line: quote.line,
        odds_american: quote.americanPrice,
        home_team: providerGame.homeTeam,
        away_team: providerGame.awayTeam,
        event_start_time: providerGame.scheduledStart,
        provider_timestamp: quote.observedAt,
        is_main_line: true,
      }];
    });
    oddsRows.push(...retailRows);
    if (retailGameIds.size < games.length) {
      errors.push(`BALLDONTLIE NBA retail identity unavailable for ${games.length - retailGameIds.size} of ${games.length} scoped game(s); unmatched games preserved.`);
    }
    log(`BALLDONTLIE /v2/odds normalized retail rows: ${retailRows.length}`);
  } else if (opts.owlsApiKey) {
    throw new Error("BALLDONTLIE NBA retail odds key missing");
  }

  const reconciliationGameIds = opts.ballDontLieApiKey
    ? new Set([...sharpGameIds].filter((gameId) => retailGameIds.has(gameId)))
    : sharpGameIds;

  // 4. Match + normalize + build payloads.
  let matched = 0;
  let unmatched = 0;
  let parsed = 0;
  const payloads: PreparedLineUpsertPayload[] = [];

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
  type Tagged = PreparedLineUpsertPayload & { _is_main_flag?: boolean | null };
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
  const preparedByIdentity = new Map<string, string | null>();
  const dedupedPayloadsBeforePairGate: LineUpsertPayload[] = [...dedupeByGroup.values()].map(
    (p) => {
      // Strip the tracking tag before write — schema doesn't have it.
      const rest = { ...p };
      delete rest._is_main_flag;
      const { source_timestamp, ...payload } = rest;
      preparedByIdentity.set(
        `${payload.game_id}|${payload.market_type}|${payload.sportsbook}|${payload.side}|${payload.line_value ?? "null"}|${payload.odds_american ?? "null"}`,
        source_timestamp,
      );
      return payload;
    },
  );
  const completeBoard = selectCompleteExecutableBookPairs(dedupedPayloadsBeforePairGate);
  const dedupedPayloads = completeBoard.rows;
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
    `Dedupe per (game,market,side,sportsbook): kept ${dedupedPayloadsBeforePairGate.length} of ${payloads.length} parsed rows`,
  );
  log(
    `Executable pair gate: kept ${dedupedPayloads.length} rows; dropped ${completeBoard.incompleteGroups} incomplete sportsbook group(s)`,
  );

  if (opts.ballDontLieApiKey) {
    for (const gameId of reconciliationGameIds) {
      for (const market of NBA_CURRENT_LINE_MARKETS) {
        const scopeRows = dedupedPayloads.filter((row) => row.game_id === gameId && row.market_type === market);
        if (
          !scopeRows.some((row) => isNbaConsumerExecutionSportsbook(row.sportsbook)) ||
          !scopeRows.some((row) => isNbaSharpReaderSportsbook(row.sportsbook))
        ) {
          errors.push(`Dual-source NBA scope incomplete for ${gameId}|${market}.`);
        }
      }
    }
  }

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
      linesRemoved: 0,
      lineHistoryWritten: 0,
      scopesReconciled: reconciliationGameIds.size * NBA_GAME_MARKETS.length,
      incompleteBookGroupsDropped: completeBoard.incompleteGroups,
      canonicalLines,
      errors,
    };
  }

  // 6. Write path: reconcile one complete current game/market scope at a time.
  // Insert the fresh provider snapshot first. Only after that succeeds do we
  // remove the exact rows that existed before this cycle. This means a provider
  // or insert failure preserves the last complete board, while a successful
  // response removes books/sides that the provider no longer returns.
  log(`\nApplying ${dedupedPayloads.length} rows…`);
  const candidateRowsByScope = new Map<string, LineUpsertPayload[]>();
  const parsedRowsByScope = new Map<string, LineUpsertPayload[]>();
  for (const row of dedupedPayloads) {
    const key = `${row.game_id}|${row.market_type}`;
    const rows = candidateRowsByScope.get(key) ?? [];
    rows.push(row);
    candidateRowsByScope.set(key, rows);
  }
  for (const row of dedupedPayloadsBeforePairGate) {
    const key = `${row.game_id}|${row.market_type}`;
    const rows = parsedRowsByScope.get(key) ?? [];
    rows.push(row);
    parsedRowsByScope.set(key, rows);
  }

  let linesWritten = 0;
  let linesRemoved = 0;
  let scopesReconciled = 0;
  const writtenPayloads: LineUpsertPayload[] = [];
  for (const gameId of reconciliationGameIds) {
    for (const market of NBA_CURRENT_LINE_MARKETS) {
      const key = `${gameId}|${market}`;
      const proposed = candidateRowsByScope.get(key) ?? [];
      const parsedForScope = parsedRowsByScope.get(key) ?? [];

      // Rows were present but no complete same-book pair survived. Treat this
      // as malformed/partial evidence and preserve the prior board for retry.
      if (parsedForScope.length > 0 && proposed.length === 0) {
        const msg = `  ✗ preserve ${key}: provider rows contained no complete executable sportsbook pair`;
        log(msg);
        errors.push(msg);
        continue;
      }

      if (opts.ballDontLieApiKey && proposed.length > 0) {
        const hasConsumerExecutionPair = proposed.some((row) => isNbaConsumerExecutionSportsbook(row.sportsbook));
        const hasSharpPair = proposed.some((row) => isNbaSharpReaderSportsbook(row.sportsbook));
        if (!hasConsumerExecutionPair || !hasSharpPair) {
          const msg = `  ✗ preserve ${key}: complete consumer execution and sharp-reader pairs are both required`;
          log(msg);
          errors.push(msg);
          continue;
        }
      }

      if (proposed.length === 0) continue;
      // A complete dual-source cycle owns the full current scope. The legacy
      // Owls-only operator path manages only its two sharp books so it cannot
      // erase a previously captured retail board.
      const managedBooks = opts.ballDontLieApiKey ? null : opts.owlsApiKey ? ["circa", "pinnacle"] : null;
      const existingIds: number[] = [];
      for (let from = 0; ; from += 1000) {
        let existingQuery = supabase
          .from("lines")
          .select("id")
          .eq("game_id", gameId)
          .eq("market_type", market)
          .is("player_id", null);
        if (managedBooks !== null) existingQuery = existingQuery.in("sportsbook", managedBooks);
        const { data: existing, error: readErr } = await existingQuery.range(from, from + 999);
        if (readErr) {
          const msg = `  ✗ read existing ${key}: ${readErr.message}`;
          log(msg);
          errors.push(msg);
          existingIds.length = 0;
          break;
        }
        const page = ((existing as unknown) ?? []) as Array<{ id: number }>;
        existingIds.push(...page.map((row) => row.id));
        if (page.length < 1000) break;
      }
      if (errors.at(-1)?.startsWith(`  ✗ read existing ${key}:`)) continue;

      if (proposed.length > 0) {
        const { error: insErr } = await supabase.from("lines").insert(proposed);
        if (insErr) {
          const msg = `  ✗ insert current scope ${key}: ${insErr.message}`;
          log(msg);
          errors.push(msg);
          continue;
        }
        linesWritten += proposed.length;
        writtenPayloads.push(...proposed);
      }

      let scopeDeleteFailed = false;
      for (let index = 0; index < existingIds.length; index += 250) {
        const ids = existingIds.slice(index, index + 250);
        const { error: delErr } = await supabase.from("lines").delete().in("id", ids);
        if (delErr) {
          const msg = `  ✗ remove superseded ${key}: ${delErr.message}`;
          log(msg);
          errors.push(msg);
          scopeDeleteFailed = true;
          break;
        }
        linesRemoved += ids.length;
      }
      if (!scopeDeleteFailed) scopesReconciled++;
    }
  }

  // 7. line_history append-only snapshot (Phase v0c-DE).
  const historyRows: LineHistoryPayload[] = writtenPayloads.map((p) => ({
    game_id: p.game_id,
    market_type: p.market_type,
    player_id: null,
    sportsbook: p.sportsbook,
    side: p.side,
    line_value: p.line_value,
    odds_american: p.odds_american,
    is_opener: false,
    recorded_at: preparedByIdentity.get(
      `${p.game_id}|${p.market_type}|${p.sportsbook}|${p.side}|${p.line_value ?? "null"}|${p.odds_american ?? "null"}`,
    ) ?? new Date().toISOString(),
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
    linesRemoved,
    lineHistoryWritten,
    scopesReconciled,
    incompleteBookGroupsDropped: completeBoard.incompleteGroups,
    canonicalLines,
    errors,
  };
}
