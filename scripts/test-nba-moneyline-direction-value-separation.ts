import assert from "node:assert/strict";
import { buildMarketSignal } from "../lib/services/nba/adaptNbaToDailyEdgeResponse";
import {
  resolveNbaMoneylineDirectionalSignal,
  type MarketIntelligence,
} from "../lib/services/nba/nbaMarketIntelligence";
import { gradeNbaMarket } from "../lib/services/nba/nbaMarketReview";

const overpricedMoneyline = {
  pick: "away",
  confidence: 61,
  band: "strong_conflict" as const,
  edge: -0.21,
  dataQualityTier: "high" as const,
  injuriesKnown: true,
  market: "moneyline" as const,
  currentPriceAmerican: -506,
  modelProbabilityOnPick: 0.61,
};

assert.equal(
  gradeNbaMarket(overpricedMoneyline).grade,
  "watch",
  "a same-side Moneyline price ahead of the model is a value Watchlist, not directional Caution",
);
assert.equal(
  gradeNbaMarket({ ...overpricedMoneyline, interpretMoneylinePriceGapAsConflict: true }).grade,
  "caution",
  "the audit hook must reproduce the superseded same-side price-gap Caution",
);
assert.equal(
  gradeNbaMarket({ ...overpricedMoneyline, market: "spread" }).grade,
  "caution",
  "a genuinely directional strong Spread conflict remains Caution",
);

const spreadConfirmed = resolveNbaMoneylineDirectionalSignal("away", {
  directReadQualified: false,
  directReadSide: null,
  spreadReadQualified: true,
  spreadReadSide: "away",
  spreadCorrectionApplied: false,
});
assert.deepEqual(
  spreadConfirmed,
  { state: "confirmed", source: "spread_observation" },
  "qualified same-side Spread movement confirms the Moneyline winner",
);

const directResistance = resolveNbaMoneylineDirectionalSignal("home", {
  directReadQualified: true,
  directReadSide: "away",
  spreadReadQualified: true,
  spreadReadSide: "home",
  spreadCorrectionApplied: false,
});
assert.deepEqual(
  directResistance,
  { state: "resistance", source: "direct_moneyline" },
  "qualified direct Moneyline movement owns opposition before observational Spread evidence",
);

const correctedWinner = resolveNbaMoneylineDirectionalSignal("home", {
  directReadQualified: true,
  directReadSide: "away",
  spreadReadQualified: true,
  spreadReadSide: "home",
  spreadCorrectionApplied: true,
});
assert.deepEqual(
  correctedWinner,
  { state: "confirmed", source: "validated_spread_correction" },
  "a validated Spread-authored winner is confirmed after the correction crosses the side",
);

function intelligence(
  qualified_market_direction?: MarketIntelligence["qualified_market_direction"],
): MarketIntelligence {
  return {
    market: "moneyline",
    pick_label: "SA ML",
    pick_side: "away",
    consensus_line: null,
    current_price: { odds_american: -506, odds_decimal: 1.1976, sportsbook: "novig", fetched_at: null },
    other_side_price: { odds_american: 390, sportsbook: "novig" },
    per_book_pick_side: [],
    per_book_other_side: [],
    market_implied_prob_pick: 0.8349,
    market_no_vig_prob_pick: 0.8205,
    fair_reference_mode: "target_excluded",
    fair_reference_books: ["pinnacle"],
    opp_fair_probability_pick: null,
    opp_ev_percentage_pick: null,
    opp_market_width: null,
    opp_warnings: [],
    opp_possibly_stale: false,
    model_confidence: 61,
    model_prob_on_pick: 0.61,
    edge_prob_pp: -21.05,
    edge_points: null,
    conflict_band: "strong_conflict",
    grade: "watch",
    effective_confidence: 52,
    best_angle_eligible: false,
    rationale: ["The forecast has a side, but its probability does not clear positive value at the selected price."],
    ...(qualified_market_direction === undefined ? {} : { qualified_market_direction }),
    splits: { pick_side: null, other_side: null, sharp_signal_side: "none" },
    first_observed_at: null,
    movement_note: "First observed tracking only — no opener available",
  };
}

assert.equal(
  buildMarketSignal(intelligence(spreadConfirmed)),
  "market_confirmed",
  "current unlocked output must use qualified directional evidence instead of the same-side price gap",
);
assert.equal(
  buildMarketSignal(intelligence({ state: "neutral", source: "none" })),
  "market_neutral",
  "unqualified movement must remain neutral rather than fabricating resistance",
);
assert.equal(
  buildMarketSignal(intelligence()),
  "market_resistance",
  "legacy locked payloads without the new field must retain their stored compatibility interpretation",
);

console.log("NBA Moneyline direction/value separation tests passed");
