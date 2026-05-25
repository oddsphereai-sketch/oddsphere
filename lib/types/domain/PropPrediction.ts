import type { PropMarketType } from "./Lines";
import type { Grade, MarketSignal, SignalType, SourceType } from "./Grade";

/**
 * Tier classification of edge:
 *   - premium: 8%+ (with "verify lineup" caveat)
 *   - strong:  5-8%
 *   - good:    3-5%
 *   - skip:    <3% (filtered out — never surfaced in UI)
 */
export type PropTier = "premium" | "strong" | "good" | "skip";

/**
 * Mirrors the `prop_predictions` table — our prop model's output.
 *
 * Schema V6/V7/V11 fields (Phase 6.3a) sit alongside the existing model
 * output: market_signal (Layer 3 market read), grade (7-category V2.1
 * grade), signal_type (attribution), source_type (provenance). Same shape
 * as GamePrediction — same engine, different display labels.
 */
export type PropPrediction = {
  id: number;
  game_id: number | null;
  player_id: number | null;
  prop_market: PropMarketType;
  prop_line: number;
  // Model output
  model_probability: number | null;
  fair_probability: number | null;
  edge_pct: number | null;
  // Confidence
  confidence_score: number | null; // 0-100, 6-factor formula
  confidence_stars: number | null; // 1-5 (computed but hidden in card UI)
  tier: PropTier | null;
  // Recommended bet
  best_sportsbook: string | null;
  best_odds_american: number | null;
  ev_pct: number | null;
  // Reasoning
  reasoning: string | null;
  caveat: string | null; // e.g., "Edge >8% — verify lineup before betting"
  // Closing Line Value (silent for 30 days, then evaluate display)
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
  // V2.1 grade engine (V6/V7 — populated by Phase 6.3c/6.3d)
  market_signal: MarketSignal | null;
  grade: Grade | null;
  signal_type: SignalType | null;
  // V11 provenance — NOT NULL with DB DEFAULT 'mock'
  source_type: SourceType;
  model_version: string | null;
  computed_at: string;
  created_at: string;
};

/**
 * Mirrors the `prediction_breakdowns` table — per-prop factor breakdown.
 * Each adjustment is the running rate after that adjustment is applied.
 */
export type PredictionBreakdown = {
  id: number;
  prop_prediction_id: number | null;
  // Factor breakdown (running rate)
  marcel_base_rate: number | null;
  matchup_log5_rate: number | null;
  park_adjustment: number | null;
  weather_adjustment: number | null;
  platoon_adjustment: number | null;
  recency_adjustment: number | null;
  expected_plate_appearances: number | null;
  lineup_position: number | null;
  // 6-factor confidence components
  reliability_score: number | null;
  lineup_confirmation_score: number | null;
  weather_certainty_score: number | null;
  workload_certainty_score: number | null;
  market_liquidity_score: number | null;
  calibration_score: number | null;
  created_at: string;
};
