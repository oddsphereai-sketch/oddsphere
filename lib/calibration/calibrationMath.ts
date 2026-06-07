/**
 * Phase 7A Stage 1 — pure calibration math.
 *
 * All functions are pure: no DB, no I/O, no randomness. They take an
 * array of (probability, won) pairs and return numbers / structured
 * bins. The operator script in scripts/operator/calibration-report.ts
 * is the only consumer in Stage 1; later stages will reuse these
 * functions for shadow proposals and (eventually) guarded auto-apply.
 *
 * What "calibration" means here:
 *   • Probability is the model's estimate that the PICKED side wins.
 *   • Outcome (won) is whether the picked side actually won (binary).
 *   • A well-calibrated model: of the picks marked 60%, ~60% actually win.
 *   • Brier, log-loss, ECE, reliability bins each describe a different
 *     facet of miscalibration. ECE on its own can hide bin-level damage;
 *     Brier on its own ignores binning. Stage 1 reports them together
 *     so the operator can see the picture, not just one number.
 *
 * Conventions:
 *   • Empty samples → metrics return null (not 0, not NaN).
 *   • Bins are always returned at the requested count (default 10) even
 *     when empty, so charts can render contiguous x-axes.
 *   • Log-loss clamps probability to (eps, 1-eps) for numerical safety.
 */

export type CalibrationSample = {
  /** Model probability of the picked side winning. In (0, 1) — closed-open. */
  probability: number;
  /** Did the picked side win? */
  won: boolean;
};

export type ReliabilityBin = {
  bin_index: number;
  /** Inclusive lower bound. */
  bin_low: number;
  /**
   * Exclusive upper bound, except the last bin which is inclusive at 1.0
   * (probability = 1.0 lands in the last bin, not bin K+1).
   */
  bin_high: number;
  count: number;
  /** null when count = 0. */
  mean_predicted: number | null;
  /** null when count = 0. */
  observed_freq: number | null;
  /** |mean_predicted - observed_freq|. null when count = 0. */
  abs_gap: number | null;
};

export type CalibrationMetrics = {
  n: number;
  /** Brier score: mean((p - y)^2). Lower is better. 0 = perfect, 0.25 ≈ coin flip. */
  brier: number | null;
  /** Log loss: -mean(y log(p) + (1-y) log(1-p)). Lower is better. */
  log_loss: number | null;
  /**
   * Expected Calibration Error — weighted mean of per-bin |mean_pred - observed|.
   * 0 = perfectly calibrated within the binning. Insensitive to bin choice
   * for samples larger than ~10 × binCount.
   */
  ece: number | null;
  mean_predicted: number | null;
  observed_freq: number | null;
  /** Always returned at the requested length (default 10) for chart continuity. */
  bins: ReliabilityBin[];
};

export const DEFAULT_RELIABILITY_BINS = 10;
const LOG_EPS = 1e-9;

export function computeBrier(samples: ReadonlyArray<CalibrationSample>): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    const o = s.won ? 1 : 0;
    const diff = s.probability - o;
    sum += diff * diff;
  }
  return sum / samples.length;
}

export function computeLogLoss(samples: ReadonlyArray<CalibrationSample>): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    const o = s.won ? 1 : 0;
    const p = Math.min(Math.max(s.probability, LOG_EPS), 1 - LOG_EPS);
    sum += -(o * Math.log(p) + (1 - o) * Math.log(1 - p));
  }
  return sum / samples.length;
}

export function computeReliabilityBins(
  samples: ReadonlyArray<CalibrationSample>,
  binCount: number = DEFAULT_RELIABILITY_BINS,
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  const sums: Array<{ p: number; o: number }> = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({
      bin_index: i,
      bin_low: i / binCount,
      bin_high: (i + 1) / binCount,
      count: 0,
      mean_predicted: null,
      observed_freq: null,
      abs_gap: null,
    });
    sums.push({ p: 0, o: 0 });
  }
  for (const s of samples) {
    let idx = Math.floor(s.probability * binCount);
    if (idx >= binCount) idx = binCount - 1; // p = 1.0 lands in the last bin
    if (idx < 0) idx = 0;
    const b = bins[idx];
    b.count++;
    sums[idx].p += s.probability;
    sums[idx].o += s.won ? 1 : 0;
  }
  for (let i = 0; i < binCount; i++) {
    const b = bins[i];
    if (b.count > 0) {
      b.mean_predicted = sums[i].p / b.count;
      b.observed_freq = sums[i].o / b.count;
      b.abs_gap = Math.abs(b.mean_predicted - b.observed_freq);
    }
  }
  return bins;
}

export function computeECE(bins: ReadonlyArray<ReliabilityBin>): number | null {
  let totalN = 0;
  for (const b of bins) totalN += b.count;
  if (totalN === 0) return null;
  let ece = 0;
  for (const b of bins) {
    if (b.count === 0 || b.abs_gap === null) continue;
    ece += (b.count / totalN) * b.abs_gap;
  }
  return ece;
}

export function computeCalibrationMetrics(
  samples: ReadonlyArray<CalibrationSample>,
  binCount: number = DEFAULT_RELIABILITY_BINS,
): CalibrationMetrics {
  const bins = computeReliabilityBins(samples, binCount);
  const n = samples.length;
  let meanPredicted: number | null = null;
  let observedFreq: number | null = null;
  if (n > 0) {
    let pSum = 0;
    let oSum = 0;
    for (const s of samples) {
      pSum += s.probability;
      oSum += s.won ? 1 : 0;
    }
    meanPredicted = pSum / n;
    observedFreq = oSum / n;
  }
  return {
    n,
    brier: computeBrier(samples),
    log_loss: computeLogLoss(samples),
    ece: computeECE(bins),
    mean_predicted: meanPredicted,
    observed_freq: observedFreq,
    bins,
  };
}
