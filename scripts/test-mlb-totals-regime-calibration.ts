import assert from "node:assert/strict";

import {
  applyMlbTotalsRegimeCalibration,
  buildMlbTotalsRegimePrior,
  MLB_TOTALS_REGIME_CALIBRATION_RELEASE,
  type MlbTotalsRegimePrior,
} from "../lib/automodel/mlbTotalsRegimeCalibration";

const builtPrior = buildMlbTotalsRegimePrior([
  ...Array.from({ length: 57 }, (_, index) => ({ date: `2026-09-${String(18 - (index % 9)).padStart(2, "0")}`, side: "over", result: "win" })),
  ...Array.from({ length: 33 }, (_, index) => ({ date: `2026-09-${String(18 - (index % 9)).padStart(2, "0")}`, side: "under", result: "win" })),
]);
assert.ok(builtPrior !== null);
assert.equal(builtPrior.overWins, 57);
assert.equal(builtPrior.underWins, 33);
assert.equal(builtPrior.smoothedOverRate, 0.62);
assert.equal(buildMlbTotalsRegimePrior(Array.from({ length: 89 }, () => ({ date: "2026-09-18", side: "over", result: "win" }))), null);

const prior: MlbTotalsRegimePrior = {
  release: MLB_TOTALS_REGIME_CALIBRATION_RELEASE,
  sampleSize: 90,
  overWins: 57,
  underWins: 33,
  rawOverRate: 57 / 90,
  smoothedOverRate: 62 / 100,
  latestSettledDate: "2026-09-18",
};

const calibrated = applyMlbTotalsRegimeCalibration({
  modelOverProbability: 0.46,
  prior,
});
assert.equal(calibrated.applied, true);
assert.equal(calibrated.release, MLB_TOTALS_REGIME_CALIBRATION_RELEASE);
assert.ok(Math.abs(calibrated.modelOverProbabilityAfter - 0.516) < 1e-12);
assert.equal(calibrated.modelOverProbabilityAfter >= 0.5, true, "a sufficiently strong run environment can change the forecast side");

const missing = applyMlbTotalsRegimeCalibration({ modelOverProbability: 0.46, prior: null });
assert.equal(missing.applied, false);
assert.equal(missing.modelOverProbabilityAfter, 0.46, "missing prior must preserve the incumbent probability");

const thin = applyMlbTotalsRegimeCalibration({
  modelOverProbability: 0.46,
  prior: { ...prior, sampleSize: 89 },
});
assert.equal(thin.applied, false);
assert.equal(thin.reason, "insufficient_prior_sample");

console.log("mlb totals regime calibration tests passed");
