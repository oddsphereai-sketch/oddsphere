/**
 * Member-facing recommendation confidence for flipped picks (2026-06-22).
 *
 * When a pick is flipped (ML inversion / totals mean-side), the flipped side's
 * RAW model probability is < 0.5 (we are deliberately taking the side the base
 * model rated lower). Showing that sub-50 number as a recommendation confidence
 * reads as broken. Members must instead see a conservative, calibrated
 * recommendation confidence above 50 — the model's own conviction MAGNITUDE,
 * floored to a sensible recommendation minimum and capped conservatively. The
 * raw opposite-side probability is preserved in snapshot audit only.
 *
 * Calibration sanity: totals flips win ~54.6% (≈ floor 55); ML flips win ~70%
 * (capped at 60 — conservative). No flip/fade language ever reaches the UI.
 */

export const FLIP_CONFIDENCE_FLOOR = 55;
export const FLIP_CONFIDENCE_CAP = 60;

function round1(n: number): number { return Math.round(n * 10) / 10; }

/**
 * Conservative member-facing confidence for a flipped recommendation.
 * Input is the model's conviction magnitude on its ORIGINAL pick (0-100, always
 * > 50 since it was the model's argmax). Output is clamped to [55, 60].
 */
export function flipRecommendationConfidence(originalConviction: number | null): number {
  const base =
    originalConviction !== null && Number.isFinite(originalConviction)
      ? originalConviction
      : FLIP_CONFIDENCE_FLOOR;
  return round1(Math.min(FLIP_CONFIDENCE_CAP, Math.max(FLIP_CONFIDENCE_FLOOR, base)));
}
