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
  for (const g of games) {
    const { error: updErr } = await supabase
      .from("game_predictions")
      .update({ locked_at: lockedAt })
      .eq("game_id", g.game_id);
    if (updErr) {
      errors.push(`game_id=${g.game_id}: locked_at UPDATE failed: ${updErr.message}`);
      continue;
    }
    lockedCount++;

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
  return cronHandlerPerSport(
    request,
    "pregame_sweep",
    sportsInSeasonToday(),
    async ({ sport }) => {
      let records = 0;
      let apiCalls = 0;

      // ── 1. Read slate + partition by lock state ─────────────────────
      const candidates = await loadSlateCandidates(sport, date);
      const now = new Date();
      const partition = partitionByLockState(candidates, now);

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
      // V1 limitation: linesService is slate-scoped, so it refreshes
      // lines/signals for all games including already-locked ones. The
      // refresh is cheap and the locked games' prediction values are
      // frozen at Layer 1 anyway. Phase 4.2.B follow-up will scope these
      // to unlocked games only.
      const gameLines = await linesService.refreshGameLines(sport, date);
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

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: {
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
