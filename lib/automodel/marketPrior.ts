/**
 * Phase 6B — Market-prior helpers for mlbAutoModelV2.
 *
 * Pure functions. No DB, no env reads, no I/O. Inputs are typed; outputs
 * are deterministic. Designed to be unit-tested in isolation.
 *
 * Architectural role: turn the market's signals (listed total, complete
 * sharp/retail price groups, ML odds, and Pinnacle fair probabilities) into
 * a per-team "baseline" run expectation that
 * mlbAutoModelV2 anchors on. The model's independent baseball factors
 * (V1's layered output) are then applied as residuals on top, capped to
 * prevent runaway moves from weak signal.
 *
 * Principle: market as prior, not prison. The baseline forms the starting
 * expectation; baseball signals move the prediction away from the line
 * when evidence supports it. If market data is missing or degraded, the
 * helper says so explicitly via MarketBaseline.dataQuality, and the
 * caller (mlbAutoModelV2) falls back to V1.
 *
 * Phase 6B.0 scope: full-game baseline only. First-inning market (NRFI/
 * YRFI odds) is not ingested today; FI V2 is deferred to a follow-up
 * once those lines flow into the snapshot.
 */

import type { MarketSnapshot, SharpSnapshot } from "./types";
import {
  inferPoissonMeanFromNoVigTotalPrice,
  splitConflictsWithPriceMap,
} from "./mlbCoherentMarketPriceMap";

/**
 * Convert American odds to raw implied probability (with vig).
 *
 * Examples:
 *   +100 → 0.500
 *   -110 → 0.524 (the "vig" side of -110 to win 100)
 *   +200 → 0.333
 *   -200 → 0.667
 */
export function americanToImpliedProb(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`americanToImpliedProb: invalid odds ${american}`);
  }
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * Two-way no-vig probabilities. Given American odds for both sides of a
 * binary market (e.g., ML home + ML away), strip the bookmaker's hold
 * and return probabilities that sum to 1.
 *
 * Method: raw implied probs / sum-of-raw. This is the standard "additive
 * de-vig" method — simple and widely accepted; matches Pinnacle's
 * published fair-prob methodology to within ~0.5% on typical MLB lines.
 *
 * Returns { home, away } where home + away ≈ 1 (exactly 1 in floating
 * point modulo rounding).
 */
export function noVigPair(
  homeAmerican: number,
  awayAmerican: number,
): { home: number; away: number } {
  const homeRaw = americanToImpliedProb(homeAmerican);
  const awayRaw = americanToImpliedProb(awayAmerican);
  const total = homeRaw + awayRaw;
  if (total <= 0) {
    throw new Error(
      `noVigPair: raw probability sum non-positive (home=${homeRaw}, away=${awayRaw})`,
    );
  }
  return { home: homeRaw / total, away: awayRaw / total };
}

/**
 * Map a team's no-vig win probability to its expected share of total
 * runs scored in the game.
 *
 * Empirical relationship: a team that's a heavier ML favorite tends to
 * also score a slightly larger share of runs (because run-scoring drives
 * the win edge). But the relationship is much flatter than 1:1 because
 * win probability also reflects defense, pitching, sequencing variance,
 * and other factors that don't track linearly with offensive output.
 *
 * Design-doc anchor: when home prob = 0.55, historical home run share
 * is ~0.515. That's a slope of (0.515 − 0.5) / (0.55 − 0.5) = 0.30.
 *
 * V2.0 formula: shareHome = 0.5 + RUN_SHARE_SLOPE × (probHome − 0.5).
 * Bounded to [SHARE_FLOOR, SHARE_CEIL] to prevent extreme blowouts.
 *
 * RUN_SHARE_SLOPE is a constant exported below so calibration can tune
 * it once historical finalized-score data is available.
 */
export const RUN_SHARE_SLOPE = 0.30;
export const SHARE_FLOOR = 0.40;
export const SHARE_CEIL = 0.60;

export function probToRunShare(homeNoVigProb: number): number {
  if (!Number.isFinite(homeNoVigProb)) {
    throw new Error(`probToRunShare: invalid prob ${homeNoVigProb}`);
  }
  const raw = 0.5 + RUN_SHARE_SLOPE * (homeNoVigProb - 0.5);
  return Math.max(SHARE_FLOOR, Math.min(SHARE_CEIL, raw));
}

/**
 * Market baseline derived from the snapshot's market + sharp inputs.
 * The baseline forms the prior for mlbAutoModelV2's score projection.
 *
 * dataQuality:
 *   "ok"       — listed_total + ML odds (or Pinnacle fair probs) present,
 *                consistent. V2 anchors on this baseline.
 *   "degraded" — partial data; V2 may still attempt baseline but with
 *                wider confidence drag.
 *   "missing"  — insufficient market data. V2 falls back to V1 unchanged.
 */
export interface MarketBaseline {
  homeNoVigProb: number | null;
  awayNoVigProb: number | null;
  listedTotal: number | null;
  homeRunShare: number | null;
  homeImpliedTotal: number | null;
  awayImpliedTotal: number | null;
  source: "coherent_sharp_retail_price_map" | "pinnacle_fair" | "american_devig" | "fallback_default" | null;
  dataQuality: "ok" | "degraded" | "missing";
  reason: string;
  /**
   * Phase 6B.8 — no-vig O/U side probabilities, computed from real
   * over/under American odds in MarketSnapshot. Pair-de-vig: each
   * side's raw implied prob / (sum of both raw implieds). Null when
   * either side's price is missing — V2.2 must surface ou_market_prob
   * as null in that case (NOT a 0.5 placeholder). Independent from
   * homeNoVigProb / awayNoVigProb which use ML odds.
   */
  overNoVigProb: number | null;
  underNoVigProb: number | null;
  /** Source label for the O/U pair, separate from the ML source above. */
  ouSource: "coherent_sharp_retail_price_map" | "american_devig" | null;
  /** Expected scoring mean inferred from the exact total price when eligible. */
  marketExpectedTotal?: number | null;
  coherentMoneylinePriceMapApplied?: boolean;
  coherentTotalPriceMapApplied?: boolean;
  coherentMoneylineSplitConflict?: boolean;
  coherentTotalSplitConflict?: boolean;
}

/**
 * Build a MarketBaseline from a MarketSnapshot + optional SharpSnapshot.
 * Pure: no I/O, deterministic.
 *
 * Priority order for win probabilities:
 *   1. Eligible coherent sharp/retail group consensus.
 *   2. Pinnacle fair-prob fields (sharp.pinnacle_ml_fair_prob_*) if both
 *      sides present and consistent (sum ≈ 1 within 2%).
 *   3. American odds de-vig (market.home_ml_odds_american +
 *      market.away_ml_odds_american) — falls back when sharp.* is null.
 *   4. Fallback default 0.51 home edge if listed_total exists but no
 *      ML odds anywhere — annotated as "degraded".
 *
 * Missing-baseline returns:
 *   - dataQuality="missing", all numeric fields null, V2 should fall back.
 *
 * No mutation of inputs; safe to call on the same snapshot multiple times.
 */
export function computeMarketBaseline(
  market: MarketSnapshot,
  sharp: SharpSnapshot | null,
): MarketBaseline {
  const listedTotal = market.listed_total;
  const coherentMap = market.coherent_price_map ?? null;
  const coherentMlSplitConflict = coherentMap === null
    ? false
    : splitConflictsWithPriceMap({
        priceMap: coherentMap.moneyline_home,
        publicBettingPct: sharp?.public_betting_pct_home ?? null,
        publicMoneyPct: sharp?.public_money_pct_home ?? null,
      });
  const coherentTotalSplitConflict = coherentMap === null
    ? false
    : splitConflictsWithPriceMap({
        priceMap: coherentMap.total_over,
        publicBettingPct: sharp?.public_betting_pct_over ?? null,
        publicMoneyPct: sharp?.public_money_pct_over ?? null,
      });
  const coherentMlHomeProb =
    coherentMap?.moneyline_home.eligible === true && !coherentMlSplitConflict
      ? groupConsensusProbability(coherentMap.moneyline_home)
      : null;
  const coherentTotalOverProb =
    coherentMap?.total_over.eligible === true && !coherentTotalSplitConflict
      ? groupConsensusProbability(coherentMap.total_over)
      : null;
  const inferredMarketExpectedTotal =
    listedTotal !== null && coherentTotalOverProb !== null
      ? inferPoissonMeanFromNoVigTotalPrice({
          listedTotal,
          overNoVigProbability: coherentTotalOverProb,
        })
      : null;
  const marketExpectedTotal = inferredMarketExpectedTotal ?? listedTotal;

  // Phase 6B.8 — resolve the no-vig O/U pair once. Used in every return
  // path below. Null when either side's price is missing or the pair
  // fails sanity checks. The OU baseline is INDEPENDENT of the ML
  // baseline: a game can have valid ML odds + missing OU odds (common
  // when only splits_consensus rows were ingested for totals), or vice
  // versa. Each baseline field is populated separately.
  const ouPair = computeOuNoVigPair(
    market.over_odds_american,
    market.under_odds_american,
  );
  const overNoVigProb = coherentTotalOverProb ?? ouPair?.over ?? null;
  const underNoVigProb = overNoVigProb === null ? null : 1 - overNoVigProb;
  const ouSource: MarketBaseline["ouSource"] = coherentTotalOverProb !== null
    ? "coherent_sharp_retail_price_map"
    : ouPair !== null
      ? "american_devig"
      : null;

  // 1. Prefer an eligible multi-book sharp price map; otherwise retain the
  // existing Pinnacle fair-probability path.
  const preferredHomeProb = coherentMlHomeProb ?? sharp?.pinnacle_ml_fair_prob_home ?? null;
  const preferredAwayProb = coherentMlHomeProb !== null
    ? 1 - coherentMlHomeProb
    : sharp?.pinnacle_ml_fair_prob_away ?? null;
  const preferredSource = coherentMlHomeProb !== null
    ? "coherent_sharp_retail_price_map" as const
    : "pinnacle_fair" as const;
  if (preferredHomeProb !== null && preferredAwayProb !== null) {
    const homeProb = preferredHomeProb;
    const awayProb = preferredAwayProb;
    const sum = homeProb + awayProb;
    if (Math.abs(sum - 1) > 0.02) {
      // Inconsistent Pinnacle probs — fall through to American de-vig.
    } else if (homeProb > 0 && homeProb < 1) {
      const share = probToRunShare(homeProb);
      if (marketExpectedTotal === null) {
        return {
          homeNoVigProb: homeProb,
          awayNoVigProb: awayProb,
          listedTotal: null,
          homeRunShare: share,
          homeImpliedTotal: null,
          awayImpliedTotal: null,
          source: preferredSource,
          dataQuality: "degraded",
          reason:
            "Pinnacle fair probs present but listed_total is null; baseline cannot anchor team totals.",
          overNoVigProb,
          underNoVigProb,
          ouSource,
          marketExpectedTotal,
          coherentMoneylinePriceMapApplied: coherentMlHomeProb !== null,
          coherentTotalPriceMapApplied: inferredMarketExpectedTotal !== null,
          coherentMoneylineSplitConflict: coherentMlSplitConflict,
          coherentTotalSplitConflict,
        };
      }
      return {
        homeNoVigProb: homeProb,
        awayNoVigProb: awayProb,
        listedTotal,
        homeRunShare: share,
        homeImpliedTotal: round1(marketExpectedTotal * share),
        awayImpliedTotal: round1(marketExpectedTotal * (1 - share)),
        source: preferredSource,
        dataQuality: "ok",
        reason: `${preferredSource} (home=${homeProb.toFixed(3)}); run share=${share.toFixed(3)}; listed total=${listedTotal}; expected total=${marketExpectedTotal.toFixed(3)}.`,
        overNoVigProb,
        underNoVigProb,
        ouSource,
        marketExpectedTotal,
        coherentMoneylinePriceMapApplied: coherentMlHomeProb !== null,
        coherentTotalPriceMapApplied: inferredMarketExpectedTotal !== null,
        coherentMoneylineSplitConflict: coherentMlSplitConflict,
        coherentTotalSplitConflict,
      };
    }
  }

  // 2. American de-vig from raw ML odds.
  const homeAm = market.home_ml_odds_american;
  const awayAm = market.away_ml_odds_american;
  if (
    homeAm !== null &&
    awayAm !== null &&
    Number.isFinite(homeAm) &&
    Number.isFinite(awayAm) &&
    homeAm !== 0 &&
    awayAm !== 0
  ) {
    try {
      const pair = noVigPair(homeAm, awayAm);
      const share = probToRunShare(pair.home);
      if (marketExpectedTotal === null) {
        return {
          homeNoVigProb: pair.home,
          awayNoVigProb: pair.away,
          listedTotal: null,
          homeRunShare: share,
          homeImpliedTotal: null,
          awayImpliedTotal: null,
          source: "american_devig",
          dataQuality: "degraded",
          reason:
            "American de-vig produced fair probs but listed_total is null; team totals cannot anchor.",
          overNoVigProb,
          underNoVigProb,
          ouSource,
          marketExpectedTotal,
          coherentMoneylinePriceMapApplied: false,
          coherentTotalPriceMapApplied: inferredMarketExpectedTotal !== null,
          coherentMoneylineSplitConflict: coherentMlSplitConflict,
          coherentTotalSplitConflict,
        };
      }
      return {
        homeNoVigProb: pair.home,
        awayNoVigProb: pair.away,
        listedTotal,
        homeRunShare: share,
        homeImpliedTotal: round1(marketExpectedTotal * share),
        awayImpliedTotal: round1(marketExpectedTotal * (1 - share)),
        source: "american_devig",
        dataQuality: "ok",
        reason: `American de-vig (home=${pair.home.toFixed(3)}); run share=${share.toFixed(3)}; total=${listedTotal}.`,
        overNoVigProb,
        underNoVigProb,
        ouSource,
        marketExpectedTotal,
        coherentMoneylinePriceMapApplied: false,
        coherentTotalPriceMapApplied: inferredMarketExpectedTotal !== null,
        coherentMoneylineSplitConflict: coherentMlSplitConflict,
        coherentTotalSplitConflict,
      };
    } catch {
      // Fall through; produce a missing/degraded baseline below.
    }
  }

  // 3. Last-resort fallback: listed_total present but no ML signal —
  //    use a mild home-field default share so V2 still has a baseline
  //    to anchor on, but mark degraded so the caller can adjust drag.
  if (marketExpectedTotal !== null) {
    const share = 0.51; // mild home edge default for MLB
    return {
      homeNoVigProb: 0.51,
      awayNoVigProb: 0.49,
      listedTotal,
      homeRunShare: share,
      homeImpliedTotal: round1(marketExpectedTotal * share),
      awayImpliedTotal: round1(marketExpectedTotal * (1 - share)),
      source: "fallback_default",
      dataQuality: "degraded",
      reason:
        "No ML odds in any source; using default 0.51 home edge with listed_total. Baseline is weak; V2 should reduce confidence.",
      overNoVigProb,
      underNoVigProb,
      ouSource,
      marketExpectedTotal,
      coherentMoneylinePriceMapApplied: false,
      coherentTotalPriceMapApplied: inferredMarketExpectedTotal !== null,
      coherentMoneylineSplitConflict: coherentMlSplitConflict,
      coherentTotalSplitConflict,
    };
  }

  return {
    homeNoVigProb: null,
    awayNoVigProb: null,
    listedTotal: null,
    homeRunShare: null,
    homeImpliedTotal: null,
    awayImpliedTotal: null,
    source: null,
    dataQuality: "missing",
    reason:
      "No market data available (no listed_total, no ML odds, no Pinnacle fair probs). V2 must fall back to V1.",
    overNoVigProb,
    underNoVigProb,
    ouSource,
    marketExpectedTotal,
    coherentMoneylinePriceMapApplied: false,
    coherentTotalPriceMapApplied: false,
    coherentMoneylineSplitConflict: coherentMlSplitConflict,
    coherentTotalSplitConflict,
  };
}

function groupConsensusProbability(side: NonNullable<MarketSnapshot["coherent_price_map"]>["moneyline_home"]): number | null {
  if (side.sharp_no_vig_probability === null || side.retail_no_vig_probability === null) return null;
  // Equal group weight deliberately gives the smaller sharp cohort equal
  // standing without allowing either source class to dictate the forecast.
  return (side.sharp_no_vig_probability + side.retail_no_vig_probability) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Phase 6B.8 — pair-de-vig for O/U side prices.
 *
 * Wraps the existing noVigPair (used for the ML pair) with null-safety
 * and sanity guards appropriate for OU markets. Returns null when:
 *   • either side's price is missing,
 *   • inputs throw via americanToImpliedProb (zero/non-finite),
 *   • the overhead is implausible (outside 0.99..1.40),
 *   • the resulting pair lands outside [0.02, 0.98].
 *
 * Method: raw implied probs / sum-of-raw — same as ML noVigPair, just
 * relabeled to over/under. Reuses americanToImpliedProb directly so
 * any future precision changes propagate uniformly.
 */
export function computeOuNoVigPair(
  overOdds: number | null,
  underOdds: number | null,
): { over: number; under: number } | null {
  if (overOdds === null || underOdds === null) return null;
  let overRaw: number;
  let underRaw: number;
  try {
    overRaw = americanToImpliedProb(overOdds);
    underRaw = americanToImpliedProb(underOdds);
  } catch {
    return null;
  }
  const overhead = overRaw + underRaw;
  if (!Number.isFinite(overhead) || overhead < 0.99 || overhead > 1.4) return null;
  const overNoVig = overRaw / overhead;
  const underNoVig = underRaw / overhead;
  if (overNoVig < 0.02 || overNoVig > 0.98) return null;
  if (underNoVig < 0.02 || underNoVig > 0.98) return null;
  return { over: overNoVig, under: underNoVig };
}
