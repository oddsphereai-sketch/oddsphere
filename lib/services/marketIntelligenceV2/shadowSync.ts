import type { SupabaseClient } from "@supabase/supabase-js";
import { PlaybookClient } from "../../providers/playbook/playbookClient";
import type { PlaybookLineGame, PlaybookSplitGame } from "../../providers/playbook/types";
import { SharpApiClient, SharpApiNotFoundError } from "../../providers/real_api/_sharpApiClient";
import { normalizeMlbTeamName } from "../../providers/real_api/_teamNameNormalizer";
import { buildGameKey, type NormalizerSport } from "../../providers/playbook/playbookTeamNormalizer";
import { readMarketIntelligenceV2Config } from "../../config/marketIntelligenceV2";
import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import type { Sport } from "../../types/domain/Sport";
import type {
  CanonicalObservationRejection,
  MarketIntelligenceMarketType,
  MarketIntelligenceSelectionSide,
  MarketPriceObservationV2,
  MarketSplitObservationV2,
} from "../../types/domain/MarketIntelligenceV2";
import {
  buildPlaybookSplitObservationsV2,
  buildSharpApiSplitHistoryObservationsV2,
  buildSharpApiPriceObservationV2,
  buildSharpApiSplitObservationsV2,
  playbookLineForSelection,
  sharpApiSplitHistoryObservedAt,
  type RawSharpApiSplitHistoryRowV2,
  type RawSharpApiSplitRowV2,
} from "./canonicalAdapters";

type GameRef = {
  id: number;
  externalId: number;
  slateDate: string | null;
  gameDate: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homeAbbr: string;
  awayAbbr: string;
  homeName: string;
  awayName: string;
};

type LineRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  fetched_at: string | null;
};

type SharpSplitRowWithTeams = RawSharpApiSplitRowV2 & {
  home_team?: string | null;
  away_team?: string | null;
};

type SharpEventCatalogRow = {
  id?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  start_time?: string | null;
  books?: string[] | null;
};

export type SharpSplitSlateAlignment = {
  aligned: boolean;
  validPairs: number;
  currentSlateMatches: number;
  previousSlateMatches: number;
  currentCoverage: number;
  eventDateMatches: number;
  eventDateMismatches: number;
  eventDateUnparseable: number;
  verifiedCurrentRows: number;
};

export function selectVerifiedSharpApiCurrentRows(
  rows: readonly SharpSplitRowWithTeams[],
  currentGames: readonly Pick<GameRef, "awayAbbr" | "homeAbbr">[],
  requestedSlateDate: string,
): SharpSplitRowWithTeams[] {
  const currentPairs = new Set(currentGames.map((game) => `${game.awayAbbr}@${game.homeAbbr}`));
  return rows.filter((row) => {
    const league = String(row.league ?? "").toLowerCase();
    if (league && league !== "mlb") return false;
    if (extractEventIdDate(row.event_id) !== requestedSlateDate) return false;
    const key = marketIntelligenceGameKey("mlb", row.away_team, row.home_team);
    return key !== null && currentPairs.has(key);
  });
}

/**
 * Whole-payload identity gate for the Market Intelligence observation writer.
 * SharpAPI can advance event-id dates before advancing matchup rows, so a
 * repeated series alone is not proof that the payload belongs to this slate.
 */
export function assessSharpApiSplitSlateAlignment(
  rows: readonly SharpSplitRowWithTeams[],
  currentGames: readonly Pick<GameRef, "awayAbbr" | "homeAbbr">[],
  previousGames: readonly Pick<GameRef, "awayAbbr" | "homeAbbr">[],
  requestedSlateDate: string,
): SharpSplitSlateAlignment {
  const rowPairs = new Set<string>();
  let eventDateMatches = 0;
  let eventDateMismatches = 0;
  let eventDateUnparseable = 0;
  for (const row of rows) {
    const league = String(row.league ?? "").toLowerCase();
    if (league && league !== "mlb") continue;
    const key = marketIntelligenceGameKey("mlb", row.away_team, row.home_team);
    if (key === null) continue;
    rowPairs.add(key);
    const eventDate = extractEventIdDate(row.event_id);
    if (eventDate === null) eventDateUnparseable++;
    else if (eventDate === requestedSlateDate) eventDateMatches++;
    else eventDateMismatches++;
  }
  const currentPairs = new Set(currentGames.map((game) => `${game.awayAbbr}@${game.homeAbbr}`));
  const previousPairs = new Set(previousGames.map((game) => `${game.awayAbbr}@${game.homeAbbr}`));
  const currentSlateMatches = Array.from(rowPairs).filter((key) => currentPairs.has(key)).length;
  const previousSlateMatches = Array.from(rowPairs).filter((key) => previousPairs.has(key)).length;
  const validPairs = rowPairs.size;
  const currentCoverage = validPairs === 0 ? 0 : currentSlateMatches / validPairs;
  const exactEventDateEvidence = eventDateMatches > 0 && eventDateMismatches === 0;
  const verifiedCurrentRows = selectVerifiedSharpApiCurrentRows(
    rows,
    currentGames,
    requestedSlateDate,
  ).length;
  return {
    aligned:
      validPairs > 0 &&
      currentCoverage >= 0.7 &&
      (currentSlateMatches > previousSlateMatches || exactEventDateEvidence),
    validPairs,
    currentSlateMatches,
    previousSlateMatches,
    currentCoverage,
    eventDateMatches,
    eventDateMismatches,
    eventDateUnparseable,
    verifiedCurrentRows,
  };
}

export type MarketIntelligenceV2ShadowSyncResult = {
  apply: boolean;
  sport: Sport;
  slateDate: string;
  gamesLoaded: number;
  playbookSplitRowsFetched: number;
  sharpapiSplitRowsFetched: number;
  splitObservationsBuilt: number;
  priceObservationsBuilt: number;
  splitObservationsWritten: number;
  priceObservationsWritten: number;
  rejected: CanonicalObservationRejection[];
  skippedTableMissing: boolean;
  errors: string[];
  details: Record<string, unknown>;
};

const MARKET_TYPES: readonly MarketIntelligenceMarketType[] = ["moneyline", "spread", "total"];
const SHARP_BOOKS = new Set(["pinnacle", "bookmaker", "circa"]);

function externalMarketId(game: GameRef, market: MarketIntelligenceMarketType): string {
  return `${game.externalId}:${market}`;
}

function externalSelectionKey(
  game: GameRef,
  market: MarketIntelligenceMarketType,
  side: MarketIntelligenceSelectionSide,
): string {
  return `${game.externalId}:${market}:${side}`;
}

function minutesToStart(gameDate: string | null, now: Date): number | null {
  if (!gameDate) return null;
  const t = Date.parse(gameDate);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / 60000);
}

function offsetDate(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function timeDistanceMs(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return null;
  return Math.abs(at - bt);
}

export function marketIntelligenceGameKey(
  sport: Sport | string,
  away: unknown,
  home: unknown,
): string | null {
  if (sport === "mlb") {
    const a = normalizeMlbTeamName(String(away ?? ""));
    const h = normalizeMlbTeamName(String(home ?? ""));
    return a && h ? `${a}@${h}` : null;
  }
  return buildGameKey(sport as NormalizerSport, away, home);
}

function extractEventIdDate(eventId: string | number | null | undefined): string | null {
  if (eventId === null || eventId === undefined) return null;
  const m = String(eventId).replace(/_b\d+(?:_g\d+)?$/, "").match(/_(\d{4}-\d{2}-\d{2})$/);
  return m?.[1] ?? null;
}

function stripSharpApiEventBucket(eventId: string): string {
  return eventId.replace(/_b\d+(?:_g\d+)?$/, "");
}

function isTableMissing(message: string): boolean {
  return /relation .* does not exist|Could not find the table|schema cache/i.test(message);
}

function isColumnMissing(message: string): boolean {
  return /column .* does not exist|Could not find .* column|schema cache/i.test(message);
}

function isConflictTargetMissing(message: string): boolean {
  return /no unique or exclusion constraint matching the ON CONFLICT specification/i.test(message);
}

export function isSharpApiHistoryUniqueConflict(message: string): boolean {
  return /market_split_observations_v2_sharp_history_source_uidx/i.test(message);
}

function stripV27SplitColumns(row: MarketSplitObservationV2): Omit<MarketSplitObservationV2, "split_line_basis" | "ingestion_run_id"> {
  const { split_line_basis: _splitLineBasis, ingestion_run_id: _ingestionRunId, ...legacyRow } = row;
  void _splitLineBasis;
  void _ingestionRunId;
  return legacyRow;
}

async function loadGames(
  supabase: SupabaseClient,
  sport: Sport,
  slateDate: string,
): Promise<GameRef[]> {
  return loadGamesForSlateWindow(supabase, sport, slateDate, slateDate);
}

async function loadGamesForSlateWindow(
  supabase: SupabaseClient,
  sport: Sport,
  slateDateFrom: string,
  slateDateTo: string,
): Promise<GameRef[]> {
  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, abbreviation, name")
    .eq("sport", sport);
  if (teamsErr) throw new Error(`teams fetch failed: ${teamsErr.message}`);
  const abbr = new Map<number, string>();
  const name = new Map<number, string>();
  for (const t of teams ?? []) {
    abbr.set(t.id as number, String(t.abbreviation ?? ""));
    name.set(t.id as number, String(t.name ?? ""));
  }

  const { data: games, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, home_team_id, away_team_id")
    .eq("sport", sport)
    .gte("slate_date", slateDateFrom)
    .lte("slate_date", slateDateTo);
  if (gamesErr) throw new Error(`games fetch failed: ${gamesErr.message}`);

  return (games ?? [])
    .filter((g) => typeof g.external_id === "number")
    .map((g) => {
      const homeTeamId = g.home_team_id as number;
      const awayTeamId = g.away_team_id as number;
      return {
        id: g.id as number,
        externalId: g.external_id as number,
        slateDate: (g.slate_date as string | null) ?? null,
        gameDate: (g.game_date as string | null) ?? null,
        homeTeamId,
        awayTeamId,
        homeAbbr: abbr.get(homeTeamId) ?? "",
        awayAbbr: abbr.get(awayTeamId) ?? "",
        homeName: name.get(homeTeamId) ?? "",
        awayName: name.get(awayTeamId) ?? "",
      };
    });
}

async function loadPriceObservations(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  games: readonly GameRef[];
  now: Date;
}): Promise<MarketPriceObservationV2[]> {
  if (opts.games.length === 0) return [];
  const gameById = new Map(opts.games.map((g) => [g.id, g]));
  const { data, error } = await opts.supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, odds_decimal, implied_probability, fetched_at")
    .in("game_id", opts.games.map((g) => g.id))
    .in("market_type", [...MARKET_TYPES])
    .is("player_id", null);
  if (error) throw new Error(`lines fetch failed: ${error.message}`);

  const out: MarketPriceObservationV2[] = [];
  for (const r of (data ?? []) as LineRow[]) {
    const game = gameById.get(r.game_id);
    if (!game) continue;
    if (isBlockedSportsbook(r.sportsbook)) continue;
    const market = r.market_type as MarketIntelligenceMarketType;
    if (!MARKET_TYPES.includes(market)) continue;
    const side = r.side as MarketIntelligenceSelectionSide | null;
    if (side !== "home" && side !== "away" && side !== "over" && side !== "under") continue;
    out.push(buildSharpApiPriceObservationV2({
      canonicalEventId: String(game.externalId),
      canonicalMarketId: externalMarketId(game, market),
      league: opts.sport,
      sportsbook: r.sportsbook,
      sharpBook: SHARP_BOOKS.has(r.sportsbook.toLowerCase()),
      marketType: market,
      selectionKey: externalSelectionKey(game, market, side),
      line: r.line_value,
      americanPrice: r.odds_american,
      decimalPrice: r.odds_decimal,
      noVigProbability: r.implied_probability,
      providerTimestamp: r.fetched_at,
      fetchedAt: new Date().toISOString(),
      minutesToStart: minutesToStart(game.gameDate, opts.now),
    }));
  }
  return out;
}

async function collectPlaybookSplits(opts: {
  sport: Sport;
  slateDate: string;
  todayUtc: string;
  games: readonly GameRef[];
  apiKey: string | undefined;
  now: Date;
  ingestionRunId: string;
}): Promise<{
  fetchedRows: number;
  observations: MarketSplitObservationV2[];
  rejected: CanonicalObservationRejection[];
  errors: string[];
  details?: Record<string, unknown>;
}> {
  if (!opts.apiKey) {
    return { fetchedRows: 0, observations: [], rejected: [], errors: ["PLAYBOOK_API_KEY missing; skipped Playbook v2 shadow splits"] };
  }
  const client = new PlaybookClient(opts.apiKey);
  const res = opts.slateDate === opts.todayUtc
    ? await client.splits(opts.sport)
    : await client.splitsHistory(opts.sport, opts.slateDate);
  let lineRows: PlaybookLineGame[] = [];
  if (opts.slateDate === opts.todayUtc) {
    try {
      const lineRes = await client.lines(opts.sport);
      lineRows = lineRes.body.data ?? [];
    } catch {
      lineRows = [];
    }
  }
  const rows = (((res.body as { data?: unknown[] }).data) ?? []) as PlaybookSplitGame[];
  const gamesByKey = new Map<string, GameRef[]>();
  for (const game of opts.games) {
    const key = opts.sport === "mlb"
      ? `${game.awayAbbr}@${game.homeAbbr}`
      : marketIntelligenceGameKey(opts.sport, game.awayName, game.homeName);
    if (key) {
      const list = gamesByKey.get(key) ?? [];
      list.push(game);
      gamesByKey.set(key, list);
    }
  }

  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  const lineByGameId = new Map<string, PlaybookLineGame>();
  for (const row of lineRows) {
    if (row.gameId) lineByGameId.set(row.gameId, row);
  }
  for (const row of rows) {
    const key = marketIntelligenceGameKey(opts.sport, row.awayTeamName, row.homeTeamName);
    const game = key ? findPlaybookGameMatch(gamesByKey.get(key) ?? [], row) : null;
    if (!game) {
      rejected.push({
        provider: "playbook",
        provider_event_id: row.gameId ?? null,
        market_type: null,
        selection_key: null,
        reason: `unmatched Playbook game ${row.awayTeamName ?? "?"}@${row.homeTeamName ?? "?"}`,
      });
      continue;
    }
    const built = buildPlaybookSplitObservationsV2({
      row,
      canonicalEventId: String(game.externalId),
      league: opts.sport,
      fetchedAt: opts.now.toISOString(),
      minutesToStart: minutesToStart(game.gameDate, opts.now),
      ingestionRunId: opts.ingestionRunId,
      pairedLine: (market, side) => playbookLineForSelection(lineByGameId.get(row.gameId), market, side),
      canonicalMarketId: (m) => externalMarketId(game, m),
      selectionKey: (m, s) => externalSelectionKey(game, m, s),
    });
    observations.push(...built.observations);
    rejected.push(...built.rejected);
  }
  return { fetchedRows: rows.length, observations, rejected, errors: [] };
}

type SharpHistoryExistingState = {
  latestByEventBook: Map<string, string>;
  existingObservationKeys: Set<string>;
};

const SHARP_HISTORY_SOURCE_BOOKS = new Set(["draftkings", "circa"]);

function sharpHistoryStateKey(eventId: string, sourceBook: string): string {
  return `${eventId}:${sourceBook}`;
}

function isSharpApiHistoryIdentityRow(row: Pick<MarketSplitObservationV2,
  "provider" | "source_book" | "source_observed_at"
>): boolean {
  return (
    row.provider === "sharpapi" &&
    SHARP_HISTORY_SOURCE_BOOKS.has(row.source_book) &&
    row.source_observed_at !== null
  );
}

export function sharpHistoryObservationKey(row: Pick<MarketSplitObservationV2,
  "provider" | "source_book" | "canonical_event_id" | "canonical_market_id" | "selection_key" | "source_observed_at"
>): string | null {
  if (!isSharpApiHistoryIdentityRow(row)) return null;
  return [
    row.provider,
    row.source_book,
    row.canonical_event_id,
    row.canonical_market_id,
    row.selection_key,
    row.source_observed_at,
  ].join("|");
}

export function dedupeSharpApiHistorySplitObservations(
  rows: readonly MarketSplitObservationV2[],
  existingObservationKeys: ReadonlySet<string> = new Set(),
): { rows: MarketSplitObservationV2[]; skipped: number } {
  const seen = new Set(existingObservationKeys);
  const out: MarketSplitObservationV2[] = [];
  let skipped = 0;
  for (const row of rows) {
    const key = sharpHistoryObservationKey(row);
    if (key !== null) {
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
    }
    out.push(row);
  }
  return { rows: out, skipped };
}

async function dedupeSharpApiHistorySplitObservationsFromDb(opts: {
  supabase: SupabaseClient;
  rows: readonly MarketSplitObservationV2[];
}): Promise<{ rows: MarketSplitObservationV2[]; skipped: number }> {
  if (!opts.rows.some(isSharpApiHistoryIdentityRow)) {
    return { rows: [...opts.rows], skipped: 0 };
  }
  const existing = await loadSharpHistoryExistingState({
    supabase: opts.supabase,
    canonicalEventIds: Array.from(new Set(
      opts.rows
        .filter(isSharpApiHistoryIdentityRow)
        .map((row) => row.canonical_event_id),
    )),
  });
  return dedupeSharpApiHistorySplitObservations(opts.rows, existing.existingObservationKeys);
}

async function loadSharpHistoryExistingState(opts: {
  supabase: SupabaseClient;
  canonicalEventIds: readonly string[];
}): Promise<SharpHistoryExistingState> {
  const latestByEventBook = new Map<string, string>();
  const existingObservationKeys = new Set<string>();
  if (opts.canonicalEventIds.length === 0) return { latestByEventBook, existingObservationKeys };

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await opts.supabase
      .from("market_split_observations_v2")
      .select("provider, source_book, canonical_event_id, canonical_market_id, selection_key, source_observed_at")
      .eq("provider", "sharpapi")
      .in("source_book", ["draftkings", "circa"])
      .in("canonical_event_id", opts.canonicalEventIds)
      .not("source_observed_at", "is", null)
      .range(from, from + pageSize - 1);
    if (error) {
      if (isTableMissing(error.message)) return { latestByEventBook, existingObservationKeys };
      throw new Error(`market_split_observations_v2 history state fetch failed: ${error.message}`);
    }
    const rows = (data ?? []) as Array<Pick<MarketSplitObservationV2,
      "provider" | "source_book" | "canonical_event_id" | "canonical_market_id" | "selection_key" | "source_observed_at"
    >>;
    for (const row of rows) {
      const obsKey = sharpHistoryObservationKey(row);
      if (obsKey) existingObservationKeys.add(obsKey);
      if (row.source_observed_at !== null) {
        const stateKey = sharpHistoryStateKey(row.canonical_event_id, row.source_book);
        const previous = latestByEventBook.get(stateKey);
        if (!previous || Date.parse(row.source_observed_at) > Date.parse(previous)) {
          latestByEventBook.set(stateKey, row.source_observed_at);
        }
      }
    }
    if (rows.length < pageSize) break;
  }
  return { latestByEventBook, existingObservationKeys };
}

function historyStartTimeForEvent(
  game: GameRef,
  state: SharpHistoryExistingState,
): string | null {
  const timestamps = ["draftkings", "circa"]
    .map((sourceBook) => state.latestByEventBook.get(sharpHistoryStateKey(String(game.externalId), sourceBook)))
    .filter((v): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)));
  if (timestamps.length === 0) return null;
  return timestamps.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

function sanitizeSharpSplitSample(row: SharpSplitRowWithTeams): Record<string, unknown> {
  return {
    event_id: row.event_id ?? null,
    league: row.league ?? null,
    sportsbook: row.sportsbook ?? null,
    has_moneyline: row.moneyline !== null && row.moneyline !== undefined,
    has_spread: row.spread !== null && row.spread !== undefined,
    has_total: row.total !== null && row.total !== undefined,
  };
}

function playbookStartTime(row: Pick<PlaybookSplitGame, "startTime" | "startTimeEst" | "date">): string | null {
  return row.startTime ?? row.startTimeEst ?? row.date ?? null;
}

function findPlaybookGameMatch(
  candidates: readonly GameRef[],
  row: PlaybookSplitGame,
): GameRef | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const providerStart = playbookStartTime(row);
  if (providerStart) {
    const byDistance = candidates
      .map((game) => ({ game, distance: timeDistanceMs(game.gameDate, providerStart) }))
      .filter((x): x is { game: GameRef; distance: number } => x.distance !== null)
      .sort((a, b) => a.distance - b.distance);
    const best = byDistance[0] ?? null;
    if (best && best.distance <= 6 * 60 * 60 * 1000) return best.game;
  }

  return null;
}

export function findSharpApiSplitGameMatches<T extends Pick<GameRef, "gameDate">>(
  candidates: readonly T[],
  providerEventId: string | null,
): T[] {
  if (candidates.length <= 1) return [...candidates];
  const gameNumberMatch = providerEventId?.match(/_g(\d+)(?:$|_)/i) ?? null;
  const gameNumber = gameNumberMatch ? Number(gameNumberMatch[1]) : null;
  if (gameNumber === null || !Number.isInteger(gameNumber) || gameNumber < 1) return [];
  const ordered = [...candidates].sort((left, right) =>
    Date.parse(left.gameDate ?? "") - Date.parse(right.gameDate ?? ""),
  );
  return ordered[gameNumber - 1] ? [ordered[gameNumber - 1]!] : [];
}

function findSharpApiCatalogGameMatch(
  candidates: readonly GameRef[],
  row: SharpEventCatalogRow,
): GameRef | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;
  const providerStart = row.start_time ?? null;
  if (!providerStart) return null;
  const byDistance = candidates
    .map((game) => ({ game, distance: timeDistanceMs(game.gameDate, providerStart) }))
    .filter((entry): entry is { game: GameRef; distance: number } => entry.distance !== null)
    .sort((a, b) => a.distance - b.distance);
  const best = byDistance[0] ?? null;
  return best && best.distance <= 6 * 60 * 60 * 1000 ? best.game : null;
}

async function collectSharpApiSplits(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate: string;
  games: readonly GameRef[];
  previousGames: readonly GameRef[];
  apiKey: string | undefined;
  now: Date;
  ingestionRunId: string;
  includeHistory: boolean;
}): Promise<{
  fetchedRows: number;
  observations: MarketSplitObservationV2[];
  rejected: CanonicalObservationRejection[];
  errors: string[];
  details?: Record<string, unknown>;
}> {
  if (opts.sport !== "mlb") {
    return { fetchedRows: 0, observations: [], rejected: [], errors: [] };
  }
  if (!opts.apiKey) {
    return { fetchedRows: 0, observations: [], rejected: [], errors: ["SHARPAPI_KEY missing; skipped SharpAPI v2 shadow splits"] };
  }
  const client = new SharpApiClient(opts.apiKey);
  let rows: SharpSplitRowWithTeams[];
  try {
    rows = await client.fetchAll<SharpSplitRowWithTeams>({
      path: "/splits",
      query: { league: "mlb" },
      maxPages: 2,
    });
  } catch (e) {
    if (e instanceof SharpApiNotFoundError) rows = [];
    else throw e;
  }

  const slateAlignment = assessSharpApiSplitSlateAlignment(
    rows,
    opts.games,
    opts.previousGames,
    opts.slateDate,
  );
  const verifiedCurrentRows = selectVerifiedSharpApiCurrentRows(
    rows,
    opts.games,
    opts.slateDate,
  );
  const rejectedPayload = rows.length > 0 && !slateAlignment.aligned;
  const partialPayloadRecovery = rejectedPayload && verifiedCurrentRows.length > 0;
  const rowsToCollect = rejectedPayload ? verifiedCurrentRows : rows;
  const providerErrors = rejectedPayload
    ? [
        `${partialPayloadRecovery ? "SharpAPI split payload partially recovered" : "SharpAPI split payload rejected by slate alignment"}: ` +
          `accepted ${verifiedCurrentRows.length}/${rows.length} exact-date current-matchup rows; ` +
          `current=${slateAlignment.currentSlateMatches}/${slateAlignment.validPairs}, ` +
          `previous=${slateAlignment.previousSlateMatches}/${slateAlignment.validPairs}, ` +
          `event_date_match=${slateAlignment.eventDateMatches}, event_date_mismatch=${slateAlignment.eventDateMismatches}`,
      ]
    : [];

  let catalogRows: SharpEventCatalogRow[] = [];
  if (opts.includeHistory) {
    try {
      const catalogDates = [opts.slateDate, offsetDate(opts.slateDate, 1)];
      const catalogPages = await Promise.all(catalogDates.map((date) =>
        client.fetchAll<SharpEventCatalogRow>({
          path: "/events",
          query: { league: "mlb", date, limit: 200 },
          maxPages: 2,
        })
      ));
      catalogRows = catalogPages.flat();
    } catch (e) {
      providerErrors.push(`SharpAPI event-catalog history recovery failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const gamesByKey = new Map<string, GameRef[]>();
  for (const game of opts.games) {
    const key = `${game.awayAbbr}@${game.homeAbbr}`;
    const list = gamesByKey.get(key) ?? [];
    list.push(game);
    gamesByKey.set(key, list);
  }
  const existingHistory = await loadSharpHistoryExistingState({
    supabase: opts.supabase,
    canonicalEventIds: opts.games.map((g) => String(g.externalId)),
  });
  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = rejectedPayload
    ? rows
        .filter((row) => !verifiedCurrentRows.includes(row))
        .map((row) => ({
          provider: "sharpapi" as const,
          provider_event_id:
            row.event_id === undefined || row.event_id === null ? null : String(row.event_id),
          market_type: null,
          selection_key: null,
          reason: "excluded because the row is not an exact-date current-slate matchup",
        }))
    : [];
  const currentConsensusRows: SharpSplitRowWithTeams[] = [];
  let ambiguousDoubleheaderRowsRejected = 0;
  const historyRequests: Array<Promise<{
    eventId: string;
    game: GameRef;
    rows: RawSharpApiSplitHistoryRowV2[];
    startTime: string | null;
    error: string | null;
  }>> = [];
  const historyRequestKeys = new Set<string>();
  let historyRequestsSkippedAfterStart = 0;
  const queueHistoryRequest = (providerEventId: string, game: GameRef): void => {
    if (!opts.includeHistory) return;
    const eventStarted = game.gameDate !== null && Date.parse(game.gameDate) <= opts.now.getTime();
    if (eventStarted) {
      historyRequestsSkippedAfterStart++;
      return;
    }
    const requestKey = `${game.externalId}|${providerEventId}`;
    if (historyRequestKeys.has(requestKey)) return;
    historyRequestKeys.add(requestKey);
    const startTime = historyStartTimeForEvent(game, existingHistory);
    historyRequests.push(
      client.fetchAll<RawSharpApiSplitHistoryRowV2>({
        path: "/splits/history",
        query: startTime === null
          ? { event_id: providerEventId }
          : { event_id: providerEventId, start_time: startTime },
        maxPages: 20,
      })
        .then((historyRows) => ({ eventId: providerEventId, game, rows: historyRows, startTime, error: null }))
        .catch((e) => ({
          eventId: providerEventId,
          game,
          rows: [],
          startTime,
          error: e instanceof Error ? e.message : String(e),
        })),
    );
  };
  for (const row of rowsToCollect) {
    const rowDate = extractEventIdDate(row.event_id);
    if (rowDate !== null && rowDate !== opts.slateDate) continue;
    const key = marketIntelligenceGameKey(opts.sport, row.away_team, row.home_team);
    const providerEventId = row.event_id === undefined || row.event_id === null ? null : String(row.event_id);
    const pairGames = key ? gamesByKey.get(key) ?? [] : [];
    const matchedGames = findSharpApiSplitGameMatches(pairGames, providerEventId);
    if (matchedGames.length === 0) {
      if (pairGames.length > 1) ambiguousDoubleheaderRowsRejected++;
      rejected.push({
        provider: "sharpapi",
        provider_event_id: providerEventId,
        market_type: null,
        selection_key: null,
        reason: pairGames.length > 1
          ? `ambiguous SharpAPI doubleheader split identity ${providerEventId ?? "null"}`
          : `unmatched SharpAPI split game ${row.away_team ?? "?"}@${row.home_team ?? "?"}`,
      });
      continue;
    }
    const sourceBook = String(row.sportsbook ?? "").toLowerCase();
    if (sourceBook === "consensus") {
      currentConsensusRows.push(row);
    }
    for (const game of matchedGames) {
      if (providerEventId !== null) queueHistoryRequest(providerEventId, game);
      const built = buildSharpApiSplitObservationsV2({
        row,
        canonicalEventId: String(game.externalId),
        league: opts.sport,
        fetchedAt: opts.now.toISOString(),
        minutesToStart: minutesToStart(game.gameDate, opts.now),
        ingestionRunId: opts.ingestionRunId,
        canonicalMarketId: (m) => externalMarketId(game, m),
        selectionKey: (m, s) => externalSelectionKey(game, m, s),
      });
      observations.push(...built.observations);
      rejected.push(...built.rejected);
    }
  }

  let catalogEventsMatched = 0;
  const catalogGamesRecovered = new Set<number>();
  for (const event of catalogRows) {
    const providerEventId = event.id === undefined || event.id === null ? null : String(event.id);
    if (!providerEventId || extractEventIdDate(providerEventId) !== opts.slateDate) continue;
    const books = Array.isArray(event.books) ? event.books.map((book) => String(book).toLowerCase()) : [];
    if (!books.includes("draftkings") && !books.includes("circa")) continue;
    const key = marketIntelligenceGameKey(opts.sport, event.away_team, event.home_team);
    const game = key ? findSharpApiCatalogGameMatch(gamesByKey.get(key) ?? [], event) : null;
    if (!game) continue;
    catalogEventsMatched++;
    catalogGamesRecovered.add(game.externalId);
    queueHistoryRequest(providerEventId, game);
    // SharpAPI history has been observed under an unsuffixed canonical ID
    // even when the event catalog and odds rows use a bucket suffix. The base
    // ID is safe only for a single-game matchup; doubleheaders need their exact
    // `_bN_gN` identities to remain independent.
    if ((gamesByKey.get(key ?? "") ?? []).length === 1) {
      const baseEventId = stripSharpApiEventBucket(providerEventId);
      if (baseEventId !== providerEventId) queueHistoryRequest(baseEventId, game);
    }
  }
  const historyResults = await Promise.all(historyRequests);
  let historyRowsReceived = 0;
  let historyRowsAfterStartTime = 0;
  let historyCanonicalConstructed = 0;
  let historyCanonicalSkippedExisting = 0;
  const historyRequestErrors = historyResults.flatMap((result) => result.error ? [result.error] : []);
  if (historyRequestErrors.length > 0) {
    providerErrors.push(`SharpAPI split history recovery failed for ${historyRequestErrors.length}/${historyResults.length} requests`);
  }
  for (const result of historyResults) {
    historyRowsReceived += result.rows.length;
    for (const row of result.rows) {
      const observedAt = sharpApiSplitHistoryObservedAt(row);
      const book = String(row.book ?? "").toLowerCase();
      if ((book === "draftkings" || book === "circa") && observedAt !== null) {
        const latest = existingHistory.latestByEventBook.get(sharpHistoryStateKey(String(result.game.externalId), book));
        if (latest && Date.parse(observedAt) <= Date.parse(latest)) {
          continue;
        }
      }
      historyRowsAfterStartTime++;
      const built = buildSharpApiSplitHistoryObservationsV2({
        row,
        providerEventId: result.eventId,
        canonicalEventId: String(result.game.externalId),
        league: opts.sport,
        fetchedAt: opts.now.toISOString(),
        minutesToStart: minutesToStart(result.game.gameDate, opts.now),
        ingestionRunId: opts.ingestionRunId,
        canonicalMarketId: (m) => externalMarketId(result.game, m),
        selectionKey: (m, s) => externalSelectionKey(result.game, m, s),
      });
      historyCanonicalConstructed += built.observations.length;
      for (const obs of built.observations) {
        const obsKey = sharpHistoryObservationKey(obs);
        if (obsKey !== null && existingHistory.existingObservationKeys.has(obsKey)) {
          historyCanonicalSkippedExisting++;
          continue;
        }
        observations.push(obs);
        if (obsKey !== null) existingHistory.existingObservationKeys.add(obsKey);
      }
      rejected.push(...built.rejected);
    }
  }
  const historyRowsFetched = historyResults.reduce((sum, r) => sum + r.rows.length, 0);
  return {
    fetchedRows: rows.length + historyRowsFetched,
    observations,
    rejected,
    errors: providerErrors,
    details: {
      slate_alignment: slateAlignment,
      stale_or_ambiguous_payload_rejected: rejectedPayload && !partialPayloadRecovery,
      partial_payload_recovery: partialPayloadRecovery,
      partial_rows_accepted: partialPayloadRecovery ? verifiedCurrentRows.length : 0,
      partial_rows_rejected: rejectedPayload ? rows.length - verifiedCurrentRows.length : 0,
      current_split_rows_received: rows.length,
      current_consensus_rows_ingested: currentConsensusRows.length,
      current_consensus_sample: currentConsensusRows[0] ? sanitizeSharpSplitSample(currentConsensusRows[0]) : null,
      ambiguous_doubleheader_rows_rejected: ambiguousDoubleheaderRowsRejected,
      event_catalog_rows_received: catalogRows.length,
      event_catalog_matches: catalogEventsMatched,
      event_catalog_games_recovered: catalogGamesRecovered.size,
      history_requests_made: historyRequests.length,
      history_requests_skipped_after_start: historyRequestsSkippedAfterStart,
      history_request_errors: historyRequestErrors.length,
      history_rows_received: historyRowsReceived,
      history_rows_after_incremental_filter: historyRowsAfterStartTime,
      history_canonical_constructed: historyCanonicalConstructed,
      history_canonical_skipped_existing: historyCanonicalSkippedExisting,
      history_incremental_start_times_used: historyResults.filter((r) => r.startTime !== null).length,
    },
  };
}

type SplitUpsertResult = {
  written: number;
  tableMissing: boolean;
  error: string | null;
};

async function upsertSplitObservationsWithHistoryRetry(opts: {
  supabase: SupabaseClient;
  rows: readonly MarketSplitObservationV2[];
  onConflict: string;
  legacyColumns: boolean;
}): Promise<SplitUpsertResult> {
  const payload = opts.legacyColumns ? opts.rows.map(stripV27SplitColumns) : [...opts.rows];
  const { error } = await opts.supabase
    .from("market_split_observations_v2")
    .upsert(payload, {
      onConflict: opts.onConflict,
      ignoreDuplicates: true,
    });

  if (!error) return { written: opts.rows.length, tableMissing: false, error: null };
  if (isTableMissing(error.message)) return { written: 0, tableMissing: true, error: null };
  if (!isSharpApiHistoryUniqueConflict(error.message) || !opts.rows.some(isSharpApiHistoryIdentityRow)) {
    return { written: 0, tableMissing: false, error: error.message };
  }

  // Another cron can insert the same SharpAPI history observation after our
  // preflight state read but before this upsert. Reload the identity set and
  // drop those now-existing history rows, then retry once. Non-history rows stay
  // in the payload, and any non-race error still bubbles up.
  const deduped = await dedupeSharpApiHistorySplitObservationsFromDb({
    supabase: opts.supabase,
    rows: opts.rows,
  });
  if (deduped.rows.length === 0) return { written: 0, tableMissing: false, error: null };

  const retryPayload = opts.legacyColumns ? deduped.rows.map(stripV27SplitColumns) : deduped.rows;
  const retry = await opts.supabase
    .from("market_split_observations_v2")
    .upsert(retryPayload, {
      onConflict: opts.onConflict,
      ignoreDuplicates: true,
    });
  if (retry.error) {
    if (isTableMissing(retry.error.message)) return { written: 0, tableMissing: true, error: null };
    return { written: 0, tableMissing: false, error: retry.error.message };
  }
  return { written: deduped.rows.length, tableMissing: false, error: null };
}

export async function writeRows(opts: {
  supabase: SupabaseClient;
  splitObservations: readonly MarketSplitObservationV2[];
  priceObservations: readonly MarketPriceObservationV2[];
}): Promise<{ splitWritten: number; priceWritten: number; tableMissing: boolean; errors: string[] }> {
  const errors: string[] = [];
  let tableMissing = false;
  let splitWritten = 0;
  let priceWritten = 0;

  let splitObservationsForWrite = [...opts.splitObservations];
  splitObservationsForWrite = (await dedupeSharpApiHistorySplitObservationsFromDb({
    supabase: opts.supabase,
    rows: splitObservationsForWrite,
  })).rows;

  if (splitObservationsForWrite.length > 0) {
    const primary = await upsertSplitObservationsWithHistoryRetry({
      supabase: opts.supabase,
      rows: splitObservationsForWrite,
      onConflict: "provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash,fetched_at",
      legacyColumns: false,
    });
    if (primary.tableMissing) tableMissing = true;
    if (primary.error === null && !primary.tableMissing) {
      splitWritten = primary.written;
    } else if (primary.error !== null && isColumnMissing(primary.error)) {
      const retry = await upsertSplitObservationsWithHistoryRetry({
        supabase: opts.supabase,
        rows: splitObservationsForWrite,
        onConflict: "provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash",
        legacyColumns: true,
      });
      if (retry.tableMissing) tableMissing = true;
      if (retry.error) errors.push(`split upsert legacy retry: ${retry.error}`);
      else splitWritten = retry.written;
    } else if (primary.error !== null && isConflictTargetMissing(primary.error)) {
      const retry = await upsertSplitObservationsWithHistoryRetry({
        supabase: opts.supabase,
        rows: splitObservationsForWrite,
        onConflict: "provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash",
        legacyColumns: false,
      });
      if (retry.tableMissing) tableMissing = true;
      if (retry.error) errors.push(`split upsert legacy conflict retry: ${retry.error}`);
      else splitWritten = retry.written;
    } else if (primary.error !== null) {
      errors.push(`split upsert: ${primary.error}`);
    } else {
      splitWritten = primary.written;
    }
  }

  if (opts.priceObservations.length > 0) {
    const { error } = await opts.supabase
      .from("market_price_observations_v2")
      .upsert(opts.priceObservations, {
        onConflict: "canonical_market_id,sportsbook,selection_key,line,american_price,provider_timestamp",
        ignoreDuplicates: true,
      });
    if (error) {
      if (isTableMissing(error.message)) tableMissing = true;
      else errors.push(`price upsert: ${error.message}`);
    } else {
      priceWritten = opts.priceObservations.length;
    }
  }

  return { splitWritten, priceWritten, tableMissing, errors };
}

export async function syncMarketIntelligenceV2Shadow(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate: string;
  apply: boolean;
  todayUtc: string;
  now?: Date;
  playbookApiKey?: string;
  sharpApiKey?: string;
  includeSharpApiHistory?: boolean;
  logger?: (message: string) => void;
}): Promise<MarketIntelligenceV2ShadowSyncResult> {
  const now = opts.now ?? new Date();
  const ingestionRunId = `${opts.sport}:${opts.slateDate}:${now.toISOString()}`;
  const logger = opts.logger ?? (() => {});
  const result: MarketIntelligenceV2ShadowSyncResult = {
    apply: opts.apply,
    sport: opts.sport,
    slateDate: opts.slateDate,
    gamesLoaded: 0,
    playbookSplitRowsFetched: 0,
    sharpapiSplitRowsFetched: 0,
    splitObservationsBuilt: 0,
    priceObservationsBuilt: 0,
    splitObservationsWritten: 0,
    priceObservationsWritten: 0,
    rejected: [],
    skippedTableMissing: false,
    errors: [],
    details: {},
  };

  const games = await loadGames(opts.supabase, opts.sport, opts.slateDate);
  result.gamesLoaded = games.length;
  if (games.length === 0) {
    result.details.empty_slate = true;
    return result;
  }
  const playbookGames = opts.sport === "wnba" && opts.slateDate === opts.todayUtc
    ? await loadGamesForSlateWindow(
      opts.supabase,
      opts.sport,
      offsetDate(opts.slateDate, -1),
      offsetDate(opts.slateDate, 7),
    )
    : games;
  if (playbookGames.length !== games.length) {
    result.details.playbook_games_loaded = playbookGames.length;
  }
  const previousSharpApiGames = opts.sport === "mlb"
    ? await loadGames(opts.supabase, opts.sport, offsetDate(opts.slateDate, -1))
    : [];

  const [playbook, sharpapi, prices] = await Promise.all([
    collectPlaybookSplits({
      sport: opts.sport,
      slateDate: opts.slateDate,
      todayUtc: opts.todayUtc,
      games: playbookGames,
      apiKey: opts.playbookApiKey ?? process.env.PLAYBOOK_API_KEY,
      now,
      ingestionRunId,
    }),
    collectSharpApiSplits({
      supabase: opts.supabase,
      sport: opts.sport,
      slateDate: opts.slateDate,
      games,
      previousGames: previousSharpApiGames,
      apiKey: opts.sharpApiKey ?? process.env.SHARPAPI_KEY,
      now,
      ingestionRunId,
      includeHistory: opts.includeSharpApiHistory !== false,
    }),
    loadPriceObservations({ supabase: opts.supabase, sport: opts.sport, games, now }),
  ]);

  const splitObservations = [...playbook.observations, ...sharpapi.observations];
  result.playbookSplitRowsFetched = playbook.fetchedRows;
  result.sharpapiSplitRowsFetched = sharpapi.fetchedRows;
  result.splitObservationsBuilt = splitObservations.length;
  result.priceObservationsBuilt = prices.length;
  result.rejected.push(...playbook.rejected, ...sharpapi.rejected);
  result.errors.push(...playbook.errors, ...sharpapi.errors);
  result.details.providers = {
    playbook_observations: playbook.observations.length,
    sharpapi_observations: sharpapi.observations.length,
    price_observations: prices.length,
  };
  result.details.sharpapi = sharpapi.details ?? {};

  logger(
    `built split=${result.splitObservationsBuilt} price=${result.priceObservationsBuilt} rejected=${result.rejected.length}`,
  );

  if (!opts.apply) return result;
  const config = readMarketIntelligenceV2Config();
  if (!config.enabled) {
    result.errors.push("MARKET_INTELLIGENCE_V2_ENABLED must be true for v2 shadow writes");
    return result;
  }

  const write = await writeRows({
    supabase: opts.supabase,
    splitObservations,
    priceObservations: prices,
  });
  result.splitObservationsWritten = write.splitWritten;
  result.priceObservationsWritten = write.priceWritten;
  result.skippedTableMissing = write.tableMissing;
  result.errors.push(...write.errors);
  return result;
}
