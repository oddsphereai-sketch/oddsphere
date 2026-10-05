/**
 * Totals official side selector (mean-side correction).
 *
 * The O/U probability head can favor one side while the projected MEAN total is
 * on the other side of the betting line. Stored-result replay through
 * 2026-07-10 showed the broader mean-aligned selector outperforming the shipped
 * output (226-210, +8.3u vs 222-214, -4.9u across 448 graded totals), so the
 * official prediction side now follows the projected-total side on every
 * mean/probability divergence that has a real mean-side price. If the mean side
 * cannot be priced, the pick stands down rather than tracking an unpriced side.
 *
 * This changes the official prediction side only. The original probability-side
 * model output is preserved in the snapshot audit.
 */

import { flipRecommendationConfidence } from "./flipConfidence";

export const TOTALS_MEAN_FLIP_RULE_ID = "totals_mean_side_selector_v2_2026_07_11";
export const TOTALS_MARKET_OPPOSED_FLIP_RULE_ID = "totals_market_opposed_public_conflict_v1_2026_07_11";
export const MLB_TOTAL_CORROBORATED_OPPOSITION_RULE_ID =
  "mlb_total_corroborated_opposition_v1_2026_10_05";
export const TOTALS_MID_EDGE_FLIP_RULE_ID = "totals_mid_edge_inversion_v1_2026_07_20";
export const TOTALS_MID_EDGE_MIN_PCT = 3;
export const TOTALS_MID_EDGE_MAX_PCT_EXCLUSIVE = 5;
export const TOTALS_MARKET_OPPOSED_MAX_MODEL_PROB = 0.575;

export type OuSide = "over" | "under";

export type TotalsFlipInput = {
  predictedSide: OuSide | null;
  line: number | null;
  /** posterior_total (the displayed projected total). */
  projectedTotal: number | null;
  /** Model prob for the PICKED side (0-1). */
  modelProb: number | null;
  /** Market (no-vig) prob for the PICKED side (0-1). */
  marketProb: number | null;
  /** Model conviction on the ORIGINAL pick (0-100); drives member-facing confidence. */
  originalConfidence: number | null;
  overOdds: number | null;
  underOdds: number | null;
  /** Reconciliation flag fallback when projectedTotal/line are unavailable. */
  reconciliationDivergence: boolean;
  gapThreshold?: number; // default 0: any non-push mean/prob divergence qualifies
  maxLineExclusive?: number; // default Infinity: no line cap in v2
};

export type TotalsFlipResult =
  | {
      action: "flip";
      rule_id: string;
      meanSide: OuSide;
      meanGap: number;
      flippedOdds: number;
      /** Raw mean-side model probability (< 0.5) — AUDIT ONLY, never displayed. */
      flippedSideModelProb: number | null;
      flippedMarketProb: number | null;
      flippedEdgePp: number | null;
      /** Member-facing conservative recommendation confidence (>= 55). */
      recommendationConfidence: number;
    }
  | { action: "standdown"; reason: string }
  | { action: "none" };

export type TotalsMarketOpposedFlipInput = {
  predictedSide: OuSide | null;
  /** Model prob for the PICKED side (0-1). */
  modelProb: number | null;
  /** Market no-vig prob for the PICKED side (0-1). */
  marketProb: number | null;
  opposingPublicSplitConflict: boolean;
  originalConfidence: number | null;
  overOdds: number | null;
  underOdds: number | null;
  maxModelProb?: number;
};

export type TotalsMarketOpposedFlipResult =
  | {
      action: "flip";
      rule_id: string;
      flippedSide: OuSide;
      flippedOdds: number;
      maxModelProb: number;
      flippedSideModelProb: number | null;
      flippedMarketProb: number | null;
      flippedEdgePp: number | null;
      recommendationConfidence: number;
    }
  | { action: "standdown"; reason: string }
  | { action: "none" };

export type MlbTotalCorroboratedOppositionInput = {
  predictedSide: OuSide | null;
  /** Probability for the independent model's selected side. */
  modelProb: number | null;
  /** Target-excluded no-vig probability for the selected side. */
  marketProb: number | null;
  /** A continuous same-sportsbook price trail must move against the pick. */
  sameBookMovementDirection: "toward_pick" | "against_pick" | "neutral" | "unknown" | null;
  /** Retail money/ticket divergence in favor of the opposite side. */
  opposingPublicSplitConflict: boolean;
  /** Sport-owned internal market read captured before the result. */
  internalSharpDirection: string | null;
  originalConfidence: number | null;
  overOdds: number | null;
  underOdds: number | null;
  line: number | null;
  /** Authoritative MLB Total head used for the selected-side decision. */
  projectedTotal: number | null;
  projectedHomeScore: number | null;
  projectedAwayScore: number | null;
  maxModelProb?: number;
};

export type MlbTotalCorroboratedOppositionResult =
  | {
      action: "flip";
      rule_id: typeof MLB_TOTAL_CORROBORATED_OPPOSITION_RULE_ID;
      originalSide: OuSide;
      flippedSide: OuSide;
      flippedOdds: number;
      originalModelProb: number;
      rawOppositeModelProb: number;
      correctedModelProb: number;
      flippedMarketProb: number;
      flippedEdgePp: number;
      recommendationConfidence: number;
      correctedHomeScore: number;
      correctedAwayScore: number;
      correctedTotal: number;
      scoreAdjustment: "retained_already_coherent" | "reflected_across_line";
      corroboration: Array<"opposing_public_money_conflict" | "internal_sharp_resistance">;
    }
  | { action: "none"; reason: string };

export type TotalsMidEdgeFlipInput = {
  currentSide: OuSide | null;
  currentEdgePp: number | null;
  currentModelProb: number | null;
  currentMarketProb: number | null;
  currentConfidence: number | null;
  overOdds: number | null;
  underOdds: number | null;
  priorCorrectionApplied: boolean;
};

export type TotalsMidEdgeFlipResult =
  | {
      action: "flip";
      rule_id: typeof TOTALS_MID_EDGE_FLIP_RULE_ID;
      originalSide: OuSide;
      flippedSide: OuSide;
      originalEdgePp: number;
      flippedOdds: number;
      flippedSideModelProb: number | null;
      flippedMarketProb: number | null;
      flippedEdgePp: number | null;
      recommendationConfidence: number;
    }
  | { action: "none"; reason: string };

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

export function resolveTotalsMeanFlip(i: TotalsFlipInput): TotalsFlipResult {
  const gapThreshold = i.gapThreshold ?? 0;
  const maxLine = i.maxLineExclusive ?? Number.POSITIVE_INFINITY;
  if (i.predictedSide !== "over" && i.predictedSide !== "under") return { action: "none" };

  const haveMean = i.line !== null && i.projectedTotal !== null && Number.isFinite(i.line) && Number.isFinite(i.projectedTotal);
  const meanSide: OuSide | null = haveMean
    ? i.projectedTotal! > i.line!
      ? "over"
      : i.projectedTotal! < i.line!
        ? "under"
        : null
    : null;
  const isDivergent = meanSide !== null ? i.predictedSide !== meanSide : i.reconciliationDivergence === true;
  if (!isDivergent) return { action: "none" };

  // Divergent. Eligible to flip with a computable non-push mean, an optional
  // caller-supplied gap/line guard, and a real mean-side price. Otherwise stand
  // down so the official record never tracks an unpriced correction.
  if (meanSide === null) return { action: "standdown", reason: "divergent_no_projected_total" };
  const gap = Math.abs(i.projectedTotal! - i.line!);
  if (gap < gapThreshold) return { action: "standdown", reason: "gap_below_threshold" };
  if (i.line! >= maxLine) return { action: "standdown", reason: "line_at_or_above_cap" };
  const flippedOdds = meanSide === "over" ? i.overOdds : i.underOdds;
  if (flippedOdds === null || flippedOdds === undefined || !Number.isFinite(flippedOdds)) {
    return { action: "standdown", reason: "missing_mean_side_odds" };
  }
  const flippedSideModelProb = i.modelProb !== null ? 1 - i.modelProb : null;
  const flippedMarketProb = i.marketProb !== null ? 1 - i.marketProb : null;
  const flippedEdgePp =
    flippedSideModelProb !== null && flippedMarketProb !== null ? round1((flippedSideModelProb - flippedMarketProb) * 100) : null;
  return {
    action: "flip",
    rule_id: TOTALS_MEAN_FLIP_RULE_ID,
    meanSide,
    meanGap: round2(gap),
    flippedOdds,
    flippedSideModelProb,
    flippedMarketProb,
    flippedEdgePp,
    recommendationConfidence: flipRecommendationConfidence(i.originalConfidence),
  };
}

export function resolveTotalsMarketOpposedFlip(
  i: TotalsMarketOpposedFlipInput,
): TotalsMarketOpposedFlipResult {
  const maxModelProb = i.maxModelProb ?? TOTALS_MARKET_OPPOSED_MAX_MODEL_PROB;
  if (i.predictedSide !== "over" && i.predictedSide !== "under") return { action: "none" };
  if (i.modelProb === null || i.marketProb === null) return { action: "none" };
  if (!Number.isFinite(i.modelProb) || !Number.isFinite(i.marketProb)) return { action: "none" };
  if (i.modelProb > maxModelProb) return { action: "none" };
  if (i.marketProb >= 0.5) return { action: "none" };
  if (!i.opposingPublicSplitConflict) return { action: "none" };

  const flippedSide = i.predictedSide === "over" ? "under" : "over";
  const flippedOdds = flippedSide === "over" ? i.overOdds : i.underOdds;
  if (flippedOdds === null || flippedOdds === undefined || !Number.isFinite(flippedOdds)) {
    return { action: "standdown", reason: "missing_market_opposed_side_odds" };
  }

  const flippedSideModelProb = 1 - i.modelProb;
  const flippedMarketProb = 1 - i.marketProb;
  return {
    action: "flip",
    rule_id: TOTALS_MARKET_OPPOSED_FLIP_RULE_ID,
    flippedSide,
    flippedOdds,
    maxModelProb,
    flippedSideModelProb,
    flippedMarketProb,
    flippedEdgePp: round1((flippedSideModelProb - flippedMarketProb) * 100),
    recommendationConfidence: flipRecommendationConfidence(i.originalConfidence),
  };
}

/**
 * MLB-only downstream arbitration for a narrowly validated Total failure mode.
 *
 * This is intentionally not a generic market follower. The independent side
 * remains authoritative unless all of the following pre-result facts agree:
 * modest model conviction, an opposing no-vig price, an adverse continuous
 * same-book price trail, and a second independent public/sharp corroborator.
 * A real opposite-side quote and enough score information to rebuild one
 * coherent projection are mandatory.
 */
export function resolveMlbTotalCorroboratedOpposition(
  i: MlbTotalCorroboratedOppositionInput,
): MlbTotalCorroboratedOppositionResult {
  const maxModelProb = i.maxModelProb ?? TOTALS_MARKET_OPPOSED_MAX_MODEL_PROB;
  if (i.predictedSide !== "over" && i.predictedSide !== "under") {
    return { action: "none", reason: "unsupported_side" };
  }
  if (i.modelProb === null || i.marketProb === null) {
    return { action: "none", reason: "missing_probability" };
  }
  if (!Number.isFinite(i.modelProb) || !Number.isFinite(i.marketProb)) {
    return { action: "none", reason: "invalid_probability" };
  }
  if (i.modelProb > maxModelProb) return { action: "none", reason: "model_conviction_above_cap" };
  if (i.marketProb >= 0.5) return { action: "none", reason: "two_sided_price_does_not_oppose_pick" };
  if (i.sameBookMovementDirection !== "against_pick") {
    return { action: "none", reason: "no_adverse_same_book_price_move" };
  }

  const corroboration: Array<"opposing_public_money_conflict" | "internal_sharp_resistance"> = [];
  if (i.opposingPublicSplitConflict) corroboration.push("opposing_public_money_conflict");
  if (i.internalSharpDirection === "market_resistance") corroboration.push("internal_sharp_resistance");
  if (corroboration.length === 0) return { action: "none", reason: "missing_independent_corroboration" };

  const flippedSide: OuSide = i.predictedSide === "over" ? "under" : "over";
  const flippedOdds = flippedSide === "over" ? i.overOdds : i.underOdds;
  if (flippedOdds === null || !Number.isFinite(flippedOdds)) {
    return { action: "none", reason: "missing_opposite_price" };
  }
  if (
    i.line === null || !Number.isFinite(i.line) ||
    i.projectedTotal === null || !Number.isFinite(i.projectedTotal) ||
    i.projectedHomeScore === null || !Number.isFinite(i.projectedHomeScore) ||
    i.projectedAwayScore === null || !Number.isFinite(i.projectedAwayScore)
  ) {
    return { action: "none", reason: "missing_score_reconciliation_input" };
  }

  const rawTotal = i.projectedTotal;
  const alreadyCoherent = flippedSide === "over" ? rawTotal > i.line : rawTotal < i.line;
  let correctedTotal = alreadyCoherent ? rawTotal : (2 * i.line) - rawTotal;
  correctedTotal = round1(correctedTotal);
  if (flippedSide === "over" && correctedTotal <= i.line) correctedTotal = round1(i.line + 0.1);
  if (flippedSide === "under" && correctedTotal >= i.line) correctedTotal = round1(Math.max(0, i.line - 0.1));

  const rawHomeMargin = i.projectedHomeScore - i.projectedAwayScore;
  let correctedHomeScore = round1(Math.max(0, (correctedTotal + rawHomeMargin) / 2));
  const correctedAwayScore = round1(Math.max(0, correctedTotal - correctedHomeScore));
  // Keep the displayed score sum exact after one-decimal rounding.
  correctedHomeScore = round1(Math.max(0, correctedTotal - correctedAwayScore));

  const rawOppositeModelProb = 1 - i.modelProb;
  // The correction layer is a pre-result meta-model, not a claim that the raw
  // independent opposite probability exceeded 50%. Its 38-20 retrospective
  // cohort supports a conservative 55%-to-original-strength public estimate.
  const correctedModelProb = Math.max(0.55, Math.min(0.6, i.modelProb));
  const flippedMarketProb = 1 - i.marketProb;
  const flippedEdgePp = round1((correctedModelProb - flippedMarketProb) * 100);

  return {
    action: "flip",
    rule_id: MLB_TOTAL_CORROBORATED_OPPOSITION_RULE_ID,
    originalSide: i.predictedSide,
    flippedSide,
    flippedOdds,
    originalModelProb: i.modelProb,
    rawOppositeModelProb,
    correctedModelProb,
    flippedMarketProb,
    flippedEdgePp,
    recommendationConfidence: Math.round(correctedModelProb * 100),
    correctedHomeScore,
    correctedAwayScore,
    correctedTotal: round1(correctedHomeScore + correctedAwayScore),
    scoreAdjustment: alreadyCoherent ? "retained_already_coherent" : "reflected_across_line",
    corroboration,
  };
}

/**
 * Chronologically validated MLB correction (2026-07-20): uncorrected totals
 * with a final absolute model-vs-market edge in [3pp, 5pp) were inverted in
 * three consecutive windows. The opposite side is published only when it has
 * a real price; existing mean/market-aware corrections are never double-flipped.
 */
export function resolveTotalsMidEdgeFlip(i: TotalsMidEdgeFlipInput): TotalsMidEdgeFlipResult {
  if (i.priorCorrectionApplied) return { action: "none", reason: "prior_correction_applied" };
  if (i.currentSide !== "over" && i.currentSide !== "under") {
    return { action: "none", reason: "unsupported_side" };
  }
  if (i.currentEdgePp === null || !Number.isFinite(i.currentEdgePp)) {
    return { action: "none", reason: "missing_edge" };
  }
  const absEdge = Math.abs(i.currentEdgePp);
  if (absEdge < TOTALS_MID_EDGE_MIN_PCT || absEdge >= TOTALS_MID_EDGE_MAX_PCT_EXCLUSIVE) {
    return { action: "none", reason: "outside_mid_edge_band" };
  }

  const flippedSide: OuSide = i.currentSide === "over" ? "under" : "over";
  const flippedOdds = flippedSide === "over" ? i.overOdds : i.underOdds;
  if (flippedOdds === null || !Number.isFinite(flippedOdds)) {
    return { action: "none", reason: "missing_opposite_price" };
  }

  const flippedSideModelProb = i.currentModelProb !== null && Number.isFinite(i.currentModelProb)
    ? 1 - i.currentModelProb
    : null;
  const flippedMarketProb = i.currentMarketProb !== null && Number.isFinite(i.currentMarketProb)
    ? 1 - i.currentMarketProb
    : null;
  const recommendationConfidence = flipRecommendationConfidence(i.currentConfidence);

  return {
    action: "flip",
    rule_id: TOTALS_MID_EDGE_FLIP_RULE_ID,
    originalSide: i.currentSide,
    flippedSide,
    originalEdgePp: round1(i.currentEdgePp),
    flippedOdds,
    flippedSideModelProb,
    flippedMarketProb,
    flippedEdgePp: flippedMarketProb === null
      ? null
      : round1((recommendationConfidence / 100 - flippedMarketProb) * 100),
    recommendationConfidence,
  };
}
