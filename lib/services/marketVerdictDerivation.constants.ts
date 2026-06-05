/**
 * Tuning constants for marketVerdictDerivation. Test values for V1;
 * Daniel will revisit after a real-slate review.
 *
 * Separated from the derivation function so adjustments are one-file.
 *
 * R-16I Phase 1 (2026-06-04) — LEAN_CONFIDENCE_FLOOR raised 0.55 → 0.58.
 * The 0.55 floor was producing too many "shaky" Leans — picks where
 * confidence cleared the bar but supporting context was thin. 0.58
 * brings the no-sharp floor up to match the with-sharp-support floor;
 * the floor is no longer a discount for having no sharp signal. Lean
 * now means: "model is at least 8pp above no-read AND either has sharp
 * support OR doesn't need it" rather than "model cleared 55%."
 *
 * Per-market downgrades from the reviewer (sharp_conflict, public_smoke,
 * fragility flags) live in marketVerdictDerivation.ts itself — see the
 * Reviewer authority section in that file.
 */

export const MARKET_VERDICT_THRESHOLDS = {
  /** Min confidence for best_angle when grade=best_signal (no sharp need). */
  BEST_ANGLE_CONFIDENCE_BEST_SIGNAL: 0.62,
  /** Min confidence for best_angle when grade=sharp_confirmed AND no push-against. */
  BEST_ANGLE_CONFIDENCE_SHARP_CONFIRMED: 0.58,
  /** Min confidence for lean when sharps actively support the pick. */
  LEAN_CONFIDENCE_FLOOR_WITH_SHARP_SUPPORT: 0.58,
  /** Min confidence for lean (no sharp signal needed). R-16I: 0.55 → 0.58. */
  LEAN_CONFIDENCE_FLOOR: 0.58,
  /** Min confidence for watchlist. */
  WATCHLIST_CONFIDENCE_FLOOR: 0.52,
} as const;
