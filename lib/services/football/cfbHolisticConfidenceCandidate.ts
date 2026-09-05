import type { CfbV1Grade, CfbV1Market } from "./cfbV1Decision";
import {
  confidenceGradeFromScore,
  executionStatusForQuote,
} from "@/lib/services/dailyEdge/confidenceExecutionContract";

export const CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE =
  "cfb_holistic_confidence_2026_09_05_r4_confidence_economics_bridge" as const;
export const CFB_HOLISTIC_BEST_ANGLE_MIN_SCORE = 60 as const;
export const CFB_HOLISTIC_LEAN_MIN_SCORE = 55 as const;
export const CFB_HOLISTIC_WATCHLIST_MIN_SCORE = 51.5 as const;
export const CFB_HOLISTIC_SHARP_MAX_POINTS = 2.5 as const;
export const CFB_HOLISTIC_MOVEMENT_MAX_POINTS = 1.5 as const;
export const CFB_HOLISTIC_PUBLIC_MAX_POINTS = 1 as const;
export const CFB_HOLISTIC_TOTAL_EVIDENCE_MAX_POINTS = 4 as const;
export const CFB_HOLISTIC_BEST_ANGLE_FAVORITE_PRICE_FLOOR = -200 as const;
export const CFB_HOLISTIC_LEAN_FAVORITE_PRICE_FLOOR = -500 as const;

export type CfbHolisticSelectedSide = "home" | "away" | "over" | "under";
export type CfbHolisticEvidenceDirection = "support" | "resistance" | "neutral" | "unknown";

export type CfbHolisticConfidenceInput = {
  market: CfbV1Market;
  selectedSide: CfbHolisticSelectedSide;
  modelProbability: number;
  marketFairProbability: number;
  decisionGrade: CfbV1Grade;
  exactPriceExpectedValue: number;
  evaluatedPrice: number;
  evaluatedLine: number | null;
  sharpMoneyMinusTicketsPp: number | null;
  publicMoneyMinusTicketsPp: number | null;
  selectedSideLineDelta: number | null;
  selectedSideImpliedProbabilityDeltaPp: number | null;
  sharpDirection: CfbHolisticEvidenceDirection;
  movementDirection: CfbHolisticEvidenceDirection;
  publicDirection: CfbHolisticEvidenceDirection;
};

export type CfbHolisticConfidenceResult = {
  candidateRelease: typeof CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE;
  confidenceScore: number;
  modelConfidenceScore: number;
  evidenceConfidenceAdjustment: number;
  evidenceContributions: {
    sharp: number;
    movement: number;
    public: number;
  };
  probabilityGrade: CfbV1Grade;
  uncappedConfidenceGrade: CfbV1Grade;
  confidenceGrade: CfbV1Grade;
  priceTierCeiling: CfbV1Grade | null;
  decisionGradeCeiling: CfbV1Grade | null;
  marketEvidenceBallot: {
    supportCount: number;
    resistanceCount: number;
    multiChannelAffirmation: boolean;
  };
  executionStatus: "bet" | "shop";
};

/**
 * Outcome-blind confidence scorer. The model probability stays the primary
 * confidence axis. Signed market evidence can affirm or resist it within the
 * existing bounded four-point range; there is no second model/market weighting.
 * Spread economics provide an ordinal anchor rather than a binary gate. A
 * second-tier promotion requires multi-channel affirmation, while no single
 * market channel can veto or flip the prediction. A selected moneyline
 * favorite's attached price keeps the separately graduated ceiling.
 */
export function evaluateCfbHolisticConfidence(
  input: CfbHolisticConfidenceInput,
): CfbHolisticConfidenceResult {
  assertProbability(input.modelProbability);
  if (!Number.isFinite(input.exactPriceExpectedValue)) throw new Error("CFB holistic candidate EV must be finite.");
  if (!Number.isFinite(input.evaluatedPrice) || input.evaluatedPrice === 0) throw new Error("CFB holistic candidate price must be a real American quote.");
  assertProbability(input.marketFairProbability);
  const modelConfidenceScore = 100 * input.modelProbability;
  const sharp = boundedContribution(input.sharpMoneyMinusTicketsPp, CFB_HOLISTIC_SHARP_MAX_POINTS, 20);
  const movementSupportPp = selectedSideMovementSupportPp(input);
  const movement = boundedContribution(movementSupportPp, CFB_HOLISTIC_MOVEMENT_MAX_POINTS, 4);
  const publicContribution = boundedContribution(input.publicMoneyMinusTicketsPp, CFB_HOLISTIC_PUBLIC_MAX_POINTS, 20);
  const evidenceConfidenceAdjustment = clamp(
    sharp + movement + publicContribution,
    -CFB_HOLISTIC_TOTAL_EVIDENCE_MAX_POINTS,
    CFB_HOLISTIC_TOTAL_EVIDENCE_MAX_POINTS,
  );
  const confidenceScore = clamp(modelConfidenceScore + evidenceConfidenceAdjustment, 0, 100);
  const uncappedConfidenceGrade = gradeForScore(confidenceScore);
  const priceTierCeiling = favoritePriceTierCeiling(input.market, input.evaluatedPrice);
  const marketEvidenceBallot = categoricalEvidenceBallot(input);
  const decisionGradeCeiling = input.market === "spread"
    ? spreadDecisionGradeCeiling(input.decisionGrade, marketEvidenceBallot.multiChannelAffirmation)
    : null;
  const spreadPremiumCeiling = input.market === "spread"
    && input.decisionGrade !== "Best Angle"
    && !marketEvidenceBallot.multiChannelAffirmation
      ? "Lean"
      : null;
  const finalGradeCeiling = mostRestrictiveGradeCeiling([
    priceTierCeiling,
    decisionGradeCeiling,
    spreadPremiumCeiling,
  ]);
  return {
    candidateRelease: CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE,
    confidenceScore,
    modelConfidenceScore,
    evidenceConfidenceAdjustment,
    evidenceContributions: { sharp, movement, public: publicContribution },
    probabilityGrade: gradeForScore(modelConfidenceScore),
    uncappedConfidenceGrade,
    confidenceGrade: applyGradeCeiling(uncappedConfidenceGrade, finalGradeCeiling),
    priceTierCeiling,
    decisionGradeCeiling,
    marketEvidenceBallot,
    executionStatus: executionStatusForQuote({
      americanPrice: input.evaluatedPrice,
      expectedValue: input.exactPriceExpectedValue,
      quoteFresh: true,
      quoteCoherent: true,
    }) as "bet" | "shop",
  };
}

function spreadDecisionGradeCeiling(
  grade: CfbV1Grade,
  multiChannelAffirmation: boolean,
): CfbV1Grade {
  if (grade === "No Play") return multiChannelAffirmation ? "Lean" : "Watchlist";
  if (grade === "Watchlist") return multiChannelAffirmation ? "Best Angle" : "Lean";
  return "Best Angle";
}

function categoricalEvidenceBallot(input: CfbHolisticConfidenceInput): {
  supportCount: number;
  resistanceCount: number;
  multiChannelAffirmation: boolean;
} {
  const directions = [input.sharpDirection, input.movementDirection, input.publicDirection];
  const supportCount = directions.filter((direction) => direction === "support").length;
  const resistanceCount = directions.filter((direction) => direction === "resistance").length;
  return {
    supportCount,
    resistanceCount,
    multiChannelAffirmation: supportCount >= 2 && resistanceCount === 0,
  };
}

function mostRestrictiveGradeCeiling(ceilings: Array<CfbV1Grade | null>): CfbV1Grade | null {
  const rank: Record<CfbV1Grade, number> = {
    "No Play": 0,
    Watchlist: 1,
    Lean: 2,
    "Best Angle": 3,
  };
  return ceilings.filter((value): value is CfbV1Grade => value !== null)
    .sort((first, second) => rank[first] - rank[second])[0] ?? null;
}

export function favoritePriceTierCeiling(
  market: CfbV1Market,
  evaluatedPrice: number,
): CfbV1Grade | null {
  if (market !== "moneyline" || evaluatedPrice >= 0) return null;
  if (evaluatedPrice <= CFB_HOLISTIC_LEAN_FAVORITE_PRICE_FLOOR) return "Watchlist";
  if (evaluatedPrice < CFB_HOLISTIC_BEST_ANGLE_FAVORITE_PRICE_FLOOR) return "Lean";
  return null;
}

function applyGradeCeiling(grade: CfbV1Grade, ceiling: CfbV1Grade | null): CfbV1Grade {
  if (ceiling === null) return grade;
  const rank: Record<CfbV1Grade, number> = {
    "No Play": 0,
    Watchlist: 1,
    Lean: 2,
    "Best Angle": 3,
  };
  return rank[grade] > rank[ceiling] ? ceiling : grade;
}

export function gradeForScore(score: number): CfbV1Grade {
  return confidenceGradeFromScore(score, {
    bestAngle: CFB_HOLISTIC_BEST_ANGLE_MIN_SCORE,
    lean: CFB_HOLISTIC_LEAN_MIN_SCORE,
    watchlist: CFB_HOLISTIC_WATCHLIST_MIN_SCORE,
  });
}

export function selectedSideMovementSupportPp(input: Pick<
  CfbHolisticConfidenceInput,
  "market" | "selectedSide" | "selectedSideLineDelta" | "selectedSideImpliedProbabilityDeltaPp"
>): number | null {
  const lineSupportPp = input.selectedSideLineDelta === null
    ? null
    : input.market === "spread"
      ? -2 * input.selectedSideLineDelta
      : input.market === "total"
        ? (input.selectedSide === "over" ? 2 : -2) * input.selectedSideLineDelta
        : null;
  return meanFinite([input.selectedSideImpliedProbabilityDeltaPp, lineSupportPp]);
}

function boundedContribution(value: number | null, maximum: number, fullStrength: number): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return clamp(value / fullStrength, -1, 1) * maximum;
}

function meanFinite(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function assertProbability(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("CFB holistic candidate probability must be within [0,1].");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
