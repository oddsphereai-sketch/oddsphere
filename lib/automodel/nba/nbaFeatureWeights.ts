/**
 * Phase 7C — NBA v1 research-prior constants.
 *
 * ⚠ ADMIN/AUDIT-ONLY TERMINOLOGY. The labels "research-prior",
 * "calibration pending", "Oliver priors", "v1 weights" appear only in
 * admin preview / audit scripts. The member-facing Daily Edge MUST NOT
 * surface any of these tokens; customer rendering uses polished
 * language only (grade, confidence, model edge, market context,
 * injury/data-quality cautions).
 *
 * Every constant in this file is labeled with:
 *   • the research source / prior it derives from
 *   • why this magnitude is plausible
 *   • that the value is NOT calibrated from settled NBA outcomes yet
 *
 * Calibration is scheduled for after enough NBA games are graded
 * (target: ≥30 settled games). Until then, treat these as priors.
 *
 * Pure constants. No DB, no network. Imported by nbaAutoModelV2.
 */

import type { NbaDataQualityTier } from "./types";

// ─────────────────────────────────────────────────────────────
// League anchors
// ─────────────────────────────────────────────────────────────

/**
 * League-average pace points per 100 possessions, modern era.
 * Used as the baseline efficiency anchor in Step 2 of the pipeline.
 * Source: NBA.com season averages 2023-2026 ~ 114-115. Research-prior.
 */
export const V1_LEAGUE_AVG_PP100 = 114.5;

/**
 * League-average offensive rating used to compute team strength above/
 * below average. Same magnitude as PP100; kept separate for clarity.
 */
export const V1_LEAGUE_AVG_OFF_RATING = 114.5;

/** League-average defensive rating (mirror of offensive average). */
export const V1_LEAGUE_AVG_DEF_RATING = 114.5;

/** League-average pace (possessions per 48). Recent NBA ~99-100. */
export const V1_LEAGUE_AVG_PACE = 99.5;

// ─────────────────────────────────────────────────────────────
// Home-court advantage
// ─────────────────────────────────────────────────────────────

/**
 * Regular-season HCA in points. Research-prior. Public estimates have
 * trended down toward ~2.5 in the post-2020 era from the classic ~3.0
 * (see Wages of Wins, 538 long-run analyses).
 */
export const V1_HCA_REGULAR_SEASON = 2.5;

/**
 * Playoff HCA in points. Marginally larger than regular season due to
 * crowd intensity + travel cumulative effect. Research-prior.
 */
export const V1_HCA_PLAYOFFS = 3.0;

// ─────────────────────────────────────────────────────────────
// Rest / venue context
// ─────────────────────────────────────────────────────────────

/**
 * Per-day rest differential modifier in points. Used to compute a small
 * symmetric bump when one team has more rest than the other. Bounded
 * total below.
 */
export const V1_REST_DELTA_PP_GAME = 0.5;

/** Maximum absolute rest-differential adjustment in points. */
export const V1_REST_DELTA_MAX = 1.5;

// ─────────────────────────────────────────────────────────────
// Four Factors (Dean Oliver, "Basketball on Paper", 2004)
// ─────────────────────────────────────────────────────────────
//
// Research prior: Oliver's relative ordering puts eFG > TOV > ORB > FT.
// Common approximations of his weights are 40% / 25% / 20% / 15% of the
// shooting-vs-rebounding-vs-turnovers-vs-foul-getting effect on
// efficiency. These are STARTING priors — the v1 budget allocator below
// uses them as the modifier weights, NOT as raw point swings.

/** Oliver weight share of the Four Factors modifier budget. */
export const V1_FF_WEIGHTS = {
  efg: 0.40,
  tov: 0.25,
  orb: 0.20,
  ft: 0.15,
} as const;

/**
 * Maximum combined Four Factors modifier per team per 100 possessions.
 * Set deliberately small (±3.0 pp100) so Four Factors cannot overwhelm
 * the ORtg/DRtg backbone. Research-prior cap; will be re-tuned post-
 * calibration. (Per Daniel's explicit direction 2026-06-08.)
 */
export const V1_FF_BUDGET_PP100 = 3.0;

/**
 * Scale factors converting (team_pct - opp_pct) deltas into points per
 * 100 possessions BEFORE the budget cap.
 *
 * Magnitudes derived from research priors:
 *   • Each 1pp eFG advantage shifts offensive efficiency by roughly
 *     1.0 pp100 at the matchup level (1pp eFG ≈ ~0.6 added points per
 *     shot × ~75 shots / 100 poss → ~0.45 raw, doubled when
 *     factoring matchup leverage; rounded to 1.0 for the v1 prior).
 *   • TOV: similar shape — each 1pp TOV advantage saves ~1.0 pp100
 *     (one fewer turnover per 100 poss → ~1.1 added value).
 *   • ORB: smaller — each 1pp ORB advantage adds ~0.5 pp100
 *     (one extra offensive rebound creates a putback opportunity
 *     worth roughly half a possession).
 *   • FT rate: smallest — each 1pp FT-rate advantage adds ~0.4 pp100
 *     (free throws are efficient but FT-rate deltas are small in NBA).
 *
 * All four are CAPPED individually at ±2.0 pp100 before the budget
 * weighting and final ±3.0 pp100 cap apply.
 */
export const V1_FF_PP100_SCALES = {
  efg: 1.0,
  tov: 1.0,
  orb: 0.5,
  ft: 0.4,
} as const;

/** Per-factor absolute cap (in points per 100) before weighting. */
export const V1_FF_PER_FACTOR_CAP_PP100 = 2.0;

// ─────────────────────────────────────────────────────────────
// Recency / playoff blend (Bayesian-style shrinkage)
// ─────────────────────────────────────────────────────────────
//
// Research prior: small playoff samples are noisy. With 0 prior games
// the playoff weight is 0 (pure regular season). The weight grows
// smoothly toward 1 as sample increases, with K controlling the
// inflection point. K=10 means a 10-game playoff sample carries
// equal weight to season baseline; below 10 games season dominates.

/** Shrinkage constant K in playoff_weight = games / (games + K). */
export const V1_RECENCY_SHRINKAGE_K = 10;

/** Hard cap on playoff weight — never trust ONLY the playoff sample. */
export const V1_PLAYOFF_WEIGHT_MAX = 0.70;

// ─────────────────────────────────────────────────────────────
// Distribution / probability constants
// ─────────────────────────────────────────────────────────────
//
// Research priors: NBA team-margin standard deviation has run ~12 pts
// in modern eras (per multiple public regressions). NBA total-points
// distribution has higher SD (~21 pts) because over/under depends on
// BOTH teams' scoring noise compounded.

/** Margin (home minus away) standard deviation in points. */
export const V1_MARGIN_SD = 12.0;

/** Total (home plus away) standard deviation in points. */
export const V1_TOTAL_SD = 21.0;

/** Volatility bump (added to margin SD) when injuries unknown / data thin. */
export const V1_SD_INFLATION_INJURY_UNKNOWN = 1.5;
export const V1_SD_INFLATION_LIMITED_BOOKS = 1.0;

// ─────────────────────────────────────────────────────────────
// Confidence ceilings + caps (NBA-tuned, research-prior placeholders)
// ─────────────────────────────────────────────────────────────

/**
 * Per data-quality tier ceilings. Same shape as v0 NBA_CONFIDENCE_CEILING
 * but tightened slightly because v1 has more inputs (Four Factors) →
 * cleaner edges should be earnable, but we cap until calibration proves
 * the model is properly calibrated.
 */
export const V1_CONFIDENCE_CEILING: Record<NbaDataQualityTier, number> = {
  high: 70,
  medium: 60,
  low: 53,
  fallback: 50,
} as const;

export const V1_CONFIDENCE_FLOOR = 50;

/** Minimum confidence for v1 Best Angle eligibility. */
export const V1_BEST_ANGLE_MIN_CONFIDENCE = 62;

/** Minimum probability edge (model_prob - market_no_vig) for Best Angle. */
export const V1_BEST_ANGLE_MIN_EDGE_PROB = 0.04;

/** Confidence cap when a major player is OUT (no quantified impact yet). */
export const V1_CAP_MAJOR_OUT = 60;

/** Confidence cap when a major player's status is UNKNOWN. */
export const V1_CAP_MAJOR_UNKNOWN = 55;

/** Confidence cap when book coverage is limited (≤ 2 books seen). */
export const V1_CAP_LIMITED_BOOK_COVERAGE = 60;

/** Confidence cap when market data is missing entirely. */
export const V1_CAP_NO_MARKET = 55;

// ─────────────────────────────────────────────────────────────
// v0 vs v1 audit-flag thresholds
// ─────────────────────────────────────────────────────────────

export const V1_AUDIT_FLAG_SPREAD_DELTA_PT = 2.0;
export const V1_AUDIT_FLAG_TOTAL_DELTA_PT = 4.0;
export const V1_AUDIT_FLAG_ML_DELTA_PP = 5.0;

// ─────────────────────────────────────────────────────────────
// Sensitivity helper (±25% per Four Factor weight)
// ─────────────────────────────────────────────────────────────

/**
 * Returns the 8 (4 factors × ±25%) perturbed weight vectors used by
 * scripts/audit/nba/compare-nba-v0-v1.ts to show sensitivity. Pure.
 */
export function ffSensitivityVectors(): Array<{
  label: string;
  weights: typeof V1_FF_WEIGHTS;
}> {
  const base = V1_FF_WEIGHTS;
  const factors: Array<keyof typeof V1_FF_WEIGHTS> = ["efg", "tov", "orb", "ft"];
  const out: Array<{ label: string; weights: typeof V1_FF_WEIGHTS }> = [];
  for (const f of factors) {
    out.push({
      label: `${f}-25%`,
      weights: { ...base, [f]: base[f] * 0.75 } as typeof V1_FF_WEIGHTS,
    });
    out.push({
      label: `${f}+25%`,
      weights: { ...base, [f]: base[f] * 1.25 } as typeof V1_FF_WEIGHTS,
    });
  }
  return out;
}

// Future TODO (post-calibration):
//   • Replace research-prior FF_WEIGHTS with calibrated values from
//     settled-results regression.
//   • Add nonlinear/interaction terms once we have enough data to fit them.
//   • Tighten V1_FF_BUDGET_PP100 if FF modifier proves to be over-weighted
//     vs the ORtg/DRtg backbone in backtest.
