/**
 * Push 4 — pure helpers for game lifecycle classification.
 *
 * Used by the tracking pages, the grader, and the score-ingest
 * service so every part of the system agrees on what state a game
 * is in. Derives a single canonical "lifecycle" label from the
 * underlying provider status string + the game's scheduled time.
 *
 * Lifecycle labels (UI-friendly):
 *   - "upcoming"     — game hasn't started, prediction is live
 *   - "live_locked"  — game has started; prediction locked
 *   - "final"        — game over, scoring available
 *   - "graded"       — game over AND prediction has a grade row
 *   - "void"         — postponed / canceled
 *
 * The label is a UI abstraction; the underlying provider status is
 * the source of truth.
 */

export type GameLifecycle =
  | "upcoming"
  | "live_locked"
  | "final"
  | "graded"
  | "void";

const FINAL_STATUSES: ReadonlySet<string> = new Set([
  "final",
  "STATUS_FINAL",
  "STATUS_FINAL_PEN",
  "STATUS_FINAL_OT",
]);

const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "in_progress",
  "live",
  "suspended",
  "STATUS_IN_PROGRESS",
  "STATUS_HALFTIME",
  "STATUS_END_PERIOD",
]);

const VOID_STATUSES: ReadonlySet<string> = new Set([
  "postponed",
  "canceled",
  "cancelled",
  "STATUS_POSTPONED",
  "STATUS_CANCELED",
]);

const UPCOMING_STATUSES: ReadonlySet<string> = new Set([
  "scheduled",
  "STATUS_SCHEDULED",
]);

export function isFinalStatus(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return false;
  return FINAL_STATUSES.has(s);
}

export function isLiveStatus(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return false;
  return LIVE_STATUSES.has(s);
}

export function isVoidStatus(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return false;
  return VOID_STATUSES.has(s);
}

export function isUpcomingStatus(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return false;
  return UPCOMING_STATUSES.has(s);
}

/**
 * Derive the lifecycle label from a row.
 *
 * `nowMs` defaults to Date.now() but can be injected for deterministic
 * tests. `hasGrade` tells the function whether a prediction_grades row
 * already exists for this prediction — if yes, we surface "graded"
 * over "final".
 */
export function deriveLifecycle(opts: {
  status: string | null;
  gameDateIso: string | null;
  hasGrade?: boolean;
  nowMs?: number;
}): GameLifecycle {
  const { status, gameDateIso, hasGrade } = opts;
  const now = opts.nowMs ?? Date.now();

  if (isVoidStatus(status)) return "void";
  if (isFinalStatus(status)) {
    return hasGrade === true ? "graded" : "final";
  }
  if (isLiveStatus(status)) return "live_locked";

  // Default to upcoming when status is scheduled OR unknown. When the
  // game's wall-clock time has passed and status is still "scheduled"
  // we surface "live_locked" — provider may be slow to update.
  if (gameDateIso !== null) {
    const startMs = new Date(gameDateIso).getTime();
    if (Number.isFinite(startMs) && startMs <= now) {
      return "live_locked";
    }
  }
  return "upcoming";
}
