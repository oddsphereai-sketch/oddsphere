/**
 * Marcel-style 3-year weighted regression toward league average.
 *
 * The Marcels (Tom Tango) is the simplest player-projection system that
 * empirically performs well — it's the textbook baseline against which more
 * sophisticated systems are measured. We use it as the base-rate generator
 * for the prop pipeline.
 *
 * Algorithm:
 *   1. Take the 3 most recent seasons of (numerator, denominator) data.
 *   2. Apply weights 5 / 4 / 3 to current / previous / two-years-ago.
 *   3. Compute observed rate as Σ(weight × num) / Σ(weight × denom).
 *   4. Shrink toward league average by reliability factor:
 *        reliability = denom / (denom + constant)
 *   5. Projected = reliability × observed + (1 − reliability) × league
 *
 * The reliability constant determines how much PA/BFP is needed before the
 * observed rate dominates the shrinkage. Per Tango's research, ~1200 PA
 * marks reliability = 0.5 for batting average; HR rate stabilizes faster
 * (~700 PA); pitcher K rate fastest of all (~150 BFP). See
 * RELIABILITY_CONSTANTS in lib/config/constants.ts.
 *
 * The function is rate-agnostic — caller supplies whatever numerator and
 * denominator are appropriate for the market (hits/PA, HR/PA, K/BFP, ...).
 */

export type SeasonRate = {
  season: number;
  numerator: number;
  denominator: number;
};

export type MarcelResult = {
  projectedRate: number;
  observedRate: number;
  reliability: number;
  weightedDenominator: number;
};

/**
 * 5/4/3 weights for the most recent 3 seasons relative to currentSeason.
 * Slot 0 = current, slot 1 = previous, slot 2 = two-years-ago.
 */
const WEIGHTS = [5, 4, 3] as const;

/**
 * Project a rate via Marcel regression.
 *
 * @param seasons               Array of seasons. Order doesn't matter; the
 *                              function selects the 3 most recent relative
 *                              to currentSeason.
 * @param leagueAverage         Rate to shrink toward when sample is small.
 * @param reliabilityConstant   PA (or BFP) at which reliability = 0.5.
 *                              Default 1200 (BA scale); pass the market-
 *                              specific value from RELIABILITY_CONSTANTS.
 * @param currentSeason         Optional anchor; defaults to max(season) in
 *                              input. Useful for backtests where we want
 *                              to project AS-OF a historical season.
 */
export function marcelRegressedRate(
  seasons: SeasonRate[],
  leagueAverage: number,
  reliabilityConstant: number = 1200,
  currentSeason?: number
): MarcelResult {
  if (leagueAverage < 0 || leagueAverage > 1) {
    throw new Error(
      `marcelRegressedRate: leagueAverage must be in [0, 1], got ${leagueAverage}`
    );
  }
  if (reliabilityConstant <= 0) {
    throw new Error(
      `marcelRegressedRate: reliabilityConstant must be > 0, got ${reliabilityConstant}`
    );
  }

  if (seasons.length === 0) {
    // No data at all — fall back to league average with zero reliability.
    return {
      projectedRate: leagueAverage,
      observedRate: leagueAverage,
      reliability: 0,
      weightedDenominator: 0,
    };
  }

  const anchor =
    currentSeason ?? Math.max(...seasons.map((s) => s.season));

  // Select the 3 most recent seasons at or before the anchor.
  // For each weight slot (0, 1, 2), pick the season at offset (0, 1, 2)
  // from anchor — if missing, the slot contributes nothing.
  const buckets: SeasonRate[] = [];
  for (let offset = 0; offset < 3; offset++) {
    const target = anchor - offset;
    const found = seasons.find((s) => s.season === target);
    buckets.push(
      found ?? { season: target, numerator: 0, denominator: 0 }
    );
  }

  let weightedNum = 0;
  let weightedDenom = 0;
  for (let i = 0; i < 3; i++) {
    const b = buckets[i]!;
    if (b.denominator < 0 || b.numerator < 0) {
      throw new Error(
        `marcelRegressedRate: negative season values for season=${b.season}`
      );
    }
    weightedNum += WEIGHTS[i] * b.numerator;
    weightedDenom += WEIGHTS[i] * b.denominator;
  }

  if (weightedDenom === 0) {
    return {
      projectedRate: leagueAverage,
      observedRate: leagueAverage,
      reliability: 0,
      weightedDenominator: 0,
    };
  }

  const observedRate = weightedNum / weightedDenom;
  const reliability = weightedDenom / (weightedDenom + reliabilityConstant);
  const projectedRate =
    reliability * observedRate + (1 - reliability) * leagueAverage;

  return {
    projectedRate,
    observedRate,
    reliability,
    weightedDenominator: weightedDenom,
  };
}
