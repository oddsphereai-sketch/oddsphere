/**
 * ML inverted low-conviction market-divergent flip (2026-06-22).
 *
 * Evidence (graded 6/6-6/22): MLB moneyline picks with final confidence in
 * [55,60) AND raw (pre-dampening) confidence < 60 AND market-divergent are an
 * INVERTED cohort — shipped 12-28 (30%, -17.9u), but betting the OPPOSITE side
 * at real opposite-book prices goes 28-12 (70%, +21.5u). These are morning-draft
 * marginal-conviction favorites the model backs against the market and loses.
 *
 * This pure helper decides whether to flip the OFFICIAL/tracked recommendation
 * to the opposite ML side and returns the flipped side's priced fields. It NEVER
 * fabricates a price: if the opposite-side odds are missing, it does not flip.
 * The underlying model opinion (game_predictions.predicted_ml_winner) is
 * untouched; only the prediction_records recommendation flips, with full audit.
 */

import { flipRecommendationConfidence } from "./flipConfidence";

export const ML_INVERSION_RULE_ID = "ml_inverted_lowconv_marketdivergent_v1";
export const ML_INVERSION_GRADE_RULE_ID =
  "ml_inversion_positive_value_safety_lean_v1_2026_07_24";
export const ML_INVERSION_MIN_EDGE_PP = 0.5;
export const ML_INVERSION_MIN_PRICE_EXCLUSIVE = -220;

export type MlSide = "home" | "away";

export type MlFlipInput = {
  predictedSide: MlSide | null;
  /** Final ML confidence, 0-100. */
  confidence: number | null;
  /** Pre-dampening ml_raw_confidence, 0-100. */
  rawConfidence: number | null;
  /** market_aligned flag; flip only fires when this is strictly false. */
  marketAligned: boolean;
  /** Model prob for the PREDICTED side (0-1). */
  modelProb: number | null;
  /** Market (no-vig) prob for the PREDICTED side (0-1). */
  marketProb: number | null;
  homeOdds: number | null;
  awayOdds: number | null;
};

export type MlFlipResult =
  | {
      flipped: true;
      rule_id: string;
      flippedSide: MlSide;
      flippedOdds: number;
      /** Raw opposite-side model probability (< 0.5) — AUDIT ONLY, never displayed. */
      flippedSideModelProb: number | null;
      flippedMarketProb: number | null;
      flippedEdgePp: number | null;
      /** Member-facing conservative recommendation confidence (>= 55). */
      recommendationConfidence: number;
    }
  | { flipped: false; reason: string };

export type MlInversionPublicGradeResult = {
  rule_id: typeof ML_INVERSION_GRADE_RULE_ID;
  actionable: boolean;
  playGrade: "lean" | null;
  bestAngle: false;
  edgePp: number | null;
  expectedValue: number | null;
  reason: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function resolveMlInversionFlip(i: MlFlipInput): MlFlipResult {
  if (i.predictedSide !== "home" && i.predictedSide !== "away") {
    return { flipped: false, reason: "no_predicted_side" };
  }
  if (i.confidence === null || !(i.confidence >= 55 && i.confidence < 60)) {
    return { flipped: false, reason: "confidence_out_of_band" };
  }
  if (i.rawConfidence === null || !(i.rawConfidence < 60)) {
    return { flipped: false, reason: "raw_confidence_not_low" };
  }
  if (i.marketAligned !== false) {
    return { flipped: false, reason: "not_market_divergent" };
  }
  const flippedSide: MlSide = i.predictedSide === "home" ? "away" : "home";
  const flippedOdds = flippedSide === "home" ? i.homeOdds : i.awayOdds;
  if (flippedOdds === null || flippedOdds === undefined || !Number.isFinite(flippedOdds)) {
    return { flipped: false, reason: "missing_opposite_odds" };
  }
  const flippedSideModelProb = i.modelProb !== null ? 1 - i.modelProb : null;
  const flippedMarketProb = i.marketProb !== null ? 1 - i.marketProb : null;
  const flippedEdgePp =
    flippedSideModelProb !== null && flippedMarketProb !== null
      ? round1((flippedSideModelProb - flippedMarketProb) * 100)
      : null;
  return {
    flipped: true,
    rule_id: ML_INVERSION_RULE_ID,
    flippedSide,
    flippedOdds,
    flippedSideModelProb,
    flippedMarketProb,
    flippedEdgePp,
    recommendationConfidence: flipRecommendationConfidence(i.confidence),
  };
}

function americanDecimalOdds(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

/**
 * Resolve the public grade after an inversion has selected the final side.
 *
 * The inversion-specific recommendation probability is the public probability
 * substrate. The base model's opposite-side probability remains audit-only:
 * requiring positive value from it would make every inversion impossible by
 * definition. A qualifying inversion is exactly Lean; inversion status alone
 * can never create a Best Angle.
 */
export function resolveMlInversionPublicGrade(args: {
  inversionTriggered: boolean;
  finalSideChanged: boolean;
  finalOdds: number | null;
  recommendationProbability: number | null;
  finalMarketProbability: number | null;
  dataQualityTier: string | null;
  provisional: boolean;
}): MlInversionPublicGradeResult {
  const blocked = (
    reason: string,
    edgePp: number | null = null,
    expectedValue: number | null = null,
  ): MlInversionPublicGradeResult => ({
    rule_id: ML_INVERSION_GRADE_RULE_ID,
    actionable: false,
    playGrade: null,
    bestAngle: false,
    edgePp,
    expectedValue,
    reason,
  });
  if (!args.inversionTriggered) return blocked("not_an_inversion");
  if (!args.finalSideChanged) return blocked("inversion_did_not_change_final_side");
  if (args.dataQualityTier !== "high" || args.provisional) {
    return blocked("inversion_data_quality_not_actionable");
  }
  if (
    args.finalOdds === null ||
    !Number.isFinite(args.finalOdds) ||
    args.finalOdds === 0
  ) {
    return blocked("inversion_final_price_missing");
  }
  if (args.finalOdds <= ML_INVERSION_MIN_PRICE_EXCLUSIVE) {
    return blocked("inversion_final_price_outside_lean_policy");
  }
  if (
    args.recommendationProbability === null ||
    !Number.isFinite(args.recommendationProbability) ||
    args.finalMarketProbability === null ||
    !Number.isFinite(args.finalMarketProbability)
  ) {
    return blocked("inversion_final_value_missing");
  }
  const edgePp = round1(
    (args.recommendationProbability - args.finalMarketProbability) * 100,
  );
  const expectedValue =
    args.recommendationProbability * americanDecimalOdds(args.finalOdds) - 1;
  if (edgePp < ML_INVERSION_MIN_EDGE_PP) {
    return blocked("inversion_final_edge_below_lean_minimum", edgePp, expectedValue);
  }
  if (expectedValue <= 0) {
    return blocked("inversion_final_ev_not_positive", edgePp, expectedValue);
  }
  return {
    rule_id: ML_INVERSION_GRADE_RULE_ID,
    actionable: true,
    playGrade: "lean",
    bestAngle: false,
    edgePp,
    expectedValue,
    reason: "genuine_final_side_inversion_clears_lean_value_and_safety_gates",
  };
}
