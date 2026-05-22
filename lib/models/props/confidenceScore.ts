/**
 * 6-factor weighted confidence score → 0-100 scale → 1-5 stars.
 *
 * Stars are stored on prop_predictions for internal filtering but
 * intentionally NOT rendered on the customer-facing card (per the locked
 * design decision — stars feel capper-coded). The numeric score is what
 * the UI uses for filter operators ("show me confidence > 70").
 *
 * The 6 factors:
 *   1. Reliability        (sample-size; Marcel denominator → [0,1])
 *   2. Calibration        (historical hit-rate-vs-confidence alignment)
 *   3. Lineup confirmed   (binary)
 *   4. Market liquidity   (multiple books quoting → higher confidence)
 *   5. Workload certainty (pitcher rest, injury status)
 *   6. Weather certainty  (forecast reliability; OpenWeather is good)
 *
 * Weights live in CONFIDENCE_WEIGHTS (constants.ts), enforced sum=100 at
 * module load.
 */

import { CONFIDENCE_WEIGHTS } from "../../config/constants";
import { clamp } from "../../utils/stats";

export type ConfidenceFactors = {
  /** Sample-size confidence in [0, 1]. Typically Marcel reliability. */
  reliability: number;
  /** Historical calibration in [0, 1]. Defaults to CALIBRATION_DEFAULT for new buckets. */
  calibration: number;
  /** Lineup is officially confirmed (vs projected). */
  lineupConfirmed: boolean;
  /** Sportsbook liquidity in [0, 1]. More books quoting → higher value. */
  marketLiquidity: number;
  /** Pitcher rest + injury health for pitcher props; for batters, opposing
   *  pitcher's workload. [0, 1]. */
  workloadCertainty: number;
  /** Forecast certainty for the game time. OpenWeather is typically ~0.9. */
  weatherCertainty: number;
};

export type ConfidenceResult = {
  score: number; // 0-100, rounded to 2 dp
  stars: number; // 1-5 (Math.ceil(score / 20))
};

/**
 * Compute the 6-factor confidence score.
 *
 * Lineup is boolean → 1.0 when confirmed, 0.6 when projected (we can still
 * make a prediction but with reduced confidence in the PA count).
 * All other factors are continuous in [0, 1].
 *
 * Inputs are clamped into [0, 1] defensively — a bug elsewhere shouldn't
 * crash the prediction pipeline.
 */
export function computeConfidence(
  factors: ConfidenceFactors
): ConfidenceResult {
  const w = CONFIDENCE_WEIGHTS;

  const lineupValue = factors.lineupConfirmed ? 1.0 : 0.6;
  const reliability = clamp(factors.reliability, 0, 1);
  const calibration = clamp(factors.calibration, 0, 1);
  const marketLiquidity = clamp(factors.marketLiquidity, 0, 1);
  const workload = clamp(factors.workloadCertainty, 0, 1);
  const weather = clamp(factors.weatherCertainty, 0, 1);

  const score =
    w.reliability * reliability +
    w.calibration * calibration +
    w.lineup * lineupValue +
    w.market_liquidity * marketLiquidity +
    w.workload * workload +
    w.weather * weather;

  // Score is in [0, 100] since weights sum to 100 and inputs are [0, 1].
  // Stars: 1-5 via Math.ceil(score / 20) with floor at 1.
  const stars = Math.max(1, Math.min(5, Math.ceil(score / 20)));

  return { score: +score.toFixed(2), stars };
}
