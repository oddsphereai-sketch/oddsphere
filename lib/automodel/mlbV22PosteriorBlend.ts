/**
 * Push 3A — V2.2 Adaptive Posterior Blend (Layer 3).
 *
 * Blends the independent baseball projection with the market baseline,
 * using ADAPTIVE weights driven by data quality + missingness. The
 * weight schedule is tuned so high-quality features can push the model
 * meaningfully away from market (up to 65% independent), while sparse
 * features shrink toward market (down to 25% independent).
 *
 * Differences from V2.1's blend:
 *
 *   V2.1 (Push 1 launch): trust coefficients of 0.55 / 0.35 / 0.25 /
 *   1.00 applied to a V1-bridged Layer 2 residual. The 0.55 ceiling
 *   was conservative because Layer 2 wrapped V1's compressed scores,
 *   so even at "high" data quality the model couldn't move far from
 *   the market.
 *
 *   V2.2 (this push): Layer 2 is now a clean independent projection
 *   from real baseball features. Trust coefficients raised:
 *     high   → 0.65 independent / 0.35 market
 *     medium → 0.45 independent / 0.55 market
 *     low    → 0.25 independent / 0.75 market
 *     fallback → 1.00 independent (no market available) OR
 *                0.05 independent (severely missing features)
 *
 * Guardrails:
 *   - Posterior total never moves more than CAP_RUNS from market_total.
 *   - Posterior run differential never moves more than CAP_RUNS from
 *     market-implied run differential.
 *   - These caps prevent any single feature outlier from yanking
 *     the projection to absurd values. The caps are wide enough at
 *     CAP_RUNS=2.5 to allow legitimate +/- 2 run movement without
 *     producing 10+ run projections.
 *
 * Confidence floor / ceiling:
 *   - Confidence is computed AFTER the blend by mapping projected
 *     win probability + run differential to a 0-100 scale.
 *   - Each data-quality tier has a ceiling so missing data can't
 *     produce 80%+ confidence even when the bet looks profitable.
 */

import type { MarketBaseline } from "./marketPrior";
import type { V22IndependentProjection } from "./mlbIndependentProjection";

// ─── trust coefficients ───────────────────────────────────────────

export const V22_TRUST_INDEPENDENT_HIGH = 0.65;
export const V22_TRUST_INDEPENDENT_MEDIUM = 0.45;
export const V22_TRUST_INDEPENDENT_LOW = 0.25;
export const V22_TRUST_INDEPENDENT_FALLBACK_NO_MARKET = 1.0;
export const V22_TRUST_INDEPENDENT_SEVERE_MISSING = 0.05;

// Cap movement away from market (runs).
export const V22_POSTERIOR_TOTAL_CAP_RUNS = 2.5;
export const V22_POSTERIOR_DIFF_CAP_RUNS = 2.5;

// Confidence ceilings by tier
export const V22_CONFIDENCE_CEILING = {
  high: 78,
  medium: 64,
  low: 58,
  fallback: 54,
} as const;

export const V22_CONFIDENCE_FLOOR = 50;

// ─── types ────────────────────────────────────────────────────────

export type V22PosteriorInputs = {
  market: MarketBaseline | null;
  independent: V22IndependentProjection;
};

export type V22PosteriorOutput = {
  away_expected_runs: number;
  home_expected_runs: number;
  total_expected_runs: number;
  home_run_diff: number;
  /** Independent weight used in the blend (0 to 1). */
  trust_independent: number;
  market_total_used: number | null;
  market_implied_away: number | null;
  market_implied_home: number | null;
  market_implied_diff: number | null;
  posterior_moved_runs_from_market: number;
  capped_by_total: boolean;
  capped_by_diff: boolean;
};

// ─── pure helpers ─────────────────────────────────────────────────

export function selectTrustIndependent(args: {
  tier: V22IndependentProjection["data_quality_tier"];
  missingCount: number;
  hasMarket: boolean;
}): number {
  if (!args.hasMarket) return V22_TRUST_INDEPENDENT_FALLBACK_NO_MARKET;
  // Severe missingness override — never trust independent more than
  // a token amount when 12+ features are missing.
  if (args.missingCount >= 10) return V22_TRUST_INDEPENDENT_SEVERE_MISSING;
  switch (args.tier) {
    case "high": return V22_TRUST_INDEPENDENT_HIGH;
    case "medium": return V22_TRUST_INDEPENDENT_MEDIUM;
    case "low": return V22_TRUST_INDEPENDENT_LOW;
    case "fallback": return V22_TRUST_INDEPENDENT_SEVERE_MISSING;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute the adaptive posterior given the independent projection
 * and (optionally) the market baseline. When market is null the
 * posterior IS the independent projection; the caller marks the
 * row provisional and applies a low confidence ceiling.
 */
export function blendPosterior(
  inputs: V22PosteriorInputs,
): V22PosteriorOutput {
  const indep = inputs.independent;
  const market = inputs.market;
  const hasMarket =
    market !== null &&
    market.dataQuality === "ok" &&
    market.listedTotal !== null &&
    market.homeImpliedTotal !== null &&
    market.awayImpliedTotal !== null;

  const trustIndep = selectTrustIndependent({
    tier: indep.data_quality_tier,
    missingCount: indep.feature_audit.missing_count,
    hasMarket,
  });
  const trustMarket = 1 - trustIndep;

  let awayPosterior = indep.away_expected_runs;
  let homePosterior = indep.home_expected_runs;
  let capByTotal = false;
  let capByDiff = false;

  let marketAwayImplied: number | null = null;
  let marketHomeImplied: number | null = null;
  let marketTotal: number | null = null;
  let marketDiff: number | null = null;

  if (hasMarket && market !== null) {
    marketAwayImplied = market.awayImpliedTotal;
    marketHomeImplied = market.homeImpliedTotal;
    marketTotal = market.marketExpectedTotal ?? market.listedTotal;
    marketDiff =
      marketHomeImplied !== null && marketAwayImplied !== null
        ? marketHomeImplied - marketAwayImplied
        : null;

    awayPosterior =
      trustIndep * indep.away_expected_runs +
      trustMarket * (marketAwayImplied ?? indep.away_expected_runs);
    homePosterior =
      trustIndep * indep.home_expected_runs +
      trustMarket * (marketHomeImplied ?? indep.home_expected_runs);

    // Total guardrail
    const posteriorTotal = awayPosterior + homePosterior;
    if (marketTotal !== null) {
      const dT = posteriorTotal - marketTotal;
      if (Math.abs(dT) > V22_POSTERIOR_TOTAL_CAP_RUNS) {
        const cappedT = marketTotal + Math.sign(dT) * V22_POSTERIOR_TOTAL_CAP_RUNS;
        const scale = cappedT / posteriorTotal;
        awayPosterior *= scale;
        homePosterior *= scale;
        capByTotal = true;
      }
    }
    // Diff guardrail
    if (marketDiff !== null) {
      const posteriorDiff = homePosterior - awayPosterior;
      const dD = posteriorDiff - marketDiff;
      if (Math.abs(dD) > V22_POSTERIOR_DIFF_CAP_RUNS) {
        const cappedDiff = marketDiff + Math.sign(dD) * V22_POSTERIOR_DIFF_CAP_RUNS;
        const total = awayPosterior + homePosterior;
        homePosterior = (total + cappedDiff) / 2;
        awayPosterior = (total - cappedDiff) / 2;
        capByDiff = true;
      }
    }
  }

  // Sanity floor — never negative
  awayPosterior = Math.max(0.5, awayPosterior);
  homePosterior = Math.max(0.5, homePosterior);

  const totalPost = awayPosterior + homePosterior;
  const diffPost = homePosterior - awayPosterior;
  const movedFromMarket =
    marketTotal !== null ? Math.abs(totalPost - marketTotal) : 0;

  return {
    away_expected_runs: awayPosterior,
    home_expected_runs: homePosterior,
    total_expected_runs: totalPost,
    home_run_diff: diffPost,
    trust_independent: trustIndep,
    market_total_used: marketTotal,
    market_implied_away: marketAwayImplied,
    market_implied_home: marketHomeImplied,
    market_implied_diff: marketDiff,
    posterior_moved_runs_from_market: movedFromMarket,
    capped_by_total: capByTotal,
    capped_by_diff: capByDiff,
  };
}

/**
 * Map projected win prob + run diff to a 0-100 confidence score,
 * tier-capped.
 */
export function computeConfidence(args: {
  win_prob: number;             // 0..1, projected ML probability for the pick
  ou_prob: number;              // 0..1, projected O/U probability for the pick
  run_diff_abs: number;         // |home-away| in runs
  tier: V22IndependentProjection["data_quality_tier"];
}): number {
  // Linear-ish mapping: a 56% win prob deserves ~55 confidence;
  // a 70% deserves ~70. Run-diff strength bumps confidence a couple
  // points when the projection strongly disagrees with a coin flip.
  const probSide = Math.max(args.win_prob, 1 - args.win_prob);
  const ouProbSide = Math.max(args.ou_prob, 1 - args.ou_prob);
  // Base = avg of ML side prob and OU side prob, mapped to %
  let base = ((probSide + ouProbSide) / 2) * 100;
  // Run-differential bump (up to +5 points when diff >= 2.0)
  base += clamp(args.run_diff_abs / 2.0, 0, 1) * 4;
  // Apply tier ceiling + floor
  const ceiling = V22_CONFIDENCE_CEILING[args.tier];
  return clamp(base, V22_CONFIDENCE_FLOOR, ceiling);
}

export const __TEST__ = {
  clamp,
};
