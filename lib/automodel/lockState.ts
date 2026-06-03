/**
 * Phase 4.2.B — Pure per-game lock-state classification.
 *
 * Decides whether a game is `locked`, `entering_lock`, `still_unlocked`, or
 * `already_started` relative to a caller-supplied `now`. Caller-supplied so
 * tests are deterministic and prod callers pass `new Date()`.
 *
 * Lock semantics (V1, per Phase 4.2.B planning):
 *   • Per-game lock — all three markets (ML, Total, FI) on a game share a
 *     single locked_at. No per-market locking.
 *   • Trigger: game_date - now <= LOCK_WINDOW_MINUTES (default 60).
 *   • State transitions are observed at refresh time; the cron path is
 *     responsible for setting locked_at = NOW() when classify() returns
 *     "entering_lock". This module produces only the classification.
 *   • Manual overrides (is_override=true) bypass the lock guard at the
 *     ingest layer — that policy lives outside this pure module.
 *
 * Pure module. No DB imports. No env reads. No service imports. Reuses the
 * Phase 4A `isInT60Window` helper as the underlying time math.
 */

import { isInT60Window, T60_WINDOW_MINUTES_DEFAULT } from "./t60Selection";

/**
 * The four states a game can be in relative to its scheduled first pitch
 * and existing lock state.
 *
 * • "locked"          — locked_at is already set; do NOT refresh
 * • "entering_lock"   — game enters T-60 window AND not yet locked;
 *                        next refresh should run the model one last time
 *                        AND set locked_at = now in the same UPSERT
 * • "still_unlocked"  — game far from T-60 (or no game_date yet); refresh
 *                        as normal, locked_at stays NULL
 * • "already_started" — game start time is in the past AND not locked;
 *                        skip refresh (game in progress or finished).
 *                        Pre-lock games that started without ever getting
 *                        locked are an error path — usually means the
 *                        lock cron didn't fire. Treat as locked anyway.
 */
export type LockState =
  | "locked"
  | "entering_lock"
  | "still_unlocked"
  | "already_started";

/**
 * Input shape — minimal fields the classifier needs. Callers map DB rows
 * or any other source into this. `locked_at` is the existing column value
 * on game_predictions; `game_date` is the existing column on games.
 */
export type LockCandidate = {
  /** game_predictions.locked_at — null if not yet locked. */
  locked_at: string | Date | null | undefined;
  /** games.game_date — ISO 8601 timestamp, the scheduled first pitch. */
  game_date: string | null | undefined;
};

/**
 * Default lock window — matches Phase 4A T60_WINDOW_MINUTES_DEFAULT.
 * Re-exported here so callers don't have to know about the t60Selection
 * module unless they want to.
 */
export const LOCK_WINDOW_MINUTES_DEFAULT = T60_WINDOW_MINUTES_DEFAULT;

/**
 * Classify a single game's lock state. Pure function.
 *
 * Decision table:
 *
 *   locked_at present              → "locked"
 *   game_date null/invalid         → "still_unlocked" (no time data to lock against)
 *   game_date in the past          → "already_started"
 *   game_date within window        → "entering_lock"
 *   game_date beyond window        → "still_unlocked"
 *
 * @param candidate     Per-game inputs
 * @param now           The reference moment (production passes new Date())
 * @param windowMinutes Lock window length (default 60)
 */
export function classifyLockState(
  candidate: LockCandidate,
  now: Date,
  windowMinutes: number = LOCK_WINDOW_MINUTES_DEFAULT
): LockState {
  // Already locked — terminal state. Nothing else matters.
  if (candidate.locked_at !== null && candidate.locked_at !== undefined) {
    return "locked";
  }

  // No game_date → can't measure T-60. Treat as unlocked and let the next
  // refresh either (a) ingest a game_date or (b) leave the row alone.
  if (candidate.game_date === null || candidate.game_date === undefined) {
    return "still_unlocked";
  }

  const startMs = Date.parse(candidate.game_date);
  if (Number.isNaN(startMs)) {
    // Invalid timestamp string — same handling as missing game_date.
    return "still_unlocked";
  }

  const deltaMs = startMs - now.getTime();
  const windowMs = windowMinutes * 60 * 1000;

  // Already started — game is in progress or finished, was never locked.
  // Treat as terminal: the cron should not refresh either.
  if (deltaMs < 0) return "already_started";

  // Inside the lock window (0 <= delta <= window).
  if (deltaMs <= windowMs) return "entering_lock";

  // Far from T-60.
  return "still_unlocked";
}

/**
 * Convenience boolean — "is this prediction locked-and-frozen?".
 *
 * Used by the Layer 1 ingester guard (`ingestScoresModel`) to skip
 * cron writes against locked rows. Manual overrides (is_override=true)
 * are handled by the ingester's separate branch and bypass this check.
 */
export function isLocked(candidate: Pick<LockCandidate, "locked_at">): boolean {
  return (
    candidate.locked_at !== null &&
    candidate.locked_at !== undefined
  );
}

/**
 * Compute the wall-clock moment a game will lock — derived purely from
 * game_date - window. Used by the DTO surface (`locksAt` field) and by
 * the UI badge to render "Locks in 23 min" / "Locked 6:05 PM".
 *
 * Returns null when game_date is missing or invalid. Returns an ISO 8601
 * string (UTC) when valid — callers format for display.
 */
export function computeLocksAt(
  game_date: string | null | undefined,
  windowMinutes: number = LOCK_WINDOW_MINUTES_DEFAULT
): string | null {
  if (game_date === null || game_date === undefined) return null;
  const startMs = Date.parse(game_date);
  if (Number.isNaN(startMs)) return null;
  return new Date(startMs - windowMinutes * 60 * 1000).toISOString();
}

/**
 * Bulk classifier — partition a list of candidates by state. Order-preserving
 * within each bucket. Used by the pregame-sweep cron to drive its per-state
 * action loop.
 */
export type LockPartition<T extends LockCandidate> = {
  locked: T[];
  entering_lock: T[];
  still_unlocked: T[];
  already_started: T[];
};

export function partitionByLockState<T extends LockCandidate>(
  candidates: readonly T[],
  now: Date,
  windowMinutes: number = LOCK_WINDOW_MINUTES_DEFAULT
): LockPartition<T> {
  const out: LockPartition<T> = {
    locked: [],
    entering_lock: [],
    still_unlocked: [],
    already_started: [],
  };
  for (const c of candidates) {
    const state = classifyLockState(c, now, windowMinutes);
    out[state].push(c);
  }
  return out;
}

// Re-export the underlying T-60 helper for callers that want a single
// import rather than reaching into the t60Selection module separately.
// Keeps lockState.ts as the single import surface for Phase 4.2.B
// consumers.
export { isInT60Window };
