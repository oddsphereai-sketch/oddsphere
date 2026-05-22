/**
 * Binomial distribution — X ~ Binomial(n, p)
 *
 * Used for props where each trial is independent and identically
 * distributed: batter_hits is the canonical case (each PA is independent
 * ~Bernoulli(hit_rate); total hits over n PA is Binomial).
 *
 * Numerical stability: PMF uses log-space (logChoose + log-power) and
 * exponentiates at the end. Safe for n up to ~1000.
 */

import { logChoose } from "../../../utils/stats";

/**
 * Probability mass: P(X = k) where X ~ Binomial(n, p).
 */
export function binomialPmf(n: number, p: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  const logProb =
    logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logProb);
}

/**
 * Cumulative: P(X ≤ k).
 */
export function binomialCdf(n: number, p: number, k: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += binomialPmf(n, p, i);
  return Math.min(1, sum);
}

/**
 * Right-tail probability: P(X ≥ threshold).
 *
 * This is the main public API for the prop pipeline. For an "over 1.5"
 * line, callers pass `threshold = Math.floor(line) + 1 = 2`.
 *
 * For integer thresholds outside [0, n], returns clamped 0 or 1.
 */
export function binomialProbabilityOver(
  n: number,
  p: number,
  threshold: number
): number {
  if (threshold <= 0) return 1;
  if (threshold > n) return 0;
  return 1 - binomialCdf(n, p, threshold - 1);
}

/**
 * Mean E[X] = n × p.
 */
export function binomialMean(n: number, p: number): number {
  return n * p;
}

/**
 * Variance Var(X) = n × p × (1 − p).
 */
export function binomialVariance(n: number, p: number): number {
  return n * p * (1 - p);
}
