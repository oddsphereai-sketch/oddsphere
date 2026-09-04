import type { CfbV1Grade, CfbV1Market } from "./cfbV1Decision";
import {
  confidenceGradeFromScore,
  executionStatusForQuote,
} from "@/lib/services/dailyEdge/confidenceExecutionContract";

export const CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE =
  "cfb_holistic_confidence_shadow_2026_09_04_r1_continuous_evidence" as const;
export const CFB_HOLISTIC_BEST_ANGLE_MIN_SCORE = 60 as const;
export const CFB_HOLISTIC_LEAN_MIN_SCORE = 55 as const;
export const CFB_HOLISTIC_WATCHLIST_MIN_SCORE = 51.5 as const;
export const CFB_HOLISTIC_SHARP_MAX_POINTS = 2.5 as const;
export const CFB_HOLISTIC_MOVEMENT_MAX_POINTS = 1.5 as const;
export const CFB_HOLISTIC_PUBLIC_MAX_POINTS = 1 as const;
export const CFB_HOLISTIC_TOTAL_EVIDENCE_MAX_POINTS = 4 as const;

export type CfbHolisticSelectedSide = "home" | "away" | "over" | "under";

export type CfbHolisticConfidenceInput = {
  market: CfbV1Market;
  selectedSide: CfbHolisticSelectedSide;
  modelProbability: number;
  exactPriceExpectedValue: number;
  evaluatedPrice: number;
  evaluatedLine: number | null;
  sharpMoneyMinusTicketsPp: number | null;
  publicMoneyMinusTicketsPp: number | null;
  selectedSideLineDelta: number | null;
  selectedSideImpliedProbabilityDeltaPp: number | null;
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
  confidenceGrade: CfbV1Grade;
  executionStatus: "bet" | "shop";
};

/**
 * Outcome-blind shadow scorer. Exact price and EV are retained for execution,
 * but cannot change the confidence score or grade.
 */
export function evaluateCfbHolisticConfidence(
  input: CfbHolisticConfidenceInput,
): CfbHolisticConfidenceResult {
  assertProbability(input.modelProbability);
  if (!Number.isFinite(input.exactPriceExpectedValue)) throw new Error("CFB holistic candidate EV must be finite.");
  if (!Number.isFinite(input.evaluatedPrice) || input.evaluatedPrice === 0) throw new Error("CFB holistic candidate price must be a real American quote.");
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
  return {
    candidateRelease: CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE,
    confidenceScore,
    modelConfidenceScore,
    evidenceConfidenceAdjustment,
    evidenceContributions: { sharp, movement, public: publicContribution },
    probabilityGrade: gradeForScore(modelConfidenceScore),
    confidenceGrade: gradeForScore(confidenceScore),
    executionStatus: executionStatusForQuote({
      americanPrice: input.evaluatedPrice,
      expectedValue: input.exactPriceExpectedValue,
      quoteFresh: true,
      quoteCoherent: true,
    }) as "bet" | "shop",
  };
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
