/**
 * GET /api/lab/calibration
 *
 * Powers the CalibrationDisplay section on the Tracking page — the "we admit
 * our biases" feature. Reads calibration_buckets directly with two filters:
 *
 *   • is_displayable=true   (sample size >= min_sample_size; default 30)
 *   • prediction_type IN ('game_ml','game_total','game_nrfi')
 *
 * Per the V1 launch decision locked after 5C: prop calibration is excluded
 * from V1 tracking because the prop model is unproven and raw W-L on binary
 * props at low baselines looks bad even when edge is good. Phase 9+ revisits
 * with ROI/CLV-based tracking. The filter lives in code (not just a SQL
 * predicate) so the carve-out is documented + testable.
 *
 * Returns lifetime buckets (`time_window='all_time'`) plus an auto-selected
 * headline finding for the hero callout — the displayable bucket with the
 * largest absolute calibration delta wins (newsworthy admission first).
 *
 * Auth: public read. Calibration buckets carry no member-identifying data.
 */

import { supabase } from "@/lib/db/supabase";
import type { Sport } from "@/lib/types/domain/Sport";
import type {
  CalibrationBucket,
  CalibrationHeadline,
  CalibrationPredictionType,
  CalibrationResponse,
} from "@/app/lab/lib/labTypes";

const GAME_LEVEL_TYPES: CalibrationPredictionType[] = [
  "game_ml",
  "game_total",
  "game_nrfi",
];

type Row = {
  sport: string;
  prediction_type: string;
  market: string | null;
  confidence_bucket_lower: number;
  confidence_bucket_upper: number;
  confidence_bucket_label: string | null;
  predictions_in_bucket: number;
  actual_hit_rate: number | null;
  expected_hit_rate: number | null;
  calibration_delta: number | null;
  time_window: string;
};

function predictionLabel(t: CalibrationPredictionType): string {
  if (t === "game_ml") return "game moneylines";
  if (t === "game_total") return "game totals";
  return "first-inning runs";
}

function composeHeadlineText(b: CalibrationBucket): string {
  const expectedPct = Math.round(b.expectedHitRate * 100);
  const actualPct = Math.round(b.actualHitRate * 100);
  // The bucket's MID-point is the "we said" number; show as the lower bound
  // since that's what the label reads ("60-70% → 60%").
  const lower = Math.round(b.bucketLower);
  if (b.calibrationDelta < 0) {
    return `When we say ${lower}%+ confidence on ${predictionLabel(b.predictionType)}, we hit ${actualPct}% of the time. Expected ${expectedPct}%.`;
  }
  return `Our ${lower}%+ confidence picks on ${predictionLabel(b.predictionType)} hit ${actualPct}% — beating the ${expectedPct}% we predicted.`;
}

function selectHeadline(buckets: CalibrationBucket[]): CalibrationHeadline | null {
  if (buckets.length === 0) return null;
  // Largest absolute delta wins. Tie-break by sample size (more samples = more
  // confident in the miss). Tie-break again by lower-bucket-first.
  const ranked = [...buckets].sort((a, b) => {
    const dA = Math.abs(a.calibrationDelta);
    const dB = Math.abs(b.calibrationDelta);
    if (dB !== dA) return dB - dA;
    if (b.sampleSize !== a.sampleSize) return b.sampleSize - a.sampleSize;
    return a.bucketLower - b.bucketLower;
  });
  const top = ranked[0]!;
  return { bucket: top, summary: composeHeadlineText(top) };
}

export async function GET(_request: Request) {
  // Filter at the DB level for the carve-out, but the response shape still
  // reflects the intent (only game-level types come back).
  const { data, error } = await supabase
    .from("calibration_buckets")
    .select(
      "sport, prediction_type, market, confidence_bucket_lower, confidence_bucket_upper, confidence_bucket_label, predictions_in_bucket, actual_hit_rate, expected_hit_rate, calibration_delta, time_window"
    )
    .eq("is_displayable", true)
    .in("prediction_type", GAME_LEVEL_TYPES as string[])
    .eq("time_window", "all_time")
    .order("prediction_type", { ascending: true })
    .order("confidence_bucket_lower", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const buckets: CalibrationBucket[] = ((data ?? []) as Row[]).flatMap((r) => {
    // Defense-in-depth: skip nulls in critical numeric columns even though
    // is_displayable=true should imply they're populated.
    if (r.actual_hit_rate === null || r.expected_hit_rate === null || r.calibration_delta === null) {
      return [];
    }
    return [{
      sport: r.sport as Sport,
      predictionType: r.prediction_type as CalibrationPredictionType,
      market: r.market,
      label: r.confidence_bucket_label ?? `${r.confidence_bucket_lower}-${r.confidence_bucket_upper}%`,
      bucketLower: r.confidence_bucket_lower,
      bucketUpper: r.confidence_bucket_upper,
      sampleSize: r.predictions_in_bucket,
      // DB stores 0-100; UI consumes 0-1.
      expectedHitRate: r.expected_hit_rate / 100,
      actualHitRate: r.actual_hit_rate / 100,
      calibrationDelta: r.calibration_delta,
      timeWindow: "all_time",
    }];
  });

  const body: CalibrationResponse = {
    as_of: new Date().toISOString(),
    buckets,
    headline: selectHeadline(buckets),
  };

  return Response.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
