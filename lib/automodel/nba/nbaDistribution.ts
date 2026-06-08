/**
 * Phase 7C — NBA v1 distribution layer.
 *
 * Pure functions. Takes a projected margin + projected total and the
 * current market spread/total, produces independent probabilities for
 * ML, spread cover, and total over/under via a normal approximation.
 *
 * "v1 research-prior, calibration pending" — the margin/total SD
 * constants in nbaFeatureWeights.ts are research priors. Once we
 * accumulate settled NBA game data we'll recalibrate these from
 * realized residuals.
 *
 * Independence guarantee: each market is computed from its own model
 * inputs against its own market line. ML probability does NOT cascade
 * into spread or total probability. This matches the user's
 * "ML/spread/total must be independent" requirement.
 */

// ─────────────────────────────────────────────────────────────
// Normal CDF helper — Abramowitz & Stegun 26.2.17 approximation.
// Pure, no external dependency.
// ─────────────────────────────────────────────────────────────

function erf(x: number): number {
  // A&S 7.1.26 — max error ~1.5e-7. Sufficient for probability layer.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * ax);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function clamp01(p: number): number {
  if (Number.isNaN(p)) return 0.5;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

// ─────────────────────────────────────────────────────────────
// Probability outputs
// ─────────────────────────────────────────────────────────────

export type NbaMarketProbabilities = {
  /** P(home wins) — derived from projected home margin and margin SD. */
  ml_home_win_prob: number;
  /** P(away wins) = 1 - ml_home_win_prob. */
  ml_away_win_prob: number;
  /**
   * P(home covers the market spread). The market spread is HOME-perspective
   * (negative = home favored). Cover = (home_margin - market_spread_home) > 0.
   * If market_spread_home is null → null.
   */
  spread_home_cover_prob: number | null;
  spread_away_cover_prob: number | null;
  /** P(over the market total). Null when market_total is null. */
  total_over_prob: number | null;
  total_under_prob: number | null;
  /** Effective standard deviations used (audit). */
  margin_sd_used: number;
  total_sd_used: number;
};

export type NbaDistributionInput = {
  /** Projected home_score - away_score from the model. */
  projected_home_margin: number;
  /** Projected home_score + away_score from the model. */
  projected_total: number;
  /** Current market spread from the HOME perspective (negative = home favored). */
  market_spread_home: number | null;
  /** Current market total. */
  market_total: number | null;
  /** Base margin SD prior. */
  margin_sd_base: number;
  /** Base total SD prior. */
  total_sd_base: number;
  /** Optional SD inflations summed onto base (volatility adjustments). */
  sd_inflations?: {
    injury_unknown?: number;
    limited_books?: number;
  };
};

/**
 * Compute independent ML / spread / total probabilities from the v1
 * projection and the current market.
 */
export function computeNbaMarketProbabilities(
  input: NbaDistributionInput,
): NbaMarketProbabilities {
  const inflation =
    (input.sd_inflations?.injury_unknown ?? 0) +
    (input.sd_inflations?.limited_books ?? 0);
  const marginSd = input.margin_sd_base + inflation;
  const totalSd = input.total_sd_base + inflation;

  // ML: P(home margin > 0) = 1 - Φ((0 - projected) / SD)
  const mlHome = clamp01(
    1 - normalCdf((0 - input.projected_home_margin) / marginSd),
  );
  const mlAway = clamp01(1 - mlHome);

  // Spread: P(home covers) = P(home_margin > market_spread_home).
  // market_spread_home is negative when home is favored; cover means
  // realized margin exceeds the spread line.
  let spreadHomeCover: number | null = null;
  let spreadAwayCover: number | null = null;
  if (input.market_spread_home !== null) {
    spreadHomeCover = clamp01(
      1 - normalCdf((input.market_spread_home - input.projected_home_margin) / marginSd),
    );
    spreadAwayCover = clamp01(1 - spreadHomeCover);
  }

  // Total: P(total > market_total).
  let totalOver: number | null = null;
  let totalUnder: number | null = null;
  if (input.market_total !== null) {
    totalOver = clamp01(
      1 - normalCdf((input.market_total - input.projected_total) / totalSd),
    );
    totalUnder = clamp01(1 - totalOver);
  }

  return {
    ml_home_win_prob: mlHome,
    ml_away_win_prob: mlAway,
    spread_home_cover_prob: spreadHomeCover,
    spread_away_cover_prob: spreadAwayCover,
    total_over_prob: totalOver,
    total_under_prob: totalUnder,
    margin_sd_used: marginSd,
    total_sd_used: totalSd,
  };
}

// Re-exported for fixture tests.
export const __NBA_DISTRIBUTION_TEST__ = {
  normalCdf,
  erf,
};
