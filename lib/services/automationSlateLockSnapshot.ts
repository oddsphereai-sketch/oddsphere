/**
 * Phase 4.2.C.1.R-19 Phase 4b — slate-lock snapshot for the cron-safe
 * automation orchestrator.
 *
 * Wraps the existing Phase 4.2.B pure lock helpers
 * (`lib/automodel/lockState.ts`) and produces the shape the cron route
 * surfaces on its AutomationRunReport. NO behavior change beyond
 * surfacing: every existing write-protection still flows through:
 *
 *   • automodelService.generatePredictionsForSlate(respectLocks=true)
 *     — Layer 2 pre-filter via fetchLockedExternalIds excludes locked
 *     games from the snapshot build.
 *   • ingestScoresModel
 *     — Layer 1 guard rejects writes to locked rows (unless the
 *     incoming row carries is_override=true).
 *   • /api/cron/pregame-sweep
 *     — Owns the `entering_lock → locked` transition (sets locked_at
 *     = NOW() atomically with the final auto-model pass + writes the
 *     admin_audit_log row).
 *
 * R-19 Phase 4b does NOT duplicate the lock-on-write logic. The
 * slate-cycle orchestrator REPORTS lock state and lets the existing
 * pregame-sweep cron own the transition. Separating "wholesale slate
 * refresh" (slate-cycle) from "per-game T-60 lock" (pregame-sweep)
 * keeps each route single-purpose and easier to reason about under
 * unattended cron.
 *
 * Pure module — no DB imports, no env reads.
 */

import {
  partitionByLockState,
  computeLocksAt,
  LOCK_WINDOW_MINUTES_DEFAULT,
  type LockCandidate,
  type LockState,
} from "../automodel/lockState";
import type { Sport } from "../types/domain/Sport";

/**
 * Single game's lock-relevant inputs. Matches the shape a Supabase
 * query of `games` joined with `game_predictions.locked_at` produces.
 */
export interface SlateLockGameInput {
  game_external_id: number;
  game_date: string | null;
  locked_at: string | null;
  /** Optional matchup label for human-readable report rendering. */
  matchup?: string | null;
}

/**
 * Per-game lock entry in the report. Always present for every game on
 * the slate so operator tooling can render a complete table.
 */
export interface PerGameLockState {
  game_external_id: number;
  game_date: string | null;
  locked_at: string | null;
  matchup: string | null;
  lock_state: LockState;
  /** Wall-clock moment this game will/did lock — `game_date - window`.
   *  Null when game_date is missing or invalid. */
  locks_at: string | null;
}

export interface SlateLockSnapshotInput {
  sport: Sport;
  games: ReadonlyArray<SlateLockGameInput>;
  /** Reference moment — tests pass a fixed Date; production passes new Date(). */
  now: Date;
  /** Lock window length. Defaults to LOCK_WINDOW_MINUTES_DEFAULT (60). */
  windowMinutes?: number;
}

export interface SlateLockSnapshotResult {
  /** The lock-window constant used (echoed for operator confirmation). */
  lock_window_minutes: number;
  /** Total games on the slate. */
  total_games: number;
  /** Games far from T-60 (lock state = "still_unlocked"). */
  unlocked_games: number;
  /** Games inside T-60 AND not yet locked (lock state = "entering_lock").
   *  These are the games the pregame-sweep cron WOULD lock on its next
   *  pass. The slate-cycle orchestrator never sets locked_at itself —
   *  this is a forecast, not an action. */
  would_lock_games: number;
  /** Games whose locked_at is already set (lock state = "locked"). */
  already_locked_games: number;
  /** Games whose start time is in the past AND not yet locked
   *  (lock state = "already_started"). Pre-lock games that started
   *  without ever getting locked — usually means the pregame-sweep
   *  cron didn't fire. Treated as locked by both automodelService and
   *  ingestScoresModel. */
  already_started_games: number;
  /** Sum of {locked, would-lock, already-started} — games whose
   *  predictions are or will be frozen on this run. */
  effectively_locked_count: number;
  /** Per-game snapshot — every game on the slate appears here. */
  per_game: PerGameLockState[];
}

/**
 * Build the slate-wide lock snapshot from a list of game-row inputs.
 * Pure function — order-preserving, no side effects.
 *
 * The `effectively_locked_count` is the number that
 * `automodelService.generatePredictionsForSlate(respectLocks=true)`
 * would exclude from its snapshot build. `would_lock_games` is
 * informational only — pregame-sweep is what actually flips
 * locked_at on those rows.
 */
export function assessSlateLockSnapshot(
  input: SlateLockSnapshotInput
): SlateLockSnapshotResult {
  const windowMinutes = input.windowMinutes ?? LOCK_WINDOW_MINUTES_DEFAULT;
  // Map our input shape to the LockCandidate shape the underlying
  // helper expects, then preserve the original input alongside so
  // the per-game report can echo external_id / matchup.
  type Annotated = LockCandidate & SlateLockGameInput;
  const annotated: Annotated[] = input.games.map((g) => ({
    game_external_id: g.game_external_id,
    game_date: g.game_date,
    locked_at: g.locked_at,
    matchup: g.matchup ?? null,
  }));
  const partition = partitionByLockState(annotated, input.now, windowMinutes);

  const perGame: PerGameLockState[] = [];
  for (const g of annotated) {
    let lockState: LockState;
    if (partition.locked.includes(g)) lockState = "locked";
    else if (partition.entering_lock.includes(g)) lockState = "entering_lock";
    else if (partition.already_started.includes(g)) lockState = "already_started";
    else lockState = "still_unlocked";
    perGame.push({
      game_external_id: g.game_external_id,
      game_date: g.game_date,
      locked_at: g.locked_at ?? null,
      matchup: g.matchup ?? null,
      lock_state: lockState,
      locks_at: computeLocksAt(g.game_date, windowMinutes),
    });
  }

  const result: SlateLockSnapshotResult = {
    lock_window_minutes: windowMinutes,
    total_games: input.games.length,
    unlocked_games: partition.still_unlocked.length,
    would_lock_games: partition.entering_lock.length,
    already_locked_games: partition.locked.length,
    already_started_games: partition.already_started.length,
    effectively_locked_count:
      partition.locked.length +
      partition.entering_lock.length +
      partition.already_started.length,
    per_game: perGame,
  };
  return result;
}

// ─── Lock warning derivation ─────────────────────────────────────────────

/**
 * Env-flag the operator sets when `/api/cron/pregame-sweep` has been
 * scheduled in vercel.json and is firing on a real cadence. Until then,
 * NOTHING flips `locked_at` from null → set, which means the per-game
 * lock guarantee at the heart of Phase 4b is inert.
 *
 * Without this flag, the orchestrator can still RESPECT existing locks
 * (via automodelService.respectLocks=true), but no transitions happen.
 * The lock-warnings surface this loudly so an operator doesn't activate
 * unattended cron under the false belief that lock-on-write is in effect.
 */
export const PREGAME_SWEEP_CRON_ACTIVE_ENV = "PREGAME_SWEEP_CRON_ACTIVE";

/**
 * Structured warning codes. Each has a fixed severity:
 *
 *   • `lock_miss`                       → severity "block" — push to
 *     blocking_reasons AND force m2 blocked. The DB sees games whose
 *     `game_date` is in the past with `locked_at = null` — i.e. the
 *     lock cron didn't fire. Running M2 on these would silently
 *     overwrite picks for games that have already started.
 *
 *   • `entering_lock_no_transition`     → severity "warn" — slate-cycle
 *     does NOT flip locked_at itself. Games inside the T-60 window are
 *     about to lock but pregame-sweep is the only path that performs
 *     the UPDATE. Surfaced so operators know a separate cron must be
 *     scheduled to complete the lock transition.
 *
 *   • `pregame_sweep_not_active`        → severity "warn" — the
 *     PREGAME_SWEEP_CRON_ACTIVE env flag is not "true". Without
 *     pregame-sweep firing, no game ever moves from
 *     `entering_lock` → `locked`. The lock guarantee is inert until
 *     the operator schedules pregame-sweep in vercel.json AND flips
 *     this env flag.
 */
export type LockWarningCode =
  | "lock_miss"
  | "entering_lock_no_transition"
  | "pregame_sweep_not_active";

export type LockWarningSeverity = "warn" | "block";

export interface LockWarning {
  code: LockWarningCode;
  severity: LockWarningSeverity;
  message: string;
  /** Affected game count when relevant (lock_miss / entering_lock). */
  affected_count: number;
}

export interface LockWarningEnv {
  PREGAME_SWEEP_CRON_ACTIVE?: string | undefined;
}

export interface DeriveLockWarningsInput {
  snapshot: SlateLockSnapshotResult | null;
  env: LockWarningEnv;
}

/**
 * Derive structured warnings from a lock snapshot. Pure function — no
 * I/O. Returns an empty array when the snapshot is null (e.g. slate
 * not yet in DB) AND pregame-sweep is marked active.
 *
 * Decision matrix:
 *
 *   snapshot.already_started_games > 0
 *     AND snapshot.already_locked_games === 0
 *     → push `lock_miss` (severity: block)
 *
 *   snapshot.would_lock_games > 0
 *     → push `entering_lock_no_transition` (severity: warn)
 *
 *   env.PREGAME_SWEEP_CRON_ACTIVE !== "true"
 *     → push `pregame_sweep_not_active` (severity: warn)
 */
export function deriveLockWarnings(
  input: DeriveLockWarningsInput
): LockWarning[] {
  const out: LockWarning[] = [];
  const snap = input.snapshot;

  if (snap !== null) {
    if (snap.already_started_games > 0 && snap.already_locked_games === 0) {
      out.push({
        code: "lock_miss",
        severity: "block",
        affected_count: snap.already_started_games,
        message:
          `Lock miss: ${snap.already_started_games} game(s) on this slate have a past ` +
          `game_date with locked_at = null. The pregame-sweep cron didn't fire in time, ` +
          `so games that have already started were never locked. Running M2 on these ` +
          `would silently overwrite picks for games in progress; blocking.`,
      });
    }
    if (snap.would_lock_games > 0) {
      out.push({
        code: "entering_lock_no_transition",
        severity: "warn",
        affected_count: snap.would_lock_games,
        message:
          `${snap.would_lock_games} game(s) inside the T-60 lock window. Slate-cycle ` +
          `does NOT flip locked_at — /api/cron/pregame-sweep owns that transition. ` +
          `Verify pregame-sweep is scheduled and firing, otherwise these games will ` +
          `start without ever being locked.`,
      });
    }
  }

  if (input.env[PREGAME_SWEEP_CRON_ACTIVE_ENV] !== "true") {
    out.push({
      code: "pregame_sweep_not_active",
      severity: "warn",
      affected_count: 0,
      message:
        `${PREGAME_SWEEP_CRON_ACTIVE_ENV} env flag is not "true" — operator has not ` +
        `declared the pregame-sweep cron schedule active. Until pregame-sweep fires ` +
        `on a real cadence (vercel.json schedule + this env flag), no game's ` +
        `locked_at will ever transition from null → set. Slate-cycle continues to ` +
        `respect existing locks but the lock chain is inert.`,
    });
  }

  return out;
}

/**
 * Predicate — does the warning set contain any blocker-severity entry?
 * Used by the orchestrator to (a) gate auto-publish and (b) decide
 * whether to surface the lock_miss exclusion plus warning in the
 * report. After R-19 Phase 5c this NO LONGER forces M2 slate-wide
 * blocked — see extractLockMissExclusions below.
 */
export function anyLockWarningBlocks(warnings: ReadonlyArray<LockWarning>): boolean {
  return warnings.some((w) => w.severity === "block");
}

/**
 * R-19 Phase 5c — extract the per-game exclusion list from the lock
 * snapshot. Pure function. Returns external_ids of games whose
 * lock_state is "already_started" AND locked_at is null — i.e. the
 * lock_miss pattern (game start time has passed but pregame-sweep
 * never set locked_at).
 *
 * The cron-safe slate-cycle orchestrator feeds these external_ids to
 * `generatePredictionsForSlate({ excludeGameExternalIds })`, which
 * union's them with the existing Layer 2 lock filter. M2 runs for
 * the remaining eligible games; affected games are surfaced on the
 * AutomationRunReport.
 *
 * Important: this is the PER-GAME version of the lock_miss safety.
 * The slate-wide warning (`lock_miss`, severity: block) still appears
 * in `slate_lock_warnings` and still blocks auto-publish — but it no
 * longer forces M2 to skip every game on the slate.
 *
 * Returns an empty array when:
 *   • snapshot is null (slate not yet ingested), OR
 *   • already_started_games === 0, OR
 *   • every already_started game already has locked_at set (no miss)
 */
export function extractLockMissExclusions(
  snapshot: SlateLockSnapshotResult | null
): number[] {
  if (snapshot === null) return [];
  const out: number[] = [];
  for (const g of snapshot.per_game) {
    if (g.lock_state === "already_started" && (g.locked_at === null || g.locked_at === undefined)) {
      out.push(g.game_external_id);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}
