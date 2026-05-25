import type { Sport } from "./Sport";
import type { SignalType, SourceType } from "./Grade";

/** Outcome of a resolved prediction. */
export type PredictionOutcome = "win" | "loss" | "push" | "void";

/** Discriminator on `prediction_results.prediction_type`. */
export type PredictionType = "game_ml" | "game_total" | "game_nrfi" | "prop";

/** Time-window labels used by tracking aggregates. */
export type TimeWindow = "yesterday" | "this_week" | "season" | "all_time";

/** Tracking market labels — shorter than line `market_type`. */
export type TrackingMarket =
  | "ml"
  | "total"
  | "nrfi"
  | "yrfi"
  | "prop_hits"
  | "prop_total_bases"
  | "prop_home_runs"
  | "prop_rbis"
  | "prop_strikeouts"
  | "prop_earned_runs"
  | "prop_hits_allowed"
  | (string & {});

/**
 * Mirrors the `prediction_results` table.
 *
 * Schema V7/V11 fields (Phase 6.3a):
 *   • signal_type — carried forward from the prediction at resolve time so
 *     tracking can pivot historical W/L by signal source without rejoining
 *     a predictions table that gets regenerated each slate.
 *   • source_type — provenance carried forward likewise. NOT NULL with
 *     DB DEFAULT 'mock'; existing rows backfilled to 'mock'.
 */
export type PredictionResult = {
  id: number;
  prediction_type: PredictionType;
  game_prediction_id: number | null;
  prop_prediction_id: number | null;
  outcome: PredictionOutcome;
  actual_value: number | null;
  predicted_side: string | null;
  sport: Sport;
  market: TrackingMarket;
  resolved_at: string;
  game_date: string; // YYYY-MM-DD
  // Closing Line Value
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
  // V2.1 attribution (V7) + provenance (V11) carried forward from the prediction
  signal_type: SignalType | null;
  source_type: SourceType;
  created_at: string;
};

/**
 * Mirrors the `tracking_aggregates` table — pre-computed W/L totals.
 * Refreshed via `post-game-results` cron after game resolution.
 */
export type TrackingAggregate = {
  id: number;
  sport: Sport;
  market: TrackingMarket;
  time_window: TimeWindow;
  window_start: string | null; // YYYY-MM-DD
  window_end: string | null; // YYYY-MM-DD
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  hit_rate: number | null; // 0-100 (e.g., 56.8)
  computed_at: string;
};
