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
  /**
   * First-inning WHIP — walks + hits per first inning. Sourced from
   * `player_season_stats.first_inning_whip` (DECIMAL 5,3). Null when no
   * FI data ingested. Used by nrfiPick as a secondary modifier on top
   * of FI ERA. Gated by FIRST_INNING_SAMPLE_GATE (same as FI ERA) and
   * clamped via FI_WHIP_MODIFIER_CLAMP_{MIN,MAX} so it can never swing
   * expected_runs by more than ±4%.
   */
  first_inning_whip: number | null;
  /**
   * R-14B — starter workload counters for confidence-dampening flags.
   * Sourced from `player_season_stats.pitching_{gs,gp,ip}`. Null when no
   * season row exists for this pitcher; absent (`undefined`) on fixtures
   * built before R-14B. Used to detect low-sample starters and reliever-
   * as-starter situations; dampening defaults to "no penalty" when null
   * or absent, so missing data never inflates confidence.
   */
  season_games_started?: number | null;
  season_games_pitched?: number | null;
  season_innings_pitched?: number | null;
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
  /**
   * R-16J Step 1 — season plate appearances. Used as the sample-size
   * input for lineup-OPS shrinkage (so a hot 50-PA debut doesn't get
   * full weight). Null when no season row exists; the model's shrinkage
   * helper treats null as `n = 0` → full league prior. Optional on the
   * type so pre-R-16J fixtures that omit it continue to type-check.
   */
  season_pa?: number | null;
  /**
   * R-16J Step 1.6 — lineup-source provenance. When loaded from a
   * `lineups.is_confirmed = true` row → "confirmed". From a
   * `lineups.is_confirmed = false` row → "projected". For pre-R-16J
   * fixtures the field is omitted and defaults to "confirmed" semantics
   * (treated as authoritative).
   */
  lineup_source?: "confirmed" | "projected";
};

export type TeamSnapshot = {
  team_external_id: number;
  abbreviation: string;
  /** Weighted average of RP season ERAs. Null when no RP stats. */
  bullpen_era_proxy: number | null;
  season_runs_per_game: number | null;
  /**
   * R-16J Step 1.6 — team-level offense proxy. Mean season `batting_ops`
   * across rostered batters with `batting_pa ≥ 100`. Used as Tier 3 in
   * the FI fallback hierarchy when neither side has a usable top-of-
   * order lineup OPS. Null when no qualifying batters in the team's
   * roster.
   *
   * Computed once per slate in `featureSnapshot.computeTeamAvgBatterOps`;
   * not consumed by the full-game score formula (only by NRFI offense
   * fallback). The aggregate is shrunken at consumption time via
   * `SHRINKAGE_K_TEAM_OPS` so a tiny-roster sample can't dominate.
   */
  team_avg_batter_ops?: number | null;
  /**
   * R-16J Step 1.6 — total PA used to compute `team_avg_batter_ops`.
   * Becomes the sample-size input for `shrinkRate` so the proxy
   * regresses toward league mean when the team's qualifying-batter pool
   * is thin (early season callup-heavy roster, etc.).
   */
  team_avg_batter_ops_sample?: number | null;
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
  /** Priority chain: corroboration-aware resolver (≥2 real-book
   *  agreement OR 1 real-book + splits_consensus) → splits_consensus
   *  fallback → operator-entered sport_specific.listed_line → null.
   *  Null means O/U pick must be held. */
  listed_total: number | null;
  home_ml_odds_american: number | null;
  away_ml_odds_american: number | null;
  /**
   * Phase 6B.8 — per-side O/U American odds for the picked side.
   * Lines table stores one row per (sportsbook, side) for totals; we
   * resolve the freshest real-book pair so V2.2 can compute a no-vig
   * OU market probability instead of the legacy 0.5 placeholder. Null
   * when no real-book O/U odds exist for that side — the model writes
   * ou_market_prob = null in that case (NOT 0.5).
   */
  over_odds_american: number | null;
  under_odds_american: number | null;
  /** True when Pinnacle specifically is the source of listed_total. */
  has_pinnacle_total: boolean;
  /**
   * 2026-06-09 phantom-alt-line fix — audit trail for the locked total
   * line so snapshot_json.total_line_source_at_lock /
   * total_line_book / total_line_agreement_count /
   * total_line_consensus_at_same_line can be persisted by the writer.
   * Optional for back-compat with legacy snapshots; populated by
   * featureSnapshot.pickListedTotal for every new run.
   */
  total_line_source?: "real_book" | "consensus_fallback" | "unavailable";
  total_line_book?: string | null;
  total_line_agreement_count?: number;
  total_line_consensus_at_same_line?: boolean;
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
  /**
   * R-14B — which side carries Pinnacle +EV. Null when no +EV row exists
   * for that market; absent (`undefined`) on fixtures built before R-14B.
   * Used by the dampening layer to detect "sharp +EV opposes model pick"
   * (an OU-specific dampening flag).
   */
  ml_plus_ev_side?: "home" | "away" | null;
  total_plus_ev_side?: "over" | "under" | null;
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
  // ─────────────────────────────────────────────────────────────
  // First-inning starter detail (added 2026-06-02 for FI Key Stats)
  // ─────────────────────────────────────────────────────────────
  // These mirror values the model already loads into StarterSnapshot
  // and uses inside nrfiPick. Persisted so the UI can surface the
  // actual FI-specific stats it consumes (vs the full-season ERA
  // fallback we used to show). All optional for backward compat with
  // rows generated before this field set was added.
  /** Raw first-inning ERA per starter (DECIMAL 5,2 in player_season_stats).
   *  Null when no FI data has been ingested OR the starter is missing. */
  home_first_inning_era?: number | null;
  away_first_inning_era?: number | null;
  /** First-inning starts (sample-size context). Same gating semantics as
   *  FIRST_INNING_SAMPLE_GATE in mlbAutoModelV1. */
  home_first_inning_starts?: number | null;
  away_first_inning_starts?: number | null;
  /** Raw first-inning WHIP per starter. Consumed by nrfiWhipFactor since
   *  Phase 4.1.12. Null when no FI data ingested. */
  home_first_inning_whip?: number | null;
  away_first_inning_whip?: number | null;
  /** Handedness-aware top-of-order OPS used by nrfiPick. Side's lineup
   *  vs the OPPOSING starter's throws (home OPS uses away starter's
   *  throws, and vice versa). Null when no top-of-order data available. */
  home_top_order_ops?: number | null;
  away_top_order_ops?: number | null;
  /** Starter handedness (L / R). Useful for FI Key Stats handedness
   *  display ("vs RHP" / "vs LHP"). */
  home_starter_throws?: "L" | "R" | null;
  away_starter_throws?: "L" | "R" | null;
  /**
   * R-14B — diagnostic fields for the dampening layer. Records the raw
   * model confidence, the penalty applied, and which flags fired. Optional
   * for backward compat with predictions written before R-14B; the model
   * always populates them on new writes.
   */
  ml_raw_confidence?: number | null;
  ml_dampening_penalty?: number;
  ml_dampening_reasons?: string[];
  ou_raw_confidence?: number | null;
  ou_dampening_penalty?: number;
  ou_dampening_reasons?: string[];
  // ─────────────────────────────────────────────────────────────
  // R-16J Step 1 — input shrinkage + FI probability transparency
  // ─────────────────────────────────────────────────────────────
  // The reviewer + breakdown UI can surface raw vs effective vs
  // shrinkage-weight so the user can see HOW MUCH the model trusted
  // each input. All optional for backward compat.
  /** Shrinkage weight on each starter's raw season ERA (0..1). */
  home_starter_era_shrinkage_weight?: number;
  away_starter_era_shrinkage_weight?: number;
  /** R-16J — raw (pre-calibration) expected FI runs, before
   *  FI_BASELINE_CALIBRATION is applied. nrfi_expected_runs is the
   *  CALIBRATED value the model uses for picks. */
  nrfi_lambda_raw?: number | null;
  /** Calibration constant value used for this prediction. */
  nrfi_baseline_calibration?: number;
  /** Calibrated NRFI probability from Poisson conversion `e^(-λ)`. */
  nrfi_probability?: number | null;
  /** Calibrated YRFI probability = 1 - nrfi_probability. */
  yrfi_probability?: number | null;
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
  // ─────────────────────────────────────────────────────────────
  // Phase 4.1.8 — member-first breakdown payload
  // ─────────────────────────────────────────────────────────────
  /** Phase 4.1.8.B v2 — model-side prose written by pickBreakdownGenerator.
   *  Only the model_breakdown text is persisted here; verdict + sharpRead
   *  are derived client-side (route.ts) at read time because per-pick
   *  grades + sharp signals are computed AFTER the generator runs in the
   *  orchestrator. Persisting them would always be stale. */
  breakdown_v2?: { model_breakdown: string } | null;
  /** Phase 4.1.3 v1 legacy single-blob member summary. New v2 writes
   *  explicitly omit this key (Sub-D1) so v1 and v2 copy never live
   *  side-by-side. Kept as an optional read field for backward-compat
   *  with rows written before 4.1.8.B regenerated them. */
  member_summary?: string | null;
  /** Admin-surface diagnostic prose. Never exposed via the member API
   *  (route.ts builds the DTO field-by-field; never spreads sport_specific). */
  operator_detail?: string | null;
  /** "v1.0" for pre-4.1.8 writes; "v2.0" once the 4.1.8 generator has
   *  run for the row. */
  breakdown_version?: string | null;
  /** ISO 8601 timestamp of the most recent breakdown generation run. */
  breakdown_generated_at?: string | null;
  // ─────────────────────────────────────────────────────────────
  // Phase 4.2.C.1.R-16 — AI reviewer audit record
  // ─────────────────────────────────────────────────────────────
  /**
   * Compact audit-trail emitted by the V1 deterministic AI reviewer.
   * Optional for back-compat with predictions written before R-16
   * wiring. Sized ≤ ~700 bytes per row. Carries raw vs reviewed
   * prediction snapshot, per-market actions, review flags, reasons
   * count, reviewer version, and the logic_audit_passed boolean.
   * Full reasons text is intentionally not persisted (review_reasons
   * is rebuildable from the input + flag set when needed).
   *
   * `unknown` here because the concrete shape (`ReviewV1AuditRecord`)
   * lives in `lib/services/aiReviewerV1.ts` and we don't want a
   * dependency cycle from automodel types into a service module.
   * The reviewer's `buildAuditRecord` is what writes here; readers
   * cast to the concrete type via that module.
   */
  review_v1?: unknown | null;
  // ─────────────────────────────────────────────────────────────
  // Phase 6B.1 — V2 market-prior model fields (additive)
  // ─────────────────────────────────────────────────────────────
  /**
   * Which model produced the prediction values on this row:
   *   "v1"        — V1 ran and wrote (default).
   *   "v2"        — V2 ran and wrote (market-prior).
   *   "shadow_v1" — V1 wrote; V2 also ran and stashed audit only.
   *   "v2_fallback_v1" — V2 errored; V1 took over and wrote. Logged.
   *
   * Optional + undefined-tolerant for backwards compat with rows
   * written before Phase 6B.1.
   */
  model_used?: "v1" | "v2" | "v2_1" | "v2_2" | "shadow_v1" | "v2_fallback_v1" | "v2_1_fallback_v1" | "v2_2_fallback_v1";
  /**
   * Compact summary of the V2 data-quality assessment. Top-level
   * boolean/string fields here so admin UIs can filter without
   * descending into v2_audit JSON. Optional for back-compat.
   */
  v2_provisional?: boolean;
  v2_data_quality_tier?: "high" | "medium" | "low" | "fallback";
  v2_best_angle_eligible?: boolean;
  /**
   * Full V2 audit payload — mirrors V2Output.v2Audit. `unknown` here to
   * avoid a dependency cycle (concrete shape lives in
   * `lib/automodel/mlbAutoModelV2.ts`). Readers cast via that module.
   * Carries: marketBaseline, residuals, capActive flags, edgePct,
   * dataQuality, bestAngleEligibility, provisional, notes, fallback.
   */
  v2_audit?: unknown | null;
  // ─────────────────────────────────────────────────────────────
  // Phase 6B V2.1 — layered prediction-integrity model fields
  // ─────────────────────────────────────────────────────────────
  ml_play_grade?: string;
  ou_play_grade?: string;
  ml_prediction_type?: string | null;
  ou_prediction_type?: string | null;
  ml_best_angle_eligible?: boolean;
  ou_best_angle_eligible?: boolean;
  ml_best_angle_reason?: string | null;
  ou_best_angle_reason?: string | null;
  ml_no_bet_reason?: string | null;
  ou_no_bet_reason?: string | null;
  ml_market_aligned?: boolean;
  ou_market_aligned?: boolean;
  model_integrity_notes?: string[];
  v2_1_audit?: unknown | null;
  v2_2_audit?: unknown | null;
  /**
   * 2026-06-12 — MLB totals projection/side reconciliation audit blob.
   * Written by automodelService after runMlbAutoModelV2_2 so the
   * downstream record writer + grade derivation can read both the raw
   * model values and the reconciled customer-facing values. Type-erased
   * here (`unknown`) to keep this types.ts module free of the deeper
   * reconciliation type — gradeDerivationService casts to the real
   * shape at read time.
   */
  total_projection_reconciliation?: unknown | null;
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
 * R-16J Step 1 — input shrinkage strengths (pseudo-counts for
 * empirical-Bayes / James-Stein regression toward league mean).
 *
 *   effective_value  = (k * prior + n * raw_value) / (k + n)
 *   shrinkage_weight = n / (k + n)
 *
 * Where `k` is the pseudo-count of "prior observations" — higher k =
 * more skepticism toward the raw value. Values approved in R-16J Step 1
 * planning (Daniel, 2026-06-04). Tunable in this single file.
 *
 * The pseudo-count scale uses the same sample-size unit as `n` in the
 * formula (innings for pitchers, plate appearances for hitters).
 *
 * Rationale per input:
 *   STARTER_ERA  90 IP  — sabermetric convention for SP-ERA stabilization.
 *                         A starter with 45 IP gets ~33% weight; with
 *                         180 IP gets ~67%; with 360 IP gets 80%.
 *   STARTER_WHIP 75 IP  — WHIP stabilizes slightly faster than ERA.
 *   FI_ERA       10 FIS — First-inning samples are tiny but the
 *                         k=15 sensitivity test produced 8/9 toss-ups
 *                         on the 2026-06-04 slate; k=10 gives the
 *                         model more directional surface area without
 *                         forcing picks. A 10-start pitcher gets 50%
 *                         raw weight; a 1-start pitcher still gets
 *                         only ~9%. (Was 15 in pre-Variant-B planning.)
 *   FI_WHIP      10 FIS — symmetric to FI ERA.
 *   BULLPEN_ERA  150 IP — reserved for Step 1.5 (no `bullpen_ip` plumbing
 *                         yet; bullpen factor remains un-shrunk in Step 1).
 *   LINEUP_OPS   150 PA — protects against hot-streak debuts. A 100-PA
 *                         debut gets ~40% weight; a 400-PA regular gets
 *                         ~73%.
 */
export const SHRINKAGE_K_STARTER_ERA = 90;
export const SHRINKAGE_K_STARTER_WHIP = 75;
// R-16J Step 1 (Variant B, 2026-06-05): FI ERA + FI WHIP k lowered
// 15 → 10 after sensitivity sweep. With k=15 the 2026-06-04 slate
// produced 8/9 toss-ups; with k=10 the same slate produces 6 toss-ups
// + 2 YRFI + 1 NRFI — more directional surface area without forcing
// picks via threshold manipulation. A pitcher with 10 FI starts now
// gets ~50% raw weight (vs 40% at k=15); a 1-start pitcher still gets
// only ~9% raw weight. Variant B preserves the 0.55/0.45 thresholds
// so picks earn their slot through model probability, not threshold
// narrowing.
export const SHRINKAGE_K_FI_ERA = 10;
export const SHRINKAGE_K_FI_WHIP = 10;
export const SHRINKAGE_K_BULLPEN_ERA = 150;
export const SHRINKAGE_K_LINEUP_OPS = 150;

/** League baseline WHIP — prior for starter WHIP shrinkage. */
export const LEAGUE_BASELINE_WHIP = 1.30;

/** League baseline FI ERA — alias to AVG_ERA today (per-9-IP convention). */
export const LEAGUE_BASELINE_FI_ERA = 4.0;

/**
 * R-16J Step 1 — empirical anchor for the first-inning runs formula.
 *
 * The model's `(FI_ERA / 9)` conversion produces ~0.88 combined runs
 * at all-league-average inputs, but empirical MLB FI combined runs
 * average ~0.55 (NRFI rate ≈ 55-58%). Without this multiplier, the
 * model is structurally biased ~2× too high on FI λ — producing
 * P(NRFI) ≈ 33% when reality is ≈ 56%.
 *
 * The constant is applied as the final multiplier on `expected_first_
 * inning_runs` so league-average inputs land at λ ≈ 0.58 → P(NRFI) ≈
 * 0.56, matching empirical baseline.
 *
 * 0.66 is an empirical estimate based on published MLB NRFI rates.
 * Step 1.5 will populate `games.first_inning_runs` and refit this
 * constant from our own DB. Until then it's a temporary anchor that
 * corrects a clear 2× bias.
 */
export const FI_BASELINE_CALIBRATION = 0.66;

/**
 * R-16J Step 1.7 — FI pick decision thresholds (Poisson NRFI probability).
 *
 *   P(NRFI) ≥ NRFI_PROBABILITY_THRESHOLD          → NRFI
 *   P(NRFI) ≤ YRFI_PROBABILITY_THRESHOLD          → YRFI
 *   YRFI_THRESHOLD < P(NRFI) < NRFI_THRESHOLD     → Toss-Up
 *
 * Step 1 shipped 0.55 / 0.45. Step 1.7 narrows to 0.53 / 0.47 after
 * Step 1.6 fixed the data-locked Toss-Up problem and the remaining
 * Toss-Up volume was driven by genuine probability picks landing in
 * the 0.45–0.55 band. Narrowing surfaces modest but real directional
 * FI edges (e.g. P=0.536) without forcing balance — true 50/50 games
 * (0.47 < P < 0.53) still land Toss-Up.
 *
 * The thresholds are deliberately NOT symmetric tighter than 0.47/0.53
 * — 0.50 is the only true neutral, and a ±0.03 band around it captures
 * genuine model uncertainty without publishing 51/49 reads as picks.
 *
 * The narrow-edge codes below tag directional picks in the [0.53, 0.55)
 * or (0.45, 0.47] bands so the breakdown copy / UI can flag them as
 * narrow-margin without rejecting the pick.
 */
export const NRFI_PROBABILITY_THRESHOLD = 0.53;
export const YRFI_PROBABILITY_THRESHOLD = 0.47;
export const NRFI_NARROW_EDGE_BAND_UPPER = 0.55;
export const YRFI_NARROW_EDGE_BAND_LOWER = 0.45;

/**
 * R-16J Step 1.6 — team-OPS aggregate shrinkage k.
 *
 * Used when the FI offense fallback chain reaches Tier 3 (team-level
 * average batter OPS, computed across rostered batters with PA ≥ 100).
 * Larger than the per-batter k because the underlying sample is the
 * sum of multiple players' PA — a 5-batter team aggregate easily
 * crosses 1500 PA in mid-season, so a meaningful k that still tames
 * thin-roster cases lands around 300.
 */
export const SHRINKAGE_K_TEAM_OPS = 300;

/**
 * R-16J Step 1.6 — NRFI confidence cap penalties per FI offense
 * fallback tier. Applied to the NRFI/YRFI confidence ceiling (NOT to
 * the probability itself). Penalties are in confidence points and use
 * the WORSE of the two sides (max of home + away tiers).
 *
 *   Tier 1: confirmed lineup top-order OPS         (no penalty)
 *   Tier 2: projected lineup top-order OPS         (no penalty — BDL
 *                                                   projections trusted)
 *   Tier 3: team-OPS aggregate proxy               (−3pp)
 *   Tier 4: league average                         (−5pp)
 *
 * The cap reduction acknowledges data quality without forcing a
 * specific decision — a model that lands clearly NRFI/YRFI at tier 3
 * can still surface the pick, just capped at a lower ceiling.
 */
export const NRFI_PROJECTED_LINEUP_PENALTY = 0;
export const NRFI_TEAM_PROXY_PENALTY = 3;
export const NRFI_LEAGUE_AVG_PENALTY = 5;

/**
 * Phase R-14 — per-stage confidence cap configuration.
 *
 * Pre-R-14 we had a single `clamp(raw, 50, cap)` per stage, which
 * meant any raw confidence above the cap (e.g., PIT @ HOU's 206.6
 * ML on 2026-06-04) was indistinguishable from raw values just at
 * the cap (KC @ MIN's 60.5). That flattening hid real model signal
 * — a 5.9-run projected gap read as the same 60% as a 0.4-run gap.
 *
 * The new shape introduces a "soft cap" and a "hard cap" per
 * stage, with a linear compression slope in between:
 *
 *   raw ≤ soft        → display = raw                  (unchanged)
 *   soft < raw ≤ ...  → display = soft + (raw - soft) * compressionSlope
 *   compressed > hard → display = hard                 (clamp)
 *
 * This preserves the existing behavior for thin-edge games (raw at
 * or below the previous cap) while letting strong edges show
 * visibly higher confidence — still bounded by the hard cap so we
 * don't pretend a morning-draft pick is publish-quality.
 *
 * Defaults: compressionSlope = 0.20 (a doubling of raw above the
 * soft cap adds ~20% of that surplus to display). Morning draft
 * hard cap raised from 60 → 72 to capture realistic max edges;
 * T-60 from 75 → 85 to match the higher conviction allowed once
 * lineups confirm.
 *
 * `STAGE_CONFIDENCE_CAPS` (singular cap) is preserved as an alias
 * to the HARD cap for backward compatibility with existing test
 * assertions of the form `confidence <= STAGE_CONFIDENCE_CAPS[stage]`.
 */
export type StageConfidenceCaps = {
  /** Pre-R-14 cap value. Raw at or below this is unchanged. */
  soft: number;
  /** Final value never exceeds this, even after compression. */
  hard: number;
  /** Linear slope applied to raw - soft. 0.20 = aggressive compression;
   *  0.50 = mild. 0.20 chosen to give a slate range of ~18 points
   *  spread on 2026-06-04 (52→70) instead of all-60 bunching. */
  compressionSlope: number;
};

export const STAGE_CONFIDENCE_CAPS_V2: Record<ModelStage, StageConfidenceCaps> = {
  // R-14B — hard caps lowered (72→68 morning, 85→82 locked) so the
  // R-14B dampening layer can actually pull strong-edge games down. The
  // soft caps and compression slope are unchanged.
  morning_draft: { soft: 60, hard: 68, compressionSlope: 0.20 },
  t60_locked: { soft: 75, hard: 82, compressionSlope: 0.20 },
};

/**
 * Back-compat alias = `.hard` of STAGE_CONFIDENCE_CAPS_V2. Existing
 * callers reading this constant get the new hard cap value (72 for
 * morning_draft, 85 for t60_locked). Existing test assertions of
 * `confidence <= STAGE_CONFIDENCE_CAPS[stage]` still hold because
 * the model never emits a confidence above the hard cap.
 */
export const STAGE_CONFIDENCE_CAPS: Record<ModelStage, number> = {
  morning_draft: STAGE_CONFIDENCE_CAPS_V2.morning_draft.hard,
  t60_locked: STAGE_CONFIDENCE_CAPS_V2.t60_locked.hard,
};

/**
 * R-14 — apply soft-cap + linear-compression + hard-cap. Pure
 * function; used by mlbAutoModelV1's ML and OU branches. NRFI uses
 * its own zone-based cap (NRFI_CONFIDENCE_CAP) and is untouched.
 */
export function compressConfidence(raw: number, caps: StageConfidenceCaps): number {
  if (raw <= caps.soft) return raw;
  const compressed = caps.soft + (raw - caps.soft) * caps.compressionSlope;
  return Math.min(compressed, caps.hard);
}

/**
 * R-14B — confidence dampening flags. Each flag defaults to `false` when
 * the underlying data is unavailable, so missing data never inflates the
 * displayed number. `dampenRawConfidence` applies these BEFORE the
 * soft/hard compression in `compressConfidence`, so the dampening can
 * pull a strong raw value down below the hard cap.
 */
export type DampeningFlags = {
  // ── Starter quality (ML only) ──
  home_starter_low_gs: boolean;
  away_starter_low_gs: boolean;
  home_starter_low_ip: boolean;
  away_starter_low_ip: boolean;
  home_starter_reliever_as_starter: boolean;
  away_starter_reliever_as_starter: boolean;
  // ── Cross-market data quality ──
  bullpen_fallback: boolean;
  morning_unconfirmed: boolean;
  // ── ML market context ──
  public_smoke_aligned_with_pick: boolean;
  no_ml_split_data: boolean;
  partial_market_coverage: boolean;
  // ── OU market context ──
  sharp_plus_ev_opposes_ou: boolean;
  no_total_split_data: boolean;
};

/**
 * R-14B — applies per-flag additive penalties to raw confidence BEFORE
 * compression. Returns the dampened raw plus the penalty + reason list
 * for diagnostic output. Floor: dampened raw never drops below 50.
 *
 * The thin-OU-edge case ("ouDiff < 0.25 → should stay low") is handled
 * naturally by the raw formula `50 + 8*ouDiff` (≤ 52), which is below
 * every soft cap, so no explicit penalty is needed.
 */
export function dampenRawConfidence(
  raw: number,
  flags: DampeningFlags,
  market: "ml" | "ou"
): { dampened: number; penalty: number; reasons: string[] } {
  let penalty = 0;
  const reasons: string[] = [];
  const add = (n: number, reason: string) => {
    penalty += n;
    reasons.push(`${reason}(-${n})`);
  };

  if (market === "ml") {
    if (flags.home_starter_low_gs) add(6, "home_low_gs");
    if (flags.away_starter_low_gs) add(6, "away_low_gs");
    if (flags.home_starter_low_ip) add(4, "home_low_ip");
    if (flags.away_starter_low_ip) add(4, "away_low_ip");
    if (flags.home_starter_reliever_as_starter) add(4, "home_rp_as_sp");
    if (flags.away_starter_reliever_as_starter) add(4, "away_rp_as_sp");
    if (flags.bullpen_fallback) add(3, "bullpen_fallback");
    if (flags.morning_unconfirmed) add(3, "morning_unconfirmed");
    if (flags.public_smoke_aligned_with_pick) add(4, "public_smoke_aligned");
    if (flags.no_ml_split_data) add(2, "no_ml_splits");
    if (flags.partial_market_coverage) add(2, "partial_market");
  } else {
    if (flags.sharp_plus_ev_opposes_ou) add(6, "sharp_ev_opposes");
    if (flags.bullpen_fallback) add(3, "bullpen_fallback");
    if (flags.morning_unconfirmed) add(3, "morning_unconfirmed");
    if (flags.no_total_split_data) add(2, "no_total_splits");
  }

  const dampened = Math.max(50, raw - penalty);
  return { dampened, penalty, reasons };
}

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

// Phase 3.x.3 recalibration — anchored on observed real-FI distribution
// (median ≈ 1.07 runs per game on the 5/22 backfilled slate; MLB historical
// first-inning runs per game ≈ 0.9–1.1). The pre-3.x.3 thresholds were
// calibrated against the season_era × 0.7 proxy, which systematically
// underestimated first-inning damage and clustered every real-FI game as
// strong_yrfi. See Phase 3.x.2.C-prime analytical report.
export const NRFI_THRESHOLD_STRONG = 0.50;
export const NRFI_THRESHOLD_LEAN = 0.85;
export const YRFI_THRESHOLD_LEAN = 1.15;
export const YRFI_THRESHOLD_STRONG = 1.45;

// ─────────────────────────────────────────────────────────────
// FI WHIP secondary modifier (added 2026-06-02)
// ─────────────────────────────────────────────────────────────
//
// Per-starter first-inning WHIP applied as a small multiplicative
// modifier on each starter's per-side expected first-inning runs,
// AFTER the ERA-based computation but before global modifiers
// (park/weather/market). Designed as a SECONDARY signal — not a
// replacement for FI ERA.
//
// Baseline (1.225) is empirically grounded in MLB FI WHIP norms — the
// median of our `player_season_stats.first_inning_whip` distribution on
// the current ingested set was 1.22. Scale (0.35) limits the modifier's
// influence to roughly one-third of its raw deviation from baseline,
// reflecting that FI ERA and FI WHIP are ~0.81 correlated in our data
// (most of WHIP's signal is already captured by ERA). Hard clamp
// [0.96, 1.04] caps the modifier at ±4% so a single outlier sample
// cannot meaningfully swing the model.
//
// Gated by FIRST_INNING_SAMPLE_GATE (3 starts, same as FI ERA gate).
// Below the gate or when WHIP is null, the modifier is a no-op (1.0)
// and a per-side reason code is emitted.
export const FI_WHIP_BASELINE = 1.225;
export const FI_WHIP_MODIFIER_SCALE = 0.35;
export const FI_WHIP_MODIFIER_CLAMP_MIN = 0.96;
export const FI_WHIP_MODIFIER_CLAMP_MAX = 1.04;

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

/** Phase 6B.1 — V2 market-prior model version tag. */
export const MODEL_VERSION_V2 = "auto_v2.0_mlb_market_prior";

/** Phase 6B V2.1 — layered prediction-integrity model version tag. */
export const MODEL_VERSION_V2_1 = "auto_v2.1_mlb_prediction_integrity";
export const MODEL_VERSION_V2_2 = "auto_v2.2_mlb_full_game_projection";
