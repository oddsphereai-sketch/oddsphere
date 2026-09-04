import type { Sport } from "@/lib/types/domain/Sport";
import {
  resolveDailyEdgeConfidenceExecutionDecision,
  type DailyEdgeConfidenceBands,
  type DailyEdgeConfidenceExecutionDecision,
  type DailyEdgeConfidenceGrade,
} from "./confidenceExecutionContract";

export const DAILY_EDGE_FULL_GAME_CONFIDENCE_CANDIDATE_RELEASE =
  "daily_edge_full_game_confidence_candidate_2026_09_04_r1_frozen_semantics" as const;

const BINARY_BANDS: DailyEdgeConfidenceBands = { bestAngle: 60, lean: 55, watchlist: 51.5 };
const THREE_WAY_MATCH_RESULT_BANDS: DailyEdgeConfidenceBands = { bestAngle: 55, lean: 48, watchlist: 40 };
const DOUBLE_CHANCE_BANDS: DailyEdgeConfidenceBands = { bestAngle: 72, lean: 66, watchlist: 58 };

export type FullGameConfidenceMarket =
  | "moneyline"
  | "spread"
  | "total"
  | "match_result"
  | "btts"
  | "double_chance";

export type FullGameConfidenceDecision = DailyEdgeConfidenceExecutionDecision & {
  candidateRelease: typeof DAILY_EDGE_FULL_GAME_CONFIDENCE_CANDIDATE_RELEASE;
  sport: Sport;
  market: FullGameConfidenceMarket;
  modelProbabilityScore: number;
  evidenceAdjustmentPoints: number;
};

/**
 * Outcome-blind cross-sport semantic candidate. Authoritative sport models
 * retain ownership of forecast probability and bounded evidence adjustment.
 * This function never reads market price or EV while constructing confidence.
 */
export function resolveFullGameConfidenceDecision(args: {
  sport: Sport;
  market: FullGameConfidenceMarket;
  modelProbability: number;
  evidenceAdjustmentPoints?: number;
  previousConfidenceGrade?: DailyEdgeConfidenceGrade | null;
  hardHoldReason?: string | null;
  americanPrice: number | null;
  expectedValue: number | null;
  quoteFresh: boolean;
  quoteCoherent: boolean;
}): FullGameConfidenceDecision {
  if (args.sport === "cbb") throw new Error("CBB has no active Daily Edge champion; confidence publication is unavailable.");
  if (!Number.isFinite(args.modelProbability) || args.modelProbability < 0 || args.modelProbability > 1) {
    throw new Error("Full-game confidence probability must be within [0,1].");
  }
  const evidenceAdjustmentPoints = args.evidenceAdjustmentPoints ?? 0;
  if (!Number.isFinite(evidenceAdjustmentPoints) || Math.abs(evidenceAdjustmentPoints) > 4) {
    throw new Error("Full-game confidence evidence adjustment must be finite and within [-4,4].");
  }
  const modelProbabilityScore = 100 * args.modelProbability;
  const confidenceScore = clamp(modelProbabilityScore + evidenceAdjustmentPoints, 0, 100);
  const decision = resolveDailyEdgeConfidenceExecutionDecision({
    confidenceScore,
    previousConfidenceGrade: args.previousConfidenceGrade,
    bands: confidenceBandsFor(args.sport, args.market),
    hardHoldReason: args.hardHoldReason,
    americanPrice: args.americanPrice,
    expectedValue: args.expectedValue,
    quoteFresh: args.quoteFresh,
    quoteCoherent: args.quoteCoherent,
  });
  return {
    ...decision,
    candidateRelease: DAILY_EDGE_FULL_GAME_CONFIDENCE_CANDIDATE_RELEASE,
    sport: args.sport,
    market: args.market,
    modelProbabilityScore,
    evidenceAdjustmentPoints,
  };
}

export function confidenceBandsFor(
  sport: Sport,
  market: FullGameConfidenceMarket,
): DailyEdgeConfidenceBands {
  if ((sport === "soccer" || sport === "ucl") && market === "match_result") {
    return THREE_WAY_MATCH_RESULT_BANDS;
  }
  if ((sport === "soccer" || sport === "ucl") && market === "double_chance") {
    return DOUBLE_CHANCE_BANDS;
  }
  return BINARY_BANDS;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
