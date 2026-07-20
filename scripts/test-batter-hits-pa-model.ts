import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  BATTER_HITS_PA_MODEL_VERSION,
  projectBatterHitsPa,
  type BatterHitsPaInput,
} from "../lib/mlb/props/batterHitsPaModel";

const baseline: BatterHitsPaInput = {
  line: 0.5,
  battingOrder: 2,
  recentLogs: [
    { value: 1, secondaryLabel: "4 AB | 1 TB" },
    { value: 2, secondaryLabel: "5 AB | 3 TB" },
    { value: 0, secondaryLabel: "4 AB | 0 TB" },
    { value: 1, secondaryLabel: "4 AB | 1 TB" },
    { value: 1, secondaryLabel: "3 AB | 1 TB" },
  ],
  pitchMixBattingAverage: 0.29,
  pitchMixPitchesSeen: 200,
};

const result = required(projectBatterHitsPa(baseline));
assert.equal(result.modelVersion, BATTER_HITS_PA_MODEL_VERSION);
assert.ok(Math.abs(result.overProbability + result.underProbability - 1) < 1e-5);
assert.ok(result.pitchMixWeight > 0 && result.pitchMixWeight <= 0.1);
assert.ok(result.projectedAtBats >= 1 && result.projectedAtBats <= 5.5);

const higherLine = required(projectBatterHitsPa({ ...baseline, line: 1.5 }));
assert.ok(higherLine.overProbability < result.overProbability);

const leadoff = required(projectBatterHitsPa({ ...baseline, battingOrder: 1 }));
const ninth = required(projectBatterHitsPa({ ...baseline, battingOrder: 9 }));
assert.ok(leadoff.projectedAtBats > ninth.projectedAtBats);
assert.ok(leadoff.overProbability > ninth.overProbability);

const hot = required(projectBatterHitsPa({
  ...baseline,
  recentLogs: baseline.recentLogs.map((log) => ({ ...log, value: Number(log.secondaryLabel?.match(/(\d+) AB/)?.[1] ?? 0) })),
}));
const cold = required(projectBatterHitsPa({
  ...baseline,
  recentLogs: baseline.recentLogs.map((log) => ({ ...log, value: 0 })),
}));
assert.ok(hot.overProbability > cold.overProbability);

assert.equal(projectBatterHitsPa({ ...baseline, recentLogs: [] }), null);
assert.equal(projectBatterHitsPa({ ...baseline, recentLogs: [{ value: 1, secondaryLabel: "missing AB" }] }), null);
assert.equal(projectBatterHitsPa({ ...baseline, recentLogs: [{ value: 5, secondaryLabel: "4 AB" }] }), null);

const startedAt = performance.now();
for (let index = 0; index < 6_000; index++) {
  assert.ok(projectBatterHitsPa({ ...baseline, battingOrder: index % 9 + 1 }));
}
const elapsedMs = performance.now() - startedAt;
assert.ok(elapsedMs < 2_000, `6,000 projections took ${elapsedMs.toFixed(1)}ms`);

console.log(`PASS ${BATTER_HITS_PA_MODEL_VERSION}: deterministic math and 6,000 projections in ${elapsedMs.toFixed(1)}ms`);

function required<T>(value: T | null): T {
  assert.notEqual(value, null);
  return value as T;
}
