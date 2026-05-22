/**
 * Negative Binomial distribution — overdispersed count data.
 *
 * Used for props where the variance exceeds the mean (overdispersion):
 *   • batter_total_bases  — HR=4 outliers inflate variance
 *   • pitcher_hits_allowed — clustered hits inflate variance
 *
 * Parameterization: by mean (μ) and variance (σ²) with σ² > μ.
 *   r = μ² / (σ² − μ)        (size / dispersion parameter)
 *   p = μ / σ²                (success probability)
 *
 * Sanity:
 *   • mean = r(1 − p) / p
 *   • variance = r(1 − p) / p²
 *
 * Special case: if σ² ≤ μ, the data is NOT overdispersed and Poisson
 * applies. The functions below throw if asked to construct an NB with
 * non-overdispersed inputs — this is a programming error, not a recoverable
 * runtime condition.
 *
 * Numerical stability: PMF uses log-space via logGamma. Safe for k up to
 * any practical prop range.
 */

import { logGamma, logFactorial } from "../../../utils/stats";

function paramsFromMeanVar(mean: number, variance: number): { r: number; p: number } {
  if (mean <= 0) {
    throw new Error(`Negative binomial: mean must be > 0, got ${mean}`);
  }
  if (variance <= mean) {
    throw new Error(
      `Negative binomial requires variance > mean (overdispersion). ` +
        `Got mean=${mean}, variance=${variance}. ` +
        `For variance ≤ mean, use Poisson instead.`
    );
  }
  const r = (mean * mean) / (variance - mean);
  const p = mean / variance;
  return { r, p };
}

/**
 * Probability mass: P(X = k) where X ~ NB(r, p).
 *
 * PMF: Γ(k+r) / (k! × Γ(r)) × p^r × (1−p)^k
 */
export function negativeBinomialPmf(
  mean: number,
  variance: number,
  k: number
): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  const { r, p } = paramsFromMeanVar(mean, variance);
  const logProb =
    logGamma(k + r) - logFactorial(k) - logGamma(r) +
    r * Math.log(p) +
    k * Math.log(1 - p);
  return Math.exp(logProb);
}

/**
 * Cumulative: P(X ≤ k).
 */
export function negativeBinomialCdf(
  mean: number,
  variance: number,
  k: number
): number {
  if (k < 0) return 0;
  // NB tails are heavier than Poisson; cap higher.
  const std = Math.sqrt(variance);
  const cap = Math.min(k, Math.ceil(mean + 6 * std + 20));
  let sum = 0;
  for (let i = 0; i <= cap && i <= k; i++) {
    sum += negativeBinomialPmf(mean, variance, i);
  }
  return Math.min(1, sum);
}

/**
 * Right-tail probability: P(X ≥ threshold).
 *
 * Main public API for the prop pipeline.
 */
export function negativeBinomialProbabilityOver(
  mean: number,
  variance: number,
  threshold: number
): number {
  if (threshold <= 0) return 1;
  return 1 - negativeBinomialCdf(mean, variance, threshold - 1);
}

/**
 * Verify mean/variance relationships hold for a given parameterization.
 * Returns the recovered theoretical mean and variance from r and p, which
 * should match the inputs up to floating-point precision.
 */
export function negativeBinomialMeanVar(
  mean: number,
  variance: number
): { mean: number; variance: number } {
  const { r, p } = paramsFromMeanVar(mean, variance);
  return {
    mean: (r * (1 - p)) / p,
    variance: (r * (1 - p)) / (p * p),
  };
}
