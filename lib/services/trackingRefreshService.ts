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
import { createNbaPredictionRecords } from "./nba/buildNbaPredictionRecords";
import { ingestNbaFinalScores } from "./nba/nbaScoreIngestService";
// Phase 7L Step 5 — NHL sport loop branch. Only fires when caller
// explicitly passes sport="nhl"; the cron route's
// cronHandlerPerSport(["mlb", "nba"]) keeps NHL out of automated
// firing. Member-facing NHL launch is gated separately via SportRail.
import { writeNhlPredictionRecords } from "./nhl/buildNhlPredictionRecords";
import { ingestNhlFinalScores } from "./nhl/nhlScoreIngestService";
import { ingestSoccerFinalScores } from "./soccer/soccerScoreIngestService";
import { ingestEplFinalScores } from "./epl/eplScoreIngestService";
import { ingestUclFinalScores } from "./ucl/uclScoreIngestService";
import { resolveUclFeatureFlags, resolveUclSettlementGradingPlan } from "./ucl/uclFeatureFlags";
import { buildWnbaPredictionRecords } from "./wnba/buildWnbaPredictionRecords";
import { ingestWnbaFinalScores } from "./wnba/ingestWnbaFinalScores";
import { ingestNflFinalScores } from "./football/nflScoreIngestService";
import { ingestCfbFinalScores } from "./football/cfbScoreIngestService";
import { moneyPuckSeasonStartYear } from "../providers/nhl/_moneyPuckClient";

export type TrackingRefreshOptions = {
  /**
   * Date list to refresh. Caller computes (UTC-based) — service is
   * agnostic to the slate-date timezone convention.
   */
  dates: ReadonlyArray<string>;
  /** When false → dry-run; no DB writes. */
  apply: boolean;
  supabase: SupabaseClient;
  /**
   * Sport to refresh. Defaults to "mlb" to preserve historical
   * single-sport callers byte-for-byte. The cron route iterates
   * sports via cronHandlerPerSport so each sport gets its own
   * lock + log row; this function still runs one sport per call.
   */
  sport?: Sport;
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
  sport: Sport,
  date: string,
): Promise<number> {
  // MLB uses slate_status="published"; NBA today has no slate_status
  // gate (the existing seed/ingest scripts insert without setting
  // slate_status). Treat the absence as "always check provider" for
  // non-MLB sports — the per-sport refresh helpers (e.g.,
  // ingestNbaFinalScores) are no-ops when the games table is empty.
  if (sport === "mlb") {
    const { count } = await supabase
      .from("games")
      .select("*", { count: "exact", head: true })
      .eq("sport", sport)
      .eq("slate_date", date)
      .eq("slate_status", "published");
    return count ?? 0;
  }
  const { count } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("slate_date", date);
  return count ?? 0;
}

async function loadExistingRecordCounts(
  supabase: SupabaseClient,
  sport: Sport,
  date: string,
): Promise<{ total: number; launchDay: number }> {
  const { count: total } = await supabase
    .from("prediction_records")
    .select("*", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("slate_date", date);
  const { count: launchDay } = await supabase
    .from("prediction_records")
    .select("*", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("slate_date", date)
    .eq("launch_day", true);
  return { total: total ?? 0, launchDay: launchDay ?? 0 };
}

/**
 * Orchestrate one refresh pass across the supplied dates for ONE sport.
 *
 * The MLB branch (sport === "mlb", which is the historical default)
 * runs the identical sequence it did before:
 *   1. createPredictionRecords({sport:"mlb"})
 *   2. ingestMlbLinescores({date})            ← MLB-only step
 *   3. ingestFinalScores({sport:"mlb"})       ← BDL provider
 *   4. gradePredictionsForSlate({sport:"mlb"})
 *
 * The NBA branch (sport === "nba") runs a sport-appropriate sequence:
 *   1. createNbaPredictionRecords({date})     ← NBA pipeline writer
 *   2. ingestNbaFinalScores({date})           ← ESPN scoreboard provider
 *   3. gradePredictionsForSlate({sport:"nba"})← shared sport-generic
 *
 * The WNBA branch (sport === "wnba") mirrors the NBA/NHL shape:
 *   1. buildWnbaPredictionRecords()            ← WNBA pipeline writer
 *   2. ingestWnbaFinalScores()                 ← BDL WNBA provider
 *   3. gradePredictionsForSlate({sport:"wnba"})← shared sport-generic
 *
 * No MLB code path changes when sport === "nba".
 */
export async function runTrackingRefresh(
  opts: TrackingRefreshOptions,
): Promise<TrackingRefreshSummary> {
  const sport: Sport = opts.sport ?? "mlb";
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
      const publishedCount = await loadPublishedGameCount(opts.supabase, sport, date);
      if (publishedCount === 0) {
        perDate.errors.push("no published games — skipping date entirely");
        summary.perDate.push(perDate);
        continue;
      }
      summary.datesProcessed++;

      if (sport === "mlb") {
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
        const existing = await loadExistingRecordCounts(opts.supabase, sport, date);
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
      } else if (sport === "nba") {
        // NBA branch — Phase 7H. No linescore step (NBA has no FI/NRFI).
        // Existing records are checked the same way as MLB to honor
        // launch_day preservation, but NBA has no launch_day baselines
        // today, so this is just defensive.
        const existing = await loadExistingRecordCounts(opts.supabase, sport, date);
        perDate.records_existed_before = existing.total;
        if (existing.launchDay > 0) {
          perDate.records_skipped_due_to_launch_day_preservation = true;
        } else {
          try {
            const createRes = await createNbaPredictionRecords({
              slateDate: date,
              launchDay: false,
              apply: opts.apply,
              supabase: opts.supabase,
            });
            perDate.records_created = createRes.insertedCount;
            for (const e of createRes.errors) {
              perDate.errors.push(`nba-records: game_id=${e.game_id ?? "?"} ${e.market} ${e.reason}`);
            }
          } catch (e) {
            perDate.errors.push(`nba-records exception: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // No linescore step for NBA — there is no FI market to grade
        // and the full-game score is captured by ingestNbaFinalScores.

        // Final scores — ESPN scoreboard.
        try {
          const fsRes = await ingestNbaFinalScores({
            slateDate: date,
            apply: opts.apply,
            supabase: opts.supabase,
          });
          perDate.final_scores_updated = fsRes.updatedCount;
          perDate.final_scores_in_progress = fsRes.inProgressCount;
          perDate.final_scores_scheduled = fsRes.scheduledCount;
          for (const e of fsRes.errors) {
            perDate.errors.push(`nba-final-scores: ${e.reason}`);
          }
        } catch (e) {
          perDate.errors.push(`nba-final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (sport === "nhl") {
        // Phase 7L Step 5 — NHL sport branch. Mirrors NBA's shape:
        // write prediction_records + ingest final scores. The shared
        // grader (gradePredictionsForSlate) handles grading via the
        // extended predictionGrader.isFinalStatus that recognizes
        // NHL's "FINAL"/"OFF" terminal statuses.
        //
        // Lock semantics: writeNhlPredictionRecords skips rows where
        // locked_at IS NOT NULL, so re-runs during the day mutate
        // pre-lock rows but freeze post-lock ones (matching MLB/NBA
        // contract).
        const existing = await loadExistingRecordCounts(opts.supabase, sport, date);
        perDate.records_existed_before = existing.total;
        if (existing.launchDay > 0) {
          perDate.records_skipped_due_to_launch_day_preservation = true;
        } else {
          try {
            const season = moneyPuckSeasonStartYear(new Date());
            const createRes = await writeNhlPredictionRecords({
              slateDate: date,
              season,
              apply: opts.apply,
            });
            perDate.records_created = createRes.recordsCreated;
            for (const e of createRes.errors) {
              perDate.errors.push(`nhl-records: ${e}`);
            }
          } catch (e) {
            perDate.errors.push(`nhl-records exception: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // No linescore step for NHL — there is no FI/period market to
        // grade and the full-game score is captured by ingestNhlFinalScores.

        // Final scores — NHL public API.
        try {
          const fsRes = await ingestNhlFinalScores({
            slateDate: date,
            apply: opts.apply,
          });
          perDate.final_scores_updated = fsRes.updated;
          // NHL service exposes a single counter; in_progress/scheduled
          // are derived from API events not yet final. Map cleanly:
          perDate.final_scores_in_progress = 0;
          perDate.final_scores_scheduled = Math.max(0, fsRes.apiEventsFetched - fsRes.finalizedCount);
          for (const e of fsRes.errors) {
            perDate.errors.push(`nhl-final-scores: ${e}`);
          }
        } catch (e) {
          perDate.errors.push(`nhl-final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (sport === "nfl") {
        // NFL prediction_records are created only by the leased forward writer
        // from immutable, on-time regular-season T-60 tuples. This cycle never
        // reconstructs or changes them; it only ingests exact-id final scores
        // and lets the shared grader settle the frozen rows.
        const existing = await loadExistingRecordCounts(opts.supabase, sport, date);
        perDate.records_existed_before = existing.total;
        try {
          const fsRes = await ingestNflFinalScores({
            supabase: opts.supabase,
            slateDate: date,
            apply: opts.apply,
          });
          perDate.final_scores_updated = fsRes.updatedCount;
          perDate.final_scores_in_progress = fsRes.inProgressCount;
          perDate.final_scores_scheduled = fsRes.scheduledCount;
          for (const e of fsRes.errors) perDate.errors.push(`nfl-final-scores: ${e.reason}`);
        } catch (e) {
          perDate.errors.push(`nfl-final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (sport === "cfb") {
        // CFB prediction_records are owned only by the leased forward writer's
        // immutable T-60 tuple. The shared tracking cycle performs a bounded
        // exact-provider-id final read and settles those frozen rows.
        const existing = await loadExistingRecordCounts(opts.supabase, sport, date);
        perDate.records_existed_before = existing.total;
        try {
          const fsRes = await ingestCfbFinalScores({
            supabase: opts.supabase,
            slateDate: date,
            apply: opts.apply,
          });
          perDate.final_scores_updated = fsRes.updatedCount;
          perDate.final_scores_in_progress = fsRes.inProgressCount;
          perDate.final_scores_scheduled = fsRes.scheduledCount;
          for (const e of fsRes.errors) perDate.errors.push(`cfb-final-scores: ${e.reason}`);
        } catch (e) {
          perDate.errors.push(`cfb-final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (sport === "soccer") {
        // Soccer records are written by their competition refresh, not here.
        // With EPL enabled, finalize only the EPL external-id namespace; the
        // shared soccer-native grader then resolves Match Result, Double
        // Chance, Total, and BTTS from the 90-minute score. No record write
        // and no locked-snapshot mutation occurs in this branch.
        try {
          const fsRes = process.env.EPL_PIPELINE_ENABLED === "true"
            ? await ingestEplFinalScores({ slateDate: date, apply: opts.apply })
            : await ingestSoccerFinalScores({ slateDate: date, apply: opts.apply });
          perDate.final_scores_updated = fsRes.updated;
          perDate.final_scores_in_progress = 0;
          perDate.final_scores_scheduled = Math.max(0, fsRes.apiEventsFetched - fsRes.finalizedCount);
          for (const e of fsRes.errors) {
            perDate.errors.push(`soccer-final-scores: ${e}`);
          }
        } catch (e) {
          perDate.errors.push(`soccer-final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
        }
        // UCL is an additive exact namespace. Do not widen or replace the
        // established World Cup/EPL settlement branch above.
        if ((await import("./ucl/uclFeatureFlags")).resolveUclFeatureFlags().settlement) {
          try {
            const ucl = await ingestUclFinalScores({ slateDate: date, apply: opts.apply });
            perDate.final_scores_updated += ucl.updated;
            perDate.final_scores_scheduled += Math.max(0, ucl.apiEventsFetched - ucl.finalizedCount);
            for (const error of ucl.errors) perDate.errors.push(`ucl-final-scores: ${error}`);
            if (ucl.heldSpecialFinals > 0) perDate.errors.push(`ucl-final-scores: ${ucl.heldSpecialFinals} special finals held pending regulation-period scores`);
          } catch (e) {
            perDate.errors.push(`ucl-final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } else if (sport === "wnba") {
        // WNBA launch tracking (2026-06-24). The WNBA daily refresh already
        // writes records after running the model; this branch makes tracking-
        // refresh idempotently catch up records, ingest finals, and grade.
        // buildWnbaPredictionRecords preserves locked rows.
        const existing = await loadExistingRecordCounts(opts.supabase, sport, date);
        perDate.records_existed_before = existing.total;
        if (existing.launchDay > 0) {
          perDate.records_skipped_due_to_launch_day_preservation = true;
        } else {
          try {
            const createRes = await buildWnbaPredictionRecords({
              supabase: opts.supabase,
              apply: opts.apply,
              slateDate: date,
              windowDays: 0,
              logger: () => {},
            });
            perDate.records_created = createRes.written;
            for (const e of createRes.errors) {
              perDate.errors.push(`wnba-records: ${e}`);
            }
          } catch (e) {
            perDate.errors.push(`wnba-records exception: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        try {
          const fsRes = await ingestWnbaFinalScores({
            supabase: opts.supabase,
            apply: opts.apply,
          });
          perDate.final_scores_updated = fsRes.updated;
          perDate.final_scores_in_progress = 0;
          perDate.final_scores_scheduled = Math.max(0, fsRes.finalsFound - fsRes.matched);
          for (const e of fsRes.errors) {
            perDate.errors.push(`wnba-final-scores: ${e}`);
          }
        } catch (e) {
          perDate.errors.push(`wnba-final-scores exception: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 4. Grade predictions (shared sport-generic grader)
      try {
        const uclGrading = resolveUclSettlementGradingPlan(sport, resolveUclFeatureFlags().settlement);
        const gradeRes = await gradePredictionsForSlate({
          sport,
          slateDate: date,
          apply: opts.apply,
          supabase: opts.supabase,
          source: "auto_score_ingest",
          // UCL is always excluded from the generic soccer pass. Its exact
          // pass below is the sole grading authority and is master-gated.
          excludeCompetition: uclGrading.excludeFromGeneric,
        });
        perDate.grades_upserted = gradeRes.upsertedCount;
        perDate.grades_skipped_pending_downgrade = gradeRes.skippedPendingDowngrade;
        perDate.grades_pending_after = gradeRes.computed.pending;
        for (const e of gradeRes.errors) {
          perDate.errors.push(`grade: ${e.reason}`);
        }
        if (uclGrading.runExactUclPass) {
          const uclGrade = await gradePredictionsForSlate({
            sport,
            slateDate: date,
            apply: opts.apply,
            supabase: opts.supabase,
            source: "auto_score_ingest",
            competition: "uefa_champions_league",
          });
          perDate.grades_upserted += uclGrade.upsertedCount;
          perDate.grades_skipped_pending_downgrade += uclGrade.skippedPendingDowngrade;
          perDate.grades_pending_after += uclGrade.computed.pending;
          for (const e of uclGrade.errors) perDate.errors.push(`ucl-grade: ${e.reason}`);
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
