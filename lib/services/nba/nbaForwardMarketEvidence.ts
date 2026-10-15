import type { ComparableOpenToCurrentMovement } from "../../types/domain/DisplayedContextMarket";
import type { MarketIntelligence } from "./buildNbaDailyEdgeDto";
import type { NbaComparableOpening } from "./nbaSameBookMovement";

/** Evidence schema only. This does not change projections, picks, grades, or
 * stakes and therefore stays independent of the model release identifier. */
export const NBA_FORWARD_MARKET_EVIDENCE_RELEASE =
  "nba_forward_market_evidence_2026_10_15_r1_same_book_exact_line";

function americanImpliedProbability(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : -american / (-american + 100);
}

/**
 * Converts a pipeline-selected opener into lock-time evidence. The pipeline
 * already enforces same game/book/side and exact line; this second boundary
 * fails closed if writer inputs no longer agree.
 */
export function buildNbaComparableMovementEvidence(opts: {
  market: "moneyline" | "spread" | "total";
  intel: MarketIntelligence;
  opening: NbaComparableOpening | null;
}): ComparableOpenToCurrentMovement | null {
  const currentPrice = opts.intel.current_price.odds_american;
  const currentObservedAt = opts.intel.current_price.fetched_at;
  const currentSportsbook = opts.intel.current_price.sportsbook;
  const side = opts.intel.pick_side;
  if (
    opts.opening === null || currentPrice === null || currentPrice === 0 ||
    currentObservedAt === null || currentSportsbook === null || side === null ||
    !Number.isFinite(Date.parse(currentObservedAt)) ||
    currentSportsbook.trim().toLowerCase() !== opts.opening.sportsbook.trim().toLowerCase()
  ) return null;
  if (
    opts.market !== "moneyline" &&
    (
      opts.intel.consensus_line === null || opts.opening.line === null ||
      opts.opening.line.toFixed(3) !== opts.intel.consensus_line.toFixed(3)
    )
  ) return null;
  const openingProbability = americanImpliedProbability(opts.opening.americanPrice);
  const currentProbability = americanImpliedProbability(currentPrice);
  return {
    comparison_scope: "same_game_same_book_same_side_exact_line",
    market: opts.market,
    side,
    sportsbook: opts.opening.sportsbook,
    line: opts.market === "moneyline" ? null : opts.opening.line,
    opening_american_price: opts.opening.americanPrice,
    opening_observed_at: opts.opening.observedAt,
    current_american_price: currentPrice,
    current_observed_at: new Date(currentObservedAt).toISOString(),
    opening_implied_probability: openingProbability,
    current_implied_probability: currentProbability,
    implied_probability_change_pp: (currentProbability - openingProbability) * 100,
  };
}
