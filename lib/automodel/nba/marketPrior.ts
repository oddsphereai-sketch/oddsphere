/**
 * Phase 7A — NBA Finals v0a — market-prior derivation (Layer 2).
 *
 * Pure. No DB, no network. Given an NbaMarketSnapshot returns:
 *   • ML no-vig pair (home + away)
 *   • spread-implied home points (the listed home spread, sign-flipped:
 *     spread -4 → home implied +4 points over away)
 *   • total (passed through when present)
 *
 * Mirrors the no-vig derivation used in the MLB marketPrior but does not
 * import from it — keeping the NBA module tree fully independent so MLB
 * is untouchable per the v0a constraints.
 *
 * All numeric output fields are nullable: when a side of any pair is
 * missing or the de-vig overhead is implausible, that field returns null
 * and downstream layers degrade gracefully (lower trust, lower confidence).
 */

import type { NbaMarketSnapshot } from "./types";

export type NbaMarketBaseline = {
  ml_home_no_vig: number | null;
  ml_away_no_vig: number | null;
  /** Listed home spread expressed as the home team's POINT MARGIN.
   *  spread.home_line = -4.5 → spread_implied_home_pts = +4.5 (home favored). */
  spread_implied_home_pts: number | null;
  total_implied: number | null;
  /** Over no-vig probability. Null when over/under odds missing. */
  over_no_vig: number | null;
  under_no_vig: number | null;
  /** Convenience: best-known market spread+total signal valid? */
  has_full_market: boolean;
};

export function americanToImpliedProb(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`americanToImpliedProb: invalid odds ${american}`);
  }
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

export function noVigPair(
  aAmerican: number,
  bAmerican: number,
): { a: number; b: number } | null {
  let aRaw: number;
  let bRaw: number;
  try {
    aRaw = americanToImpliedProb(aAmerican);
    bRaw = americanToImpliedProb(bAmerican);
  } catch {
    return null;
  }
  const total = aRaw + bRaw;
  if (!Number.isFinite(total) || total < 0.99 || total > 1.4) return null;
  const a = aRaw / total;
  const b = bRaw / total;
  if (a < 0.02 || a > 0.98) return null;
  if (b < 0.02 || b > 0.98) return null;
  return { a, b };
}

export function computeMarketBaseline(
  market: NbaMarketSnapshot,
): NbaMarketBaseline {
  // ML
  let mlHome: number | null = null;
  let mlAway: number | null = null;
  if (
    market.ml.home_odds_american !== null &&
    market.ml.away_odds_american !== null
  ) {
    const pair = noVigPair(
      market.ml.home_odds_american,
      market.ml.away_odds_american,
    );
    if (pair !== null) {
      mlHome = pair.a;
      mlAway = pair.b;
    }
  }

  // Spread — `home_line` is what the book lists for HOME. To express
  // "home margin implied by the market", flip the sign: if home is listed
  // at -4 (favored by 4) the implied home margin is +4.
  const spreadImpliedHomePts =
    market.spread.home_line !== null
      ? -market.spread.home_line
      : null;

  // Total — passed through when present.
  const totalImplied = market.total.line;

  // Over/Under no-vig
  let overNoVig: number | null = null;
  let underNoVig: number | null = null;
  if (
    market.total.over_odds_american !== null &&
    market.total.under_odds_american !== null
  ) {
    const pair = noVigPair(
      market.total.over_odds_american,
      market.total.under_odds_american,
    );
    if (pair !== null) {
      overNoVig = pair.a;
      underNoVig = pair.b;
    }
  }

  const hasFullMarket =
    mlHome !== null &&
    spreadImpliedHomePts !== null &&
    totalImplied !== null;

  return {
    ml_home_no_vig: mlHome,
    ml_away_no_vig: mlAway,
    spread_implied_home_pts: spreadImpliedHomePts,
    total_implied: totalImplied,
    over_no_vig: overNoVig,
    under_no_vig: underNoVig,
    has_full_market: hasFullMarket,
  };
}
