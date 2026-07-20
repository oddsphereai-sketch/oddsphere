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
