import type { Sport } from "./Sport";
import type {
  PredictionType,
  TimeWindow,
  TrackingMarket,
} from "./Tracking";

/**
 * Mirrors the `calibration_buckets` table.
 *
 * Powers the "When we say 60% confidence, we hit X% of the time" credibility
 * display on the Tracking page. Recomputed weekly. UI only shows buckets where
 * `is_displayable` is true (typically requires ≥30 predictions in bucket).
 */
export type CalibrationBucket = {
  id: number;
  sport: Sport;
  prediction_type: PredictionType;
  market: TrackingMarket | null;
  // Bucket definition
  confidence_bucket_lower: number; // e.g., 55.0
  confidence_bucket_upper: number; // e.g., 60.0
  confidence_bucket_label: string; // '55-60%'
  // Calibration data
  predictions_in_bucket: number; // sample size
  actual_hit_rate: number | null; // what % actually hit
  expected_hit_rate: number | null; // bucket midpoint
  calibration_delta: number | null; // actual − expected (positive = overperforming)
  // Display gating
  is_displayable: boolean;
  min_sample_size: number; // default 30
  computed_at: string;
  time_window: TimeWindow | null;
};
