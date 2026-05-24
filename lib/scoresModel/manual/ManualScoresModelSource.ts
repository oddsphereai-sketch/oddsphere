/**
 * Manual scores-model source — reads game_predictions rows that Daniel
 * uploaded via the admin UI (or, equivalently, that the manual ingester
 * wrote with prediction_source='manual_daniel').
 *
 * V1 is the only implementation. The IScoresModelSource interface lets us
 * swap in an AutoScoresModelSource per-sport later (Phase 10+) without
 * touching any consumers.
 *
 * Reads happen via a games JOIN filtered by sport + slate_date (Phase 5E.1).
 * slate_date is the local-evening date in the sport's anchor timezone, so
 * Pacific evening games + the Saturday/Sunday seam map cleanly without the
 * UTC-window hack that earlier versions used.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IScoresModelSource,
  ScoresModelMetadata,
  ScoresModelPrediction,
} from "../interfaces/IScoresModelSource";
import type { Sport } from "../../types/domain/Sport";
import type { PredictionSource } from "../../types/domain/Prediction";

export class ManualScoresModelSource implements IScoresModelSource {
  readonly sport: Sport;
  readonly isAutomated = false as const;
  readonly metadata: ScoresModelMetadata;

  constructor(
    sport: Sport,
    private readonly client: SupabaseClient,
    /** prediction_source value to match on read. Defaults to 'manual_daniel'. */
    private readonly source: PredictionSource = "manual_daniel"
  ) {
    this.sport = sport;
    this.metadata = {
      name: `Manual upload (${sport.toUpperCase()})`,
      source: this.source,
      isAutomated: false,
    };
  }

  async getPredictionsForDate(date: string): Promise<ScoresModelPrediction[]> {
    // Filter on the games side via FK: sport + slate_date. The .eq() on a
    // joined-table column needs the `<alias>.<column>` syntax; Supabase
    // supports this for embedded relations.
    const { data, error } = await this.client
      .from("game_predictions")
      .select(
        "predicted_home_score, predicted_away_score, predicted_total, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, sport_specific, prediction_source, is_override, original_auto_prediction, model_version, computed_at, games!inner ( external_id, sport, game_date, slate_date )"
      )
      .eq("prediction_source", this.source)
      .eq("games.sport", this.sport)
      .eq("games.slate_date", date);
    if (error) throw new Error(`ManualScoresModelSource read failed: ${error.message}`);

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

    return rows
      .map((r) => ({
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

  async getLastUpdated(date: string): Promise<Date | null> {
    const { data, error } = await this.client
      .from("scores_model_runs")
      .select("completed_at")
      .eq("sport", this.sport)
      .eq("source", this.source)
      .eq("run_date", date)
      .maybeSingle();
    if (error) {
      // PGRST116 = no row matched, which is fine
      if (error.code === "PGRST116") return null;
      throw new Error(`ManualScoresModelSource getLastUpdated failed: ${error.message}`);
    }
    if (!data?.completed_at) return null;
    return new Date(data.completed_at);
  }
}

// (Phase 5E.1: slateDateForGameTime removed. Filtering now uses
// games.slate_date directly. See lib/dates/slateDate.ts for the canonical
// TS computation.)
