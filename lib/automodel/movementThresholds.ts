/**
 * Phase 4A — pure thresholds + helpers for movement detection.
 *
 * Defaults match Phase 4 planning §4.2. Re-tuning happens here; the
 * stale-detection helper consumes via the shared `MOVEMENT_THRESHOLDS`
 * object (overridable per-call for tests).
 *
 * V1 policy (planning §4.3): record deltas for audit, do NOT trigger
 * early reruns. T-60 always reruns eligible games. These thresholds
 * answer "did this move materially?" — never "should we rerun now?"
 *
 * Pure module. No imports from lib/db, lib/services, providers, or any
 * env-reading code.
 */

/**
 * Default movement thresholds. Tuned per planning §4.2.
 *
 *   • TOTAL_RUNS         0.5 — half-run swing flips most O/U math
 *   • ML_FAIR_PROB_PCT   5.0 — 5pp Pinnacle fair-prob move (≈ +50 cents)
 *   • ML_EV_PCT          1.0 — EV crosses zero by 1% OR magnitude swings 1%
 *   • PUBLIC_BETTING_PCT 10.0 — 10pp public ticket %
 *   • PUBLIC_MONEY_PCT   10.0 — 10pp public money %
 */
export const MOVEMENT_THRESHOLDS = {
  TOTAL_RUNS: 0.5,
  ML_FAIR_PROB_PCT: 5.0,
  ML_EV_PCT: 1.0,
  PUBLIC_BETTING_PCT: 10.0,
  PUBLIC_MONEY_PCT: 10.0,
} as const;

/**
 * Loose threshold record — same KEYS as MOVEMENT_THRESHOLDS but with
 * `number` values (not narrow literals). Used as the helper parameter
 * type so callers (and tests) can override individual thresholds without
 * the `as const` literal type narrowing rejecting their numbers.
 */
export type MovementThresholdConfig = {
  [K in keyof typeof MOVEMENT_THRESHOLDS]: number;
};

/**
 * Was a numeric move significant per threshold?
 *
 * Both values must be non-null AND finite for the test to apply.
 * Anything else → false. "Treat unknown as not significant" avoids
 * false-positive stale flags driven by missing/null inputs (e.g.
 * Pinnacle line absent from the morning snapshot).
 *
 * Symmetric: `|after - before| >= threshold`. Threshold is inclusive
 * on the boundary (a move of exactly the threshold counts as
 * significant).
 */
export function isSignificantMove(
  before: number | null | undefined,
  after: number | null | undefined,
  threshold: number
): boolean {
  if (before === null || before === undefined) return false;
  if (after === null || after === undefined) return false;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
  return Math.abs(after - before) >= threshold;
}

/**
 * Did EV flip MEANINGFULLY?
 *
 * Two cases:
 *   1. The sign changed (the EV crossed zero — i.e. the "+EV side" of
 *      this market flipped). Sign change is significant on its own,
 *      regardless of magnitude.
 *   2. The magnitude moved by >= magnitudeThreshold (large swing
 *      without crossing zero).
 *
 * Both null/undefined inputs → false (consistent with isSignificantMove).
 * Zero → zero (no change) → false.
 *
 * Math.sign(0) === 0 — so a transition from 0 → +1 IS a sign change
 * per JS semantics, which matches the intent ("EV emerged"). A
 * transition from +0.1 → -0.1 with magnitudeThreshold=1.0 is
 * significant because the sign flipped (the +EV side switched), even
 * though the magnitude move is only 0.2.
 */
export function didEvFlipMeaningfully(
  before: number | null | undefined,
  after: number | null | undefined,
  magnitudeThreshold: number
): boolean {
  if (before === null || before === undefined) return false;
  if (after === null || after === undefined) return false;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
  if (before === 0 && after === 0) return false;
  const signChanged = Math.sign(before) !== Math.sign(after);
  if (signChanged) return true;
  return Math.abs(after - before) >= magnitudeThreshold;
}

/**
 * Compute a delta (after - before) that's safe to display.
 *
 * Returns null when either side is null/undefined or non-finite —
 * consistent with isSignificantMove's "unknown = no signal" semantics.
 * Used to populate MovementDeltas where every field is `number | null`.
 */
export function safeDelta(
  before: number | null | undefined,
  after: number | null | undefined
): number | null {
  if (before === null || before === undefined) return null;
  if (after === null || after === undefined) return null;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return after - before;
}
