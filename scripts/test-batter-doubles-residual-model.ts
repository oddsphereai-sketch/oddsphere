import assert from "node:assert/strict";
import {
  BATTER_DOUBLES_RESIDUAL_MODEL_VERSION,
  projectBatterDoublesResidual,
} from "../lib/mlb/props/batterDoublesResidualModel";
import {
  BATTER_DOUBLES_RESIDUAL_PROMOTION_POLICY,
  qualifiesBatterDoublesResidualPromotion,
} from "../lib/mlb/props/actionabilityPolicy";
import { buildPlayerPropRecentForm } from "../lib/mlb/props/researchEvidence";
import type { MlbHistoricalStatRow } from "../lib/mlb/props/providers";

assert.equal(
  BATTER_DOUBLES_RESIDUAL_MODEL_VERSION,
  "batter_doubles_market_residual_v1_2026_07_30",
);
assert.deepEqual(BATTER_DOUBLES_RESIDUAL_PROMOTION_POLICY, {
  minimumModelProbability: 0.52,
  minimumEdge: 0.005,
  minimumExpectedValue: 0.005,
  minimumDecimalOdds: 1.25,
});

const projection = projectBatterDoublesResidual({
  marketOverProbability: 0.2,
  plateAppearancesLast5: 4,
  rbisLast5: 0,
  rbisSeason: 0.4,
  runsLast10: 0.5,
  walksLast20: 0.2,
  walksSeason: 0.35,
  doublesOverRateLast20: 0,
});
assert.ok(projection);
assert.ok(Math.abs(projection.overProbability - 0.1503570529863684) < 1e-12);
assert.ok(Math.abs(projection.overProbability + projection.underProbability - 1) < 1e-12);
assert.ok(projection.logitAdjustment < 0);
assert.equal(projectBatterDoublesResidual({
  marketOverProbability: Number.NaN,
  plateAppearancesLast5: 4,
  rbisLast5: 0,
  rbisSeason: 0.4,
  runsLast10: 0.5,
  walksLast20: 0.2,
  walksSeason: 0.35,
  doublesOverRateLast20: 0,
}), null);

assert.equal(qualifiesBatterDoublesResidualPromotion({
  modelProbability: 0.81,
  marketProbability: 0.74,
  expectedValue: 0.02,
  americanOdds: -375,
}), true);
assert.equal(qualifiesBatterDoublesResidualPromotion({
  modelProbability: 0.81,
  marketProbability: 0.74,
  expectedValue: 0.02,
  americanOdds: -450,
}), false);
assert.equal(qualifiesBatterDoublesResidualPromotion({
  modelProbability: 0.744,
  marketProbability: 0.74,
  expectedValue: 0.02,
  americanOdds: -375,
}), false);

const logs: MlbHistoricalStatRow[] = Array.from({ length: 20 }, (_, index) => ({
  gameId: `game-${index}`,
  playerId: "player-1",
  teamId: "team-1",
  opponentTeamId: "team-2",
  gameDate: `2026-07-${String(20 - index).padStart(2, "0")}`,
  stats: {
    plate_appearances: index < 5 ? 4 : 3,
    doubles: index % 4 === 0 ? 1 : 0,
    rbis: index < 5 ? 0 : 1,
    runs: index < 10 ? 1 : 0,
    walks: index % 2,
    home_away: "home",
  },
  provider: "test",
  asOfTimestamp: `2026-07-${String(20 - index).padStart(2, "0")}T23:59:59.999Z`,
}));
const recent = buildPlayerPropRecentForm({
  logs,
  marketKey: "batter_doubles",
  asOfTimestamp: "2026-07-21T12:00:00.000Z",
  coverage: "full_season",
});
assert.ok(recent?.doublesResidualFeatures);
assert.equal(recent.doublesResidualFeatures.plateAppearancesLast5, 4);
assert.equal(recent.doublesResidualFeatures.rbisLast5, 0);
assert.equal(recent.doublesResidualFeatures.rbisSeason, 0.75);
assert.equal(recent.doublesResidualFeatures.runsLast10, 1);
assert.equal(recent.doublesResidualFeatures.walksLast20, 0.5);
assert.equal(recent.doublesResidualFeatures.walksSeason, 0.5);
assert.equal(recent.doublesResidualFeatures.doublesLast20.length, 20);

console.log("batter doubles residual model tests passed");
