/**
 * Calibration Computer — bucket predictions by confidence score and compute
 * realized hit rate per bucket. Pure function.
 *
 * The question this answers: "do confidence scores correlate with actual
 * hit rates?" A well-calibrated 70%-confidence prediction should win ~70%
 * of the time.
 *
 * Buckets are 10-point increments [50, 60), [60, 70), [70, 80), [80, 90),
 * [90, 100]. Predictions with confidence < 50 are excluded — these are
 * "skip"-tier model outputs that we wouldn't surface as picks. They DO
 * appear in prop_predictions per the 3C methodology decision but don't
 * contribute to calibration signal until we have evidence the model thinks
 * a non-pick is actually a pick.
 *
 * `hit_rate` is null when sample_count < minSamples (default 30 per locked
 * Foundation policy — small samples are noisy).
 */

import { CALIBRATION_MIN_SAMPLES } from "../../config/constants";
import type { TimeWindowName } from "./aggregator";

export type PredictionForCalibration = {
  prediction_type: "game_ml" | "game_total" | "game_nrfi" | "prop";
  sport: string;
  market: string;
  confidence: number;
  outcome: "win" | "loss" | "push" | "void";
  game_date: string;
};

export type CalibrationBucketRow = {
  sport: string;
  prediction_type: string;
  market: string;
  confidence_bucket_lower: number;
  confidence_bucket_upper: number;
  confidence_bucket_label: string;
  time_window: TimeWindowName;
  sample_count: number;
  hit_rate: number | null;
  /** Bucket midpoint — what we'd EXPECT the hit rate to be if calibrated. */
  expected_hit_rate: number;
  /** actual − expected. Positive = overperforming the bucket. */
  calibration_delta: number | null;
  /** True iff sample_count >= minSamples (also gates DB display). */
  is_displayable: boolean;
};

export type CalibrationOptions = {
  today: string;
  seasonStart: string;
  /** Minimum samples per bucket before hit_rate is published (else null). */
  minSamples?: number;
};

const BUCKETS: Array<[number, number]> = [
  [50, 60],
  [60, 70],
  [70, 80],
  [80, 90],
  [90, 100.01], // closed at 100; +0.01 keeps a 100.0 score in this bucket
];

function findBucket(confidence: number): [number, number] | null {
  if (confidence < 50) return null;
  for (const [lo, hi] of BUCKETS) {
    if (confidence >= lo && confidence < hi) return [lo, Math.floor(hi)];
  }
  return null;
}

function daysBetweenISO(later: string, earlier: string): number {
  return (
    (new Date(later).getTime() - new Date(earlier).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

function windowMatches(
  windowName: TimeWindowName,
  gameDate: string,
  today: string,
  seasonStart: string
): boolean {
  switch (windowName) {
    case "yesterday":
      return daysBetweenISO(today, gameDate) === 1;
    case "this_week": {
      const d = daysBetweenISO(today, gameDate);
      return d >= 1 && d <= 7;
    }
    case "season":
      return gameDate >= seasonStart && gameDate <= today;
    case "all_time":
      return true;
  }
}

export function computeCalibration(
  predictions: PredictionForCalibration[],
  opts: CalibrationOptions
): CalibrationBucketRow[] {
  const minSamples = opts.minSamples ?? CALIBRATION_MIN_SAMPLES;
  const windows: TimeWindowName[] = ["yesterday", "this_week", "season", "all_time"];
  const rows: CalibrationBucketRow[] = [];

  // Distinct (sport, prediction_type, market) tuples
  const tuples = new Set<string>(
    predictions.map((p) => `${p.sport}::${p.prediction_type}::${p.market}`)
  );

  for (const w of windows) {
    for (const t of tuples) {
      const [sport, prediction_type, market] = t.split("::") as [
        string,
        string,
        string,
      ];
      for (const [lo, hi] of BUCKETS) {
        const matching = predictions.filter((p) => {
          if (p.sport !== sport) return false;
          if (p.prediction_type !== prediction_type) return false;
          if (p.market !== market) return false;
          const bucket = findBucket(p.confidence);
          if (!bucket || bucket[0] !== lo) return false;
          return windowMatches(w, p.game_date, opts.today, opts.seasonStart);
        });
        if (matching.length === 0) continue;
        const wins = matching.filter((m) => m.outcome === "win").length;
        const losses = matching.filter((m) => m.outcome === "loss").length;
        const denom = wins + losses;
        const sampleCount = matching.length;
        const hitRate =
          sampleCount >= minSamples && denom > 0
            ? +((wins / denom) * 100).toFixed(2)
            : null;
        const upper = Math.floor(hi);
        const expectedHitRate = (lo + upper) / 2;
        const delta =
          hitRate !== null ? +(hitRate - expectedHitRate).toFixed(2) : null;
        rows.push({
          sport,
          prediction_type,
          market,
          confidence_bucket_lower: lo,
          confidence_bucket_upper: upper,
          confidence_bucket_label: `${lo}-${upper}%`,
          time_window: w,
          sample_count: sampleCount,
          hit_rate: hitRate,
          expected_hit_rate: expectedHitRate,
          calibration_delta: delta,
          is_displayable: sampleCount >= minSamples,
        });
      }
    }
  }
  return rows;
}
