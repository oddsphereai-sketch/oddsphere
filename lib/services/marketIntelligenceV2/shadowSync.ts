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
  const m = String(eventId).replace(/_b\d+$/, "").match(/_(\d{4}-\d{2}-\d{2})$/);
  return m?.[1] ?? null;
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

function sharpHistoryStateKey(eventId: string, sourceBook: string): string {
  return `${eventId}:${sourceBook}`;
}

function sharpHistoryObservationKey(row: Pick<MarketSplitObservationV2,
  "provider" | "source_book" | "canonical_event_id" | "canonical_market_id" | "selection_key" | "source_observed_at"
>): string | null {
  if (row.source_observed_at === null) return null;
  return [
    row.provider,
    row.source_book,
    row.canonical_event_id,
    row.canonical_market_id,
    row.selection_key,
    row.source_observed_at,
  ].join("|");
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

async function collectSharpApiSplits(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate: string;
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

  const gameByKey = new Map(opts.games.map((g) => [`${g.awayAbbr}@${g.homeAbbr}`, g]));
  const existingHistory = await loadSharpHistoryExistingState({
    supabase: opts.supabase,
    canonicalEventIds: opts.games.map((g) => String(g.externalId)),
  });
  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  const unsupportedCurrentRows: SharpSplitRowWithTeams[] = [];
  const historyRequests: Array<Promise<{
    eventId: string;
    game: GameRef;
    rows: RawSharpApiSplitHistoryRowV2[];
    startTime: string | null;
  }>> = [];
  for (const row of rows) {
    const rowDate = extractEventIdDate(row.event_id);
    if (rowDate !== null && rowDate !== opts.slateDate) continue;
    const key = marketIntelligenceGameKey(opts.sport, row.away_team, row.home_team);
    const game = key ? gameByKey.get(key) : undefined;
    if (!game) {
      rejected.push({
        provider: "sharpapi",
        provider_event_id: row.event_id === undefined || row.event_id === null ? null : String(row.event_id),
        market_type: null,
        selection_key: null,
        reason: `unmatched SharpAPI split game ${row.away_team ?? "?"}@${row.home_team ?? "?"}`,
      });
      continue;
    }
    const providerEventId = row.event_id === undefined || row.event_id === null ? null : String(row.event_id);
    const sourceBook = String(row.sportsbook ?? "").toLowerCase();
    if (sourceBook === "consensus") {
      unsupportedCurrentRows.push(row);
    }
    const eventStarted = game.gameDate !== null && Date.parse(game.gameDate) <= opts.now.getTime();
    if (providerEventId !== null && !eventStarted) {
      const startTime = historyStartTimeForEvent(game, existingHistory);
      historyRequests.push(
        client.fetchAll<RawSharpApiSplitHistoryRowV2>({
          path: "/splits/history",
          query: startTime === null
            ? { event_id: providerEventId }
            : { event_id: providerEventId, start_time: startTime },
          maxPages: 20,
        })
          .then((historyRows) => ({ eventId: providerEventId, game, rows: historyRows, startTime }))
          .catch(() => ({ eventId: providerEventId, game, rows: [], startTime })),
      );
    }
    if (sourceBook === "consensus") continue;
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
  const historyResults = await Promise.all(historyRequests);
  let historyRowsReceived = 0;
  let historyRowsAfterStartTime = 0;
  let historyCanonicalConstructed = 0;
  let historyCanonicalSkippedExisting = 0;
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
    errors: [],
    details: {
      current_split_rows_received: rows.length,
      unsupported_current_consensus_rows: unsupportedCurrentRows.length,
      unsupported_current_consensus_sample: unsupportedCurrentRows[0] ? sanitizeSharpSplitSample(unsupportedCurrentRows[0]) : null,
      history_requests_made: historyRequests.length,
      history_requests_skipped_after_start: opts.games.length - historyRequests.length,
      history_rows_received: historyRowsReceived,
      history_rows_after_incremental_filter: historyRowsAfterStartTime,
      history_canonical_constructed: historyCanonicalConstructed,
      history_canonical_skipped_existing: historyCanonicalSkippedExisting,
      history_incremental_start_times_used: historyResults.filter((r) => r.startTime !== null).length,
    },
  };
}

async function writeRows(opts: {
  supabase: SupabaseClient;
  splitObservations: readonly MarketSplitObservationV2[];
  priceObservations: readonly MarketPriceObservationV2[];
}): Promise<{ splitWritten: number; priceWritten: number; tableMissing: boolean; errors: string[] }> {
  const errors: string[] = [];
  let tableMissing = false;
  let splitWritten = 0;
  let priceWritten = 0;

  if (opts.splitObservations.length > 0) {
    const { error } = await opts.supabase
      .from("market_split_observations_v2")
      .upsert(opts.splitObservations, {
        onConflict: "provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash,fetched_at",
        ignoreDuplicates: true,
      });
    if (error) {
      if (isTableMissing(error.message)) tableMissing = true;
      else if (isColumnMissing(error.message)) {
        const { error: retryError } = await opts.supabase
          .from("market_split_observations_v2")
          .upsert(opts.splitObservations.map(stripV27SplitColumns), {
            onConflict: "provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash",
            ignoreDuplicates: true,
          });
        if (retryError) errors.push(`split upsert legacy retry: ${retryError.message}`);
        else splitWritten = opts.splitObservations.length;
      } else if (isConflictTargetMissing(error.message)) {
        const { error: retryError } = await opts.supabase
          .from("market_split_observations_v2")
          .upsert(opts.splitObservations, {
            onConflict: "provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash",
            ignoreDuplicates: true,
          });
        if (retryError) errors.push(`split upsert legacy conflict retry: ${retryError.message}`);
        else splitWritten = opts.splitObservations.length;
      } else errors.push(`split upsert: ${error.message}`);
    } else {
      splitWritten = opts.splitObservations.length;
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
      apiKey: opts.sharpApiKey ?? process.env.SHARPAPI_KEY,
      now,
      ingestionRunId,
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
