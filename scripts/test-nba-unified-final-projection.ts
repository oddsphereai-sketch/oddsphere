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
assert.equal(blended.marginHome, 7);
assert.equal(blended.total, 217);
assert.equal(blended.homeScore, 112);
assert.equal(blended.awayScore, 105);
assert.equal(blended.spreadResidual, 1);
assert.equal(blended.movementApplied, false);

const movementFlip = buildNbaUnifiedFinalProjection({
  independentHomeScore: 105,
  independentAwayScore: 110,
  currentSpreadHome: -1,
  currentTotal: 218,
  openingSpreadHome: 1,
});
assert.equal(NBA_UNIFIED_FINAL_RECIPE.spreadMovementThreshold, 2);
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
});
assert.equal(awaySupport.movementApplied, true);
assert.ok(awaySupport.spreadResidual! < 0, "three points of away support must orient the final residual away");

assert.throws(() => buildNbaUnifiedFinalProjection({
  independentHomeScore: Number.NaN,
  independentAwayScore: 100,
  currentSpreadHome: -2,
  currentTotal: 220,
  openingSpreadHome: -1,
}));

console.log("NBA unified final projection tests passed");
