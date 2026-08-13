import assert from "node:assert/strict";
import {
  BATTER_HOME_RUNS_PORTFOLIO_POLICY,
  BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION,
  projectBatterHomeRunsPortfolio,
  projectBatterHomeRunsResidual,
} from "../lib/mlb/props/batterHomeRunsResidualModel";

const inputs = {
  marketOverProbability: 0.12,
  line: 0.5,
  home: true,
  homeRunsLast20: [1, ...Array(19).fill(0)],
};
const first = projectBatterHomeRunsResidual(inputs);
const second = projectBatterHomeRunsResidual(inputs);

assert.equal(BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION, "batter_home_runs_pa_portfolio_v2_2026_08_13");
assert.deepEqual(first, second);
assert.ok(first);
assert.ok(Math.abs(first.overProbability - 0.09155263455822557) < 1e-12);
assert.ok(Math.abs(first.overProbability + first.underProbability - 1) < 1e-12);
assert.ok(first.independentOverProbability > 0 && first.independentOverProbability < 1);
assert.equal(projectBatterHomeRunsResidual({ ...inputs, homeRunsLast20: [0, 0, 0] }), null);

const portfolio = projectBatterHomeRunsPortfolio({
  marketOverProbability: 0.1,
  battingOrder: 2,
  recentLogs: Array.from({ length: 20 }, (_, index) => ({
    homeRuns: index < 4 ? 1 : 0,
    plateAppearances: 4,
  })),
  parkHomeRunFactor: 105,
  temperatureF: 80,
  outdoor: true,
});
assert.ok(portfolio);
assert.equal(BATTER_HOME_RUNS_PORTFOLIO_POLICY.playsPerSlate, 3);
assert.equal(BATTER_HOME_RUNS_PORTFOLIO_POLICY.maximumPerGame, 1);
assert.ok(portfolio.overProbability > 0.1);
assert.ok(portfolio.projectedPlateAppearances > 4.5);
assert.ok(Math.abs(portfolio.overProbability + portfolio.underProbability - 1) < 1e-12);
assert.equal(projectBatterHomeRunsPortfolio({
  marketOverProbability: 0.1,
  battingOrder: 2,
  recentLogs: Array(4).fill({ homeRuns: 0, plateAppearances: 4 }),
  parkHomeRunFactor: 100,
  temperatureF: 70,
  outdoor: true,
}), null);

console.log("batter home-runs residual model tests passed");
