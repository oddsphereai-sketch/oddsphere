/**
 * Compute the model's edge vs the market's fair price.
 *
 * SharpAPI provides Pinnacle-de-vigged fair odds for each prop. Our model
 * produces an independent probability estimate. The edge is the difference:
 *
 *   edgePct = (modelProbability − fairProbability) × 100
 *
 * Interpretation:
 *   • edgePct > 0 → model thinks the bet is +EV
 *   • edgePct < 0 → model thinks the market is right and the bet is −EV
 *
 * The tier classifier uses |edgePct| against the thresholds in EDGE_TIERS
 * to bucket as PREMIUM (8%+) / STRONG (5-8%) / GOOD (3-5%) / skip (<3%).
 *
 * Why edge_pct in probability points (not EV%)? Probability points are
 * the cleaner mental model — "the model thinks this hits 8 points more
 * often than the market is pricing." It's also what calibration tracking
 * tests against (predicted hit rate vs actual hit rate). EV% is computed
 * separately by the prop pipeline using the actual offered odds, not the
 * fair odds.
 */

import { americanToImplied } from "../../utils/odds";

export type EdgeResult = {
  edgePct: number;
  fairProbability: number;
};

/**
 * Compute edge against SharpAPI fair odds.
 *
 * @param modelProbability    Our model's estimated probability of "over".
 * @param fairOddsAmerican    SharpAPI's de-vigged fair odds (American).
 */
export function calculateEdge(
  modelProbability: number,
  fairOddsAmerican: number
): EdgeResult {
  if (modelProbability < 0 || modelProbability > 1) {
    throw new Error(
      `calculateEdge: modelProbability must be in [0, 1], got ${modelProbability}`
    );
  }

  const fairProbability = americanToImplied(fairOddsAmerican);
  const edgePct = (modelProbability - fairProbability) * 100;

  return {
    edgePct: +edgePct.toFixed(2),
    fairProbability,
  };
}
