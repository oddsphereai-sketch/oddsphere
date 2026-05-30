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
   * Per-pitcher first-inning ERA sourced from MLB Stats API statSplits
   * (sitCode i01). Null when no FI data has been ingested for this
   * pitcher's season. When non-null, `first_inning_starts` carries the
   * sample size used for the gate in mlbAutoModelV1.
   */
  first_inning_era: number | null;
  /**
   * First-inning starts (sample size for the model's FI-ERA gate).
   * Sourced from MLB Stats API's first-inning split `gamesPlayed`. Null
   * when no FI data has been ingested for this pitcher's season.
   */
  first_inning_starts: number | null;
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
   *  draft. Phase 3A leaves this false; Phase 4B/4C will populate at T-60
   *  using the pure stale-detection helper added in Phase 4A. */
  stale: boolean;
  stale_reason: string | null;
  /** V2 mirror of top-level fields — preserves multi-sport convention. */
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  auto_factors: AutoFactors;
  ai_sanity: AiSanityRecord;
  // ─────────────────────────────────────────────────────────────
  // Phase 4 audit fields. Phase 4A reserved the shape; Phase 4B
  // deferred persistence; Phase 4C populates from the orchestrator's
  // write entry points via the enrichment hook on generatePredictionsForSlate.
  // All optional so Phase 3A's runMlbAutoModelV1 can keep producing
  // the existing shape without modification.
  // ─────────────────────────────────────────────────────────────
  /** ISO timestamp of the PREVIOUS run for this game (null on first run). */
  previous_run_at?: string | null;
  /** Stage of the previous run (null on first run). */
  previous_stage?: ModelStage | null;
  /** Structured deltas vs previous run (null on first run). */
  movement_deltas?: MovementDeltas | null;
  /** Which trigger produced this row (null on Phase 3A direct callers). */
  run_kind?: "morning" | "t60" | "manual_rerun" | "held_rerun" | null;
  /**
   * Phase 4C — compact snapshot of the 10 GameSnapshot primitives that
   * Phase 4A's stale rules 3, 4, 6, 7, 8, 9 need at NEXT-run comparison
   * time. Null on rows pre-dating 4C. Bounded ~120 bytes per row by
   * design — see lib/automodel/snapshotStash.ts.
   */
  snapshot_stash?: SnapshotStash | null;
  // ─────────────────────────────────────────────────────────────
  // Phase 4D.1 — NRFI / YRFI / Toss-Up classification audit fields
  // ─────────────────────────────────────────────────────────────
  /** Explicit decision kind. Replaces the predicted_nrfi-null-as-multi-
   *  meaning ambiguity (held vs Toss-Up). Optional for back-compat with
   *  pre-4D.1 rows. */
  nrfi_decision_kind?: NrfiDecisionKind | null;
  /** Zone the expected_first_inning_runs landed in. Pairs with
   *  decision_kind — "below_floor" means a NRFI/YRFI pick was
   *  downgraded to Toss-Up because data-quality caps pushed confidence
   *  under HARD_CONFIDENCE_FLOOR. */
  nrfi_threshold_zone?: NrfiThresholdZone | null;
  /** Tags describing which factors / data-quality issues contributed
   *  to this NRFI decision. Reserved for future AI breakdown — kept
   *  minimal in 4D.1. Empty array OK; null on legacy rows. */
  nrfi_reason_codes?: string[] | null;
  /** NRFI-specific hold reason. Distinct from the game-level
   *  `hold_reason` (which only fires when ALL three picks held). Set
   *  ONLY when nrfi_decision_kind === "held". */
  nrfi_hold_reason?: string | null;
};

// ─────────────────────────────────────────────────────────────
// Phase 4C — compact snapshot stash for next-run stale comparison
// ─────────────────────────────────────────────────────────────

/**
 * Phase 4C — minimum set of GameSnapshot primitives needed by Phase 4A
 * stale detection rules at the NEXT run. Persisted on each write to
 * `sport_specific.snapshot_stash` so a later run can detect:
 *
 *   • starter became scratched (rule 3)
 *   • new top-3 hitter scratched (rule 4)
 *   • Pinnacle ML fair-prob move (rule 6)
 *   • Pinnacle ML EV flip/move (rule 7)
 *   • public betting moves (rule 8)
 *   • public money moves (rule 9)
 *
 * Intentionally BOUNDED: 10 primitives, no nested arrays/objects,
 * ~120 bytes per row × 12 games = ~1.5 KB per slate. Avoids storing
 * the full GameSnapshot (which would balloon JSONB).
 *
 * Daniel's guidance (Phase 4C planning §7): "keep snapshot_stash
 * compact exactly as proposed. Do not store full raw snapshots or
 * large nested data."
 */
export type SnapshotStash = {
  home_starter_was_scratched: boolean;
  away_starter_was_scratched: boolean;
  home_top3_hitters_injured_count: number;
  away_top3_hitters_injured_count: number;
  pinnacle_ml_fair_prob_home: number | null;
  pinnacle_ml_ev_pct: number | null;
  public_betting_pct_home: number | null;
  public_money_pct_home: number | null;
  public_betting_pct_over: number | null;
  public_money_pct_over: number | null;
};

// ─────────────────────────────────────────────────────────────
// Phase 4C — enrichment hook for generatePredictionsForSlate
// ─────────────────────────────────────────────────────────────

/**
 * Phase 4C — hook called by `generatePredictionsForSlate` after the
 * model runs for each game (and AI sanity boundary) but BEFORE the
 * prediction is added to the predictions array and ingested.
 *
 * Returns a partial `AutoModelSportSpecific` to MERGE into the
 * prediction's sport_specific. Used by the orchestrator to inject
 * Phase 4 audit fields (snapshot_stash, previous_run_at,
 * previous_stage, movement_deltas, stale, stale_reason, run_kind)
 * computed from data the orchestrator owns (pre-fetched prior auto
 * rows + the live GameSnapshot the hook receives).
 *
 * The hook is OPTIONAL. When omitted, `generatePredictionsForSlate`
 * runs exactly as Phase 3B/3C did — Phase 3C tests pass unchanged.
 *
 * Errors thrown by the hook are caught per-game and logged; the
 * game's prediction proceeds with un-enriched sport_specific rather
 * than failing the whole slate.
 */
export type EnrichmentHook = (
  snapshot: GameSnapshot,
  output: AutoModelOutput
) => Partial<AutoModelSportSpecific>;

// ─────────────────────────────────────────────────────────────
// Phase 4A — stale-detection contracts (pure)
// ─────────────────────────────────────────────────────────────

/**
 * Movement deltas between a prior auto prediction and the current
 * snapshot. Null values mean "delta could not be computed" (one side
 * missing). Booleans are derived flags — direction-agnostic, just "did
 * this change?"
 *
 * Stored on `sport_specific.movement_deltas` for operator audit. Does
 * NOT trigger reruns in V1 (planning §4.3 — audit-only).
 */
export type MovementDeltas = {
  /** Listed total absolute change (current - prior) in runs. */
  total_line_delta: number | null;
  /** Pinnacle ML fair-prob absolute change (current - prior), pp. */
  ml_fair_prob_delta: number | null;
  /** Pinnacle ML EV percentage absolute change (current - prior), pct. */
  ev_delta: number | null;
  /** Public betting % absolute change (current - prior), pp. Picks the
   *  side (home vs over) with the larger magnitude move. */
  public_betting_delta: number | null;
  /** Public money % absolute change (current - prior), pp. Picks the
   *  side with the larger magnitude move. */
  public_money_delta: number | null;
  /** True when home OR away starter player_external_id changed. */
  starter_changed: boolean;
  /** True when lineup_confirmed regressed from true → false. */
  lineup_status_changed: boolean;
  /** True when sharp grade direction flipped support↔conflict. */
  sharp_grade_changed: boolean;
  /** True when current snapshot's provider data is missing/delayed. */
  provider_data_missing: boolean;
};

/**
 * Starter-change diff. Per-side booleans plus the actual IDs for the
 * operator audit string. Either side may be null when prior or current
 * data is incomplete; a null on either side does NOT count as a change
 * (handled separately by the hold-reason / provider-missing path).
 */
export type StarterChangeReport = {
  home_changed: boolean;
  away_changed: boolean;
  home_previous: number | null;
  home_current: number | null;
  away_previous: number | null;
  away_current: number | null;
};

/**
 * Output of buildStaleReport. The orchestrator (Phase 4B/4C) writes:
 *   sport_specific.stale          ← report.is_stale
 *   sport_specific.stale_reason   ← report.reasons.join("; ")
 *   sport_specific.movement_deltas ← report.movement_deltas
 *
 * V1 policy (planning §4.3): is_stale is AUDIT-ONLY — it does NOT
 * gate the rerun decision. T-60 always reruns eligible games.
 */
export type StaleReport = {
  is_stale: boolean;
  /** Human-readable reasons, one per material change. Joined with "; "
   *  by the orchestrator for sport_specific.stale_reason. */
  reasons: string[];
  movement_deltas: MovementDeltas;
  starter_change: StarterChangeReport;
};

/**
 * Minimal subset of prior-prediction data the stale detector needs.
 * All fields are optional/null because:
 *   • Some prior rows pre-date Phase 4's audit-field reservation
 *     and won't carry these keys.
 *   • Phase 3A's sport_specific has a subset of these fields already
 *     (e.g. starter_confirmed, lineup_confirmed); Phase 4 callers
 *     stash the remainder onto sport_specific when writing.
 *
 * The detector treats every missing field as "unknown" and skips the
 * corresponding stale reason — avoids false positives from missing
 * baselines.
 */
export type PriorPredictionForStale = {
  starter_confirmed?: boolean | null;
  lineup_confirmed?: boolean | null;
  home_starter_id?: number | null;
  away_starter_id?: number | null;
  home_starter_was_scratched?: boolean | null;
  away_starter_was_scratched?: boolean | null;
  listed_total?: number | null;
  pinnacle_ml_fair_prob_home?: number | null;
  pinnacle_ml_ev_pct?: number | null;
  public_betting_pct_home?: number | null;
  public_money_pct_home?: number | null;
  public_betting_pct_over?: number | null;
  public_money_pct_over?: number | null;
  home_top3_hitters_injured_count?: number | null;
  away_top3_hitters_injured_count?: number | null;
  /** Direction the sharp grade pointed at the time of prior run. The
   *  orchestrator derives this from the row's grade columns before
   *  passing in. "neutral" includes market_neutral / no-pick. */
  sharp_grade_direction?: "support" | "conflict" | "neutral" | null;
};

/**
 * Subset of the CURRENT GameSnapshot the stale detector needs. The full
 * GameSnapshot carries lineup details and other heavy fields the
 * detector doesn't read; this projection keeps the type narrow.
 */
export type CurrentSnapshotForStale = {
  home_starter_external_id: number | null;
  away_starter_external_id: number | null;
  home_starter_is_scratched: boolean;
  away_starter_is_scratched: boolean;
  starter_confirmed: boolean;
  lineup_confirmed: boolean;
  listed_total: number | null;
  pinnacle_ml_fair_prob_home: number | null;
  pinnacle_ml_ev_pct: number | null;
  public_betting_pct_home: number | null;
  public_money_pct_home: number | null;
  public_betting_pct_over: number | null;
  public_money_pct_over: number | null;
  home_top3_hitters_injured_count: number;
  away_top3_hitters_injured_count: number;
  /** False when current snapshot has no sharp signal AND no lines — i.e.
   *  the provider data is missing or significantly delayed. */
  provider_data_present: boolean;
};

/**
 * Derived state the orchestrator computes from the CURRENT slate before
 * calling buildStaleReport. Currently just the sharp grade direction
 * (which needs Phase 2 framework logic to derive, so the detector
 * accepts it pre-computed rather than re-deriving).
 */
export type CurrentDerivedForStale = {
  sharp_grade_direction: "support" | "conflict" | "neutral" | null;
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
 * The natural cap on the strong-zone band is 62; the absolute hard cap
 * (65) only applies when ALL data inputs are present (real first-inning
 * ERA + confirmed lineup + confirmed starter, none of which happen yet
 * in V1).
 */
export const NRFI_CONFIDENCE_CAP = 65;

/**
 * Hard confidence floor — picks below this become null (held).
 * Daily Edge UI renders nothing when the column is null.
 */
export const HARD_CONFIDENCE_FLOOR = 51;

// ─────────────────────────────────────────────────────────────
// Phase 4D.1 — 5-zone NRFI / YRFI / Toss-Up framework
// ─────────────────────────────────────────────────────────────
//
// Expected first-inning runs (both teams summed) routes into one of
// five zones. Pre-4D.1, the model used a 2-threshold scheme (0.45 /
// 0.65) that placed ~90% of typical MLB matchups in the no-play band,
// producing 11/12 "held" on the seed slate. The 5-zone scheme widens
// the active-pick range and adds an explicit "Toss-Up" output for
// contested first-inning matchups (rather than collapsing them into
// the same null bucket as data-thin holds).
//
//   expected ≤ 0.40              → strong NRFI
//   0.40 < expected ≤ 0.50       → lean NRFI
//   0.50 < expected < 0.62       → Toss-Up
//   0.62 ≤ expected < 0.72       → lean YRFI
//   expected ≥ 0.72              → strong YRFI
//
// Hard hold reasons (missing/scratched starter, no ERA available) still
// produce a `held` decision_kind separately — Toss-Up is reserved for
// data-adequate-but-contested rows.

export const NRFI_THRESHOLD_STRONG = 0.40;
export const NRFI_THRESHOLD_LEAN = 0.50;
export const YRFI_THRESHOLD_LEAN = 0.62;
export const YRFI_THRESHOLD_STRONG = 0.72;

/**
 * Confidence bands per zone. Pre-4D.1 used a single linear formula
 * `50 + 15 × strength`. New bands are tighter and zone-aware:
 *
 *   Toss-Up:           52         (literally a toss; small display number)
 *   lean NRFI / YRFI:  53 – 56
 *   strong NRFI / YRFI:57 – 62    (62 is the natural cap; 65 is reserved
 *                                  for "all-data-present" cases that don't
 *                                  yet exist in V1)
 *
 * Data-quality caps below can lower confidence further. If a NRFI/YRFI
 * pick's effective confidence drops below the floor (51), the decision
 * is downgraded to Toss-Up rather than nulled to "held".
 */
export const NRFI_CONFIDENCE_TOSS_UP = 52;
export const NRFI_CONFIDENCE_LEAN_MIN = 53;
export const NRFI_CONFIDENCE_LEAN_MAX = 56;
export const NRFI_CONFIDENCE_STRONG_MIN = 57;
export const NRFI_CONFIDENCE_STRONG_MAX = 62;

/**
 * Data-quality caps applied after the natural confidence is computed.
 * Each cap reduces the maximum confidence allowed for a NRFI/YRFI pick;
 * if cumulative caps push confidence below the floor, the pick
 * downgrades to Toss-Up.
 *
 * Toss-Up itself is NOT subject to these caps — it's already at 52.
 *
 *   FALLBACK_CAP        — when starter has no real first_inning_era
 *                         and we used `season_era × 0.7` proxy
 *   UNCONFIRMED_PENALTY — applied per unconfirmed-data-source flag
 *                         (lineup_confirmed=false; starter_confirmed=false)
 */
export const NRFI_FALLBACK_CONFIDENCE_CAP = 60;
export const NRFI_UNCONFIRMED_CONFIDENCE_PENALTY = 5;

/**
 * Phase 4D.1 — explicit decision kind on sport_specific so Toss-Up is
 * distinguishable from data-thin holds. Operator and downstream
 * consumers read this field; the legacy `predicted_nrfi: boolean | null`
 * stays for back-compat (true=NRFI, false=YRFI, null=Toss-Up OR held).
 */
export type NrfiDecisionKind = "nrfi" | "yrfi" | "toss_up" | "held";

/**
 * Phase 4D.1 — the zone the expected_first_inning_runs landed in.
 * `below_floor` indicates the natural-zone pick was downgraded by data
 * quality caps to under the confidence floor (and thus to Toss-Up).
 */
export type NrfiThresholdZone =
  | "strong_nrfi"
  | "lean_nrfi"
  | "toss_up"
  | "lean_yrfi"
  | "strong_yrfi"
  | "below_floor";

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
