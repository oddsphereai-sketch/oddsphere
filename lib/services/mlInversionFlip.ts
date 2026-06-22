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

export const ML_INVERSION_RULE_ID = "ml_inverted_lowconv_marketdivergent_v1";

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
      flippedModelProb: number | null;
      flippedMarketProb: number | null;
      flippedEdgePp: number | null;
      flippedConfidence: number | null;
    }
  | { flipped: false; reason: string };

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
  const flippedModelProb = i.modelProb !== null ? 1 - i.modelProb : null;
  const flippedMarketProb = i.marketProb !== null ? 1 - i.marketProb : null;
  const flippedEdgePp =
    flippedModelProb !== null && flippedMarketProb !== null
      ? round1((flippedModelProb - flippedMarketProb) * 100)
      : null;
  const flippedConfidence = flippedModelProb !== null ? round1(flippedModelProb * 100) : null;
  return {
    flipped: true,
    rule_id: ML_INVERSION_RULE_ID,
    flippedSide,
    flippedOdds,
    flippedModelProb,
    flippedMarketProb,
    flippedEdgePp,
    flippedConfidence,
  };
}
