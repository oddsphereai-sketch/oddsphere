/**
 * Phase 7L Phase 1 — NHL lines refresh service.
 *
 * Input is ET slate_date; DB lookup filters by games.slate_date equality,
 * then matches Owls rows by canonical teams and provider start time. Late
 * tips that live in UTC the next day are found cleanly.
 *
 * Scope:
 *   • Reads:  Owls /odds (NHL), our games + teams (sport='nhl').
 *   • Writes: lines (sport-agnostic via game_id FK), line_history
 *             (append-only intraday snapshots).
 *   • NEVER writes any other table.
 *   • OWLS_INSIGHT_API_KEY received by argument; never logged.
 *
 * Markets: moneyline + total + spread, complete two-sided pairs only.
 */

import { supabase } from "../../db/supabase";
import {
  fetchSharpNhlEventOdds,
  fetchSharpNhlEvents,
  type SharpNhlEvent,
  type SharpNhlOddsRow,
} from "../../providers/nhl/_sharpApiNhlClient";
import { normalizeNhlTeamName, type NhlTeamAbbrev } from "../../providers/nhl/_teamNameNormalizer";
import { OwlsInsightClient } from "../../providers/owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookOdds,
  type RawOwlsOddsResponse,
} from "../../providers/owls/owlsSharpBookOdds";
import { flagOpenersInHistoryPayload } from "../_lineHistoryOpenerHelper";
import { loadCompleteCurrentGameLines } from "../currentGameLineReader";
import { replaceCurrentGameLinesBatched } from "../currentGameLinesBatchWriter";
import { canonicalizeNhlLineRows } from "./nhlLineBoard";
import { requiresNhlPregameMarketCoverage } from "./nhlPregameCoverage";

export type RefreshNhlLinesOptions = {
  /** ET sports-day in YYYY-MM-DD. Filters games.slate_date directly. */
  slateDate: string;
  /** Owls is the active production source for complete Circa/Pinnacle pairs. */
  owlsApiKey?: string;
  /** Legacy operator-only fallback; active crons do not pass this. */
  sharpApiKey?: string;
  dryRun: boolean;
  /** Optional exact NHL API game ids for a targeted pre-lock refresh. */
  externalIdsFilter?: number[];
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
  linesReverified: number;
  lineGroupsVerified: number;
  lineGroupsChanged: number;
  lineHistoryWritten: number;
  /** Canonical complete provider board used by read-only impact audits. */
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
  status: string | null;
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

type PreparedLinePayload = LinePayload & {
  source_timestamp: string | null;
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
    .select("id, external_id, home_team_id, away_team_id, game_date, status")
    .eq("sport", "nhl")
    .eq("slate_date", slateDate);
  if (error !== null) throw new Error(`load NHL games failed: ${error.message}`);
  return ((data as unknown) ?? []) as GameRow[];
}

async function loadFullyLockedNhlGameIds(gameIds: number[]): Promise<Set<number>> {
  if (gameIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id, market, locked_at")
    .eq("sport", "nhl")
    .in("game_id", gameIds)
    .in("market", ["moneyline", "total", "spread"])
    .not("locked_at", "is", null);
  if (error !== null) throw new Error(`load NHL locked coverage failed: ${error.message}`);
  const marketsByGame = new Map<number, Set<string>>();
  for (const row of data ?? []) {
    const markets = marketsByGame.get(Number(row.game_id)) ?? new Set<string>();
    markets.add(String(row.market));
    marketsByGame.set(Number(row.game_id), markets);
  }
  return new Set(
    [...marketsByGame]
      .filter(([, markets]) => ["moneyline", "total", "spread"].every((market) => markets.has(market)))
      .map(([gameId]) => gameId),
  );
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

function eventCandidateScore(
  event: SharpNhlEvent,
  game: GameRow,
  home: NhlTeamAbbrev,
  away: NhlTeamAbbrev,
): number {
  if (!event.id || !event.home_team?.trim() || !event.away_team?.trim()) return Number.NEGATIVE_INFINITY;
  const eventHome = normalizeNhlTeamName(event.home_team);
  const eventAway = normalizeNhlTeamName(event.away_team);
  if (eventHome !== home || eventAway !== away) return Number.NEGATIVE_INFINITY;
  const deltaMinutes = Math.abs(Date.parse(event.start_time ?? "") - Date.parse(game.game_date)) / 60_000;
  if (!Number.isFinite(deltaMinutes) || deltaMinutes > 12 * 60) return Number.NEGATIVE_INFINITY;
  return (event.market_count ?? 0) * 1_000 - deltaMinutes;
}

export function selectSharpNhlEvent(
  events: SharpNhlEvent[],
  game: GameRow,
  home: NhlTeamAbbrev,
  away: NhlTeamAbbrev,
): SharpNhlEvent | null {
  return events
    .map((event) => ({ event, score: eventCandidateScore(event, game, home, away) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)[0]?.event ?? null;
}

function buildPayload(
  row: SharpNhlOddsRow,
  gameId: number,
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
): PreparedLinePayload | null {
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
    source_timestamp: row.timestamp ?? null,
  };
}

export async function refreshNhlLines(
  opts: RefreshNhlLinesOptions,
): Promise<RefreshNhlLinesResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];

  const requestedExternalIds = opts.externalIdsFilter === undefined
    ? null
    : new Set(opts.externalIdsFilter);
  const games = (await loadNhlGamesForSlateDate(opts.slateDate)).filter((game) => (
    requestedExternalIds === null || requestedExternalIds.has(game.external_id)
  ));
  const fullyLockedGameIds = await loadFullyLockedNhlGameIds(games.map((game) => game.id));
  const pregameGames = games.filter((game) => requiresNhlPregameMarketCoverage(
    game.status,
    fullyLockedGameIds.has(game.id),
  ));
  log(`NHL games on slate ${opts.slateDate}: ${games.length}`);
  if (games.length === 0) {
    log(`(no NHL games in DB for slate_date ${opts.slateDate}; run seed-nhl-games.ts first)`);
    return {
      mode: "no-games", gamesInDb: 0, oddsRowsFetched: 0,
      matched: 0, unmatched: 0, parsed: 0,
      linesWritten: 0, linesReverified: 0,
      lineGroupsVerified: 0, lineGroupsChanged: 0,
      lineHistoryWritten: 0,
      canonicalLines: [],
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

  const oddsRows: SharpNhlOddsRow[] = [];
  let matched = 0;
  let unmatched = 0;
  let parsed = 0;
  const preparedPayloads: PreparedLinePayload[] = [];
  if (opts.owlsApiKey) {
    const response = await new OwlsInsightClient(opts.owlsApiKey).odds<RawOwlsOddsResponse>("nhl");
    const coverage = normalizeOwlsSharpBookOdds(response.body, "nhl");
    for (const row of coverage.prices) {
      const homeAbbr = normalizeNhlTeamName(row.homeTeam);
      const awayAbbr = normalizeNhlTeamName(row.awayTeam);
      const game = pregameGames.find((candidate) => {
        const abbrs = gameAbbrs.get(candidate.id);
        if (!abbrs || abbrs.home !== homeAbbr || abbrs.away !== awayAbbr) return false;
        const distanceMs = Math.abs(Date.parse(row.scheduledStart ?? "") - Date.parse(candidate.game_date));
        return Number.isFinite(distanceMs) && distanceMs <= 12 * 3_600_000;
      });
      if (!game) { unmatched++; continue; }
      matched++;
      parsed++;
      preparedPayloads.push({
        game_id: game.id,
        market_type: row.market,
        player_id: null,
        sportsbook: row.sportsbook,
        side: row.side,
        line_value: row.line,
        odds_american: row.americanPrice,
        odds_decimal: row.decimalPrice,
        implied_probability: impliedProbability(row.americanPrice),
        ev_percent: null,
        fair_odds: null,
        source_timestamp: row.observedAt,
      });
    }
    log(`Owls /odds normalized rows: ${preparedPayloads.length}`);
  } else if (opts.sharpApiKey) {
    const sharpApiDates = sharpApiDatesForGames(pregameGames);
    log(`Legacy SharpAPI event dates (UTC): ${sharpApiDates.join(", ")}`);
    const events: SharpNhlEvent[] = [];
    for (const date of sharpApiDates) {
      try {
        events.push(...await fetchSharpNhlEvents(date, opts.sharpApiKey, log));
      } catch (error) {
        errors.push(`Legacy SharpAPI event catalog ${date}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const game of pregameGames) {
      const abbrs = gameAbbrs.get(game.id);
      if (!abbrs) {
        errors.push(`game_id=${game.id}: canonical NHL teams unavailable`);
        continue;
      }
      const event = selectSharpNhlEvent(events, game, abbrs.home, abbrs.away);
      if (!event?.id) {
        errors.push(`game_id=${game.id}: legacy SharpAPI event not found`);
        continue;
      }
      try {
        oddsRows.push(...await fetchSharpNhlEventOdds(event.id, opts.sharpApiKey, log));
      } catch (error) {
        errors.push(`game_id=${game.id}: legacy SharpAPI event odds failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    log(`Legacy SharpAPI /odds rows fetched: ${oddsRows.length}`);
  } else {
    throw new Error("Owls NHL odds key missing");
  }

  for (const r of oddsRows) {
    if (
      r.is_alternate_line === true
      || r.is_main_line === false
      || r.is_active === false
      || r.is_live === true
      || r.is_stale_pregame_price === true
    ) continue;
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
    preparedPayloads.push(payload);
  }
  const oddsRowsFetched = opts.owlsApiKey ? preparedPayloads.length : oddsRows.length;

  // A provider can return exact duplicates or multiple observations for one
  // named book. Keep the newest deterministic quote and only complete
  // two-sided pairs. A partial refresh leaves the prior complete DB group in
  // place instead of erasing a side from the member board.
  const sourceTimestampByIdentity = new Map<string, string | null>();
  const payloads: LinePayload[] = canonicalizeNhlLineRows(preparedPayloads).map(({ source_timestamp, ...payload }) => {
    sourceTimestampByIdentity.set(
      `${payload.game_id}|${payload.market_type}|${payload.sportsbook}|${payload.side}|${payload.line_value ?? "null"}|${payload.odds_american ?? "null"}`,
      source_timestamp,
    );
    void source_timestamp;
    return payload;
  });
  const canonicalLines: RefreshNhlLinesResult["canonicalLines"] = payloads.map((line) => ({
    gameId: line.game_id,
    marketType: line.market_type as "moneyline" | "spread" | "total",
    sportsbook: line.sportsbook,
    side: line.side as "home" | "away" | "over" | "under",
    lineValue: line.line_value,
    oddsAmerican: line.odds_american,
  }));

  log(`\nProcessed: matched=${matched} unmatched=${unmatched} parsed=${parsed}`);

  const coverage = new Map<number, Map<string, Set<string>>>();
  for (const payload of payloads) {
    const gameMarkets = coverage.get(payload.game_id) ?? new Map<string, Set<string>>();
    const sides = gameMarkets.get(payload.market_type) ?? new Set<string>();
    sides.add(payload.side);
    gameMarkets.set(payload.market_type, sides);
    coverage.set(payload.game_id, gameMarkets);
  }
  for (const game of pregameGames) {
    const gameMarkets = coverage.get(game.id);
    for (const market of ["moneyline", "spread", "total"] as const) {
      const expectedSides = market === "total" ? ["over", "under"] : ["home", "away"];
      const sides = gameMarkets?.get(market);
      if (expectedSides.some((side) => !sides?.has(side))) {
        errors.push(`game_id=${game.id}: incomplete ${opts.owlsApiKey ? "Owls" : "legacy SharpAPI"} ${market} coverage`);
      }
    }
  }

  if (opts.dryRun) {
    log(`\n[dry-run] would upsert ${payloads.length} lines row(s)`);
    for (const p of payloads.slice(0, 8)) {
      log(`    game_id=${p.game_id} ${p.market_type}/${p.side} book=${p.sportsbook} line=${p.line_value} odds=${p.odds_american}`);
    }
    if (payloads.length > 8) log(`    … and ${payloads.length - 8} more`);
    return {
      mode: "dry-run", gamesInDb: games.length, oddsRowsFetched,
      matched, unmatched, parsed,
      linesWritten: 0, linesReverified: 0,
      lineGroupsVerified: 0, lineGroupsChanged: 0,
      lineHistoryWritten: 0,
      canonicalLines,
      errors,
    };
  }

  // Compare against the complete current board before replacement so flat
  // verification polls do not masquerade as economic movement in history.
  log(`\nApplying ${payloads.length} rows…`);
  const groups = new Map<string, LinePayload[]>();
  for (const p of payloads) {
    const k = `${p.game_id}|${p.market_type}|${p.sportsbook}`;
    const arr = groups.get(k) ?? [];
    arr.push(p);
    groups.set(k, arr);
  }
  const currentRows = await loadCompleteCurrentGameLines({
    client: supabase,
    gameIds: games.map((game) => game.id),
    marketTypes: ["moneyline", "total", "spread"],
    context: `refreshNhlLines slate=${opts.slateDate} current-board comparison`,
    pageSize: 1_000,
    // This high one-time repair ceiling lets the first deployment collapse
    // legacy duplicate generations. Healthy steady state is roughly two rows
    // per game/market/book and remains far below the bound.
    maxRows: 100_000,
  });
  const currentByGroup = new Map<string, Array<{
    id: number;
    game_id: number;
    market_type: string;
    sportsbook: string;
    side: string;
    line_value: number | null;
    odds_american: number | null;
    fetched_at: string | null;
  }>>();
  for (const row of currentRows) {
    if (row.side === null) continue;
    const key = `${row.game_id}|${row.market_type}|${row.sportsbook}`;
    const list = currentByGroup.get(key) ?? [];
    list.push({
      id: Number(row.id),
      game_id: row.game_id,
      market_type: row.market_type,
      sportsbook: row.sportsbook,
      side: String(row.side),
      line_value: row.line_value as number | null,
      odds_american: row.odds_american as number | null,
      fetched_at: row.fetched_at,
    });
    currentByGroup.set(key, list);
  }
  const rowSignature = (row: { side: string; line_value: number | null; odds_american: number | null }): string => (
    `${row.side}|${row.line_value ?? "null"}|${row.odds_american ?? "null"}`
  );
  const groupSignature = (rows: Array<{ side: string; line_value: number | null; odds_american: number | null }>): string => (
    rows.map(rowSignature).sort().join(";")
  );
  const currentSignature = (rows: ReturnType<typeof currentByGroup.get>): string => {
    const canonical = canonicalizeNhlLineRows((rows ?? []).map((row) => ({
      ...row,
      observed_at: row.fetched_at,
    })));
    const newestObserved = Math.max(...canonical.map((row) => Date.parse(row.observed_at ?? "")));
    if (!Number.isFinite(newestObserved)) return "";
    return groupSignature(canonical.filter((row) => Date.parse(row.observed_at ?? "") === newestObserved));
  };
  const changedPayloads: LinePayload[] = [];
  let unchangedPayloadRows = 0;
  for (const [key, group] of groups) {
    if (groupSignature(group) === currentSignature(currentByGroup.get(key))) {
      unchangedPayloadRows += group.length;
      continue;
    }
    changedPayloads.push(...group);
  }

  // Every successfully returned complete provider tuple is a current quote,
  // even when its economics are unchanged. Replace the current table in
  // bounded batches so fetched_at means "last explicitly verified" while
  // line_history remains economic-change-only. The same replacement also
  // collapses legacy duplicate current generations left by truncated reads.
  const replacement = await replaceCurrentGameLinesBatched(
    supabase,
    payloads,
    `refreshNhlLines slate=${opts.slateDate}`,
    { maxPriorRows: 100_000 },
  );
  if (replacement.failedGroups > 0 || replacement.cleanupFailedGroups > 0) {
    errors.push(
      replacement.firstError
      ?? `NHL current-board replacement failed for ${replacement.failedGroups} group(s)`,
    );
  }
  const linesWritten = replacement.insertedRows;
  const lineGroupsVerified = replacement.insertedGroups;
  const completeReplacement = replacement.failedGroups === 0 && replacement.cleanupFailedGroups === 0;
  const linesReverified = completeReplacement ? unchangedPayloadRows : 0;
  const lineGroupsChanged = completeReplacement
    ? new Set(changedPayloads.map((row) => `${row.game_id}|${row.market_type}|${row.sportsbook}`)).size
    : 0;

  const historyRows: LineHistoryPayload[] = (completeReplacement ? changedPayloads : []).map((p) => ({
    game_id: p.game_id,
    market_type: p.market_type,
    player_id: null,
    sportsbook: p.sportsbook,
    side: p.side,
    line_value: p.line_value,
    odds_american: p.odds_american,
    is_opener: false,
    recorded_at: sourceTimestampByIdentity.get(
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
    oddsRowsFetched,
    matched, unmatched, parsed,
    linesWritten, linesReverified,
    lineGroupsVerified, lineGroupsChanged,
    lineHistoryWritten,
    canonicalLines,
    errors,
  };
}
