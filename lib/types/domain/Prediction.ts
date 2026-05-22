/**
 * Mirrors the `game_predictions` table — Daniel's scores model output per
 * game, with CLV columns folded inline. CLV is silent until ≥30 days of data.
 */
export type GamePrediction = {
  id: number;
  game_id: number | null;
  // Predicted scores
  predicted_home_runs: number | null;
  predicted_away_runs: number | null;
  predicted_total: number | null;
  // ML pick
  predicted_ml_winner: "home" | "away" | null;
  ml_confidence: number | null; // 0-100
  // O/U pick
  predicted_ou_side: "over" | "under" | null;
  ou_confidence: number | null;
  // NRFI pick (MLB-specific; NULL for non-MLB)
  predicted_nrfi: boolean | null; // true = NRFI, false = YRFI
  nrfi_confidence: number | null;
  // Closing Line Value (silent for 30 days, then evaluate display)
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
  model_version: string | null;
  computed_at: string;
  created_at: string;
};
