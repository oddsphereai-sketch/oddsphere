import assert from "node:assert/strict";
import {
  gradeNbaMarket,
  NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE,
} from "../lib/services/nba/nbaMarketReview";

const strongFavorite = {
  pick: "home",
  confidence: 92,
  band: "support" as const,
  edge: 0.086,
  dataQualityTier: "high" as const,
  injuriesKnown: true,
  market: "moneyline" as const,
  currentPriceAmerican: -567,
  modelProbabilityOnPick: 0.9202,
  moneylineEvidence: {
    directReadQualified: false,
    directReadSide: null,
    spreadReadQualified: false,
    spreadReadSide: null,
    spreadCorrectionApplied: false,
  },
};

assert.equal(NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE, -400);
assert.equal(
  gradeNbaMarket(strongFavorite).grade,
  "lean",
  "a favorite requiring at least four units of risk must remain below Best Angle",
);
assert.equal(
  gradeNbaMarket({
    ...strongFavorite,
    moneylineEvidence: {
      ...strongFavorite.moneylineEvidence,
      directReadQualified: true,
      directReadSide: "home" as const,
    },
  }).grade,
  "lean",
  "market confirmation cannot turn a very steep favorite into a Best Angle",
);
assert.equal(
  gradeNbaMarket({ ...strongFavorite, enforceSteepMoneylineBestAngleTier: false }).grade,
  "best_angle",
  "the audit hook must reproduce the superseded steep-favorite Best Angle",
);
assert.equal(
  gradeNbaMarket({ ...strongFavorite, currentPriceAmerican: -399 }).grade,
  "best_angle",
  "a favorite below the risk boundary remains eligible under the existing value gates",
);
assert.equal(
  gradeNbaMarket({
    ...strongFavorite,
    pick: "away",
    currentPriceAmerican: 400,
    modelProbabilityOnPick: 0.30,
    edge: 0.10,
    confidence: 70,
  }).grade,
  "best_angle",
  "the favorite-risk rule must not demote plus-money underdogs",
);

console.log("NBA steep Moneyline Best Angle grade tests passed");
