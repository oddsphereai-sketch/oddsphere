/**
 * Push 4c — Tracking refresh service.
 *
 * One coherent flow that the /api/cron/tracking-refresh route invokes
 * on a schedule. Composes the four Push 4 / 4b services in the right
 * order, per slate date:
 *
 *   1. createPredictionRecords   — for published slates without records
 *   2. ingestMlbLinescores       — first-inning splits from MLB Stats API
 *   3. ingestFinalScores         — BDL final scores into games.status/scores
 *   4. gradePredictionsForSlate  — grader output into prediction_grades
 *
 * Date strategy: yesterday + today + tomorrow (ET → UTC slate dates).
 *   - yesterday: catches late finishes (West Coast games ending after
 *     midnight UTC) and any missed grading from the previous run
 *   - today: the active slate
 *   - tomorrow: prepares prediction_records for a freshly-published
 *     morning slate so member tracking has rows to read as soon as
 *     games begin
 *
 * Safety guarantees:
 *   - Never writes to game_predictions
 *   - Never writes to slate_status
 *   - Never writes to locked_at
 *   - All four sub-services already enforce their own safety rules
 *
 * Launch-day handling:
 *   - For 2026-06-06 (or any date with launch_day=true records already
 *     present), the cron skips create — it never flips existing
 *     launch_day=true rows to launch_day=false. Future slates created
 *     by the cron always get launch_day=false.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../types/domain/Sport";
import { createPredictionRecords } from "./predictionRecordService";
import { ingestMlbLinescores } from "./mlbLinescoreIngestService";
import { ingestFinalScores } from "./scoreIngestService";
import { gradePredictionsForSlate } from "./predictionGradingService";

export type TrackingRefreshOptions = {
  /**
   * Date list to refresh. Caller computes (UTC-based) — service is
   * agnostic to the slate-date timezone convention.
   */
  dates: ReadonlyArray<string>;
  /** When false → dry-run; no DB writes. */
  apply: boolean;
  supabase: SupabaseClient;
};

export type TrackingRefreshPerDate = {
  date: string;
  records_existed_before: number;
  records_created: number;
  records_skipped_due_to_launch_day_preservation: boolean;
  linescores_updated: number;
  linescores_pending: number;
  final_scores_updated: number;
  final_scores_in_progress: number;
  final_scores_scheduled: number;
  grades_upserted: number;
  grades_skipped_pending_downgrade: number;
  grades_pending_after: number;
  errors: string[];
};

export type TrackingRefreshSummary = {
  apply: boolean;
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  datesProcessed: number;
  perDate: TrackingRefreshPerDate[];
  totals: {
    records_created: number;
    linescores_updated: number;
    final_scores_updated: number;
    grades_upserted: number;
    errors: number;
  };
  globalErrors: string[];
};

const SPORT: Sport = "mlb"; // V1 cron only refreshes MLB

/**
 * Pure helper used by the cron route AND tests. Given a "now" Date,
 * produce the date strings the cron should refresh. Defaults to
 * yesterday/today/tomorrow in UTC (matches how slate_date is stored).
 */
export function computeRefreshDates(
  now: Date,
  opts: { lookbackDays?: number; lookaheadDays?: number } = {},
): string[] {
  const lookback = opts.lookbackDays ?? 1;
  const lookahead = opts.lookaheadDays ?? 1;
  const out: string[] = [];
  for (let d = -lookback; d <= lookahead; d++) {
    const dt = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const day = String(dt.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

async function loadPublishedGameCount(
  supabase: SupabaseClient,
  date: string,
): Promise<number> {
  const { count } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("sport", SPORT)
    .eq("slate_date", date)
    .eq("slate_status", "published");
  return count ?? 0;
}

async function loadExistingRecordCounts(
  supabase: SupabaseClient,
  date: string,
): Promise<{ total: number; launchDay: number }> {
  const { count: total } = await supabase
    .from("prediction_records")
    .select("*", { count: "exact", head: true })
    .eq("sport", SPORT)
    .eq("slate_date", date);
  const { count: launchDay } = await supabase
    .from("prediction_records")
    .select("*", { count: "exact", head: true })
    .eq("sport", SPORT)
    .eq("slate_date", date)
    .eq("launch_day", true);
  return { total: total ?? 0, launchDay: launchDay ?? 0 };
}

/**
 * Orchestrate one refresh pass across the supplied dates.
 */
export async function runTrackingRefresh(
  opts: TrackingRefreshOptions,
): Promise<TrackingRefreshSummary> {
  const startedAtIso = new Date().toISOString();
  const t0 = Date.now();
  const summary: TrackingRefreshSummary = {
    apply: opts.apply,
    startedAtIso,
    finishedAtIso: "",
    durationMs: 0,
    datesProcessed: 0,
    perDate: [],
    totals: {
      records_created: 0,
      linescores_updated: 0,
      final_scores_updated: 0,
      grades_upserted: 0,
      errors: 0,
    },
    globalErrors: [],
  };

  for (const date of opts.dates) {
    const perDate: TrackingRefreshPerDate = {
      date,
      records_existed_before: 0,
      records_created: 0,
      records_skipped_due_to_launch_day_preservation: false,
      linescores_updated: 0,
      linescores_pending: 0,
      final_scores_updated: 0,
      final_scores_in_progress: 0,
      final_scores_scheduled: 0,
      grades_upserted: 0,
      grades_skipped_pending_downgrade: 0,
      grades_pending_after: 0,
      errors: [],
    };

    try {
      // Skip whole date if no published slate
      const publishedCount = await loadPublishedGameCount(opts.supabase, date);
      if (publishedCount === 0) {
        perDate.errors.push("no published games — skipping date entirely");
        summary.perDate.push(perDate);
        continue;
      }
      summary.datesProcessed++;

      // 1. Prediction records — always upsert so pending unlocked
      //    rows track the latest game_predictions. Phase 6B.12: the
      //    pre-launch behavior skipped this entirely when records
      //    already existed, which left every intraday cron pass with
      //    stale model_probability / confidence / best_angle / pick.
      //    The upsert in createPredictionRecords is locked-row-aware:
      //    it refuses to overwrite any row with locked_at != null
      //    (pregame-sweep owns the lock transition), so this stays
      //    safe even when some games are locked and others aren't.
      //
      //    The one preserved guard: launch_day=true rows. Those are
      //    pre-launch manual baselines we never want cron-overwritten.
      const existing = await loadExistingRecordCounts(opts.supabase, date);
      perDate.records_existed_before = existing.total;
      if (existing.launchDay > 0) {
        perDate.records_skipped_due_to_launch_day_preservation = true;
      } else {
        const createRes = await createPredictionRecords({
          sport: "mlb",
          slateDate: date,
          launchDay: false, // cron-created records are always fresh-tracking
          apply: opts.apply,
          supabase: opts.supabase,
        });
        perDate.records_created = createRes.insertedCount;
        for (const e of createRes.errors) {
          perDate.errors.push(`records: game_id=${e.game_id} ${e.market} ${e.reason}`);
        }
      }

      // 2. MLB linescores
      try {
        const lsRes = await ingestMlbLinescores({
          date,
          apply: opts.apply,
          supabase: opts.supabase,
        });
        perDate.linescores_updated = lsRes.updatedCount;
        perDate.linescores_pending = lsRes.pendingCount;
        for (const e of lsRes.errors) {
          perDate.errors.push(`linescore: ${e.reason}`);
        }
      } catch (e) {
        perDate.errors.push(`linescore exception: ${e instanceof Error ? e.message : String(e)}`);
      }

      // 3. Final scores
      try {
        const fsRes = await ingestFinalScores({
          sport: "mlb",
          slateDate: date,
          apply: opts.apply,
          supabase: opts.supabase,
        });
        perDate.final_scores_updated = fsRes.updatedCount;
        perDate.final_scores_in_progress = fsRes.inProgressCount;
        perDate.final_scores_scheduled = fsRes.scheduledCount;
        for (const e of fsRes.errors) {
          perDate.errors.push(`final-scores: ${e.reason}`);
        }
      } catch (e) {
        perDate.errors.push(`final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
      }

      // 4. Grade predictions
      try {
        const gradeRes = await gradePredictionsForSlate({
          sport: "mlb",
          slateDate: date,
          apply: opts.apply,
          supabase: opts.supabase,
          source: "auto_score_ingest",
        });
        perDate.grades_upserted = gradeRes.upsertedCount;
        perDate.grades_skipped_pending_downgrade = gradeRes.skippedPendingDowngrade;
        perDate.grades_pending_after = gradeRes.computed.pending;
        for (const e of gradeRes.errors) {
          perDate.errors.push(`grade: ${e.reason}`);
        }
      } catch (e) {
        perDate.errors.push(`grade exception: ${e instanceof Error ? e.message : String(e)}`);
      }
    } catch (e) {
      perDate.errors.push(`fatal: ${e instanceof Error ? e.message : String(e)}`);
    }

    summary.totals.records_created += perDate.records_created;
    summary.totals.linescores_updated += perDate.linescores_updated;
    summary.totals.final_scores_updated += perDate.final_scores_updated;
    summary.totals.grades_upserted += perDate.grades_upserted;
    summary.totals.errors += perDate.errors.length;
    summary.perDate.push(perDate);
  }

  summary.finishedAtIso = new Date().toISOString();
  summary.durationMs = Date.now() - t0;
  return summary;
}
