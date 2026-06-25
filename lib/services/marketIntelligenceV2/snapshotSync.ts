import type { SupabaseClient } from "@supabase/supabase-js";
import { readMarketIntelligenceV2Config } from "../../config/marketIntelligenceV2";
import type { Sport } from "../../types/domain/Sport";
import type { MarketIntelligenceMarketType } from "../../types/domain/MarketIntelligenceV2";
import {
  resolveMarketReadV2,
  type PriceObservationForResolver,
  type SplitObservationForResolver,
} from "./resolver";

export const MARKET_INTELLIGENCE_V2_RESOLVER_VERSION = "market-intelligence-v2-shadow-0.1.0";

type GameRow = {
  id: number;
  external_id: number;
  game_predictions?: PredictionRow[] | PredictionRow | null;
};

type PredictionRow = {
  predicted_ml_winner: string | null;
  predicted_ou_side: string | null;
};

type Candidate = {
  canonicalEventId: string;
  canonicalMarketId: string;
  marketType: MarketIntelligenceMarketType;
  selectionKey: string;
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

function predictionFromJoin(value: GameRow["game_predictions"]): PredictionRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadCandidates(opts: {
  supabase: SupabaseClient;
  sport: Sport;
  slateDate: string;
}): Promise<Candidate[]> {
  const { data, error } = await opts.supabase
    .from("games")
    .select("id, external_id, game_predictions(predicted_ml_winner, predicted_ou_side)")
    .eq("sport", opts.sport)
    .eq("slate_date", opts.slateDate);
  if (error) throw new Error(`candidate games fetch failed: ${error.message}`);

  const out: Candidate[] = [];
  for (const game of (data ?? []) as GameRow[]) {
    if (typeof game.external_id !== "number") continue;
    const pred = predictionFromJoin(game.game_predictions);
    if (!pred) continue;
    const eventId = String(game.external_id);
    if (pred.predicted_ml_winner === "home" || pred.predicted_ml_winner === "away") {
      out.push({
        canonicalEventId: eventId,
        canonicalMarketId: `${eventId}:moneyline`,
        marketType: "moneyline",
        selectionKey: `${eventId}:moneyline:${pred.predicted_ml_winner}`,
      });
    }
    if (pred.predicted_ou_side === "over" || pred.predicted_ou_side === "under") {
      out.push({
        canonicalEventId: eventId,
        canonicalMarketId: `${eventId}:total`,
        marketType: "total",
        selectionKey: `${eventId}:total:${pred.predicted_ou_side}`,
      });
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

  const candidates = await loadCandidates(opts);
  result.candidates = candidates.length;
  if (candidates.length === 0) return result;

  const eventIds = [...new Set(candidates.map((c) => c.canonicalEventId))];
  const { data: splitRows, error: splitErr } = await opts.supabase
    .from("market_split_observations_v2")
    .select("provider, source_book, source_type, market_type, selection_key, bets_pct, money_pct, books_used, source_observed_at, fetched_at")
    .in("canonical_event_id", eventIds);
  if (splitErr) {
    if (isTableMissing(splitErr.message)) {
      result.skippedTableMissing = true;
      return result;
    }
    throw new Error(`split observations fetch failed: ${splitErr.message}`);
  }

  const { data: priceRows, error: priceErr } = await opts.supabase
    .from("market_price_observations_v2")
    .select("sportsbook, sharp_book, market_type, selection_key, american_price, line, provider_timestamp, fetched_at")
    .in("canonical_event_id", eventIds);
  if (priceErr) {
    if (isTableMissing(priceErr.message)) {
      result.skippedTableMissing = true;
      return result;
    }
    throw new Error(`price observations fetch failed: ${priceErr.message}`);
  }

  const splitObservations = (splitRows ?? []) as SplitObservationForResolver[];
  const priceObservations = (priceRows ?? []) as PriceObservationForResolver[];
  const payload = candidates.map((candidate) => {
    const resolved = resolveMarketReadV2({
      marketType: candidate.marketType,
      selectionKey: candidate.selectionKey,
      splitObservations,
      priceObservations,
    });
    result.labelCounts[resolved.label] = (result.labelCounts[resolved.label] ?? 0) + 1;
    return {
      canonical_event_id: candidate.canonicalEventId,
      canonical_market_id: candidate.canonicalMarketId,
      selection_key: candidate.selectionKey,
      league: opts.sport,
      market_type: candidate.marketType,
      resolver_version: MARKET_INTELLIGENCE_V2_RESOLVER_VERSION,
      score: resolved.score,
      label: resolved.label,
      explanation: resolved.explanation,
      evidence_json: resolved.evidence,
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
    result.errors.push(`snapshot insert: ${error.message}`);
    return result;
  }
  result.snapshotsWritten = payload.length;
  return result;
}
