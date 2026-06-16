/**
 * Pure line-tracker evidence builder (2026-06-16). No React, no DB — unit-
 * tested directly. Renders the compact one-line movement story for the Edge
 * Stack "Line Move" row:
 *
 *     Open −170 · First Published −165 · Current −157 · Locked −160
 *
 * Only non-null stops are shown, in canonical order. When neither a First
 * Published nor a Locked stop exists (the state until the streaming worker +
 * posted-line writes are live), it degrades to "Open −170 · Current −157" —
 * the same information today's card shows, just with explicit labels.
 *
 * Member-facing labels are Open / First Published / Current / Locked. The word
 * "OddSphere posted" is never used (internal storage only).
 */

export type LineTrackerInput = {
  openAmerican: number | null;
  postedAmerican: number | null;
  /** The picked-side price just before the most recent move ("Previous"). */
  previousAmerican?: number | null;
  currentAmerican: number | null;
  lockedAmerican: number | null;
};

function fmt(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export type LineTrackerEvidence = {
  /** The compact one-line stop chain, or null when there is nothing to show. */
  evidence: string | null;
  /** True when a First Published or Locked stop is present (richer than Open→Current). */
  hasExtraStops: boolean;
};

export function buildLineTrackerEvidence(input: LineTrackerInput): LineTrackerEvidence {
  const stops: string[] = [];
  if (input.openAmerican !== null) stops.push(`Open ${fmt(input.openAmerican)}`);
  if (input.postedAmerican !== null) stops.push(`First Published ${fmt(input.postedAmerican)}`);
  // "Previous" only when it differs from current (a real prior price before the
  // most recent move) — avoids a redundant stop equal to Current.
  const previousAmerican = input.previousAmerican ?? null;
  if (previousAmerican !== null && previousAmerican !== input.currentAmerican) {
    stops.push(`Previous ${fmt(previousAmerican)}`);
  }
  if (input.currentAmerican !== null) stops.push(`Current ${fmt(input.currentAmerican)}`);
  if (input.lockedAmerican !== null) stops.push(`Locked ${fmt(input.lockedAmerican)}`);

  const hasExtraStops =
    input.postedAmerican !== null || input.lockedAmerican !== null ||
    (previousAmerican !== null && previousAmerican !== input.currentAmerican);
  // Need at least two stops to tell a "move" story; one stop alone is not a tracker.
  if (stops.length < 2) return { evidence: null, hasExtraStops };
  return { evidence: stops.join(" · "), hasExtraStops };
}
