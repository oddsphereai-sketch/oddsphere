import assert from "node:assert/strict";
import {
  americanBreakEvenProbability,
  calibrateMlbTotalPickedProbability,
  calibrateWnbaSpreadPickedProbability,
  MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID,
  MLB_MONEYLINE_RAW_CHAMPION_ACTION_RULE_ID,
  resolveMlbMoneylineChampionAction,
  resolveMlbMoneylineRawSideChampion,
  resolveMlbTotalRuntimeResidualChampion,
  resolveWnbaMoneylineChampionAction,
  resolveWnbaSpreadChampionAction,
  resolveWnbaTotalReflectedProjectionChampion,
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
}), { actionable: false, promoted: false, demoted: true, ruleId: null });

assert.deepEqual(resolveMlbMoneylineChampionAction({
  currentActionable: false,
  blocked: false,
  modelProbability: 0.6,
  oddsAmerican: -135,
}), {
  actionable: true,
  promoted: true,
  demoted: false,
  ruleId: MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID,
});

assert.deepEqual(resolveMlbMoneylineChampionAction({
  currentActionable: false,
  blocked: false,
  modelProbability: 0.6,
  oddsAmerican: 120,
}), {
  actionable: true,
  promoted: true,
  demoted: false,
  ruleId: MLB_MONEYLINE_RAW_CHAMPION_ACTION_RULE_ID,
});

assert.equal(resolveMlbMoneylineChampionAction({
  currentActionable: false,
  blocked: false,
  modelProbability: 0.7,
  oddsAmerican: -220,
}).actionable, true, "favorite promotions are not capped at -120 or -200");
assert.deepEqual(resolveMlbMoneylineChampionAction({
  currentActionable: true,
  blocked: false,
  modelProbability: 0.5,
  oddsAmerican: -110,
}), {
  actionable: false,
  promoted: false,
  demoted: true,
  ruleId: "mlb_moneyline_raw_champion_replace_minus120_plus129_v1_2026_08_15",
}, "the qualified replacement policy demotes negative-EV rows only in its tested price band");
assert.equal(resolveMlbMoneylineChampionAction({
  currentActionable: true,
  blocked: false,
  modelProbability: 0.5,
  oddsAmerican: -175,
}).actionable, true, "the tested band does not cap or replace actions below -120");

assert.deepEqual(resolveMlbMoneylineRawSideChampion({
  currentSide: "away",
  currentModelProbability: 0.58,
  currentMarketProbability: 0.42,
  homeOdds: -135,
}), {
  applied: true,
  ruleId: "mlb_away_market_40_45_raw_side_champion_v1_2026_08_15",
  correctedSide: "home",
  correctedOdds: -135,
  correctedModelProbability: 0.5800000000000001,
  correctedMarketProbability: 0.5800000000000001,
});
assert.equal(resolveMlbMoneylineRawSideChampion({
  currentSide: "home",
  currentModelProbability: 0.58,
  currentMarketProbability: 0.42,
  homeOdds: -135,
}).applied, false, "the moneyline champion is a narrow away-pick disagreement cohort");

const runtimeTotalChampion = resolveMlbTotalRuntimeResidualChampion({
  currentSide: "under",
  currentMarketProbability: 0.52,
  independentTotal: 18,
  posteriorTotal: 9,
  marketTotal: 8.5,
  homeStarterEra: 4.2,
  awayStarterEra: 4.2,
  homeBullpenFactor: 1,
  awayBullpenFactor: 1,
  homeLineupWeightedOps: 0.72,
  awayLineupWeightedOps: 0.72,
  homeTopOrderOps: 0.72,
  awayTopOrderOps: 0.72,
  parkFactorRuns: 1,
  weatherTotalAdjust: 0,
  leagueAverageEra: 4.2,
  leagueAverageOps: 0.72,
  overOdds: -108,
  underOdds: -112,
  overLine: 8.5,
  underLine: 8.5,
});
assert.equal(runtimeTotalChampion.applied, true);
if (runtimeTotalChampion.applied) {
  assert.equal(runtimeTotalChampion.correctedSide, "over");
  assert.equal(runtimeTotalChampion.correctedOdds, -108);
  assert.equal(runtimeTotalChampion.correctedLine, 8.5);
  assert.ok(runtimeTotalChampion.correctedModelProbability > 0.6);
}
assert.equal(resolveMlbTotalRuntimeResidualChampion({
  currentSide: "over",
  currentMarketProbability: 0.52,
  independentTotal: 8.5,
  posteriorTotal: 8.5,
  marketTotal: 8.5,
  homeStarterEra: null,
  awayStarterEra: null,
  homeBullpenFactor: null,
  awayBullpenFactor: null,
  homeLineupWeightedOps: null,
  awayLineupWeightedOps: null,
  homeTopOrderOps: null,
  awayTopOrderOps: null,
  parkFactorRuns: null,
  weatherTotalAdjust: null,
  leagueAverageEra: null,
  leagueAverageOps: null,
  overOdds: -110,
  underOdds: -110,
  overLine: 8.5,
  underLine: 8.5,
}).applied, false, "the totals challenger changes only strong sub-40% disagreements");

const wnbaTotalChampion = resolveWnbaTotalReflectedProjectionChampion({
  rawProjectedTotal: 172,
  marketTotal: 176,
  overOdds: -108,
  underOdds: -112,
});
assert.equal(wnbaTotalChampion.applied, true);
if (wnbaTotalChampion.applied) {
  assert.equal(wnbaTotalChampion.side, "over");
  assert.equal(wnbaTotalChampion.oddsAmerican, -108);
  assert.equal(wnbaTotalChampion.projectedTotal, 180);
  assert.ok(wnbaTotalChampion.selectedProbability > 0.5);
}
assert.equal(resolveWnbaTotalReflectedProjectionChampion({
  rawProjectedTotal: 172,
  marketTotal: 176,
  overOdds: null,
  underOdds: -112,
}).applied, false, "WNBA total side changes require the exact opposite-side price");

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
