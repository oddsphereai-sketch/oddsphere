import type { SupabaseClient } from "@supabase/supabase-js";
import { readMarketIntelligenceV2Config } from "../../config/marketIntelligenceV2";
import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import type { Sport } from "../../types/domain/Sport";
import type { MarketIntelligenceMarketType } from "../../types/domain/MarketIntelligenceV2";
import {
  resolveMarketReadV2,
  type PriceObservationForResolver,
  type SplitObservationForResolver,
} from "./resolver";

export const MARKET_INTELLIGENCE_V2_RESOLVER_VERSION = "market-intelligence-v2.2-ui-movement-0.4.2-blocked-book-filter";
const OBSERVATION_PAGE_SIZE = 1000;

type GameRow = {
  id: number;
  external_id: number;
  game_date: string | null;
  game_predictions?: PredictionRow[] | PredictionRow | null;
};

type PredictionRow = {
  id?: number | null;
  predicted_ml_winner: string | null;
  predicted_ou_side: string | null;
};

type RecommendationRow = {
  id: number;
  game_id: number;
  market: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  locked_at: string | null;
};

type Candidate = {
  canonicalEventId: string;
  canonicalMarketId: string;
  marketType: MarketIntelligenceMarketType;
  selectionKey: string;
  eventStartTime: string | null;
  recommendationSnapshotId: number | null;
  recommendationLockedAt: string | null;
  selectedSide: string;
  selectedLine: number | null;
  selectedPrice: number | null;
};

export type MarketIntelligenceV2SnapshotSyncResult = {
  apply: boolean;
  sport: Sport;
  slateDate: string;
  candidates: number;
  snapshotsBuilt: number;
  snapshotsWritten: number;
  skippedTableMissing: boolean;
  errors: string[];
  labelCounts: Record<string, number>;
};

function isTableMissing(message: string): boolean {
  return /relation .* does not exist|Could not find the table|schema cache/i.test(message);
}

function isColumnMissing(message: string): boolean {
  return /column .* does not exist|Could not find .* column|schema cache/i.test(message);
}

function predictionFromJoin(value: GameRow["game_predictions"]): PredictionRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isPregameCandidate(candidate: Candidate, asOfIso: string): boolean {
  if (!candidate.eventStartTime) return true;
  const start = Date.parse(candidate.eventStartTime);
  const asOf = Date.parse(asOfIso);
  return !Number.isFinite(start) || !Number.isFinite(asOf) || start > asOf;
}

async function loadSplitObservations(opts: {
  supabase: SupabaseClient;
  eventIds: string[];
}): Promise<{ rows: SplitObservationForResolver[]; tableMissing: boolean }> {
  const baseSelect =
    "provider, source_book, source_type, market_type, selection_key, bets_pct, money_pct, market_line, market_price, books_used, source_observed_at, fetched_at";
  const withV27Select =
    "provider, source_book, source_type, market_type, selection_key, bets_pct, money_pct, market_line, market_price, split_line_basis, books_used, source_observed_at, fetched_at";
  const loadPaged = async (selectSql: string): Promise<{ data: unknown[]; error: { message: string } | null }> => {
    const out: unknown[] = [];
    for (let from = 0; ; from += OBSERVATION_PAGE_SIZE) {
      const to = from + OBSERVATION_PAGE_SIZE - 1;
      const page = await opts.supabase
        .from("market_split_observations_v2")
        .select(selectSql)
        .in("canonical_event_id", opts.eventIds)
        .order("fetched_at", { ascending: false })
        .range(from, to);
      if (page.error) return { data: out, error: page.error };
      const rows = page.data ?? [];
      out.push(...rows);
      if (rows.length < OBSERVATION_PAGE_SIZE) return { data: out, error: null };
    }
  };

  const first = await loadPaged(withV27Select);
  if (!first.error) return { rows: first.data as SplitObservationForResolver[], tableMissing: false };
  if (isTableMissing(first.error.message)) return { rows: [], tableMissing: true };
  if (!isColumnMissing(first.error.message)) {
    throw new Error(`split observations fetch failed: ${first.error.message}`);
  }
  const retry = await loadPaged(baseSelect);
  if (retry.error) {
    if (isTableMissing(retry.error.message)) return { rows: [], tableMissing: true };
    throw new Error(`split observations fetch legacy retry failed: ${retry.error.message}`);
  }
  const rows = (retry.data as Array<Omit<SplitObservationForResolver, "split_line_basis">>)
    .map((row) => ({ ...row, split_line_basis: "unknown" as const }));
  return { rows, tableMissing: false };
}

async function loadPriceObservations(opts: {
  supabase: SupabaseClient;
  eventIds: string[];
}): Promise<{ rows: PriceObservationForResolver[]; tableMissing: boolean }> {
  const out: PriceObservationForResolver[] = [];
  for (let from = 0; ; from += OBSERVATION_PAGE_SIZE) {
    const to = from + OBSERVATION_PAGE_SIZE - 1;
    const page = await opts.supabase
      .from("market_price_observations_v2")
      .select("sportsbook, sharp_book, market_type, selection_key, american_price, line, provider_timestamp, fetched_at")
      .in("canonical_event_id", opts.eventIds)
      .order("fetched_at", { ascending: false })
      .range(from, to);
    if (page.error) {
      if (isTableMissing(page.error.message)) return { rows: [], tableMissing: true };
      throw new Error(`price observations fetch failed: ${page.error.message}`);
    }
    const rows = ((page.data ?? []) as PriceObservationForResolver[])
      .filter((row) => !isBlockedSportsbook(row.sportsbook));
    out.push(...rows);
    if (rows.length < OBSERVATION_PAGE_SIZE) return { rows: out, tableMissing: false };
  }
}

function stripV27SnapshotColumns(row: Record<string, unknown>): Record<string, unknown> {
  return {
    canonical_event_id: row.canonical_event_id,
    canonical_market_id: row.canonical_market_id,
    selection_key: row.selection_key,
    league: row.league,
    market_type: row.market_type,
    resolver_version: row.resolver_version,
    score: row.score,
    label: row.label,
    explanation: row.explanation,
    evidence_json: row.evidence_json,
  };
}

async function loadCandidates(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate: string;
}): Promise<Candidate[]> {
  const { data, error } = await opts.supabase
    .from("games")
    .select("id, external_id, game_date, game_predictions(id, predicted_ml_winner, predicted_ou_side)")
    .eq("sport", opts.sport)
    .eq("slate_date", opts.slateDate);
  if (error) throw new Error(`candidate games fetch failed: ${error.message}`);

  const gameRows = (data ?? []) as GameRow[];
  const gameIds = gameRows.map((g) => g.id);
  const recByGameMarket = new Map<string, RecommendationRow>();
  if (gameIds.length > 0) {
    const recommendationMarkets = opts.sport === "wnba"
      ? ["moneyline", "total", "spread"]
      : ["moneyline", "total"];
    const { data: recs, error: recErr } = await opts.supabase
      .from("prediction_records")
      .select("id, game_id, market, side, line_value, odds_american, locked_at")
      .in("game_id", gameIds)
      .in("market", recommendationMarkets);
    if (recErr && !isTableMissing(recErr.message)) {
      throw new Error(`prediction_records fetch failed: ${recErr.message}`);
    }
    for (const rec of (recs ?? []) as RecommendationRow[]) {
      recByGameMarket.set(`${rec.game_id}:${rec.market}`, rec);
    }
  }

  const out: Candidate[] = [];
  for (const game of gameRows) {
    if (typeof game.external_id !== "number") continue;
    const pred = predictionFromJoin(game.game_predictions);
    if (!pred) continue;
    const eventId = String(game.external_id);
    if (pred.predicted_ml_winner === "home" || pred.predicted_ml_winner === "away") {
      const rec = recByGameMarket.get(`${game.id}:moneyline`) ?? null;
      const selectedSide = rec?.side === "home" || rec?.side === "away"
        ? rec.side
        : pred.predicted_ml_winner;
      out.push({
        canonicalEventId: eventId,
        canonicalMarketId: `${eventId}:moneyline`,
        marketType: "moneyline",
        selectionKey: `${eventId}:moneyline:${selectedSide}`,
        eventStartTime: game.game_date,
        recommendationSnapshotId: rec?.id ?? null,
        recommendationLockedAt: rec?.locked_at ?? null,
        selectedSide,
        selectedLine: rec?.line_value ?? null,
        selectedPrice: rec?.odds_american ?? null,
      });
    }
    if (pred.predicted_ou_side === "over" || pred.predicted_ou_side === "under") {
      const rec = recByGameMarket.get(`${game.id}:total`) ?? null;
      const selectedSide = rec?.side === "over" || rec?.side === "under"
        ? rec.side
        : pred.predicted_ou_side;
      out.push({
        canonicalEventId: eventId,
        canonicalMarketId: `${eventId}:total`,
        marketType: "total",
        selectionKey: `${eventId}:total:${selectedSide}`,
        eventStartTime: game.game_date,
        recommendationSnapshotId: rec?.id ?? null,
        recommendationLockedAt: rec?.locked_at ?? null,
        selectedSide,
        selectedLine: rec?.line_value ?? null,
        selectedPrice: rec?.odds_american ?? null,
      });
    }
    if (opts.sport === "wnba") {
      const rec = recByGameMarket.get(`${game.id}:spread`) ?? null;
      if (rec?.side === "home" || rec?.side === "away") {
        out.push({
          canonicalEventId: eventId,
          canonicalMarketId: `${eventId}:spread`,
          marketType: "spread",
          selectionKey: `${eventId}:spread:${rec.side}`,
          eventStartTime: game.game_date,
          recommendationSnapshotId: rec.id,
          recommendationLockedAt: rec.locked_at,
          selectedSide: rec.side,
          selectedLine: rec.line_value,
          selectedPrice: rec.odds_american,
        });
      }
    }
  }
  return out;
}

export async function syncMarketIntelligenceV2Snapshots(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate: string;
  apply: boolean;
}): Promise<MarketIntelligenceV2SnapshotSyncResult> {
  const result: MarketIntelligenceV2SnapshotSyncResult = {
    apply: opts.apply,
    sport: opts.sport,
    slateDate: opts.slateDate,
    candidates: 0,
    snapshotsBuilt: 0,
    snapshotsWritten: 0,
    skippedTableMissing: false,
    errors: [],
    labelCounts: {},
  };

  const nowIso = new Date().toISOString();
  const loadedCandidates = await loadCandidates(opts);
  const candidates = loadedCandidates.filter((candidate) => isPregameCandidate(candidate, nowIso));
  result.candidates = candidates.length;
  if (candidates.length === 0) return result;

  const eventIds = [...new Set(candidates.map((c) => c.canonicalEventId))];
  const splitLoad = await loadSplitObservations({ supabase: opts.supabase, eventIds });
  if (splitLoad.tableMissing) {
    result.skippedTableMissing = true;
    return result;
  }

  const priceLoad = await loadPriceObservations({ supabase: opts.supabase, eventIds });
  if (priceLoad.tableMissing) {
    result.skippedTableMissing = true;
    return result;
  }

  const splitObservations = splitLoad.rows;
  const priceObservations = priceLoad.rows;
  const payload = candidates.map((candidate) => {
    const resolved = resolveMarketReadV2({
      marketType: candidate.marketType,
      selectionKey: candidate.selectionKey,
      selectedLine: candidate.selectedLine,
      selectedPrice: candidate.selectedPrice,
      recommendationLockedAt: candidate.recommendationLockedAt,
      splitObservations,
      priceObservations,
      asOf: nowIso,
      eventStartTime: candidate.eventStartTime,
    });
    const label = resolved.label ?? "No Market Read";
    result.labelCounts[label] = (result.labelCounts[label] ?? 0) + 1;
    return {
      canonical_event_id: candidate.canonicalEventId,
      canonical_market_id: candidate.canonicalMarketId,
      selection_key: candidate.selectionKey,
      league: opts.sport,
      market_type: candidate.marketType,
      resolver_version: MARKET_INTELLIGENCE_V2_RESOLVER_VERSION,
      score: resolved.score,
      label,
      explanation: resolved.explanation ?? `Market Read omitted: ${resolved.validityStatus}.`,
      evidence_json: resolved.evidence,
      evidence_as_of: resolved.evidenceAsOf,
      event_start_time: candidate.eventStartTime,
      recommendation_snapshot_id: candidate.recommendationSnapshotId,
      recommendation_locked_at: candidate.recommendationLockedAt,
      selected_side: candidate.selectedSide,
      selected_line: candidate.selectedLine,
      selected_price: candidate.selectedPrice,
      validity_status: resolved.validityStatus,
    };
  });
  result.snapshotsBuilt = payload.length;

  if (!opts.apply) return result;
  const config = readMarketIntelligenceV2Config();
  if (!config.enabled) {
    result.errors.push("MARKET_INTELLIGENCE_V2_ENABLED must be true for v2 snapshot writes");
    return result;
  }

  const { error } = await opts.supabase
    .from("market_intelligence_snapshots_v2")
    .insert(payload);
  if (error) {
    if (isTableMissing(error.message)) {
      result.skippedTableMissing = true;
      return result;
    }
    if (isColumnMissing(error.message)) {
      const { error: retryError } = await opts.supabase
        .from("market_intelligence_snapshots_v2")
        .insert(payload.map(stripV27SnapshotColumns));
      if (!retryError) {
        result.snapshotsWritten = payload.length;
        return result;
      }
      result.errors.push(`snapshot insert legacy retry: ${retryError.message}`);
      return result;
    }
    result.errors.push(`snapshot insert: ${error.message}`);
    return result;
  }
  result.snapshotsWritten = payload.length;
  return result;
}
