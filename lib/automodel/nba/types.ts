/**
 * Phase 7A — NBA Finals v0a — shared types for the NBA auto-model.
 *
 * MLB-untouchable: nothing in here is imported by lib/automodel/types.ts,
 * any MLB module, the MLB orchestrator, or any cron-bound code. This is
 * a parallel module tree purpose-built for NBA v0 / internal admin preview.
 *
 * v0a posture:
 *   • Provisional EVERYTHING — outputs are admin-only, never member-facing.
 *   • Series context IS included (game number, series score, rest,
 *     venue shift, closeout pressure) because the current Finals series
 *     is in progress.
 *   • Confidence ceilings are NBA-specific placeholders (NOT MLB's 78/64
 *     /58/54). Labeled clearly as v0 placeholders below.
 *   • DB currently has 0 NBA rows. Snapshot fields are null-safe by design;
 *     the model emits fallback-tier output when ratings/injuries are absent.
 *
 * Pure type definitions + small constants. No logic, no DB, no network.
 */

// ─────────────────────────────────────────────────────────────
// Stage execution (mirrors MLB's ModelStage so the operator script
// and admin UI can share the same shape if we ever fold them).
// ─────────────────────────────────────────────────────────────

export type NbaModelStage = "morning_draft" | "t60_locked";

// ─────────────────────────────────────────────────────────────
// Team ratings — read from a future `nba_team_ratings` source.
// For v0 the snapshot builder returns null-filled rows; the model
// is null-safe and downgrades to fallback tier when these are absent.
// ─────────────────────────────────────────────────────────────

export type NbaTeamSnapshot = {
  team_external_id: number;
  abbreviation: string;
  /** Offensive rating: points scored per 100 possessions. League avg ~115. */
  off_rating: number | null;
  /** Defensive rating: points allowed per 100 possessions. League avg ~115. */
  def_rating: number | null;
  /** off_rating - def_rating. League avg 0. */
  net_rating: number | null;
  /** Possessions per 48 min. Modern league avg ~99-100. */
  pace: number | null;
  /** Recent-form net rating over last 10 games. Optional. */
  recent_form_10g_net_rating: number | null;
};

// ─────────────────────────────────────────────────────────────
// Injuries (ESPN public source, provisional fallback when unknown).
// ─────────────────────────────────────────────────────────────

export type NbaInjuryStatus =
  | "out"
  | "questionable"
  | "probable"
  | "available"
  | "unknown";

export type NbaPlayerInjury = {
  /** Internal DB id when mapped; null when we couldn't map the ESPN row. */
  player_id: number | null;
  name: string;
  status: NbaInjuryStatus;
};

// ─────────────────────────────────────────────────────────────
// Series context — IS included in v0a per Daniel's call.
// Pure-derived from prior games in the same matchup. The
// seriesContext helper computes this; the snapshot carries it.
// ─────────────────────────────────────────────────────────────

export type NbaSeriesContext = {
  /** 1-indexed game number in the series. Game 1 = 1, Game 7 = 7. */
  game_number: number;
  /** Wins so far in the series for the home team of THIS game. */
  series_score_home: number;
  /** Wins so far in the series for the away team of THIS game. */
  series_score_away: number;
  /**
   * Positive when home team is up in the series, negative when home is
   * down, zero when tied. Convenient for downstream "closeout" checks.
   */
  home_team_leads_series_by: number;
  /** True when home would be eliminated by a loss in this game. */
  is_elimination_for_home: boolean;
  /** True when away would be eliminated by a loss in this game. */
  is_elimination_for_away: boolean;
  /** Days of rest for the home team since their last game in this series. */
  days_rest_home: number | null;
  /** Days of rest for the away team since their last game in this series. */
  days_rest_away: number | null;
  /**
   * True when this game is the FIRST game at the new venue after a
   * stretch at the other venue (e.g. Game 3 after Games 1-2 elsewhere).
   * Approximation: a venue shift is when the previous game in the series
   * had a different home team than this one.
   */
  venue_shift: boolean;
};

// ─────────────────────────────────────────────────────────────
// Market snapshot — full game ML / spread / total.
// All fields are nullable; marketPrior handles missing values gracefully.
// ─────────────────────────────────────────────────────────────

export type NbaMarketSnapshot = {
  ml: {
    home_odds_american: number | null;
    away_odds_american: number | null;
  };
  spread: {
    /**
     * Sportsbook-listed spread for the HOME team in points. Negative when
     * home is favorite (e.g. -4.5 means home is favored by 4.5). Null
     * when not posted.
     */
    home_line: number | null;
    home_odds_american: number | null;
    away_odds_american: number | null;
  };
  total: {
    line: number | null;
    over_odds_american: number | null;
    under_odds_american: number | null;
  };
};

// ─────────────────────────────────────────────────────────────
// Data-quality assessment (mirror of MLB's pattern, NBA-specific tiers).
// ─────────────────────────────────────────────────────────────

export type NbaDataQuality = {
  /** Both teams' net_rating/pace fields are non-null. */
  ratings_present: boolean;
  /** Home injuries fetched without "unknown" for any high-impact player. */
  home_injuries_known: boolean;
  away_injuries_known: boolean;
  /** market_prior produced a non-null no-vig baseline. */
  market_present: boolean;
  /** Series context derived from prior games (vs assumed Game 1). */
  series_context_derived: boolean;
};

// ─────────────────────────────────────────────────────────────
// Game snapshot — the model's input contract.
// ─────────────────────────────────────────────────────────────

export type NbaGameSnapshot = {
  game_external_id: number;
  /** YYYY-MM-DD slate date (ET). */
  slate_date: string;
  /** ISO 8601 game start time. */
  game_time_iso: string | null;
  home_team: NbaTeamSnapshot;
  away_team: NbaTeamSnapshot;
  home_injuries: NbaPlayerInjury[];
  away_injuries: NbaPlayerInjury[];
  series: NbaSeriesContext | null;
  market: NbaMarketSnapshot;
  data_quality: NbaDataQuality;
};

// ─────────────────────────────────────────────────────────────
// Model output + audit (V22-shaped audit trail).
// ─────────────────────────────────────────────────────────────

export type NbaDataQualityTier = "high" | "medium" | "low" | "fallback";

export type NbaAutoModelAudit = {
  // Layer 1 — independent projection
  independent_home_score: number;
  independent_away_score: number;
  independent_home_sd: number;
  independent_away_sd: number;
  // Layer 2 — market baseline
  market_total: number | null;
  market_spread_home: number | null;
  market_home_ml_no_vig: number | null;
  market_away_ml_no_vig: number | null;
  market_baseline_valid: boolean;
  // Layer 3 — blended posterior
  posterior_home_score: number;
  posterior_away_score: number;
  posterior_total: number;
  posterior_spread_home: number;
  trust_independent: number;
  // Layer 4 — reviewer
  data_quality_tier: NbaDataQualityTier;
  confidence_ceiling: number;
  /** Injury statuses that hit the model. */
  injury_unknown_count_home: number;
  injury_unknown_count_away: number;
  injury_out_count_home: number;
  injury_out_count_away: number;
  // Layer 5 — picks
  ml_pick: "home" | "away";
  ml_confidence: number;
  ml_best_angle_eligible: boolean;
  spread_pick: "home" | "away";
  spread_confidence: number;
  total_pick: "over" | "under";
  total_confidence: number;
  // Series-context audit
  series_game_number: number | null;
  series_score_home: number | null;
  series_score_away: number | null;
  series_closeout_pressure: boolean;
  series_venue_shift: boolean;
  // Notes / posture
  model_integrity_notes: string[];
  provisional: boolean;
};

export type NbaAutoModelOutput = {
  game_external_id: number;
  prediction_source: "auto_v0_nba_internal";
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total: number;
  predicted_spread_home: number;
  predicted_ml_winner: "home" | "away";
  ml_confidence: number;
  predicted_spread_side: "home" | "away";
  spread_confidence: number;
  predicted_total_side: "over" | "under";
  total_confidence: number;
  /** Stage at runtime — mirrors MLB. */
  stage: NbaModelStage;
  /** Always true for v0a (user-approved). */
  provisional: boolean;
  audit: NbaAutoModelAudit;
};

// ─────────────────────────────────────────────────────────────
// NBA-specific constants — v0 placeholders, clearly labeled.
// ─────────────────────────────────────────────────────────────

/** Modern NBA home-court advantage in points. Regular season ~2.5-3.0;
 *  playoffs ~3.0-3.5. Used by projectIndependent. */
export const NBA_HCA_REGULAR_SEASON = 3.0;
export const NBA_HCA_PLAYOFFS = 3.5;

/** League-average team rating fallback used when net_rating is null. */
export const NBA_LEAGUE_AVG_OFF_RATING = 115.0;
export const NBA_LEAGUE_AVG_DEF_RATING = 115.0;
export const NBA_LEAGUE_AVG_PACE = 99.0;

/**
 * Score standard deviation baseline. NBA team-score SD has run ~12 in
 * recent seasons; playoff games are typically slightly tighter. v0
 * placeholder — recalibrate from settled results when we have them.
 */
export const NBA_SCORE_SD_BASELINE = 12.0;

/**
 * Confidence ceilings per data-quality tier — NBA-specific placeholders.
 * Spec called for high=72 / medium=62 / low=55 / fallback=52. These are
 * v0 placeholders, not derived from settled-results calibration.
 */
export const NBA_CONFIDENCE_CEILING: Record<NbaDataQualityTier, number> = {
  high: 72,
  medium: 62,
  low: 55,
  fallback: 52,
} as const;

export const NBA_CONFIDENCE_FLOOR = 50;

/**
 * Best-Angle gate: confidence >= 62 AND data_quality_tier === 'high' AND
 * no major injury unknowns. v0 placeholder threshold.
 */
export const NBA_BEST_ANGLE_MIN_CONFIDENCE = 62;

/** Model version tag. */
export const NBA_MODEL_VERSION = "auto_v0a_nba_internal_preview";
