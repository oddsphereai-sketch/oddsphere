/**
 * Pure line-tracker evidence builder. No React, no DB — unit-tested directly.
 * Renders the compact one-line movement story for the Edge Stack "Line Move"
 * row using only meaningful market-reference points:
 *
 *     First seen −170 · Previous −150 · Current −157 · Locked −160
 *
 * Only non-null stops are shown, in canonical order. Degrades to
 * "First seen −170 · Current −157" when there is no Previous/Locked stop.
 *
 * NOTE (2026-06-16): the internal "Model Posted" / first-publish price is NOT a
 * timeline stop — it's kept for CLV in the expanded interpretation detail only
 * ("Since our post …"), never as a member-facing tracker label.
 */

export type LineTrackerInput = {
  openAmerican: number | null;
  /** Picked-side price just before the most recent move ("Previous"). */
  previousAmerican?: number | null;
  currentAmerican: number | null;
  lockedAmerican: number | null;
};

function fmt(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export type LineTrackerEvidence = {
  /** Compact one-line stop chain, or null when there is nothing to show. */
  evidence: string | null;
  /** True when a Previous or Locked stop is present (richer than Open→Current). */
  hasExtraStops: boolean;
};

export function buildLineTrackerEvidence(input: LineTrackerInput): LineTrackerEvidence {
  const previousAmerican = input.previousAmerican ?? null;
  const hasPrevious = previousAmerican !== null && previousAmerican !== input.currentAmerican;

  const stops: string[] = [];
  if (input.openAmerican !== null) stops.push(`First seen ${fmt(input.openAmerican)}`);
  if (hasPrevious) stops.push(`Previous ${fmt(previousAmerican as number)}`);
  if (input.currentAmerican !== null) stops.push(`Current ${fmt(input.currentAmerican)}`);
  if (input.lockedAmerican !== null) stops.push(`Locked ${fmt(input.lockedAmerican)}`);

  const hasExtraStops = input.lockedAmerican !== null || hasPrevious;
  // Need at least two stops to tell a "move" story.
  if (stops.length < 2) return { evidence: null, hasExtraStops };
  return { evidence: stops.join(" · "), hasExtraStops };
}
