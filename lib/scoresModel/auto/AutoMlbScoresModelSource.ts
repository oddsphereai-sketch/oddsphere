/**
 * AutoMlbScoresModelSource — IScoresModelSource adapter that lazily generates
 * MLB game predictions via the rule-seeded auto-model when called.
 *
 * Phase 4.2.A — the cleanly architected bridge between the cron's prediction
 * step (predictionService.generateGamePredictions, which only reads/verifies
 * from an IScoresModelSource) and automodelService.generatePredictionsForSlate
 * (the existing operator-script-driven write path).
 *
 * Behavior contract — `getPredictionsForDate(date)`:
 *
 *   1. Probe `scores_model_runs` for a completed prior run on
 *      (sport=mlb, source=auto_v1_mlb_rules, run_date=date).
 *      Completion proxy: successful_count > 0 AND completed_at IS NOT NULL.
 *
 *   2. If a completed run exists → read existing game_predictions rows
 *      filtered by prediction_source='auto_v1_mlb_rules' joined to games
 *      on slate_date. SAME shape as ManualScoresModelSource.
 *      Idempotent: re-running on the same date returns existing rows
 *      without re-invoking the model.
 *
 *   3. If no completed run → invoke
 *      `automodelService.generatePredictionsForSlate("mlb", date,
 *          "morning_draft", { writeToDb: true })`.
 *      automodelService enforces its own AUTOMODEL_DB_WRITES_ENABLED gate
 *      (Phase 3C two-key gate) — this adapter does NOT bypass it.
 *      Errors from automodelService propagate to the caller with adapter
 *      context prefixed for clearer cron logs.
 *
 *   4. After successful generation → read back the freshly-written rows
 *      using the same JOIN query as the existing-run branch. Returns the
 *      shaped ScoresModelPrediction[] expected by the cron.
 *
 * The default stage is `morning_draft` because the cron's
 * `predictionService.generateGamePredictions` lives in the morning-slate
 * pipeline. Phase 4.2.B will add `t60_locked` semantics for per-game
 * lock-time refreshes; that is OUT OF SCOPE here — this adapter only
 * generates the first draft for the day.
 *
 * Manual override semantics are preserved: ingestScoresModel inside
 * automodelService UPSERTs on game_id and respects is_override=true rows
 * (a manual upload that lands after the auto run will OVERWRITE the auto
 * row and snapshot the original — same behavior the manual upload route
 * uses today). This adapter does not change that contract.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IScoresModelSource,
  ScoresModelMetadata,
  ScoresModelPrediction,
} from "../interfaces/IScoresModelSource";
import type { Sport } from "../../types/domain/Sport";
import type { PredictionSource } from "../../types/domain/Prediction";
import { generatePredictionsForSlate } from "../../services/automodelService";

/**
 * Pluggable runner type — used by the test surface so unit tests can stub
 * the heavy automodelService call. Production code never overrides this.
 */
export type AutoModelRunner = (
  sport: Sport,
  date: string
) => Promise<void>;

const AUTO_SOURCE: PredictionSource = "auto_v1_mlb_rules";

export class AutoMlbScoresModelSource implements IScoresModelSource {
  readonly sport: Sport = "mlb";
  readonly isAutomated = true as const;
  readonly metadata: ScoresModelMetadata = {
    name: "Auto v1 (MLB rules)",
    source: AUTO_SOURCE,
    isAutomated: true,
  };

  /**
   * @param client          Supabase client (DI for test isolation).
   * @param runnerOverride  Test-only stub of the generate-predictions runner.
   *                        Production path passes undefined → invokes the
   *                        real automodelService.
   */
  constructor(
    private readonly client: SupabaseClient,
    private readonly runnerOverride?: AutoModelRunner
  ) {}

  async getPredictionsForDate(date: string): Promise<ScoresModelPrediction[]> {
    const hasRun = await this.hasCompletedRun(date);
    if (!hasRun) {
      await this.runAutoModel(date);
    }
    return this.readExistingRows(date);
  }

  async getLastUpdated(date: string): Promise<Date | null> {
    const { data, error } = await this.client
      .from("scores_model_runs")
      .select("completed_at")
      .eq("sport", this.sport)
      .eq("source", AUTO_SOURCE)
      .eq("run_date", date)
      .maybeSingle();
    if (error) {
      // PGRST116 = no rows matched, which is fine.
      if ((error as { code?: string }).code === "PGRST116") return null;
      throw new Error(
        `AutoMlbScoresModelSource.getLastUpdated failed: ${error.message}`
      );
    }
    if (!data?.completed_at) return null;
    return new Date(data.completed_at as string);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Check whether a successful auto-model run for this date is already
   * recorded in scores_model_runs. Used as an idempotency gate so back-
   * to-back calls in the same day don't re-invoke the model.
   *
   * Completion proxy = successful_count > 0 AND completed_at IS NOT NULL.
   * A failed-or-empty prior run intentionally does NOT count as completed,
   * so a re-call after a transient failure will re-attempt the generation.
   */
  private async hasCompletedRun(date: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("scores_model_runs")
      .select("successful_count, completed_at")
      .eq("sport", this.sport)
      .eq("source", AUTO_SOURCE)
      .eq("run_date", date)
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") return false;
      throw new Error(
        `AutoMlbScoresModelSource.hasCompletedRun failed: ${error.message}`
      );
    }
    if (data === null || data === undefined) return false;
    const row = data as { successful_count: number | null; completed_at: string | null };
    return (row.successful_count ?? 0) > 0 && row.completed_at !== null;
  }

  /**
   * Invoke the auto-model with writeToDb=true. Wraps any error with adapter
   * context so the cron's refresh_log surfaces a clear cause. automodelService
   * itself enforces AUTOMODEL_DB_WRITES_ENABLED — this adapter does not.
   */
  private async runAutoModel(date: string): Promise<void> {
    try {
      if (this.runnerOverride !== undefined) {
        await this.runnerOverride(this.sport, date);
        return;
      }
      await generatePredictionsForSlate(
        this.sport,
        date,
        "morning_draft",
        { writeToDb: true }
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `AutoMlbScoresModelSource: auto-model run failed for ${this.sport}/${date}: ${message}`
      );
    }
  }

  /**
   * Read auto-source rows from game_predictions for this date. Mirrors
   * ManualScoresModelSource's JOIN query exactly; only the source filter
   * differs. Keeps the return shape byte-for-byte identical so the cron
   * (and any downstream consumer) cannot tell the difference between
   * manual and auto sources at this surface.
   */
  private async readExistingRows(date: string): Promise<ScoresModelPrediction[]> {
    const { data, error } = await this.client
      .from("game_predictions")
      .select(
        "predicted_home_score, predicted_away_score, predicted_total, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, sport_specific, prediction_source, is_override, original_auto_prediction, model_version, computed_at, games!inner ( external_id, sport, game_date, slate_date )"
      )
      .eq("prediction_source", AUTO_SOURCE)
      .eq("games.sport", this.sport)
      .eq("games.slate_date", date);
    if (error) {
      throw new Error(
        `AutoMlbScoresModelSource.readExistingRows failed: ${error.message}`
      );
    }
    const rows = (data ?? []) as unknown as Array<{
      predicted_home_score: number | null;
      predicted_away_score: number | null;
      predicted_total: number | null;
      predicted_ml_winner: string | null;
      ml_confidence: number | null;
      predicted_ou_side: string | null;
      ou_confidence: number | null;
      predicted_nrfi: boolean | null;
      nrfi_confidence: number | null;
      sport_specific: Record<string, unknown> | null;
      prediction_source: PredictionSource;
      is_override: boolean;
      original_auto_prediction: Record<string, unknown> | null;
      model_version: string;
      computed_at: string;
      games: { external_id: number; sport: Sport; game_date: string; slate_date: string };
    }>;

    return rows.map((r) => ({
      game_external_id: r.games.external_id,
      sport: this.sport,
      predicted_home_score: r.predicted_home_score,
      predicted_away_score: r.predicted_away_score,
      predicted_total: r.predicted_total,
      predicted_ml_winner: r.predicted_ml_winner,
      ml_confidence: r.ml_confidence,
      predicted_ou_side: r.predicted_ou_side,
      ou_confidence: r.ou_confidence,
      predicted_nrfi: r.predicted_nrfi,
      nrfi_confidence: r.nrfi_confidence,
      sport_specific: r.sport_specific,
      prediction_source: r.prediction_source,
      is_override: r.is_override,
      original_auto_prediction: r.original_auto_prediction,
      model_version: r.model_version,
      computed_at: r.computed_at,
    }));
  }
}
