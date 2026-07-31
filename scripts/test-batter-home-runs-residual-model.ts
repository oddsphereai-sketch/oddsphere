import assert from "node:assert/strict";
import {
  BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION,
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

assert.equal(BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION, "batter_home_runs_market_residual_v1_2026_07_31");
assert.deepEqual(first, second);
assert.ok(first);
assert.ok(Math.abs(first.overProbability - 0.09155263455822557) < 1e-12);
assert.ok(Math.abs(first.overProbability + first.underProbability - 1) < 1e-12);
assert.ok(first.independentOverProbability > 0 && first.independentOverProbability < 1);
assert.equal(projectBatterHomeRunsResidual({ ...inputs, homeRunsLast20: [0, 0, 0] }), null);

console.log("batter home-runs residual model tests passed");
