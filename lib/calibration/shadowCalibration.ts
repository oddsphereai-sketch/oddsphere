/**
 * Phase 7A Stage 2 — Shadow calibration proposals (no writes).
 *
 * "Shadow" means we compute what the calibrated probability WOULD have
 * been if we re-mapped each bucket to its observed frequency, then compare
 * Brier / log-loss / ECE for the live mapping vs. the shadow mapping on
 * the SAME historical settled rows.
 *
 * Recommendation policy:
 *   • Only buckets whose sample is "confident" produce a shadow mapping.
 *     Insufficient or exploratory buckets keep the LIVE probability — no
 *     proposal at all for those buckets.
 *   • A proposal at the MARKET level is only meaningful when at least one
 *     bucket is confident AND the overall Brier delta exceeds a small
 *     threshold (default 0.001). Otherwise: monitor-only.
 *
 * Pure module. No DB. No I/O.
 *
 * Stage 2 emits proposals; it never applies them. Stage 3 will add
 * operator-triggered writes. Stage 4 will add guarded auto-apply.
 */

import {
  type CalibrationSample,
  type ReliabilityBin,
  computeReliabilityBins,
  computeBrier,
  computeLogLoss,
  computeECE,
  DEFAULT_RELIABILITY_BINS,
} from "./calibrationMath";
import { classifySampleSize, type SampleSizeClass } from "./sampleSize";

/** Minimum Brier improvement (live - shadow) before we call a proposal "material". */
export const MATERIAL_BRIER_DELTA = 0.001;

/** Minimum |mean_predicted - observed| in a bucket to bother proposing a remap. */
export const MATERIAL_GAP = 0.02;

export type ShadowBucketProposal = {
  bin_index: number;
  bin_low: number;
  bin_high: number;
  n: number;
  mean_predicted: number | null;
  observed_freq: number | null;
  abs_gap: number | null;
  sample_class: SampleSizeClass;
  /** null when sample_class !== "confident" — no proposal for that bucket. */
  proposed_probability: number | null;
  /** Short human-readable recommendation per bucket. */
  recommendation: string;
};

export type ShadowMarketReport = {
  market: string;
  n: number;
  /** Sample-size class for the WHOLE market sample (drives whether overall recommendation is monitor-only). */
  sample_class: SampleSizeClass;
  live_brier: number | null;
  shadow_brier: number | null;
  brier_delta: number | null; // positive = shadow improves
  live_log_loss: number | null;
  shadow_log_loss: number | null;
  log_loss_delta: number | null;
  live_ece: number | null;
  shadow_ece: number | null;
  ece_delta: number | null;
  buckets: ShadowBucketProposal[];
  /** True iff at least one bucket has a confident sample AND material gap. */
  has_material_proposal: boolean;
  /** Plain-English single-line recommendation for the market overall. */
  overall_recommendation: string;
};

/**
 * Map a sample's probability to a (shadow) calibrated probability:
 *   • Find its bin.
 *   • If that bin is "confident" AND has |gap| ≥ MATERIAL_GAP → use observed_freq.
 *   • Otherwise → leave the live probability unchanged.
 *
 * Returned helper closes over the per-bin proposals so it stays cheap when
 * computing shadow_brier across many samples.
 */
function makeShadowMapper(buckets: ShadowBucketProposal[], binCount: number) {
  const proposalByBin = new Map<number, number>();
  for (const b of buckets) {
    if (b.proposed_probability !== null) proposalByBin.set(b.bin_index, b.proposed_probability);
  }
  return function shadow(p: number): number {
    let idx = Math.floor(p * binCount);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    const remap = proposalByBin.get(idx);
    return remap === undefined ? p : remap;
  };
}

function bucketLabel(bin: ReliabilityBin): string {
  const lo = (bin.bin_low * 100).toFixed(0);
  const hi = (bin.bin_high * 100).toFixed(0);
  return `${lo}-${hi}%`;
}

function buildBucketProposal(
  bin: ReliabilityBin,
  market: string,
): ShadowBucketProposal {
  const sampleClass = classifySampleSize(bin.count, market);
  let proposed: number | null = null;
  let recommendation: string;

  if (bin.count === 0) {
    recommendation = "no samples in this bucket";
  } else if (sampleClass === "insufficient") {
    recommendation = `insufficient sample (n=${bin.count}); monitor only, no remap proposed`;
  } else if (sampleClass === "exploratory") {
    recommendation = `exploratory sample (n=${bin.count}); monitor only, no remap proposed`;
  } else {
    // Confident sample. Only propose when the gap is material.
    const gap = bin.abs_gap ?? 0;
    if (gap < MATERIAL_GAP) {
      recommendation = `confident sample (n=${bin.count}); gap ${(gap * 100).toFixed(1)}pp below material threshold ${(MATERIAL_GAP * 100).toFixed(0)}pp — no remap proposed`;
    } else {
      proposed = bin.observed_freq;
      const predPct = ((bin.mean_predicted ?? 0) * 100).toFixed(1);
      const obsPct = ((bin.observed_freq ?? 0) * 100).toFixed(1);
      recommendation = `confident sample (n=${bin.count}); proposed remap ${predPct}% → ${obsPct}% (gap ${(gap * 100).toFixed(1)}pp)`;
    }
  }

  return {
    bin_index: bin.bin_index,
    bin_low: bin.bin_low,
    bin_high: bin.bin_high,
    n: bin.count,
    mean_predicted: bin.mean_predicted,
    observed_freq: bin.observed_freq,
    abs_gap: bin.abs_gap,
    sample_class: sampleClass,
    proposed_probability: proposed,
    recommendation,
  };
}

/**
 * Build the shadow report for a single market (or "default" for cross-cuts).
 *
 * Inputs:
 *   • samples — (probability, won) pairs for SETTLED ACTIONABLE picks only.
 *   • market — name used to look up sample-size thresholds.
 *   • binCount — defaults to 10 deciles, same as the Stage 1 report.
 *
 * Always returns a ShadowMarketReport. When the sample is too small to
 * support any proposal, has_material_proposal === false and
 * overall_recommendation explains why.
 */
export function buildShadowMarketReport(
  samples: ReadonlyArray<CalibrationSample>,
  market: string,
  binCount: number = DEFAULT_RELIABILITY_BINS,
): ShadowMarketReport {
  const n = samples.length;
  const sampleClass = classifySampleSize(n, market);
  const bins = computeReliabilityBins(samples, binCount);
  const buckets = bins.map((b) => buildBucketProposal(b, market));
  const hasMaterial = buckets.some((b) => b.proposed_probability !== null);

  // Live metrics on the actual samples.
  const liveBrier = computeBrier(samples);
  const liveLogLoss = computeLogLoss(samples);
  const liveEce = computeECE(bins);

  // Shadow metrics: remap each sample's probability via the bucket-level
  // proposal (or leave unchanged when no proposal). Recompute Brier / log
  // loss / ECE on the remapped probabilities. ECE uses the SAME bin index
  // (probability bucket the sample originally landed in) so we measure
  // calibration error of the proposed mapping against the same partition.
  const shadow = makeShadowMapper(buckets, binCount);
  let shadowBrier: number | null = null;
  let shadowLogLoss: number | null = null;
  let shadowEce: number | null = null;
  if (n > 0) {
    let brierSum = 0;
    let llSum = 0;
    const LOG_EPS = 1e-9;
    // Per-bin observed vs proposed accumulator for ECE on shadow.
    const binProposedSum: number[] = new Array(binCount).fill(0);
    const binObservedSum: number[] = new Array(binCount).fill(0);
    const binCounts: number[] = new Array(binCount).fill(0);
    for (const s of samples) {
      let idx = Math.floor(s.probability * binCount);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      const sp = shadow(s.probability);
      const o = s.won ? 1 : 0;
      brierSum += (sp - o) * (sp - o);
      const p = Math.min(Math.max(sp, LOG_EPS), 1 - LOG_EPS);
      llSum += -(o * Math.log(p) + (1 - o) * Math.log(1 - p));
      binProposedSum[idx] += sp;
      binObservedSum[idx] += o;
      binCounts[idx]++;
    }
    shadowBrier = brierSum / n;
    shadowLogLoss = llSum / n;
    let eceSum = 0;
    for (let i = 0; i < binCount; i++) {
      if (binCounts[i] === 0) continue;
      const meanProposed = binProposedSum[i] / binCounts[i];
      const observed = binObservedSum[i] / binCounts[i];
      eceSum += (binCounts[i] / n) * Math.abs(meanProposed - observed);
    }
    shadowEce = eceSum;
  }

  const brierDelta = liveBrier !== null && shadowBrier !== null ? liveBrier - shadowBrier : null;
  const llDelta = liveLogLoss !== null && shadowLogLoss !== null ? liveLogLoss - shadowLogLoss : null;
  const eceDelta = liveEce !== null && shadowEce !== null ? liveEce - shadowEce : null;

  // Overall recommendation
  let overallRecommendation: string;
  if (n === 0) {
    overallRecommendation = "no samples — nothing to evaluate";
  } else if (!hasMaterial) {
    if (sampleClass === "insufficient") {
      overallRecommendation = `Insufficient market-level sample (n=${n}); monitor only.`;
    } else if (sampleClass === "exploratory") {
      overallRecommendation = `Exploratory market-level sample (n=${n}); no confident bucket has a material gap yet. Monitor only.`;
    } else {
      overallRecommendation = `Confident market-level sample (n=${n}); no bucket shows a material gap. No calibration change recommended.`;
    }
  } else if (brierDelta !== null && brierDelta >= MATERIAL_BRIER_DELTA) {
    overallRecommendation = `Shadow remap would improve Brier by ${brierDelta.toFixed(4)} on the historical sample (≥ ${MATERIAL_BRIER_DELTA} material threshold). Eligible for Stage 3 manual proposal.`;
  } else if (brierDelta !== null && brierDelta > 0) {
    overallRecommendation = `Shadow remap would improve Brier by ${brierDelta.toFixed(4)} — below material threshold (${MATERIAL_BRIER_DELTA}). Track but do not act yet.`;
  } else if (brierDelta !== null && brierDelta < 0) {
    overallRecommendation = `Shadow remap WORSENS Brier by ${(-brierDelta).toFixed(4)}. Live mapping is better on this sample — keep current calibration.`;
  } else {
    overallRecommendation = `Confident bucket-level remap available; insufficient overall-level data to compare. Monitor only.`;
  }

  return {
    market,
    n,
    sample_class: sampleClass,
    live_brier: liveBrier,
    shadow_brier: shadowBrier,
    brier_delta: brierDelta,
    live_log_loss: liveLogLoss,
    shadow_log_loss: shadowLogLoss,
    log_loss_delta: llDelta,
    live_ece: liveEce,
    shadow_ece: shadowEce,
    ece_delta: eceDelta,
    buckets,
    has_material_proposal: hasMaterial,
    overall_recommendation: overallRecommendation,
  };
}

/* Re-export bucketLabel for the operator's pretty printer. */
export { bucketLabel };
