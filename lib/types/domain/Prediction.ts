/**
 * Mirrors the `game_predictions` table — scores-model output per game, with
 * CLV columns folded inline.
 *
 * Schema V2 changes (Phase 4A):
 *   • predicted_home_runs / predicted_away_runs renamed to
 *     predicted_home_score / predicted_away_score (sport-agnostic).
 *   • sport_specific JSONB holds per-sport extras (MLB NRFI, UCL win %s,
 *     NBA listed_line, etc.).
 *   • prediction_source attributes the prediction to manual_daniel or a
 *     future auto-model.
 *   • is_override + original_auto_prediction track hybrid mode where Daniel
 *     manually overrides specific auto-predictions.
 *
 * MLB-specific fields (predicted_nrfi, nrfi_confidence) remain top-level
 * for back-compat with the MLB cron flow but ALSO appear in sport_specific
 * for the multi-sport read path. The top-level fields are deprecated as of
 * Phase 4; new code should read from sport_specific. We keep them populated
 * for V1 so existing Tracking aggregation by market doesn't break.
 */
export type PredictionSource =
  | "manual_daniel"
  | "auto_v1"
  | "auto_v2"
  | (string & {}); // forward-compat: future auto-model versions

export type GamePrediction = {
  id: number;
  game_id: number | null;
  // Predicted scores (sport-agnostic names)
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  // ML pick
  predicted_ml_winner: "home" | "away" | null;
  ml_confidence: number | null; // 0-100
  // O/U pick
  predicted_ou_side: "over" | "under" | null;
  ou_confidence: number | null;
  // NRFI pick (MLB-specific top-level; also mirrored in sport_specific)
  predicted_nrfi: boolean | null; // true = NRFI, false = YRFI
  nrfi_confidence: number | null;
  // Per-sport extras
  sport_specific: Record<string, unknown> | null;
  // Audit trail
  prediction_source: PredictionSource;
  is_override: boolean;
  original_auto_prediction: Record<string, unknown> | null;
  // Closing Line Value (silent for 30 days, then evaluate display)
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
  model_version: string | null;
  computed_at: string;
  created_at: string;
};
