/**
 * Tuning constants for marketVerdictDerivation. Test values for V1;
 * Daniel will revisit after a real-slate review.
 *
 * Separated from the derivation function so adjustments are one-file.
 */

export const MARKET_VERDICT_THRESHOLDS = {
  /** Min confidence for best_angle when grade=best_signal (no sharp need). */
  BEST_ANGLE_CONFIDENCE_BEST_SIGNAL: 0.62,
  /** Min confidence for best_angle when grade=sharp_confirmed AND no push-against. */
  BEST_ANGLE_CONFIDENCE_SHARP_CONFIRMED: 0.58,
  /** Min confidence for lean when sharps actively support the pick. */
  LEAN_CONFIDENCE_FLOOR_WITH_SHARP_SUPPORT: 0.58,
  /** Min confidence for lean (no sharp signal needed). */
  LEAN_CONFIDENCE_FLOOR: 0.55,
  /** Min confidence for watchlist. */
  WATCHLIST_CONFIDENCE_FLOOR: 0.52,
} as const;
