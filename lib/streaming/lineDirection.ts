/**
 * Shared, pure line-direction + implied-probability helpers for the streaming
 * layer (2026-06-16). Worker-safe: no React, no DB, no Next, no env.
 *
 * This is the canonical home for the "did the picked side's price move toward
 * or against us" logic. The member-facing UI helper
 * `app/lab/lib/lineMoveTone.ts` already implements the same rule and will be
 * pointed at this module in the line-tracker chunk so worker and UI can never
 * drift. Until then this module stands alone (identical thresholds).
 */

export type MoveDirection = "toward" | "against" | "flat";

/** Noise floor: moves smaller than this (in American cents) are "flat". */
export const MIN_MOVE_AMERICAN = 5;
/** Implied-prob delta (1pp) required to call a move toward/against. */
export const MIN_IMPLIED_DELTA = 0.01;

/**
 * American odds → implied probability (0..1) for a SINGLE price (with vig).
 * Returns null on invalid input so callers fall through to neutral.
 */
export function americanToImpliedProb(american: number | null | undefined): number | null {
  if (american === null || american === undefined || !Number.isFinite(american) || american === 0) {
    return null;
  }
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * Two-way no-vig probability for `sideAmerican` given BOTH sides' prices.
 * Removes the hold by normalizing the two implied probs to sum to 1.
 * Returns null when either price is missing/invalid (can't de-vig one-sided).
 */
export function noVigTwoWayProb(
  sideAmerican: number | null | undefined,
  otherAmerican: number | null | undefined,
): number | null {
  const a = americanToImpliedProb(sideAmerican);
  const b = americanToImpliedProb(otherAmerican);
  if (a === null || b === null) return null;
  const sum = a + b;
  if (sum <= 0) return null;
  return a / sum;
}

/**
 * Classify a line move from the PICKED side's perspective. Both inputs are the
 * picked-side American price. Mirrors `classifyPickRelativeLineMove` in
 * lineMoveTone.ts exactly.
 *   • "flat"    when |Δamerican| < MIN_MOVE_AMERICAN, or prob delta < 1pp
 *   • "toward"  when the picked side's implied prob ROSE ≥ 1pp
 *   • "against" when the picked side's implied prob FELL ≥ 1pp
 */
export function classifyMove(
  openAmerican: number | null | undefined,
  currentAmerican: number | null | undefined,
): MoveDirection {
  if (openAmerican === null || openAmerican === undefined) return "flat";
  if (currentAmerican === null || currentAmerican === undefined) return "flat";
  if (Math.abs(currentAmerican - openAmerican) < MIN_MOVE_AMERICAN) return "flat";
  const openProb = americanToImpliedProb(openAmerican);
  const curProb = americanToImpliedProb(currentAmerican);
  if (openProb === null || curProb === null) return "flat";
  const delta = curProb - openProb;
  if (delta >= MIN_IMPLIED_DELTA) return "toward";
  if (delta <= -MIN_IMPLIED_DELTA) return "against";
  return "flat";
}

/**
 * Signed American-cents delta between two prices. Used for the ML ±10c
 * threshold. Returns null when either price is missing. Note: American "cents"
 * are not linear around 0; this is the raw numeric difference, which is the
 * convention the existing line-move UI uses for the move-size noise floor.
 */
export function americanCentsDelta(
  fromAmerican: number | null | undefined,
  toAmerican: number | null | undefined,
): number | null {
  if (fromAmerican === null || fromAmerican === undefined) return null;
  if (toAmerican === null || toAmerican === undefined) return null;
  if (!Number.isFinite(fromAmerican) || !Number.isFinite(toAmerican)) return null;
  return toAmerican - fromAmerican;
}
