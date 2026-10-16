import assert from "node:assert/strict";

import {
  buildNbaUnifiedFinalProjection,
  NBA_UNIFIED_FINAL_RECIPE,
} from "../lib/automodel/nba/nbaUnifiedFinalProjection";

const noMarket = buildNbaUnifiedFinalProjection({
  independentHomeScore: 115,
  independentAwayScore: 110,
  currentSpreadHome: null,
  currentTotal: null,
  openingSpreadHome: null,
});
assert.equal(noMarket.homeScore, 115);
assert.equal(noMarket.awayScore, 110);
assert.equal(noMarket.movementApplied, false);

const blended = buildNbaUnifiedFinalProjection({
  independentHomeScore: 115,
  independentAwayScore: 105,
  currentSpreadHome: -6,
  currentTotal: 216,
  openingSpreadHome: -5,
});
assert.equal(NBA_UNIFIED_FINAL_RECIPE.marginIndependentWeight, 1);
assert.equal(NBA_UNIFIED_FINAL_RECIPE.totalIndependentWeight, 1);
assert.equal(blended.marginHome, 10);
assert.equal(blended.total, 220);
assert.equal(blended.homeScore, 115);
assert.equal(blended.awayScore, 105);
assert.equal(blended.spreadResidual, 4);
assert.equal(blended.movementQualified, false);
assert.equal(blended.movementApplied, false);

const movementFlip = buildNbaUnifiedFinalProjection({
  independentHomeScore: 105,
  independentAwayScore: 110,
  currentSpreadHome: -1,
  currentTotal: 218,
  openingSpreadHome: 1,
  qualifiedSpreadRead: { side: "home", magnitudePoints: 2 },
});
assert.equal(NBA_UNIFIED_FINAL_RECIPE.spreadMovementThreshold, 2);
assert.equal(movementFlip.movementQualified, true);
assert.equal(movementFlip.movementApplied, true);
assert.ok(movementFlip.spreadResidual! > 0, "two points of home support must orient the final residual home");
assert.ok(Math.abs(movementFlip.homeScore + movementFlip.awayScore - movementFlip.total) < 1e-9);
assert.ok(Math.abs(movementFlip.homeScore - movementFlip.awayScore - movementFlip.marginHome) < 1e-9);

const awaySupport = buildNbaUnifiedFinalProjection({
  independentHomeScore: 112,
  independentAwayScore: 107,
  currentSpreadHome: 2,
  currentTotal: 220,
  openingSpreadHome: -1,
  qualifiedSpreadRead: { side: "away", magnitudePoints: 3 },
});
assert.equal(awaySupport.movementApplied, true);
assert.ok(awaySupport.spreadResidual! < 0, "three points of away support must orient the final residual away");

const belowThreshold = buildNbaUnifiedFinalProjection({
  independentHomeScore: 105,
  independentAwayScore: 110,
  currentSpreadHome: -1,
  currentTotal: 218,
  openingSpreadHome: 1,
  qualifiedSpreadRead: { side: "home", magnitudePoints: 1.5 },
});
assert.equal(belowThreshold.movementQualified, false);
assert.equal(belowThreshold.movementApplied, false);
assert.equal(belowThreshold.homeScore, 105);
assert.equal(belowThreshold.awayScore, 110);

const alreadyAligned = buildNbaUnifiedFinalProjection({
  independentHomeScore: 113,
  independentAwayScore: 107,
  currentSpreadHome: -4,
  currentTotal: 215,
  openingSpreadHome: -2,
  qualifiedSpreadRead: { side: "home", magnitudePoints: 2 },
});
assert.equal(alreadyAligned.movementQualified, true);
assert.equal(alreadyAligned.movementApplied, false);
assert.equal(alreadyAligned.marginHome, 6);
assert.equal(alreadyAligned.total, 220);

const totalDisagreementFlip = buildNbaUnifiedFinalProjection({
  independentHomeScore: 106,
  independentAwayScore: 104,
  currentSpreadHome: -1,
  currentTotal: 218,
  openingSpreadHome: -1,
  qualifiedTotalRead: { side: "over", magnitudePoints: 5 },
});
assert.equal(NBA_UNIFIED_FINAL_RECIPE.totalMovementThreshold, 5);
assert.equal(NBA_UNIFIED_FINAL_RECIPE.minimumTotalResidual, 5);
assert.equal(totalDisagreementFlip.totalMovementQualified, true);
assert.equal(totalDisagreementFlip.totalMovementApplied, true);
assert.equal(totalDisagreementFlip.totalResidual, 8);
assert.equal(totalDisagreementFlip.total, 226);
assert.equal(totalDisagreementFlip.marketApplied.total, true);
assert.ok(Math.abs(totalDisagreementFlip.homeScore + totalDisagreementFlip.awayScore - 226) < 1e-9);
assert.ok(Math.abs(totalDisagreementFlip.homeScore - totalDisagreementFlip.awayScore - 2) < 1e-9);

const totalMoveBelowThreshold = buildNbaUnifiedFinalProjection({
  independentHomeScore: 106,
  independentAwayScore: 104,
  currentSpreadHome: -1,
  currentTotal: 218,
  openingSpreadHome: -1,
  qualifiedTotalRead: { side: "over", magnitudePoints: 4.5 },
});
assert.equal(totalMoveBelowThreshold.totalMovementQualified, false);
assert.equal(totalMoveBelowThreshold.totalMovementApplied, false);
assert.equal(totalMoveBelowThreshold.total, 210);

const totalEdgeBelowThreshold = buildNbaUnifiedFinalProjection({
  independentHomeScore: 108,
  independentAwayScore: 106,
  currentSpreadHome: -1,
  currentTotal: 218,
  openingSpreadHome: -1,
  qualifiedTotalRead: { side: "over", magnitudePoints: 5 },
});
assert.equal(totalEdgeBelowThreshold.totalMovementQualified, false);
assert.equal(totalEdgeBelowThreshold.totalMovementApplied, false);
assert.equal(totalEdgeBelowThreshold.total, 214);

const totalAlreadyAligned = buildNbaUnifiedFinalProjection({
  independentHomeScore: 114,
  independentAwayScore: 110,
  currentSpreadHome: -2,
  currentTotal: 218,
  openingSpreadHome: -2,
  qualifiedTotalRead: { side: "over", magnitudePoints: 5 },
});
assert.equal(totalAlreadyAligned.totalMovementQualified, true);
assert.equal(totalAlreadyAligned.totalMovementApplied, false);
assert.equal(totalAlreadyAligned.total, 224);

assert.throws(() => buildNbaUnifiedFinalProjection({
  independentHomeScore: Number.NaN,
  independentAwayScore: 100,
  currentSpreadHome: -2,
  currentTotal: 220,
  openingSpreadHome: -1,
}));

console.log("NBA unified final projection tests passed");
