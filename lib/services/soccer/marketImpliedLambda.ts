/**
 * WC Tier-0 — Market-implied per-team goal rates (λ_home, λ_away).
 *
 * Research-grounded (Egidi/Pauli/Torelli 2018; MackayAnalytics odds-inversion):
 * the de-vigged market is a CALIBRATED, per-fixture source of scoring
 * expectations, and inverting it yields separate per-team λ — which is exactly
 * Dixon-Coles attack/defense without needing goal-based ratings. We use it to
 * (a) ground the Elo model (kill the symmetric-z double-count that inflates
 * BTTS/Over), and (b) serve as the fallback when a team is missing from the Elo
 * snapshot (e.g. Haiti) so no fixture silently vanishes.
 *
 * Method:
 *   • λ_sum  = the de-vig total line (market's central total estimate).
 *   • λ_diff = solved by bisection so the bivariate-Poisson home-win prob
 *              reproduces the de-vig 1X2 home probability (home-win prob is
 *              monotonic increasing in λ_diff at fixed λ_sum → bisection is
 *              exact + robust).
 *   • λ_home = (λ_sum + λ_diff)/2 ; λ_away = (λ_sum − λ_diff)/2.
 *
 * Pure module. Reuses the same bivariate-Poisson core the model uses, so the
 * inversion is self-consistent with the scoring distribution.
 */

import { bivariatePoissonScoreDistribution } from "./dixonColes";

export interface MarketImpliedLambdaInput {
  /** De-vig match-result home win probability (0..1). */
  pHome: number | null;
  /** De-vig match-result away win probability (0..1). */
  pAway: number | null;
  /** Market total line (λ_sum anchor), e.g. 2.5. */
  totalLine: number | null;
  /** Dixon-Coles τ (same value the model uses). */
  tau: number;
}

export interface MarketImpliedLambdaResult {
  lambdaHome: number | null;
  lambdaAway: number | null;
  lambdaSum: number | null;
  lambdaDiff: number | null;
  ok: boolean;
  reason: string;
}

const SUM_MIN = 1.2;
const SUM_MAX = 5.5;

/** P(home win) from the bivariate-Poisson joint at (λ_home, λ_away, τ). */
function homeWinProb(lh: number, la: number, tau: number): number {
  const joint = bivariatePoissonScoreDistribution(lh, la, tau);
  let home = 0;
  let total = 0;
  for (let h = 0; h < joint.length; h++) {
    for (let a = 0; a < joint[h]!.length; a++) {
      const p = joint[h]![a]!;
      total += p;
      if (h > a) home += p;
    }
  }
  return total > 0 ? home / total : 0.5;
}

const NULLS: MarketImpliedLambdaResult = {
  lambdaHome: null, lambdaAway: null, lambdaSum: null, lambdaDiff: null, ok: false, reason: "",
};

export function deriveMarketImpliedLambdas(input: MarketImpliedLambdaInput): MarketImpliedLambdaResult {
  const { pHome, pAway, totalLine, tau } = input;
  if (totalLine === null || !Number.isFinite(totalLine)) return { ...NULLS, reason: "no usable total line" };
  if (pHome === null || pAway === null || !Number.isFinite(pHome) || !Number.isFinite(pAway)) {
    return { ...NULLS, reason: "no de-vig match-result probabilities" };
  }
  const lambdaSum = Math.max(SUM_MIN, Math.min(SUM_MAX, totalLine));

  // Bisection on λ_diff. Home-win prob increases monotonically with λ_diff.
  let lo = -(lambdaSum - 0.3);
  let hi = lambdaSum - 0.3;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const lh = (lambdaSum + mid) / 2;
    const la = (lambdaSum - mid) / 2;
    const ph = homeWinProb(lh, la, tau);
    if (ph < pHome) lo = mid;
    else hi = mid;
  }
  const lambdaDiff = (lo + hi) / 2;
  const lambdaHome = (lambdaSum + lambdaDiff) / 2;
  const lambdaAway = (lambdaSum - lambdaDiff) / 2;
  if (lambdaHome <= 0 || lambdaAway <= 0) return { ...NULLS, reason: "inverted λ non-positive" };

  return {
    lambdaHome: Math.round(lambdaHome * 1000) / 1000,
    lambdaAway: Math.round(lambdaAway * 1000) / 1000,
    lambdaSum: Math.round(lambdaSum * 1000) / 1000,
    lambdaDiff: Math.round(lambdaDiff * 1000) / 1000,
    ok: true,
    reason: "market_implied",
  };
}
