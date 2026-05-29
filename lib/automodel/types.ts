/**
 * Phase 3A — Shared types and league constants for the rule-seeded MLB
 * auto-model.
 *
 * Pure type definitions and constants. No logic. No imports from lib/db,
 * lib/services, or any provider — Phase 3A is strictly the pure model
 * surface.
 *
 * The GameSnapshot is the input contract: an external feature-snapshot
 * builder (Phase 3B) will populate this from DB queries. The auto-model
 * itself only consumes the snapshot — it never touches the DB.
 *
 * V1 note — confidence-edge proxy, NOT final model edge:
 *   The Phase 2 framework consumes `modelConfidence` and computes
 *   `(modelConfidence - 50)` as a temporary proxy for "model edge".
 *   Phase 3A continues this convention. When Phase 3.x supplies a true
 *   per-pick edge metric (model vs market line), the proxy will be
 *   superseded but the modelConfidence field stays.
 */

// ─────────────────────────────────────────────────────────────
// Stage execution
// ─────────────────────────────────────────────────────────────

/**
 * Two-stage execution pattern:
 *   morning_draft: 8 AM ET cron — preliminary, probable starters may not
 *                  be confirmed. Confidence cap 60. Slate stays draft.
 *   t60_locked:    60 minutes before each game's start_time — publish-
 *                  quality. Confirmed starters expected. Confidence cap 75.
 *
 * The stage parameter is supplied by the caller (Phase 3B service).
 */
export type ModelStage = "morning_draft" | "t60_locked";

// ─────────────────────────────────────────────────────────────
// Input snapshot shapes
// ─────────────────────────────────────────────────────────────

export type StarterSnapshot = {
  player_external_id: number;
  player_name: string;
  throws: "L" | "R" | null;
  season_era: number | null;
  season_whip: number | null;
  season_k_per_9: number | null;
  /** Rolling 30-day ERA. Null when insufficient data. */
  last30_era: number | null;
  /** Pitch-quality score derived from pitcher_pitch_stats. Null when
   *  no pitch-type data is available. Typical range ~0.92 - 1.08. */
  pitch_quality_score: number | null;
  /** lineups.is_probable_pitcher AND is_confirmed both true. */
  is_confirmed: boolean;
  /** Active injury with status='Out'. When true, the model treats this
   *  side's picks as held. */
  is_scratched: boolean;
  /**
   * True first-inning ERA from BDL plays data when available; null in
   * V1 (BDL plays integration is a Phase 3.x optimization). When null,
   * the NRFI helper falls back to a season-ERA proxy.
   */
  first_inning_era: number | null;
};

export type BatterSnapshot = {
  player_external_id: number;
  player_name: string;
  batting_position: number | null;
  bats: "L" | "R" | "S" | null;
  season_obp: number | null;
  season_slg: number | null;
  season_ops: number | null;
  vs_lhp_ops: number | null;
  vs_rhp_ops: number | null;
};

export type TeamSnapshot = {
  team_external_id: number;
  abbreviation: string;
  /** Weighted average of RP season ERAs. Null when no RP stats. */
  bullpen_era_proxy: number | null;
  season_runs_per_game: number | null;
};

export type ParkSnapshot = {
  /** 3-year rolling park_factor_runs. 1.0 = league neutral. */
  park_factor_runs: number | null;
  is_dome: boolean;
};

export type WeatherSnapshot = {
  temperature_f: number | null;
  humidity_pct: number | null;
  wind_speed_mph: number | null;
  wind_direction_degrees: number | null;
  /** weatherService flag: notable weather conditions. */
  is_notable: boolean;
  /** Diagnostic text, e.g. "wind out 15 mph", "high temp 95F". */
  notable_reason: string | null;
};

export type MarketSnapshot = {
  /** Priority chain: Pinnacle total → other books → operator-entered
   *  sport_specific.listed_line → null. Null means O/U pick is held. */
  listed_total: number | null;
  home_ml_odds_american: number | null;
  away_ml_odds_american: number | null;
  /** True when Pinnacle specifically is the source of listed_total. */
  has_pinnacle_total: boolean;
};

export type SharpSnapshot = {
  pinnacle_ml_fair_prob_home: number | null;
  pinnacle_ml_fair_prob_away: number | null;
  pinnacle_total_ev_pct: number | null;
  pinnacle_ml_ev_pct: number | null;
  /** 0-100 scale per Phase 1.6 convention. Null when /splits had no
   *  matching row. */
  public_betting_pct_home: number | null;
  public_money_pct_home: number | null;
  public_betting_pct_over: number | null;
  public_money_pct_over: number | null;
};

export type ActiveInjuries = {
  home_starter_out: boolean;
  away_starter_out: boolean;
  /** Count of batters in top-3 lineup positions with active 'Out'
   *  injuries. Drives Layer 6 offense reduction. */
  home_top3_hitters_injured_count: number;
  away_top3_hitters_injured_count: number;
};

export type DataQuality = {
  /** Both probable starters have lineups.is_confirmed=true. */
  starter_confirmed: boolean;
  /** Both teams have ≥ 8 confirmed batters in lineups. */
  lineup_confirmed: boolean;
  /** Weather provider returned data for this game. */
  weather_available: boolean;
  /** Both starters' season_era is non-null. */
  season_stats_present: boolean;
};

/**
 * Game-level feature snapshot. Built externally (Phase 3B service);
 * consumed by `runMlbAutoModelV1`. The model never reads from the DB —
 * everything it needs is in this snapshot.
 */
export type GameSnapshot = {
  game_external_id: number;
  slate_date: string;
  game_date: string;
  home_team: TeamSnapshot;
  away_team: TeamSnapshot;
  home_starter: StarterSnapshot | null;
  away_starter: StarterSnapshot | null;
  /** Top 8 batters by batting_position, padded with confirmed lineup
   *  rows when available. Length < 8 indicates lineup not fully posted. */
  home_lineup_top8: BatterSnapshot[];
  away_lineup_top8: BatterSnapshot[];
  ballpark: ParkSnapshot | null;
  weather: WeatherSnapshot | null;
  market: MarketSnapshot;
  sharp: SharpSnapshot | null;
  active_injuries: ActiveInjuries;
  data_quality: DataQuality;
};

// ─────────────────────────────────────────────────────────────
// Output shapes
// ─────────────────────────────────────────────────────────────

/**
 * Debug snapshot of the model's intermediate factors. Stored in
 * `sport_specific.auto_factors` for audit. Not consumed by Daily Edge
 * or the framework — purely diagnostic.
 */
export type AutoFactors = {
  home_starter_id: number | null;
  away_starter_id: number | null;
  home_starter_era: number | null;
  away_starter_era: number | null;
  home_starter_era_factor: number;
  away_starter_era_factor: number;
  home_lineup_weighted_ops: number | null;
  away_lineup_weighted_ops: number | null;
  home_lineup_ops_factor_adjusted: number;
  away_lineup_ops_factor_adjusted: number;
  home_bullpen_factor: number;
  away_bullpen_factor: number;
  park_factor_runs: number | null;
  weather_total_adjust: number;
  league_avg_runs_used: number;
  league_avg_era_used: number;
  league_avg_ops_used: number;
  stage_confidence_cap: number;
  /** NRFI diagnostic — expected first-inning runs (both teams summed). */
  nrfi_expected_runs: number | null;
  /** True when NRFI logic fell back to season-ERA × 0.7 proxy. */
  nrfi_used_fallback_era: boolean;
  /** True when NRFI logic incorporated top-of-order OPS data. */
  nrfi_used_top_of_order_data: boolean;
};

/**
 * Audit record of AI sanity boundary + deterministic guard application.
 * In V1 (stub), action is always "approve" and the adjustments are all
 * zero. Deterministic corrections (predicted_total recompute, ML winner
 * nulling, etc.) are recorded in `deterministic_corrections`.
 */
export type AiSanityRecord = {
  action: "approve" | "warn" | "hold" | "rerun";
  reasoning: string;
  applied_confidence_delta: number;
  applied_score_delta_home: number;
  applied_score_delta_away: number;
  warnings: string[];
  /** Deterministic guards applied by applyDeterministicGuards. Each
   *  entry describes a corrected field. */
  deterministic_corrections: string[];
};

/**
 * The Phase 3 sport_specific JSONB shape. Additive to existing V2
 * predicted_nrfi + nrfi_confidence + V15 listed_line keys; no DDL
 * required.
 */
export type AutoModelSportSpecific = {
  model_version: string;
  stage: ModelStage;
  /** Phase 2 framework field — read by gradeDerivationService. */
  starter_confirmed: boolean;
  /** Informational; not consumed by framework yet. */
  lineup_confirmed: boolean;
  /** Phase 2 framework field — duplicates listed_line presence check. */
  market_line_available: boolean;
  /** Phase 2 framework field — read by gradeDerivationService. */
  opposing_deterministic_warning: boolean;
  /** V15 convention — echo of snapshot.market.listed_total. Daily Edge
   *  uses this when the lines table has no entry. */
  listed_line: number | null;
  /** True when ALL three picks are held. */
  held: boolean;
  /** Diagnostic — null when not held. */
  hold_reason: string | null;
  /** Subset of picks held (model-level). May be < 3 when some picks
   *  produced but others didn't. */
  hold_picks: Array<"ml" | "ou" | "nrfi">;
  /** T-60 only — true when probable starter changed since the morning
   *  draft. Phase 3A leaves this false (T-60 stale detection is a
   *  Phase 3B service-level concern). */
  stale: boolean;
  stale_reason: string | null;
  /** V2 mirror of top-level fields — preserves multi-sport convention. */
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  auto_factors: AutoFactors;
  ai_sanity: AiSanityRecord;
};

/**
 * The auto-model's output. Shape mirrors the ScoresModelInputRow that
 * ingestScoresModel accepts — Phase 3B service will adapt this into
 * the ingest input in one mapping step.
 *
 * `prediction_source` is fixed to "auto_v1_mlb_rules" so the existing
 * inferSourceType helper maps it to source_type="real_api" automatically.
 */
export type AutoModelOutput = {
  game_external_id: number;
  prediction_source: "auto_v1_mlb_rules";
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  /** MUST equal predicted_home_score + predicted_away_score (rounded to
   *  one decimal) when both are non-null. Enforced by deterministic
   *  guard #1. */
  predicted_total: number | null;
  predicted_ml_winner: "home" | "away" | null;
  ml_confidence: number | null;
  predicted_ou_side: "over" | "under" | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  sport_specific: AutoModelSportSpecific;
};

// ─────────────────────────────────────────────────────────────
// V1 league baseline constants
// ─────────────────────────────────────────────────────────────

/**
 * League baseline constants used by Phase 3A formulas. These are V1
 * starting points; they should eventually be derived from season data
 * rather than hardcoded. Operators tune by editing this file (no DDL).
 *
 * Sources for V1 values:
 *   AVG_RUNS_PER_GAME 4.5 — typical MLB season composite (Statcast era)
 *   AVG_ERA           4.0 — typical MLB SP/RP composite ERA
 *   AVG_OPS           .730 — typical MLB qualified-hitter OPS baseline
 */
export const LEAGUE_CONSTANTS_V1 = {
  AVG_RUNS_PER_GAME: 4.5,
  AVG_ERA: 4.0,
  AVG_OPS: 0.73,
} as const;

/**
 * Per-stage confidence caps. Morning Card stays conservative
 * (preliminary). T-60 Locked Refresh permits higher confidence
 * (publish-quality).
 */
export const STAGE_CONFIDENCE_CAPS: Record<ModelStage, number> = {
  morning_draft: 60,
  t60_locked: 75,
};

/**
 * NRFI is capped lower than ML/OU because the first-inning data is
 * proxy-derived in V1 (BDL plays integration is a Phase 3.x improvement).
 */
export const NRFI_CONFIDENCE_CAP = 65;

/**
 * Hard confidence floor — picks below this become null (held).
 * Daily Edge UI renders nothing when the column is null.
 */
export const HARD_CONFIDENCE_FLOOR = 51;

/**
 * NRFI decision thresholds. Expected first-inning runs (both teams
 * summed) below LOW → NRFI; above HIGH → YRFI; in-between → no-play.
 *
 * Tuning: 0.45 / 0.65 is a conservative V1 baseline. ~50% of MLB games
 * see a first-inning run; thresholds bracket that midpoint.
 */
export const NRFI_THRESHOLD_LOW = 0.45;
export const NRFI_THRESHOLD_HIGH = 0.65;

/**
 * Innings of expected starter vs bullpen workload. Reflects typical
 * MLB starter-to-bullpen split in the modern era.
 */
export const EXPECTED_STARTER_INNINGS = 6;
export const EXPECTED_BULLPEN_INNINGS = 3;

/**
 * Layer 6 — per top-3 hitter injury offense reduction, capped.
 */
export const TOP3_HITTER_INJURY_REDUCTION_PER = 0.05;
export const TOP3_HITTER_INJURY_REDUCTION_CAP = 0.10;

/**
 * Score sanity clamps — predicted runs per team bounded to plausible
 * range. Prevents pathological inputs from producing wildly out-of-
 * range scores.
 */
export const PREDICTED_SCORE_MIN = 0;
export const PREDICTED_SCORE_MAX = 15;

/**
 * Bounded AI adjustment limits enforced at the call site
 * (Phase 3B service). Documented here so the boundary contract is
 * single-sourced.
 */
export const AI_CONFIDENCE_DELTA_BOUND = 10;
export const AI_SCORE_DELTA_BOUND = 0.3;

/** Auto-model version tag stored in sport_specific.model_version. */
export const MODEL_VERSION = "auto_v1.0_mlb_rules";
