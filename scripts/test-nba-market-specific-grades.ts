import assert from "node:assert/strict";

import { gradeNbaMarket, type GradeInput } from "../lib/services/nba/nbaMarketReview";

const base: GradeInput = {
  pick: "home",
  confidence: 58,
  band: "support",
  edge: 0.05,
  dataQualityTier: "high",
  injuriesKnown: true,
  currentPriceAmerican: -110,
  modelProbabilityOnPick: 0.6,
};

assert.deepEqual(
  gradeNbaMarket({ ...base, market: "spread", independentEdgePoints: 2.5 }),
  {
    grade: "best_angle",
    effectiveConfidence: 60,
    bestAngleEligible: true,
    rationale: ["The independent model is in its historically strongest moderate Spread edge band."],
  },
);
assert.equal(
  gradeNbaMarket({ ...base, market: "spread", independentEdgePoints: 3.5 }).grade,
  "watch",
  "the independent Spread band is upper-exclusive",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "spread",
    independentEdgePoints: -8,
    readerQualified: true,
    readerCorrectionApplied: true,
    readerMagnitudePoints: 4,
  }).grade,
  "best_angle",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "spread",
    independentEdgePoints: -8,
    readerQualified: true,
    readerCorrectionApplied: true,
    readerMagnitudePoints: 3,
  }).grade,
  "lean",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "spread",
    independentEdgePoints: 2.9,
    readerQualified: true,
    readerCorrectionApplied: false,
    readerMagnitudePoints: 4,
  }).grade,
  "watch",
  "a qualified confirmation cannot inherit the inactive independent lane",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "spread",
    independentEdgePoints: 2.9,
    currentPriceAmerican: -160,
  }).grade,
  "watch",
  "a negative-EV selected price blocks a historical proxy qualifier",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "spread",
    independentEdgePoints: 2.9,
    currentPriceAmerican: -108,
    modelProbabilityOnPick: 0.508,
  }).grade,
  "watch",
  "a calibrated lane cannot promote a side whose coherent model probability is negative-EV at the exact price",
);

assert.equal(
  gradeNbaMarket({
    ...base,
    market: "total",
    pick: "over",
    independentEdgePoints: -5,
    readerQualified: true,
    readerCorrectionApplied: true,
    readerMagnitudePoints: 5,
  }).grade,
  "best_angle",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "total",
    pick: "over",
    independentEdgePoints: -9,
    readerQualified: true,
    readerCorrectionApplied: true,
    readerMagnitudePoints: 5,
  }).grade,
  "lean",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "total",
    pick: "over",
    independentEdgePoints: 1,
  }).grade,
  "lean",
  "the low-residual Over lane is lower-inclusive",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "total",
    pick: "under",
    independentEdgePoints: -1.5,
  }).grade,
  "watch",
  "the low-residual promotion is Over-only",
);
assert.equal(
  gradeNbaMarket({
    ...base,
    market: "total",
    pick: "over",
    independentEdgePoints: 1.5,
    dataQualityTier: "medium",
  }).grade,
  "watch",
);
assert.equal(
  gradeNbaMarket({ ...base, market: "total", pick: "over", band: "market_unavailable" }).grade,
  "no_market",
);

console.log("NBA market-specific grade boundaries and price gates passed");
