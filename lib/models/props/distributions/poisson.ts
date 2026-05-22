/**
 * Poisson distribution — X ~ Poisson(λ)
 *
 * Used for props that are rare-event count data: batter_home_runs,
 * pitcher_strikeouts, pitcher_earned_runs. The Poisson is a reasonable
 * approximation when n is large and p is small (which is the regime for
 * HR per PA, K per BFP, etc.).
 *
 * Parameter: λ = expected count (typically `expected_PA × per_PA_rate`).
 *
 * Numerical stability: PMF uses log-space and exponentiates. Safe for
 * λ up to ~700 (well beyond any realistic prop value).
 */

import { logFactorial } from "../../../utils/stats";

/**
 * Probability mass: P(X = k) where X ~ Poisson(λ).
 */
export function poissonPmf(lambda: number, k: number): number {
  if (lambda < 0) {
    throw new Error(`poissonPmf: lambda must be ≥ 0, got ${lambda}`);
  }
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  const logProb = k * Math.log(lambda) - lambda - logFactorial(k);
  return Math.exp(logProb);
}

/**
 * Cumulative: P(X ≤ k).
 */
export function poissonCdf(lambda: number, k: number): number {
  if (k < 0) return 0;
  let sum = 0;
  // For large λ, sum may need many terms but Poisson tail is thin —
  // cap at 4σ above λ to bound the work.
  const cap = Math.min(k, Math.ceil(lambda + 4 * Math.sqrt(lambda) + 10));
  for (let i = 0; i <= cap && i <= k; i++) {
    sum += poissonPmf(lambda, i);
  }
  return Math.min(1, sum);
}

/**
 * Right-tail probability: P(X ≥ threshold).
 *
 * Main public API for the prop pipeline. For "over 0.5 HR", callers pass
 * `threshold = 1` (need ≥1 HR).
 */
export function poissonProbabilityOver(
  lambda: number,
  threshold: number
): number {
  if (threshold <= 0) return 1;
  return 1 - poissonCdf(lambda, threshold - 1);
}

/**
 * Mean E[X] = λ.
 */
export function poissonMean(lambda: number): number {
  return lambda;
}

/**
 * Variance Var(X) = λ (same as the mean — Poisson is the equidispersed
 * benchmark for count data).
 */
export function poissonVariance(lambda: number): number {
  return lambda;
}
