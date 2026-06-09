/**
 * /api/cron/pregame-sweep — Phase 4.2.B: per-game lock-on-write
 *
 * Runs every 15 min during the slate-active window (Phase 4.2.D will
 * schedule this on Vercel). Each invocation:
 *
 *   1. Reads today's slate + per-game lock state via classifyLockState
 *   2. Partitions games into four buckets: locked, entering_lock,
 *      still_unlocked, already_started
 *   3. For ENTERING_LOCK games: runs the auto-model one last time with
 *      stage='t60_locked', then sets game_predictions.locked_at = NOW()
 *      and writes one admin_audit_log row per transition. This is the
 *      LOCK-ON-WRITE moment — locked_at gets populated atomically with
 *      the final pre-lock refresh.
 *   4. Always refreshes lines + sharp signals + market_signal + grade
 *      derivation for the whole slate. These data sources are not
 *      locked individually in V1 — refresh is cheap and keeps already-
 *      unlocked games current.
 *
 * V1 LOCK SCOPE — what is and is NOT frozen:
 *   • Frozen at lock: predicted_ml_winner, ml_confidence, predicted_ou_side,
 *     ou_confidence, predicted_nrfi, nrfi_confidence, predicted_total,
 *     sport_specific. Layer 1 ingester guard refuses cron writes here.
 *   • Not yet frozen at lock (V1 limitation): per-pick grade + market_signal
 *     columns, because gradeDerivationService and marketSignalDerivationService
 *     UPDATE these columns directly (bypassing the ingester). A locked game's
 *     prediction VALUES stay frozen, but the derived grade can drift if
 *     sharp signals continue moving for that game after lock.
 *     Phase 4.2.B follow-up will add a locked-game filter to those services.
 *     For V1: acceptable drift — the headline pick + confidence don't change,
 *     only the secondary grade attribution.
 *
 * Audit:
 *   Every entering_lock → locked transition writes one row to admin_audit_log
 *   with action_type='game_prediction.lock', recording the game_id, sport,
 *   date, and the locked_at timestamp.
 *
 * Sport-scoped lock means MLB / NBA can run in parallel. maxDuration=60s
 * because the heaviest work (final auto-model pass for entering_lock games)
 * typically covers 0-2 games per invocation.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { supabase } from "@/lib/db/supabase";
import { linesService } from "@/lib/services/linesService";
import { generatePredictionsForSlate } from "@/lib/services/automodelService";
import { updateMarketSignalsForSlate } from "@/lib/services/marketSignalDerivationService";
import { updateGradesForSlate } from "@/lib/services/gradeDerivationService";
import {
  partitionByLockState,
  type LockCandidate,
} from "@/lib/automodel/lockState";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────
// R-19 Phase 5a — Launch-safety controls
//
// Two additions to the Phase 4.2.B pregame-sweep route:
//
//   1. Dry-run mode (`?dryRun=true` OR PREGAME_SWEEP_DRY_RUN=true env)
//      — full classification + partition + structured report, NO writes.
//      Always allowed regardless of master gate.
//
//   2. Master gate (PREGAME_SWEEP_CRON_ACTIVE=true env) — required for
//      non-dry-run (write) mode. Missing → structured blocked report.
//      Aligns with slate-cycle's ORCHESTRATOR_SKIP_CONFIRMATION pattern
//      so unattended cron only writes when the operator has explicitly
//      declared the cron schedule active.
//
// Existing protections preserved end-to-end:
//   • CRON_SECRET auth (cronHandlerPerSport)
//   • per-(data_source, sport) lock (5-min default)
//   • Layer 1 ingester guard (rejects writes to already-locked rows)
//   • Layer 2 automodelService respectLocks pre-filter (default true;
//     respectLocks: false used here for entering_lock games because
//     they haven't crossed the lock threshold yet)
//   • Audit-failure non-fatal (lock UPDATE succeeded; audit-insert
//     failure pushes to errors[] and continues)
// ─────────────────────────────────────────────────────────────

/**
 * Env var operator sets when pregame-sweep is scheduled in vercel.json
 * and intended to perform writes. Strict equality with "true" — same
 * pattern as ORCHESTRATOR_SKIP_CONFIRMATION + MORNING_SLATE_AUTO_PUBLISH.
 */
export const PREGAME_SWEEP_CRON_ACTIVE_ENV = "PREGAME_SWEEP_CRON_ACTIVE";

/**
 * Env var for dry-run mode (alternative to ?dryRun=true query param).
 * Either trigger flips the route into read-only / report-only mode.
 */
export const PREGAME_SWEEP_DRY_RUN_ENV = "PREGAME_SWEEP_DRY_RUN";

/**
 * True when the caller explicitly opted into read-only via either
 * `?dryRun=true` on the request URL or `PREGAME_SWEEP_DRY_RUN=true` in
 * the env. Strict equality on both — typos / casing do not satisfy.
 */
export function isPregameSweepDryRun(
  request: Request,
  env: Record<string, string | undefined> = process.env
): boolean {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("dryRun") === "true") return true;
  } catch {
    // Malformed URL — fall through to env check
  }
  return env[PREGAME_SWEEP_DRY_RUN_ENV] === "true";
}

/**
 * True when the operator has declared pregame-sweep cron active via env.
 * Strict equality with "true". Does NOT examine vercel.json — the flag is
 * the operator's explicit signal that the cron schedule has been wired.
 */
export function isPregameSweepGateActive(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[PREGAME_SWEEP_CRON_ACTIVE_ENV] === "true";
}

/**
 * Build the structured blocked response when the master gate is missing
 * in non-dry-run mode. Returned via the cron-handler shape so the
 * refresh_log row + JSON body both surface the block clearly.
 */
export function buildPregameSweepBlockedDetails(opts: {
  sport: Sport;
  date: string;
}): Record<string, unknown> {
  return {
    blocked: true,
    reason:
      `${PREGAME_SWEEP_CRON_ACTIVE_ENV} env var must be 'true' for non-dry-run ` +
      `cron execution. Pass ?dryRun=true to invoke in read-only mode.`,
    env_flag_required: PREGAME_SWEEP_CRON_ACTIVE_ENV,
    dry_run: false,
    pregame_sweep_active: false,
    sport: opts.sport,
    date: opts.date,
  };
}

// ─────────────────────────────────────────────────────────────
// Slate read + lock-state partition
// ─────────────────────────────────────────────────────────────

type SlateCandidate = LockCandidate & {
  game_id: number;
  external_id: number;
};

async function loadSlateCandidates(
  sport: Sport,
  date: string
): Promise<SlateCandidate[]> {
  // Select games + their game_predictions.locked_at via inner join. Games
  // without a prediction row LEFT join → locked_at is null (correct for
  // "no lock recorded yet").
  const { data, error } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, game_predictions ( locked_at )"
    )
    .eq("sport", sport)
    .eq("slate_date", date);
  if (error) {
    throw new Error(
      `pregame-sweep loadSlateCandidates failed for ${sport}/${date}: ${error.message}`
    );
  }
  type Row = {
    id: number;
    external_id: number;
    game_date: string | null;
    game_predictions: Array<{ locked_at: string | null }> | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    game_id: r.id,
    external_id: r.external_id,
    game_date: r.game_date,
    // game_predictions is array-typed (one-to-many) from the embedded
    // relation; one prediction row per game so .[0] is canonical.
    locked_at: r.game_predictions?.[0]?.locked_at ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────
// Lock-on-write — set locked_at + write audit row
// ─────────────────────────────────────────────────────────────

async function applyLocks(
  sport: Sport,
  date: string,
  games: SlateCandidate[]
): Promise<{ locked: number; audit_written: number; errors: string[] }> {
  if (games.length === 0) {
    return { locked: 0, audit_written: 0, errors: [] };
  }
  const lockedAt = new Date().toISOString();
  const errors: string[] = [];
  let lockedCount = 0;
  let auditCount = 0;

  // Per-game UPDATE so we can audit each transition individually. The
  // count of transitioning games per invocation is typically 0-2 so a
  // small loop is fine here; pregame-sweep runs every 15 min so we're
  // not batching dozens of writes.
  //
  // Phase 6B.18 — IDEMPOTENCY. Only UPDATE locked_at when it is
  // currently NULL. The pre-6B.18 unconditional UPDATE advanced
  // locked_at on every cron firing for games that were classified
  // as entering_lock multiple times (root-cause symptom: another
  // path was clearing locked_at between firings, but even after
  // that's fixed the lock semantic should treat the FIRST lock as
  // canonical, not the latest re-lock). The .is("locked_at", null)
  // predicate guarantees the row stays untouched when already
  // locked, regardless of partition mis-classification.
  for (const g of games) {
    const { error: updErr } = await supabase
      .from("game_predictions")
      .update({ locked_at: lockedAt })
      .eq("game_id", g.game_id)
      .is("locked_at", null);
    if (updErr) {
      errors.push(`game_id=${g.game_id}: locked_at UPDATE failed: ${updErr.message}`);
      continue;
    }
    lockedCount++;

    // Atomic propagation to prediction_records (Phase 7L hotfix).
    //
    // Before this fix there was a timing window between this UPDATE and
    // the next hourly tracking-refresh run during which:
    //   • game_predictions.locked_at IS NOT NULL (this row)
    //   • prediction_records.locked_at IS NULL  (stale until refresh)
    // The Daily Edge route's 6B.18 locked-snapshot override gates on
    // prediction_records.locked_at, so users loading the page inside
    // that window saw live-recomputed verdicts drift away from the
    // pregame snapshot (Best Angle → Watchlist etc.). Propagating
    // the lock here closes the window — the override fires immediately.
    //
    // Sport-scoped + locked_at-null filter mean we never touch:
    //   • other sports' prediction_records
    //   • already-locked prediction_records (preserves their original
    //     lock timestamps, never overwrites)
    // The hourly tracking-refresh writer remains the canonical fill
    // path; this is a secondary write that aligns the timestamps
    // before the cron catches up. If this propagation fails for any
    // reason we log and continue — the game_predictions lock itself
    // already succeeded, and the next tracking-refresh will eventually
    // sync prediction_records.
    const { error: prErr } = await supabase
      .from("prediction_records")
      .update({ locked_at: lockedAt })
      .eq("game_id", g.game_id)
      .eq("sport", sport)
      .is("locked_at", null);
    if (prErr) {
      errors.push(
        `game_id=${g.game_id}: prediction_records lock-propagation failed: ${prErr.message} (game_predictions already locked; tracking-refresh will retry)`,
      );
      // Non-fatal — game_predictions lock holds.
    }

    const { error: auditErr } = await supabase.from("admin_audit_log").insert({
      action_type: "game_prediction.lock",
      target_table: "game_predictions",
      target_id: g.game_id,
      before_state: { locked_at: null },
      after_state: {
        sport,
        date,
        game_id: g.game_id,
        external_id: g.external_id,
        game_date: g.game_date,
        locked_at: lockedAt,
      },
      source_type: "real_api",
    });
    if (auditErr) {
      // Audit failure is non-fatal — the lock itself succeeded. Log to the
      // sweep result so the operator sees we couldn't write audit, but
      // don't roll back the lock (rolling back would mean we'd re-lock
      // on the next sweep and potentially write a duplicate audit row).
      errors.push(`game_id=${g.game_id}: audit insert failed: ${auditErr.message}`);
      continue;
    }
    auditCount++;
  }

  return { locked: lockedCount, audit_written: auditCount, errors };
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  // R-19 Phase 5a — resolve safety controls BEFORE entering the
  // per-sport handler. Both flags are process-wide, not per-sport,
  // and should produce identical behavior across MLB / future sports.
  const dryRun = isPregameSweepDryRun(request);
  const gateActive = isPregameSweepGateActive();

  return cronHandlerPerSport(
    request,
    "pregame_sweep",
    sportsInSeasonToday(),
    async ({ sport }) => {
      // ── Master gate (write-mode only) ───────────────────────────────
      // Dry-run mode is always allowed. Write mode requires the
      // PREGAME_SWEEP_CRON_ACTIVE env flag. Missing → structured
      // blocked report without any DB I/O.
      if (!dryRun && !gateActive) {
        return {
          records_updated: 0,
          api_calls_made: 0,
          partial: true,
          details: buildPregameSweepBlockedDetails({ sport, date }),
        };
      }

      let records = 0;
      let apiCalls = 0;

      // ── 1. Read slate + partition by lock state ─────────────────────
      const candidates = await loadSlateCandidates(sport, date);
      const now = new Date();
      const partition = partitionByLockState(candidates, now);

      // ── R-19 Phase 5a — Dry-run early return ────────────────────────
      // Read-only path: full classification + report, ZERO writes.
      // Skipped steps: entering_lock t60 model pass, applyLocks
      // UPDATE, audit-row INSERT, lines refresh, sharp signals
      // refresh, market-signal derivation, grade derivation.
      if (dryRun) {
        return {
          records_updated: 0,
          api_calls_made: 0,
          partial: false,
          details: {
            dry_run: true,
            pregame_sweep_active: gateActive,
            sport,
            date,
            candidates_count: candidates.length,
            partition: {
              locked: partition.locked.length,
              entering_lock: partition.entering_lock.length,
              still_unlocked: partition.still_unlocked.length,
              already_started: partition.already_started.length,
            },
            would_lock_count: partition.entering_lock.length,
            would_lock_games: partition.entering_lock.map((g) => ({
              game_id: g.game_id,
              external_id: g.external_id,
              game_date: g.game_date,
            })),
            lock_writes_skipped: partition.entering_lock.length,
            steps_skipped: [
              "entering_lock_t60_model_pass",
              "lock_updates",
              "audit_inserts",
              "lines_refresh",
              "sharp_signals_refresh",
              "market_signals_derivation",
              "grade_derivation",
            ],
          },
        };
      }

      // ── 2. Final pre-lock auto-model pass for ENTERING_LOCK games ───
      // We use respectLocks=false because these games aren't locked YET
      // — the lock transition happens AFTER this refresh. The Layer 1
      // ingester guard would otherwise block writes for games whose row
      // is already locked, but entering_lock games haven't crossed that
      // threshold by definition.
      let enteringLockModelResult: {
        attempted: number;
        successful: number;
        errors: string[];
      } = { attempted: 0, successful: 0, errors: [] };
      if (partition.entering_lock.length > 0 && sport === "mlb") {
        const externalIds = partition.entering_lock.map((g) => g.external_id);
        try {
          const result = await generatePredictionsForSlate(
            sport,
            date,
            "t60_locked",
            {
              writeToDb: true,
              gameExternalIdsFilter: externalIds,
              respectLocks: false,
            }
          );
          enteringLockModelResult = {
            attempted: externalIds.length,
            successful: result.db_writes?.ingest.inserted ?? 0,
            errors: result.errors.map(
              (e) => `ext=${e.game_external_id}: ${e.error}`
            ),
          };
          records += result.db_writes?.ingest.inserted ?? 0;
          records += result.db_writes?.ingest.updated ?? 0;
        } catch (e) {
          enteringLockModelResult.errors.push(
            e instanceof Error ? e.message : String(e)
          );
        }
      }

      // ── 3. Apply locks (set locked_at + audit) ──────────────────────
      // Run for entering_lock games regardless of whether the model
      // refresh in step 2 succeeded — locking the row prevents future
      // sweeps from re-attempting a failed refresh, which is the safer
      // default for V1.
      const lockResult = await applyLocks(sport, date, partition.entering_lock);
      records += lockResult.locked;

      // ── 4. Refresh lines + sharp signals for the slate ──────────────
      // Phase 6B.15 — switched from refreshGameLines (V1, slate-wide
      // DELETE-then-INSERT) to refreshGameLinesV2 (per-(game, market)
      // DELETE-then-INSERT with preserve-on-empty). V1 was wiping
      // already-priced games every 15 min whenever SharpAPI returned
      // nothing for that game in the current poll — including locked
      // games whose snapshot members had already read. V2 only
      // touches (game, market) pairs where the provider returned at
      // least one row; markets the provider didn't return for stay
      // preserved with their prior data + computed_at intact.
      const gameLines = await linesService.refreshGameLinesV2(sport, date);
      records += gameLines.records_updated ?? 0;
      apiCalls += gameLines.api_calls_made ?? 0;

      const signals = await linesService.refreshSharpSignals(sport, date);
      records += signals.records_updated ?? 0;
      apiCalls += signals.api_calls_made ?? 0;

      // ── 5. V2.1 Layer 3 — market signal + grade derivation ──────────
      // Same slate-wide scope concern as step 4. Acceptable drift for V1
      // because the locked PREDICTION values don't change; only the
      // derived secondary grade can drift if signals move post-lock.
      const marketSignals = await updateMarketSignalsForSlate(sport, date);
      const marketTouched =
        marketSignals.gamePredictionsUpdated +
        marketSignals.propPredictionsUpdated;
      records += marketTouched;

      const grades = await updateGradesForSlate(sport, date);
      const gradeTouched =
        grades.gamePredictionsUpdated + grades.propPredictionsUpdated;
      records += gradeTouched;

      // R-19 Phase 5a — partial flag fires when any per-game lock errored
      // OR any t60 model pass errored. The cron-handler wrapper consults
      // this to mark the refresh_log row as 'partial' instead of 'success'.
      const anyErrors =
        lockResult.errors.length > 0 ||
        enteringLockModelResult.errors.length > 0;

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        partial: anyErrors,
        details: {
          dry_run: false,
          pregame_sweep_active: true,
          sport,
          date,
          partition: {
            locked: partition.locked.length,
            entering_lock: partition.entering_lock.length,
            still_unlocked: partition.still_unlocked.length,
            already_started: partition.already_started.length,
          },
          entering_lock_model: enteringLockModelResult,
          locks_applied: lockResult.locked,
          audit_rows_written: lockResult.audit_written,
          lock_errors: lockResult.errors,
          errors_count:
            lockResult.errors.length + enteringLockModelResult.errors.length,
          game_lines: gameLines.records_updated,
          sharp_signals: signals.records_updated,
          market_signals: marketTouched,
          market_signals_perMarket: marketSignals.perMarket,
          grades: gradeTouched,
          grades_perMarket: grades.perMarket,
          best_signal_pct: grades.monitor.bestSignalPct.toFixed(1),
          best_signal_picks: grades.monitor.bestSignalPicks,
          total_derived_picks: grades.monitor.totalDerivedPicks,
        },
      };
    }
  );
}

export const POST = GET;
