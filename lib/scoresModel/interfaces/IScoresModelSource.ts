/**
 * IScoresModelSource — contract for the scores-model data source per sport.
 *
 * Mirrors the Phase 1 provider abstraction (IPlayerStatsProvider, IOddsProvider, ISharpSignalProvider).
 * Two implementations:
 *   • ManualScoresModelSource (V1)  — reads from game_predictions rows
 *                                       that Daniel uploaded via the admin UI.
 *   • AutoScoresModelSource (Phase 10+) — runs an automated model per sport.
 *
 * Factory routes on USE_AUTO_SCORES_MODEL_<SPORT> env vars. Services in 4D-E
 * depend on this interface, not on either implementation.
 */

import type { Sport } from "../../types/domain/Sport";
import type { PredictionSource } from "../../types/domain/Prediction";

/**
 * Canonical "one game prediction" record returned by getPredictionsForDate.
 *
 * Top-level fields are the sport-agnostic columns on game_predictions.
 * sport_specific holds per-sport extras (MLB NRFI flags, UCL win %s, NBA
 * listed_line, etc.) — see lib/scoresModel/sportSchemas.ts for the
 * canonical per-sport field list.
 */
export type ScoresModelPrediction = {
  game_external_id: number;
  sport: Sport;
  // Sport-agnostic core
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: string | null;       // "home" | "away" | "draw" (UCL)
  ml_confidence: number | null;             // 0-100
  predicted_ou_side: string | null;          // "over" | "under"
  ou_confidence: number | null;
  // MLB-specific (mirrored from sport_specific for back-compat)
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  // Per-sport extras
  sport_specific: Record<string, unknown> | null;
  // Audit
  prediction_source: PredictionSource;
  is_override: boolean;
  original_auto_prediction: Record<string, unknown> | null;
  model_version: string;
  computed_at: string;
};

export type ScoresModelMetadata = {
  /** Human-readable source name — e.g., "Daniel's MLB model" or "Auto v1 (NCAAB)". */
  name: string;
  /** Source version — e.g., "manual_daniel" / "auto_v1". Matches prediction_source. */
  source: PredictionSource;
  /** Whether this source runs without human input. */
  isAutomated: boolean;
};

export interface IScoresModelSource {
  /** Sport this source serves. */
  readonly sport: Sport;

  /** Static metadata describing the source. */
  readonly metadata: ScoresModelMetadata;

  /** True for auto-models, false for manual upload sources. */
  readonly isAutomated: boolean;

  /**
   * Return all scores-model predictions for the given slate date.
   *
   * @param date YYYY-MM-DD slate date (US ET-aligned for MLB, etc.).
   * @returns    Empty array if no predictions have been published for this
   *             sport+date yet (e.g., Daniel hasn't uploaded today's slate).
   */
  getPredictionsForDate(date: string): Promise<ScoresModelPrediction[]>;

  /**
   * When was the most recent upload/run for this sport+date?
   * Returns null if no run exists yet. Backed by scores_model_runs.completed_at.
   */
  getLastUpdated(date: string): Promise<Date | null>;
}
