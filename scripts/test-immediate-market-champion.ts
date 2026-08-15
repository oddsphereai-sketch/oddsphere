import assert from "node:assert/strict";
import {
  americanBreakEvenProbability,
  calibrateMlbTotalPickedProbability,
  calibrateWnbaSpreadPickedProbability,
  MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID,
  resolveMlbMoneylineChampionAction,
  resolveWnbaMoneylineChampionAction,
  resolveWnbaSpreadChampionAction,
  WNBA_MONEYLINE_POSITIVE_EV_ADDITION_RULE_ID,
  WNBA_SPREAD_PRICE_CHAMPION_RULE_ID,
} from "../lib/automodel/immediateMarketChampion";

assert.equal(americanBreakEvenProbability(-110)?.toFixed(6), "0.523810");
assert.equal(americanBreakEvenProbability(120)?.toFixed(6), "0.454545");

assert.deepEqual(resolveMlbMoneylineChampionAction({
  currentActionable: true,
  blocked: true,
  modelProbability: null,
  oddsAmerican: null,
}), { actionable: false, promoted: false, ruleId: null });

assert.deepEqual(resolveMlbMoneylineChampionAction({
  currentActionable: false,
  blocked: false,
  modelProbability: 0.56,
  oddsAmerican: -110,
}), {
  actionable: true,
  promoted: true,
  ruleId: MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID,
});

assert.equal(resolveMlbMoneylineChampionAction({
  currentActionable: false,
  blocked: false,
  modelProbability: 0.6,
  oddsAmerican: 120,
}).actionable, false);

assert.equal(resolveMlbMoneylineChampionAction({
  currentActionable: false,
  blocked: false,
  modelProbability: 0.7,
  oddsAmerican: -220,
}).actionable, true, "favorite promotions are not capped at -120 or -200");

const calibratedTotalUnder = calibrateMlbTotalPickedProbability({
  rawPickedProbability: 0.56,
  oddsAmerican: -110,
  selectedSide: "under",
});
const calibratedTotalOver = calibrateMlbTotalPickedProbability({
  rawPickedProbability: 0.56,
  oddsAmerican: -110,
  selectedSide: "over",
});
assert.notEqual(calibratedTotalUnder, null);
assert.notEqual(calibratedTotalOver, null);
assert.ok(calibratedTotalUnder! >= 0.5 && calibratedTotalOver! >= 0.5);
assert.notEqual(calibratedTotalUnder, calibratedTotalOver, "total calibration retains the fitted side interaction");
assert.notEqual(calibrateMlbTotalPickedProbability({
  rawPickedProbability: 0.72,
  oddsAmerican: -220,
  selectedSide: "under",
}), null, "total calibration has no artificial -120 or -200 price cutoff");

assert.deepEqual(resolveWnbaMoneylineChampionAction({
  currentActionable: false,
  modelProbability: 0.48,
  oddsAmerican: 120,
}), {
  actionable: true,
  promoted: true,
  ruleId: WNBA_MONEYLINE_POSITIVE_EV_ADDITION_RULE_ID,
});
assert.equal(resolveWnbaMoneylineChampionAction({
  currentActionable: false,
  modelProbability: 0.7,
  oddsAmerican: -220,
}).actionable, true, "WNBA moneyline value is evaluated at the offered price without a -200 cap");

const spreadProbability = calibrateWnbaSpreadPickedProbability({
  rawPickedProbability: 0.6,
  oddsAmerican: -110,
  selectedSide: "home",
});
assert.notEqual(spreadProbability, null);
assert.ok(spreadProbability! >= 0.5, "published picked-side probability must retain the 50% floor");
assert.equal(resolveWnbaSpreadChampionAction({
  calibratedProbability: 0.55,
  oddsAmerican: -110,
}).actionable, true);
assert.equal(resolveWnbaSpreadChampionAction({
  calibratedProbability: 0.54,
  oddsAmerican: -110,
}).actionable, false);
assert.equal(resolveWnbaSpreadChampionAction({
  calibratedProbability: spreadProbability,
  oddsAmerican: -110,
}).ruleId, WNBA_SPREAD_PRICE_CHAMPION_RULE_ID);

console.log("immediate market champion policy tests passed");
