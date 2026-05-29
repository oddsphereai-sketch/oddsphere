/**
 * Phase 4A — pure T-60 game selection.
 *
 * Decides whether a game is within the "T-60" pre-game refresh window
 * relative to a caller-supplied `now`. Caller-supplied so tests are
 * deterministic and prod callers pass `new Date()`.
 *
 * "T-60 window" semantics:
 *   • game's start_time is between `now` and `now + window_minutes`
 *     → IN window (selected)
 *   • start_time already passed → already started → SKIPPED
 *     (unless `include_started=true` — escape hatch for operator
 *      reruns of in-progress games; not used by V1 cron)
 *   • start_time > now + window_minutes → not yet → SKIPPED
 *   • start_time null/undefined/invalid → SKIPPED with reason
 *
 * All times handled as absolute UTC (Date.parse + getTime). Timezone
 * concerns are the SOURCE's responsibility — by the time start_time
 * reaches this helper it MUST be an ISO 8601 timestamp.
 *
 * Pure module. No DB imports. No env reads. No service imports.
 */

/**
 * Default T-60 window length in minutes. Single source of truth — every
 * caller that omits the param uses this value, so re-tuning happens
 * here.
 */
export const T60_WINDOW_MINUTES_DEFAULT = 60;

/**
 * Is this game within the T-60 window relative to `now`?
 *
 * Returns:
 *   • true  — start_time is in the future AND within window_minutes
 *             (or start_time is in the past AND include_started=true)
 *   • false — null/undefined/invalid/outside-window/already-started
 *             (when include_started=false)
 *
 * `selectGamesInT60Window` provides the same logic plus per-candidate
 * skip reasons; use this single-game helper for one-off checks.
 */
export function isInT60Window(
  start_time: string | null | undefined,
  now: Date,
  window_minutes: number = T60_WINDOW_MINUTES_DEFAULT,
  include_started: boolean = false
): boolean {
  if (start_time === null || start_time === undefined) return false;
  const start_ms = Date.parse(start_time);
  if (Number.isNaN(start_ms)) return false;
  const delta_ms = start_ms - now.getTime();
  const window_ms = window_minutes * 60 * 1000;
  if (delta_ms > window_ms) return false; // too far in the future
  if (delta_ms < 0 && !include_started) return false; // already started
  return true;
}

/**
 * Input row for `selectGamesInT60Window`. Minimal shape — callers
 * (Phase 4B/4C orchestrator) map DB rows or any other source into this.
 */
export type T60Candidate = {
  game_external_id: number;
  start_time: string | null | undefined;
};

/**
 * Per-candidate skip reasons (stable strings — operator scripts and
 * tests can match exactly).
 */
export type T60SkipReason =
  | "missing start_time"
  | "invalid start_time"
  | "outside window"
  | "already started";

/**
 * Output of `selectGamesInT60Window`. `selected` carries a guaranteed-
 * non-null start_time; `skipped` carries the reason per game.
 */
export type T60Selection = {
  selected: Array<{ game_external_id: number; start_time: string }>;
  skipped: Array<{ game_external_id: number; reason: T60SkipReason }>;
};

/**
 * Partition a list of candidates into `selected` (in T-60 window) and
 * `skipped` (with reason). Pure — caller provides candidates from any
 * source (DB query, fixture, manual list).
 *
 * Skip reasons:
 *   • "missing start_time"  — start_time is null or undefined
 *   • "invalid start_time"  — start_time fails Date.parse
 *   • "outside window"      — start_time > now + window_minutes
 *   • "already started"     — start_time < now (and include_started=false)
 *
 * Order: `selected` preserves the input candidate order; `skipped`
 * preserves the input candidate order interleaved per skip.
 */
export function selectGamesInT60Window(
  candidates: readonly T60Candidate[],
  now: Date,
  window_minutes: number = T60_WINDOW_MINUTES_DEFAULT,
  include_started: boolean = false
): T60Selection {
  const selected: T60Selection["selected"] = [];
  const skipped: T60Selection["skipped"] = [];

  const window_ms = window_minutes * 60 * 1000;
  const now_ms = now.getTime();

  for (const c of candidates) {
    if (c.start_time === null || c.start_time === undefined) {
      skipped.push({
        game_external_id: c.game_external_id,
        reason: "missing start_time",
      });
      continue;
    }
    const start_ms = Date.parse(c.start_time);
    if (Number.isNaN(start_ms)) {
      skipped.push({
        game_external_id: c.game_external_id,
        reason: "invalid start_time",
      });
      continue;
    }
    const delta_ms = start_ms - now_ms;
    if (delta_ms > window_ms) {
      skipped.push({
        game_external_id: c.game_external_id,
        reason: "outside window",
      });
      continue;
    }
    if (delta_ms < 0 && !include_started) {
      skipped.push({
        game_external_id: c.game_external_id,
        reason: "already started",
      });
      continue;
    }
    selected.push({
      game_external_id: c.game_external_id,
      start_time: c.start_time,
    });
  }

  return { selected, skipped };
}
