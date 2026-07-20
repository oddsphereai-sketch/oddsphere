import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  BATTER_HRR_MODEL_VERSION,
  projectBatterHrr,
  type BatterHrrInput,
} from "../lib/mlb/props/batterHrrCountModel";

const baseline: BatterHrrInput = {
  line: 1.5,
  battingOrder: 3,
  recentValues: [3, 1, 0, 2, 4, 1, 2, 0, 3, 1],
};

const result = required(projectBatterHrr(baseline));
assert.equal(result.modelVersion, BATTER_HRR_MODEL_VERSION);
assert.ok(Math.abs(result.overProbability + result.underProbability - 1) < 1e-5);
assert.ok(result.projectedMean > 0);

const higherLine = required(projectBatterHrr({ ...baseline, line: 2.5 }));
assert.ok(higherLine.overProbability < result.overProbability);

const leadoff = required(projectBatterHrr({ ...baseline, battingOrder: 1 }));
const ninth = required(projectBatterHrr({ ...baseline, battingOrder: 9 }));
assert.ok(leadoff.projectedMean > ninth.projectedMean);
assert.ok(leadoff.overProbability > ninth.overProbability);

const highProduction = required(projectBatterHrr({ ...baseline, recentValues: baseline.recentValues.map(() => 5) }));
const lowProduction = required(projectBatterHrr({ ...baseline, recentValues: baseline.recentValues.map(() => 0) }));
assert.ok(highProduction.overProbability > lowProduction.overProbability);

assert.equal(projectBatterHrr({ ...baseline, recentValues: [] }), null);
assert.equal(projectBatterHrr({ ...baseline, recentValues: [-1, Number.NaN] }), null);

const startedAt = performance.now();
for (let index = 0; index < 6_000; index++) {
  assert.ok(projectBatterHrr({ ...baseline, battingOrder: index % 9 + 1 }));
}
const elapsedMs = performance.now() - startedAt;
assert.ok(elapsedMs < 2_000, `6,000 projections took ${elapsedMs.toFixed(1)}ms`);

console.log(`PASS ${BATTER_HRR_MODEL_VERSION}: deterministic math and 6,000 projections in ${elapsedMs.toFixed(1)}ms`);

function required<T>(value: T | null): T {
  assert.notEqual(value, null);
  return value as T;
}
