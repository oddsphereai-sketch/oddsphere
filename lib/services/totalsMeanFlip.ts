/**
 * Totals conservative mean-side flip (2026-06-22).
 *
 * The O/U side follows P(over) vs P(under); the right-skewed Poisson can put
 * P(over) < 0.5 while the projected MEAN total is above the line, so the model
 * picks the side AGAINST its own projection. Those divergent picks go ~4-12.
 * Backtest: flipping the divergent pick to the projected-mean side (54.6% / +13.4u)
 * beats standing it down (Patch 1, +1.6u). Because the edge rides on a small
 * flip sample, this ships the CONSERVATIVE rule: flip only when the mean gap is
 * material (>=0.3 runs) and the line is < 10, with a valid mean-side price.
 * Otherwise fall back to Patch 1 (no_bet stand-down). Does NOT touch the
 * projected total or the probability model — side-selection reconciliation only.
 */

export const TOTALS_MEAN_FLIP_RULE_ID = "totals_meanflip_conservative_v1";

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
  overOdds: number | null;
  underOdds: number | null;
  /** Reconciliation flag fallback when projectedTotal/line are unavailable. */
  reconciliationDivergence: boolean;
  gapThreshold?: number; // default 0.3
  maxLineExclusive?: number; // default 10 (exclude line >= 10)
};

export type TotalsFlipResult =
  | {
      action: "flip";
      rule_id: string;
      meanSide: OuSide;
      meanGap: number;
      flippedOdds: number;
      flippedModelProb: number | null;
      flippedMarketProb: number | null;
      flippedEdgePp: number | null;
      flippedConfidence: number | null;
    }
  | { action: "standdown"; reason: string }
  | { action: "none" };

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

export function resolveTotalsMeanFlip(i: TotalsFlipInput): TotalsFlipResult {
  const gapThreshold = i.gapThreshold ?? 0.3;
  const maxLine = i.maxLineExclusive ?? 10;
  if (i.predictedSide !== "over" && i.predictedSide !== "under") return { action: "none" };

  const haveMean = i.line !== null && i.projectedTotal !== null && Number.isFinite(i.line) && Number.isFinite(i.projectedTotal);
  const meanSide: OuSide | null = haveMean ? (i.projectedTotal! > i.line! ? "over" : "under") : null;
  const isDivergent = meanSide !== null ? i.predictedSide !== meanSide : i.reconciliationDivergence === true;
  if (!isDivergent) return { action: "none" };

  // Divergent. Eligible to FLIP only with a computable mean, material gap, line
  // under the cap, and a real mean-side price. Otherwise stand down (Patch 1).
  if (meanSide === null) return { action: "standdown", reason: "divergent_no_projected_total" };
  const gap = Math.abs(i.projectedTotal! - i.line!);
  if (gap < gapThreshold) return { action: "standdown", reason: "gap_below_threshold" };
  if (i.line! >= maxLine) return { action: "standdown", reason: "line_at_or_above_cap" };
  const flippedOdds = meanSide === "over" ? i.overOdds : i.underOdds;
  if (flippedOdds === null || flippedOdds === undefined || !Number.isFinite(flippedOdds)) {
    return { action: "standdown", reason: "missing_mean_side_odds" };
  }
  const flippedModelProb = i.modelProb !== null ? 1 - i.modelProb : null;
  const flippedMarketProb = i.marketProb !== null ? 1 - i.marketProb : null;
  const flippedEdgePp =
    flippedModelProb !== null && flippedMarketProb !== null ? round1((flippedModelProb - flippedMarketProb) * 100) : null;
  const flippedConfidence = flippedModelProb !== null ? round1(flippedModelProb * 100) : null;
  return {
    action: "flip",
    rule_id: TOTALS_MEAN_FLIP_RULE_ID,
    meanSide,
    meanGap: round2(gap),
    flippedOdds,
    flippedModelProb,
    flippedMarketProb,
    flippedEdgePp,
    flippedConfidence,
  };
}
