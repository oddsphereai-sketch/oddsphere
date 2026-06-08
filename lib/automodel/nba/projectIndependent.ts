/**
 * Phase 7A — NBA Finals v0a — independent score projection (Layer 1).
 *
 * Pure function. No DB, no network. Given a NbaGameSnapshot, returns the
 * model's standalone (market-free) projected score for both teams plus
 * the standard deviation of each side's score distribution.
 *
 * Method (v0):
 *
 *   pace_avg = (home.pace + away.pace) / 2
 *   off_h_eff = home.off_rating  (or LEAGUE_AVG when null)
 *   def_a_eff = away.def_rating  (or LEAGUE_AVG when null)
 *   home_expected_per_100 = (off_h_eff + def_a_eff) / 2
 *   away_expected_per_100 = (off_a_eff + def_h_eff) / 2
 *   home_mean = home_expected_per_100 × (pace_avg / 100) + HCA / 2
 *   away_mean = away_expected_per_100 × (pace_avg / 100) - HCA / 2
 *
 * HCA: playoffs gets the NBA_HCA_PLAYOFFS bump (3.5 pts); regular season
 *      uses NBA_HCA_REGULAR_SEASON (3.0 pts). v0 hard-codes playoffs
 *      because the v0a use case IS the Finals series.
 *
 * Variance: score SD derived from baseline (12 pts) modulated by pace —
 *           higher pace games have wider score variance (more possessions,
 *           more noise). v0 applies a small linear adjustment.
 *
 * Honest missingness: when net_rating/pace are null, the formula falls
 * back to league-average constants and the caller should mark the row
 * as fallback-tier downstream.
 */

import {
  NBA_HCA_PLAYOFFS,
  NBA_HCA_REGULAR_SEASON,
  NBA_LEAGUE_AVG_DEF_RATING,
  NBA_LEAGUE_AVG_OFF_RATING,
  NBA_LEAGUE_AVG_PACE,
  NBA_SCORE_SD_BASELINE,
  type NbaGameSnapshot,
  type NbaTeamSnapshot,
} from "./types";

export type IndependentProjection = {
  home_score_mean: number;
  away_score_mean: number;
  home_score_sd: number;
  away_score_sd: number;
  /** Pace average used (informational; in possessions per 48). */
  pace_used: number;
  /** Home court advantage used (points). */
  hca_used: number;
  /** True when at least one input was league-average due to a null. */
  used_fallback_rating: boolean;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function ratingOrFallback(
  primary: number | null,
  fallback: number,
): { value: number; usedFallback: boolean } {
  if (primary === null || !Number.isFinite(primary)) {
    return { value: fallback, usedFallback: true };
  }
  return { value: primary, usedFallback: false };
}

function pickHca(opts: { isPlayoffs: boolean }): number {
  return opts.isPlayoffs ? NBA_HCA_PLAYOFFS : NBA_HCA_REGULAR_SEASON;
}

/**
 * Pure independent projection. Inputs nullable; output never null.
 */
export function projectIndependent(
  snap: NbaGameSnapshot,
  opts: { isPlayoffs?: boolean } = {},
): IndependentProjection {
  // v0a default = playoffs because the use case IS the Finals series.
  const isPlayoffs = opts.isPlayoffs ?? true;

  const offH = ratingOrFallback(snap.home_team.off_rating, NBA_LEAGUE_AVG_OFF_RATING);
  const defH = ratingOrFallback(snap.home_team.def_rating, NBA_LEAGUE_AVG_DEF_RATING);
  const offA = ratingOrFallback(snap.away_team.off_rating, NBA_LEAGUE_AVG_OFF_RATING);
  const defA = ratingOrFallback(snap.away_team.def_rating, NBA_LEAGUE_AVG_DEF_RATING);
  const paceH = ratingOrFallback(snap.home_team.pace, NBA_LEAGUE_AVG_PACE);
  const paceA = ratingOrFallback(snap.away_team.pace, NBA_LEAGUE_AVG_PACE);

  const usedFallback =
    offH.usedFallback ||
    defH.usedFallback ||
    offA.usedFallback ||
    defA.usedFallback ||
    paceH.usedFallback ||
    paceA.usedFallback;

  const paceAvg = (paceH.value + paceA.value) / 2;
  const possessionsPerGame = paceAvg; // pace IS poss per 48

  // Expected points-per-100 for the matchup: blend HOME's off vs AWAY's def
  // and symmetric. (Standard Pythagorean-style team-vs-team projection.)
  const homePer100 = (offH.value + defA.value) / 2;
  const awayPer100 = (offA.value + defH.value) / 2;

  const hca = pickHca({ isPlayoffs });

  // Project to actual score: per-100 × pace / 100, with HCA split between
  // sides (home gets +HCA/2, away gets -HCA/2 so the sum equals the
  // sum-without-HCA + 0 — HCA shifts the differential, not the total).
  const homeRaw = homePer100 * (possessionsPerGame / 100);
  const awayRaw = awayPer100 * (possessionsPerGame / 100);
  const homeMean = homeRaw + hca / 2;
  const awayMean = awayRaw - hca / 2;

  // SD baseline 12 pts. Pace adjustment: a pace 10 above league avg
  // bumps SD by ~1pt (roughly sqrt-of-possessions intuition, applied
  // linearly at the v0 scale).
  const paceAdjustment = (paceAvg - NBA_LEAGUE_AVG_PACE) * 0.1;
  const sd = clamp(NBA_SCORE_SD_BASELINE + paceAdjustment, 9, 16);

  return {
    home_score_mean: round1(homeMean),
    away_score_mean: round1(awayMean),
    home_score_sd: round1(sd),
    away_score_sd: round1(sd),
    pace_used: round1(paceAvg),
    hca_used: hca,
    used_fallback_rating: usedFallback,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Re-exported for fixture tests.
export const __NBA_PROJECT_INDEPENDENT_TEST__ = {
  ratingOrFallback,
  pickHca,
};

// Silence "unused" warnings for type-only imports referenced elsewhere.
void ({} as NbaTeamSnapshot | null);
