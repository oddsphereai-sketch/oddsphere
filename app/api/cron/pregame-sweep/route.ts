/**
 * /api/cron/pregame-sweep — Phase 4.2.B: per-game lock-on-write
 *
 * Runs every minute during the slate-active window. Each invocation stays
 * targeted to games entering the lock window; ordinary sweeps are read-only
 * no-ops after classification. Each invocation:
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
import { assertMlbChampionRuntime } from "@/lib/automodel/mlbChampionRuntime";
import { assertWnbaChampionRuntime } from "@/lib/automodel/wnbaChampionRuntime";
import { createPredictionRecords } from "@/lib/services/predictionRecordService";
import { assessMlbLockCoherence } from "@/lib/services/mlbLockCoherence";
import { updateMarketSignalsForSlate } from "@/lib/services/marketSignalDerivationService";
import { updateGradesForSlate } from "@/lib/services/gradeDerivationService";
import { detectSnapshotStaleness } from "@/lib/services/snapshotStalenessDetector";
import { dailyEdgeSnapshotKey } from "@/lib/services/labResponseSnapshots";
import { refreshDailyEdgeResponseSnapshot } from "@/lib/services/labResponseSnapshotWriter";
import { isVoidStatus } from "@/lib/services/gameLifecycle";
import {
  loadLatestMlbPropsBoardSnapshot,
  loadLatestMlbPropsGameLockSchedule,
} from "@/lib/mlb/props/boardSnapshotStore";
import { ensureMlbPropsGameLocksForSchedule } from "@/lib/mlb/props/internalTracking";
import { publishMlbPropsMemberReadSnapshots } from "@/lib/mlb/props/memberReadSnapshotStore";
import {
  runScheduledMarketIntelligenceV2Collection,
  type ScheduledMarketIntelligenceV2Result,
} from "@/lib/services/marketIntelligenceV2/scheduledCollection";
import {
  partitionByLockState,
  type LockCandidate,
} from "@/lib/automodel/lockState";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  buildPregameSweepBlockedDetails,
  isPregameSweepDryRun,
  isPregameSweepGateActive,
  isPregameSweepLockOnly,
} from "@/lib/cron/pregameSweepSafety";

export const maxDuration = 90;

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

function pregameSweepSports(
  env: Record<string, string | undefined> = process.env
): Sport[] {
  const sports: Sport[] = [...sportsInSeasonToday()];
  if (env.WNBA_PREGAME_SWEEP_ENABLED === "true") sports.push("wnba");
  return [...new Set(sports)];
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
  // Read games and authoritative prediction locks separately. The embedded
  // relation occasionally returned a null/partial child projection while the
  // underlying game_predictions row was already locked, producing a false
  // started-without-lock alert. An explicit keyed lookup is deterministic.
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id, game_date, status")
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
    status: string | null;
  };
  // A postponed/canceled game must never enter the final model refresh or
  // lock path even if its original first-pitch time reaches T-60.
  const games = ((data ?? []) as Row[]).filter((game) => !isVoidStatus(game.status));
  const gameIds = games.map((game) => game.id);
  const lockByGame = new Map<number, string | null>();
  if (gameIds.length > 0) {
    const { data: predictionRows, error: predictionError } = await supabase
      .from("game_predictions")
      .select("game_id, locked_at")
      .in("game_id", gameIds);
    if (predictionError) {
      throw new Error(
        `pregame-sweep lock lookup failed for ${sport}/${date}: ${predictionError.message}`
      );
    }
    for (const row of (predictionRows ?? []) as Array<{ game_id: number; locked_at: string | null }>) {
      lockByGame.set(row.game_id, row.locked_at);
    }
  }
  return games.map((r) => ({
    game_id: r.id,
    external_id: r.external_id,
    game_date: r.game_date,
    locked_at: lockByGame.get(r.id) ?? null,
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
  // small loop is fine here; the minute sweep remains targeted and does not
  // batch dozens of writes.
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
  const lockOnly = isPregameSweepLockOnly(request);

  return cronHandlerPerSport(
    request,
    "pregame_sweep",
    // WNBA lock checks are opt-in. They are cheap, but during incident recovery
    // the 15-minute schedule should touch only MLB unless explicitly enabled.
    pregameSweepSports(),
    async ({ sport }) => {
      if (sport === "mlb" && !dryRun && gateActive) assertMlbChampionRuntime();
      if (sport === "wnba" && !dryRun && gateActive) assertWnbaChampionRuntime();
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
            lock_only: lockOnly,
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

      const propsLockSweep: {
        attempted: boolean;
        snapshotFound: boolean;
        gameLocksCreated: number;
        error: string | null;
      } = {
        attempted: sport === "mlb",
        snapshotFound: false,
        gameLocksCreated: 0,
        error: null,
      };
      if (sport === "mlb") {
        try {
          const propsSchedule = await loadLatestMlbPropsGameLockSchedule(date);
          propsLockSweep.snapshotFound = propsSchedule.length > 0;
          if (propsSchedule.length > 0) {
            const lockResult = await ensureMlbPropsGameLocksForSchedule({
              slateDate: date,
              schedule: propsSchedule,
              observedAt: now.toISOString(),
            });
            propsLockSweep.gameLocksCreated = lockResult.created;
            if (lockResult.created > 0) {
              // The compact board is the default member entry point. Scoped
              // detail readers resolve the canonical snapshot directly, so a
              // lock-only sweep never rewrites every player/game shard.
              const propsSnapshot = await loadLatestMlbPropsBoardSnapshot(date);
              if (propsSnapshot) {
                await publishMlbPropsMemberReadSnapshots(propsSnapshot, { compactOnly: true });
                records++;
              }
              records += lockResult.created;
            }
          }
        } catch (error) {
          propsLockSweep.error = error instanceof Error ? error.message : String(error);
        }
      }

      let preLockGameLines: Awaited<ReturnType<typeof linesService.refreshGameLinesV2>> | null = null;
      let preLockSignals: Awaited<ReturnType<typeof linesService.refreshSharpSignals>> | null = null;
      let marketIntelligenceV2: ScheduledMarketIntelligenceV2Result | null = null;

      // Fresh market data must exist BEFORE the T-60 model pass. The scheduled
      // Vercel job runs this route with lockOnly=true, so the old flow skipped
      // the slate-wide lines/sharp refresh and could freeze stale morning odds.
      // Refresh only when a game is actually entering lock to keep the 15-minute
      // sweep light while still making the lock snapshot market-current.
      if (partition.entering_lock.length > 0 && sport === "mlb") {
        const enteringExternalIds = partition.entering_lock.map((g) => g.external_id);
        preLockGameLines = await linesService.refreshGameLinesV2(sport, date, {
          externalIdsFilter: enteringExternalIds,
        });
        records += preLockGameLines.records_updated ?? 0;
        apiCalls += preLockGameLines.api_calls_made ?? 0;

        preLockSignals = await linesService.refreshSharpSignals(sport, date, {
          externalIdsFilter: enteringExternalIds,
        });
        records += preLockSignals.records_updated ?? 0;
        apiCalls += preLockSignals.api_calls_made ?? 0;

        if (!lockOnly) {
          marketIntelligenceV2 = await runScheduledMarketIntelligenceV2Collection({
            supabase,
            sport,
            slateDate: date,
            phase: "pregame_sweep",
          });
          records += marketIntelligenceV2.recordsUpdated;
          apiCalls += marketIntelligenceV2.apiCallsMade;
        }
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
      let enteringLockRefreshThrew = false;
      const failedEnteringLockExternalIds = new Set<number>();
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
            successful: Math.max(0, externalIds.length - result.errors.length),
            errors: result.errors.map(
              (e) => `ext=${e.game_external_id}: ${e.error}`
            ),
          };
          for (const error of result.errors) {
            if (typeof error.game_external_id === "number") {
              failedEnteringLockExternalIds.add(error.game_external_id);
            } else {
              // An unscoped failure cannot be proven safe for any candidate.
              enteringLockRefreshThrew = true;
            }
          }
          records += result.db_writes?.ingest.inserted ?? 0;
          records += result.db_writes?.ingest.updated ?? 0;
        } catch (e) {
          enteringLockRefreshThrew = true;
          enteringLockModelResult.errors.push(
            e instanceof Error ? e.message : String(e)
          );
        }
      }

      // ── 2.5. Fail-closed member-record coherence gate ───────────────
      // The final T-60 model write and its member-facing prediction_records
      // sync must describe the same recommendation before either row can be
      // frozen. A sync failure or stale member row blocks only that game from
      // locking; the next sweep can retry after the underlying issue clears.
      const modelEligibleGames = sport !== "mlb"
        ? partition.entering_lock
        : enteringLockRefreshThrew
          ? []
          : partition.entering_lock.filter(
              (game) => !failedEnteringLockExternalIds.has(game.external_id),
            );
      const modelDeferredGames = partition.entering_lock.filter(
        (game) => !modelEligibleGames.some((eligible) => eligible.game_id === game.game_id),
      );
      let gamesReadyForLock = modelEligibleGames;
      let lockCoherence: {
        checked: number;
        coherent: number;
        blocked_game_ids: number[];
        errors: string[];
      } = {
        checked: 0,
        coherent: 0,
        blocked_game_ids: modelDeferredGames.map((game) => game.game_id),
        errors: modelDeferredGames.length > 0
          ? ["final T-60 model refresh failed; lock deferred until the next sweep"]
          : [],
      };
      if (modelEligibleGames.length > 0 && sport === "mlb") {
        const enteringGameIds = new Set(modelEligibleGames.map((game) => game.game_id));
        try {
          const expectedResult = await createPredictionRecords({
            sport: "mlb",
            slateDate: date,
            launchDay: false,
            apply: false,
            supabase,
          });
          const expectedRows = expectedResult.proposed.filter((row) => enteringGameIds.has(row.game_id));
          const { data: storedRows, error: storedError } = await supabase
            .from("prediction_records")
            .select("game_id, market, pick, side, odds_american, confidence, play_grade, best_angle, no_bet")
            .in("game_id", [...enteringGameIds])
            .eq("sport", "mlb")
            .eq("slate_date", date)
            .is("locked_at", null);
          if (storedError) throw new Error(storedError.message);
          const assessment = assessMlbLockCoherence({
            gameIds: [...enteringGameIds],
            expectedRows,
            storedRows: storedRows ?? [],
          });
          lockCoherence = {
            checked: assessment.checked,
            coherent: assessment.coherentGameIds.length,
            blocked_game_ids: [
              ...modelDeferredGames.map((game) => game.game_id),
              ...assessment.blockedGameIds,
            ],
            errors: [
              ...(modelDeferredGames.length > 0
                ? ["final T-60 model refresh failed; lock deferred until the next sweep"]
                : []),
              ...assessment.errors,
            ],
          };
          const coherentIds = new Set(assessment.coherentGameIds);
          gamesReadyForLock = modelEligibleGames.filter((game) => coherentIds.has(game.game_id));
        } catch (error) {
          gamesReadyForLock = [];
          lockCoherence = {
            checked: modelEligibleGames.length,
            coherent: 0,
            blocked_game_ids: partition.entering_lock.map((game) => game.game_id),
            errors: [`lock coherence check failed closed: ${error instanceof Error ? error.message : String(error)}`],
          };
        }
      }

      // ── 3. Apply locks (set locked_at + audit) ──────────────────────
      // MLB locks only games that passed the model/member-record coherence
      // gate. Other sports retain their existing lock behavior.
      const lockResult = await applyLocks(sport, date, gamesReadyForLock);
      records += lockResult.locked;

      // Persist lock-health failures as small operational events. Successful
      // sweeps add no rows. This makes a missed/blocked lock visible before
      // settlement instead of discovering it from a flipped Tracking slate.
      const missedLockGames = partition.already_started.map((game) => game.game_id);
      const blockedLockGames = lockCoherence.blocked_game_ids;
      if (missedLockGames.length > 0 || blockedLockGames.length > 0) {
        const events = [
          ...missedLockGames.map((gameId) => ({
            severity: "critical",
            component: "pregame_sweep",
            event_type: "game_started_without_lock",
            message: `Game ${gameId} started without an authoritative prediction lock`,
            context_json: { sport, slate_date: date, game_id: gameId },
          })),
          ...blockedLockGames.map((gameId) => ({
            severity: "high",
            component: "pregame_sweep",
            event_type: "lock_coherence_blocked",
            message: `Game ${gameId} lock was blocked by member/model coherence checks`,
            context_json: { sport, slate_date: date, game_id: gameId, errors: lockCoherence.errors },
          })),
        ];
        const { error: healthEventError } = await supabase.from("data_quality_events").insert(events);
        if (healthEventError) lockResult.errors.push(`lock-health event write failed: ${healthEventError.message}`);
      }

      if (lockOnly) {
        // Member reads use the prebuilt Daily Edge response snapshot for speed.
        // A lock write without a matching snapshot publish leaves the database
        // frozen while the page still says "open" until another slate writer
        // happens to rebuild it. Publish only when a lock was just applied, or
        // when a prior publish failed and the stored snapshot still predates the
        // newest authoritative lock. The metadata check is one small indexed DB
        // read; the heavier response rebuild never runs on ordinary 5-minute
        // no-op sweeps.
        let responseSnapshot: Awaited<ReturnType<typeof refreshDailyEdgeResponseSnapshot>> | null = null;
        let responseSnapshotRefreshNeeded = lockResult.locked > 0;
        if (!responseSnapshotRefreshNeeded) {
          const latestKnownLockMs = partition.locked.reduce((latest, game) => {
            const parsed = Date.parse(String(game.locked_at ?? ""));
            return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
          }, Number.NEGATIVE_INFINITY);
          if (Number.isFinite(latestKnownLockMs)) {
            const snapshotKey = dailyEdgeSnapshotKey({
              sport,
              requestedDate: date,
              allowStale: false,
              copyPreview: false,
            });
            const { data: snapshotMeta, error: snapshotMetaError } = await supabase
              .from("lab_response_snapshots")
              .select("generated_at")
              .eq("snapshot_key", snapshotKey)
              .maybeSingle();
            responseSnapshotRefreshNeeded = snapshotMetaError !== null ||
              snapshotMeta === null ||
              Date.parse(String(snapshotMeta.generated_at)) < latestKnownLockMs;
          }
        }
        if (responseSnapshotRefreshNeeded) {
          responseSnapshot = await refreshDailyEdgeResponseSnapshot({
            sport,
            date,
            source: "pregame_sweep_lock",
          });
          if (!responseSnapshot.ok) {
            lockResult.errors.push(`daily-edge lock snapshot publish failed: ${responseSnapshot.error ?? "unknown error"}`);
          }
        }

        const anyErrors =
          lockResult.errors.length > 0 ||
          enteringLockModelResult.errors.length > 0 ||
          lockCoherence.errors.length > 0 ||
          missedLockGames.length > 0 ||
          propsLockSweep.error !== null ||
          (marketIntelligenceV2?.errors.length ?? 0) > 0;
        return {
          records_updated: records,
          api_calls_made: apiCalls,
          partial: anyErrors,
          error_message: anyErrors
            ? [
                ...enteringLockModelResult.errors,
                ...lockCoherence.errors,
                ...lockResult.errors,
                ...(missedLockGames.length > 0
                  ? [`${missedLockGames.length} game(s) started without a lock`]
                  : []),
                ...(propsLockSweep.error ? [`MLB props lock sweep: ${propsLockSweep.error}`] : []),
                ...(marketIntelligenceV2?.errors ?? []),
              ].slice(0, 5).join(" | ").slice(0, 1500)
            : null,
          details: {
            dry_run: false,
            pregame_sweep_active: true,
            lock_only: true,
            sport,
            date,
            mlb_props_lock_sweep: propsLockSweep,
            partition: {
              locked: partition.locked.length,
              entering_lock: partition.entering_lock.length,
              still_unlocked: partition.still_unlocked.length,
              already_started: partition.already_started.length,
            },
            entering_lock_model: enteringLockModelResult,
            locks_deferred_after_model_failure: modelDeferredGames.map((game) => game.external_id),
            lock_coherence: lockCoherence,
            locks_applied: lockResult.locked,
            audit_rows_written: lockResult.audit_written,
            lock_errors: lockResult.errors,
            missed_lock_game_ids: missedLockGames,
            response_snapshot: responseSnapshot,
            market_intelligence_v2: marketIntelligenceV2,
            pre_lock_market_refresh: {
              lines_records_updated: preLockGameLines?.records_updated ?? 0,
              lines_api_calls_made: preLockGameLines?.api_calls_made ?? 0,
              sharp_signal_records_updated: preLockSignals?.records_updated ?? 0,
              sharp_signal_api_calls_made: preLockSignals?.api_calls_made ?? 0,
              ran_before_t60_model: preLockGameLines !== null || preLockSignals !== null,
            },
            errors_count:
              lockResult.errors.length +
              enteringLockModelResult.errors.length +
              lockCoherence.errors.length +
              (marketIntelligenceV2?.errors.length ?? 0),
            steps_skipped: [
              "lines_refresh",
              "sharp_signals_refresh",
              "stale_snapshot_detection",
              "market_signals_derivation",
              "grade_derivation",
            ],
          },
        };
      }

      if (sport === "mlb" && marketIntelligenceV2 === null) {
        marketIntelligenceV2 = await runScheduledMarketIntelligenceV2Collection({
          supabase,
          sport,
          slateDate: date,
          phase: "pregame_sweep",
        });
        records += marketIntelligenceV2.recordsUpdated;
        apiCalls += marketIntelligenceV2.apiCallsMade;
      }

      // ── WNBA: lock-only ─────────────────────────────────────────────
      // applyLocks above already set locked_at on game_predictions AND
      // propagated to prediction_records (ML/O-U/Spread) for entering-T-60
      // WNBA games. WNBA's games/lines/model are owned by wnba-daily-refresh,
      // so STOP here — skip the MLB-specific lines / sharp-signals /
      // market-signal / grade steps below. Locked rows are never overwritten
      // by the hourly refresh (runWnbaModel + buildWnbaPredictionRecords both
      // skip locked_at != null).
      if (sport === "wnba") {
        return {
          records_updated: records,
          api_calls_made: apiCalls,
          partial: false,
          details: {
            sport,
            date,
            lock_only: true,
            entering_lock: partition.entering_lock.length,
            locked: lockResult.locked,
            market_intelligence_v2: marketIntelligenceV2,
          },
        };
      }

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
      const gameLines = preLockGameLines ?? await linesService.refreshGameLinesV2(sport, date);
      if (preLockGameLines === null) {
        records += gameLines.records_updated ?? 0;
        apiCalls += gameLines.api_calls_made ?? 0;
      }

      const signals = preLockSignals ?? await linesService.refreshSharpSignals(sport, date);
      if (preLockSignals === null) {
        records += signals.records_updated ?? 0;
        apiCalls += signals.api_calls_made ?? 0;
      }

      // ── 4.5. P7-Commit-B Phase 2 — stale-snapshot trigger ─────────────
      //
      // For still_unlocked games (pre-T-60, MLB-only in V1) compare each
      // prediction_records snapshot against the freshly refreshed
      // sharp_signals. When the snapshot is materially stale —
      // public-money conflict gate flipped, money/bets pct delta >=
      // MATERIAL_PCT_DELTA, steam/RLM flipped, signal availability
      // changed — queue the game for an automodel re-run. The re-run
      // produces a new coherent snapshot (signal_rows_at_lock +
      // lines_at_lock + play_grade + best_angle + confidence + copy)
      // so the Daily Edge route renders one consistent recommendation
      // moment.
      //
      // Locked rows are skipped by construction: this only iterates
      // partition.still_unlocked. The automodel respectLocks default
      // adds belt-and-suspenders protection.
      //
      // Sport scope: MLB only in V1, matching the entering_lock pass
      // above. NBA / NHL gain this when their automodel pipelines
      // come online with the same lifecycle.
      const staleTrigger: {
        considered: number;
        stale: number;
        refreshed: number;
        errors: string[];
      } = { considered: 0, stale: 0, refreshed: 0, errors: [] };
      if (sport === "mlb" && partition.still_unlocked.length > 0) {
        const stillUnlockedExternalIds = partition.still_unlocked.map(
          (g) => g.external_id,
        );
        // Lookup game_id by external_id.
        const { data: gameLookup } = await supabase
          .from("games")
          .select("id, external_id")
          .eq("sport", "mlb")
          .in("external_id", stillUnlockedExternalIds);
        const extToGameId = new Map<number, number>();
        for (const g of (gameLookup ?? []) as Array<{ id: number; external_id: number }>) {
          extToGameId.set(g.external_id, g.id);
        }
        const stillUnlockedGameIds = Array.from(extToGameId.values());

        if (stillUnlockedGameIds.length > 0) {
          // Pull prediction_records (snapshot_json) + game_predictions
          // (picked sides). Both keyed by game_id.
          const { data: predRecs } = await supabase
            .from("prediction_records")
            .select("game_id, market, snapshot_json")
            .eq("sport", "mlb")
            .eq("slate_date", date)
            .in("game_id", stillUnlockedGameIds)
            .in("market", ["moneyline", "total"])
            .is("locked_at", null);
          const snapshotByGame = new Map<number, Record<string, unknown>>();
          for (const r of (predRecs ?? []) as Array<{ game_id: number; market: string; snapshot_json: Record<string, unknown> | null }>) {
            if (r.snapshot_json && !snapshotByGame.has(r.game_id)) {
              snapshotByGame.set(r.game_id, r.snapshot_json);
            }
          }

          const { data: gpRows } = await supabase
            .from("game_predictions")
            .select("game_id, predicted_ml_winner, predicted_ou_side")
            .in("game_id", stillUnlockedGameIds);
          const picksByGame = new Map<number, { ml: string | null; total: string | null }>();
          for (const r of (gpRows ?? []) as Array<{ game_id: number; predicted_ml_winner: string | null; predicted_ou_side: string | null }>) {
            picksByGame.set(r.game_id, {
              ml: r.predicted_ml_winner,
              total: r.predicted_ou_side,
            });
          }

          const { data: liveSigs } = await supabase
            .from("sharp_signals")
            .select("game_id, market_type, side, public_money_pct, public_betting_pct, has_steam_move, has_reverse_line_movement")
            .in("game_id", stillUnlockedGameIds)
            .in("market_type", ["moneyline", "total"]);
          const liveByGame = new Map<number, Array<{ market_type: string; side: string | null; public_money_pct: number | null; public_betting_pct: number | null; has_steam_move: boolean | null; has_reverse_line_movement: boolean | null }>>();
          for (const r of (liveSigs ?? []) as Array<{ game_id: number; market_type: string; side: string | null; public_money_pct: number | null; public_betting_pct: number | null; has_steam_move: boolean | null; has_reverse_line_movement: boolean | null }>) {
            const arr = liveByGame.get(r.game_id) ?? [];
            arr.push({
              market_type: r.market_type,
              side: r.side,
              public_money_pct: r.public_money_pct,
              public_betting_pct: r.public_betting_pct,
              has_steam_move: r.has_steam_move,
              has_reverse_line_movement: r.has_reverse_line_movement,
            });
            liveByGame.set(r.game_id, arr);
          }

          const staleExternalIds: number[] = [];
          for (const [extId, gameId] of extToGameId) {
            staleTrigger.considered++;
            const snap = snapshotByGame.get(gameId);
            const live = liveByGame.get(gameId) ?? [];
            const picks = picksByGame.get(gameId);
            if (!snap || !picks) continue;
            const snapshotSignals = Array.isArray(
              (snap as { signal_rows_at_lock?: unknown }).signal_rows_at_lock,
            )
              ? ((snap as { signal_rows_at_lock?: unknown[] }).signal_rows_at_lock as Array<{
                  market_type: string;
                  side: string | null;
                  public_money_pct: number | null;
                  public_betting_pct: number | null;
                  has_steam_move: boolean | null;
                  has_reverse_line_movement: boolean | null;
                }>)
              : [];
            const result = detectSnapshotStaleness({
              snapshotSignals,
              liveSignals: live,
              pickedMl: picks.ml,
              pickedTotal: picks.total,
            });
            if (result.stale) {
              staleTrigger.stale++;
              staleExternalIds.push(extId);
            }
          }

          if (staleExternalIds.length > 0) {
            try {
              const refreshResult = await generatePredictionsForSlate(
                sport,
                date,
                "morning_draft",
                {
                  writeToDb: true,
                  gameExternalIdsFilter: staleExternalIds,
                  respectLocks: true,
                },
              );
              staleTrigger.refreshed =
                (refreshResult.db_writes?.ingest.inserted ?? 0) +
                (refreshResult.db_writes?.ingest.updated ?? 0);
              records += staleTrigger.refreshed;
              for (const e of refreshResult.errors) {
                staleTrigger.errors.push(`ext=${e.game_external_id}: ${e.error}`);
              }
            } catch (e) {
              staleTrigger.errors.push(e instanceof Error ? e.message : String(e));
            }
          }
        }
      }

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

      // Keep the member-facing writer and fast reader snapshot in the same
      // leased transaction sequence as the refreshed prices/predictions.
      // Locked rows remain immutable inside createPredictionRecords; only
      // still-unlocked records are replaced with the coherent current tuple.
      let memberRecordSync: {
        proposed: number;
        written: number;
        skipped_existing: number;
        errors: unknown[];
      } | null = null;
      let responseSnapshot:
        | Awaited<ReturnType<typeof refreshDailyEdgeResponseSnapshot>>
        | null = null;
      const memberPublishErrors: string[] = [];
      if (sport === "mlb") {
        try {
          const sync = await createPredictionRecords({
            sport: "mlb",
            slateDate: date,
            launchDay: false,
            apply: true,
            supabase,
          });
          records += sync.insertedCount;
          memberRecordSync = {
            proposed: sync.proposed.length,
            written: sync.insertedCount,
            skipped_existing: sync.skippedExisting,
            errors: sync.errors,
          };
          if (sync.errors.length > 0) {
            memberPublishErrors.push(
              `prediction-record sync failed: ${JSON.stringify(sync.errors).slice(0, 800)}`,
            );
          } else {
            responseSnapshot = await refreshDailyEdgeResponseSnapshot({
              sport,
              date,
              source: "pregame_sweep_refresh",
            });
            if (!responseSnapshot.ok) {
              memberPublishErrors.push(
                `daily-edge snapshot publish failed: ${responseSnapshot.error ?? "unknown error"}`,
              );
            }
          }
        } catch (error) {
          memberPublishErrors.push(
            `member publish threw: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // R-19 Phase 5a — partial flag fires when any per-game lock errored
      // OR any t60 model pass errored. The cron-handler wrapper consults
      // this to mark the refresh_log row as 'partial' instead of 'success'.
      const anyErrors =
        lockResult.errors.length > 0 ||
        enteringLockModelResult.errors.length > 0 ||
        lockCoherence.errors.length > 0 ||
        staleTrigger.errors.length > 0 ||
        memberPublishErrors.length > 0 ||
        propsLockSweep.error !== null ||
        (marketIntelligenceV2?.errors.length ?? 0) > 0;

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        partial: anyErrors,
        error_message: anyErrors
          ? [
              ...enteringLockModelResult.errors,
              ...lockCoherence.errors,
              ...lockResult.errors,
              ...staleTrigger.errors,
              ...memberPublishErrors,
              ...(propsLockSweep.error ? [`MLB props lock sweep: ${propsLockSweep.error}`] : []),
              ...(marketIntelligenceV2?.errors ?? []),
            ].slice(0, 5).join(" | ").slice(0, 1500)
          : null,
        details: {
          dry_run: false,
          pregame_sweep_active: true,
          sport,
          date,
          mlb_props_lock_sweep: propsLockSweep,
          partition: {
            locked: partition.locked.length,
            entering_lock: partition.entering_lock.length,
            still_unlocked: partition.still_unlocked.length,
            already_started: partition.already_started.length,
          },
          entering_lock_model: enteringLockModelResult,
          locks_deferred_after_model_failure: modelDeferredGames.map((game) => game.external_id),
          lock_coherence: lockCoherence,
          locks_applied: lockResult.locked,
          audit_rows_written: lockResult.audit_written,
          lock_errors: lockResult.errors,
          market_intelligence_v2: marketIntelligenceV2,
          errors_count:
            lockResult.errors.length +
            enteringLockModelResult.errors.length +
            lockCoherence.errors.length +
            (marketIntelligenceV2?.errors.length ?? 0),
          game_lines: gameLines.records_updated,
          sharp_signals: signals.records_updated,
          stale_snapshot_trigger: staleTrigger,
          member_record_sync: memberRecordSync,
          response_snapshot: responseSnapshot,
          market_signals: marketTouched,
          market_signals_perMarket: marketSignals.perMarket,
          grades: gradeTouched,
          grades_perMarket: grades.perMarket,
          best_signal_pct: grades.monitor.bestSignalPct.toFixed(1),
          best_signal_picks: grades.monitor.bestSignalPicks,
          total_derived_picks: grades.monitor.totalDerivedPicks,
        },
      };
    },
    {
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 6,
      // Lock sweeps are latency-sensitive. Wait briefly when another
      // prediction writer owns the shared lease, then rely on the next
      // minute sweep if contention lasts longer. This preserves the single
      // authoritative prediction_pipeline lease without leaving games open
      // for an entire five-minute interval.
      leaseRetryMaxWaitMs: !dryRun && gateActive ? 20_000 : undefined,
      leaseRetryIntervalMs: 1_000,
      // Suppress only near-simultaneous duplicate invocations; never suppress
      // the next intended minute-level lock check.
      minIntervalMinutes: !dryRun && gateActive ? 0.75 : undefined,
    }
  );
}

export const POST = GET;
