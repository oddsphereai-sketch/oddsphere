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

const moneylineBestAngle: GradeInput = {
  ...base,
  market: "moneyline",
  pick: "away",
  confidence: 65,
  edge: 0.1,
  currentPriceAmerican: 110,
  modelProbabilityOnPick: 0.65,
};
assert.equal(
  gradeNbaMarket({
    ...moneylineBestAngle,
    moneylineEvidence: {
      directReadQualified: true,
      directReadSide: "away",
      spreadReadQualified: false,
      spreadReadSide: null,
      spreadCorrectionApplied: false,
    },
  }).grade,
  "best_angle",
  "qualified direct Moneyline confirmation preserves Best Angle",
);
assert.equal(
  gradeNbaMarket({
    ...moneylineBestAngle,
    moneylineEvidence: {
      directReadQualified: true,
      directReadSide: "home",
      spreadReadQualified: true,
      spreadReadSide: "away",
      spreadCorrectionApplied: false,
    },
  }).grade,
  "lean",
  "an opposing qualified direct read keeps a playable model edge below Best Angle",
);
assert.equal(
  gradeNbaMarket({
    ...moneylineBestAngle,
    moneylineEvidence: {
      directReadQualified: false,
      directReadSide: null,
      spreadReadQualified: true,
      spreadReadSide: "home",
      spreadCorrectionApplied: false,
    },
  }).grade,
  "lean",
  "an opposing qualified Spread observation blocks Best Angle when the direct read is unavailable",
);
assert.equal(
  gradeNbaMarket({
    ...moneylineBestAngle,
    moneylineEvidence: {
      directReadQualified: true,
      directReadSide: "home",
      spreadReadQualified: true,
      spreadReadSide: "away",
      spreadCorrectionApplied: true,
    },
  }).grade,
  "best_angle",
  "a final side authored by the validated Spread correction outranks observational disagreement",
);
assert.equal(
  gradeNbaMarket({
    ...moneylineBestAngle,
    moneylineEvidence: {
      directReadQualified: false,
      directReadSide: null,
      spreadReadQualified: true,
      spreadReadSide: "home",
      spreadCorrectionApplied: false,
    },
    enforceMoneylineEvidenceGuard: false,
  }).grade,
  "best_angle",
  "the same-input legacy audit hook reproduces the superseded grade",
);
assert.equal(
  gradeNbaMarket({
    ...moneylineBestAngle,
    confidence: 58,
    moneylineEvidence: {
      directReadQualified: true,
      directReadSide: "away",
      spreadReadQualified: true,
      spreadReadSide: "away",
      spreadCorrectionApplied: false,
    },
  }).grade,
  "lean",
  "reader confirmation cannot lower the existing Best Angle confidence gate",
);

console.log("NBA market-specific grade boundaries and price gates passed");
