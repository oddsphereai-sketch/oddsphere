/**
 * Phase 7A — NBA Finals v0a — adaptive posterior blend (Layer 3).
 *
 * Pure. No DB, no network. Blends independent score projection (Layer 1)
 * with the market baseline (Layer 2) using a trust weight derived from
 * data quality + injury knowns.
 *
 * Inputs:
 *   • independent: { home_score_mean, away_score_mean, home_score_sd,
 *                    away_score_sd }
 *   • market:      NbaMarketBaseline (may be null fields)
 *   • trustWeight: 0..1, explicit caller-supplied trust on independent
 *
 * Output:
 *   • posterior_home_score, posterior_away_score
 *   • posterior_total      = home + away
 *   • posterior_spread     = home - away  (positive when home favored)
 *
 * When the market is partial / missing, the trust on independent is
 * implicitly higher because the market contribution drops to 0. v0a
 * does NOT cap movement from market the way MLB V2.2 does (NBA's
 * variance is much larger; capping at ±2.5 pts wouldn't make sense
 * for a sport with ~12 pt SD per side). Movement is still implicitly
 * bounded by the trust weight — at trust=0.65, posterior moves at most
 * 0.65 × (independent - market).
 */

import type { NbaMarketBaseline } from "./marketPrior";

export type BlendPosteriorInput = {
  independent: {
    home_score_mean: number;
    away_score_mean: number;
    home_score_sd: number;
    away_score_sd: number;
  };
  market: NbaMarketBaseline;
  /** 0..1. Higher = trust the independent model more. */
  trustWeight: number;
};

export type BlendPosteriorOutput = {
  posterior_home_score: number;
  posterior_away_score: number;
  posterior_total: number;
  posterior_spread: number;
  /** What the market said the total should be (or null). */
  market_total_used: number | null;
  /** Spread implied by the market (or null). */
  market_spread_used: number | null;
  /** Effective trust used (may differ from input trustWeight when the
   *  market is missing — then it's effectively 1.0). */
  effective_trust_independent: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function blendPosterior(
  input: BlendPosteriorInput,
): BlendPosteriorOutput {
  const indepTotal =
    input.independent.home_score_mean + input.independent.away_score_mean;
  const indepSpread =
    input.independent.home_score_mean - input.independent.away_score_mean;

  const marketTotal = input.market.total_implied;
  const marketSpread = input.market.spread_implied_home_pts;

  const trustClamped = clamp(input.trustWeight, 0, 1);
  // When the market is entirely missing, independent gets full weight.
  const hasMarket = marketTotal !== null || marketSpread !== null;
  const effectiveTrust = hasMarket ? trustClamped : 1.0;

  // Blend total and spread separately, then reconstruct per-side scores.
  const blendedTotal =
    marketTotal !== null
      ? effectiveTrust * indepTotal + (1 - effectiveTrust) * marketTotal
      : indepTotal;
  const blendedSpread =
    marketSpread !== null
      ? effectiveTrust * indepSpread + (1 - effectiveTrust) * marketSpread
      : indepSpread;

  const posteriorHome = (blendedTotal + blendedSpread) / 2;
  const posteriorAway = (blendedTotal - blendedSpread) / 2;

  return {
    posterior_home_score: round1(posteriorHome),
    posterior_away_score: round1(posteriorAway),
    posterior_total: round1(blendedTotal),
    posterior_spread: round1(blendedSpread),
    market_total_used: marketTotal,
    market_spread_used: marketSpread,
    effective_trust_independent: effectiveTrust,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
