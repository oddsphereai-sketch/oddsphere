import assert from "node:assert/strict";
import { CBB_LEVEL_STACK_RESEARCH_RELEASE, fitCbbMarketLevelStack, predictCbbMarketLevelStack,
  type CbbLevelStackExpert, type CbbLevelStackTrainingRow, type CbbMarketLevelStackModel } from "../lib/cbb/marketLevelStackResearch";

const experts: CbbLevelStackExpert[] = [{ id: "independent", kind: "independent" }, { id: "circa", kind: "market", book: "circa", market: "spread" }];
const cutoff = "2026-03-01T00:00:00Z", decisionAt = "2026-02-01T00:00:00Z", outcomeAvailableAt = "2026-02-02T00:00:00Z";
const row = (gameId: number, outcome: number, values: Record<string, number>): CbbLevelStackTrainingRow =>
  ({ gameId, decisionAt, outcomeAvailableAt, outcome, values });
const rows = [row(1, 1, { independent: 5, circa: 2 }), row(2, -2, { independent: 0, circa: -4 }),
  row(3, 3, { independent: 0, circa: 2 }), row(4, 4, { independent: 7, circa: 6 })];
const fit = (trainingRows = rows, fixedExperts = experts) => fitCbbMarketLevelStack({ axis: "margin", experts: fixedExperts,
  rows: trainingRows, trainingCutoff: cutoff, sourceScope: "synthetic paired-book margin fixture; offline only" });
function fitted(result: ReturnType<typeof fit>): CbbMarketLevelStackModel {
  assert.equal(result.status, "fitted", JSON.stringify(result));
  if (result.status !== "fitted") throw new Error("test fit unavailable");
  return result.model;
}
const close = (a: number, b: number, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const predict = (model: CbbMarketLevelStackModel, values: Record<string, number>) => {
  const prediction = predictCbbMarketLevelStack(model, values);
  assert.equal(prediction.status, "predicted");
  if (prediction.status !== "predicted") throw new Error("test pattern mismatch");
  return prediction.value;
};

const original = JSON.stringify({ rows, experts });
rows.forEach(r => { Object.freeze(r.values); Object.freeze(r); }); Object.freeze(rows); experts.forEach(Object.freeze); Object.freeze(experts);
const model = fitted(fit());
const numerator = rows.reduce((s, r) => s + (r.values.independent - r.outcome) * (r.values.independent - r.values.circa), 0);
const denominator = rows.reduce((s, r) => s + (r.values.independent - r.values.circa) ** 2, 0);
const alpha = Math.max(0, Math.min(1, numerator / denominator));
close(model.weights[1], alpha); close(model.weights[0], 1 - alpha);
close(model.trainingRisk, rows.reduce((s, r) => s + (predict(model, r.values) - r.outcome) ** 2, 0) / rows.length);
assert.equal(model.release, CBB_LEVEL_STACK_RESEARCH_RELEASE); assert.equal(model.trainingCutoff, cutoff);
assert.deepEqual(model.trainingGameIds, [1, 2, 3, 4]); assert.equal(model.trainedThrough, "2026-02-02T00:00:00.000Z");
assert.equal(JSON.stringify({ rows, experts }), original, "fitting does not change inputs or source declarations");

// Uncentered second moments retain constant bias: a centered covariance-only
// fit would see a zero matrix here and discard all of this outcome evidence.
const biased = fitted(fit([row(1, 0, { independent: 10, circa: 1 }), row(2, 2, { independent: 12, circa: 3 })]));
close(biased.weights[0], 0); close(biased.weights[1], 1); close(biased.trainingRisk, 1);
assert.deepEqual(biased.uncenteredSecondMoment, [[100, 10], [10, 1]]);

// A shared outcome-noise term c11^T adds the same risk to every simplex
// mixture. These paired perturbations create it exactly without assuming
// that a game's residual SD is the experts' epistemic uncertainty.
const noisyRows = rows.flatMap((r, i) => [-5, 5].map((noise, k) => ({ ...r, gameId: i * 2 + k + 1, outcome: r.outcome + noise })));
const noisy = fitted(fit(noisyRows));
model.weights.forEach((weight, i) => close(noisy.weights[i], weight));
model.uncenteredSecondMoment.forEach((r, i) => r.forEach((value, j) => close(noisy.uncenteredSecondMoment[i][j], value + 25)));
close(noisy.trainingRisk, model.trainingRisk + 25);

// Singular second moment does not itself mean an unidentified optimum: the
// opposite constant biases identify the unique half/half zero-error fit.
const opposite = fitted(fit([row(1, 0, { independent: 1, circa: -1 }), row(2, 2, { independent: 3, circa: 1 })]));
close(opposite.weights[0], .5); close(opposite.weights[1], .5); close(opposite.trainingRisk, 0);
const collinear = fit(rows.map(r => ({ ...r, values: { independent: r.values.independent, circa: r.values.independent } })));
assert.equal(collinear.status, "unidentified");
if (collinear.status === "unidentified") {
  assert.equal(collinear.reason, "multiple_optimal_weight_vectors");
  assert.ok(collinear.candidateWeights.length >= 2, "different future mixtures cannot be resolved by source name");
}
const threeExperts: CbbLevelStackExpert[] = [...experts, { id: "pinnacle", kind: "market", book: "pinnacle", market: "spread" }];
const duplicatedMarketColumns = fit([row(1, 0, { independent: 2, circa: -1, pinnacle: -1 }),
  row(2, 1, { independent: -1, circa: 2, pinnacle: 2 })], threeExperts);
assert.equal(duplicatedMarketColumns.status, "unidentified", "two different books identical in training cannot receive an arbitrary future mixture");
const inactiveCollinearity = fitted(fit([row(1, 1, { independent: 1, circa: 3, pinnacle: 3 }),
  row(2, 2, { independent: 2, circa: 5, pinnacle: 5 })], threeExperts));
assert.deepEqual(inactiveCollinearity.weights, [1, 0, 0], "redundant unused experts do not invalidate an identified boundary optimum");

const diagonal = fitted(fit([row(1, 0, { independent: Math.sqrt(3), circa: 0, pinnacle: 0 }),
  row(2, 0, { independent: 0, circa: 2 * Math.sqrt(3), pinnacle: 0 }),
  row(3, 0, { independent: 0, circa: 0, pinnacle: 3 * Math.sqrt(3) })], threeExperts));
[36 / 49, 9 / 49, 4 / 49].forEach((weight, i) => close(diagonal.weights[i], weight));
const reordered = fitted(fit(rows, [...experts].reverse()));
assert.equal(reordered.sourcePattern, model.sourcePattern);
close(predict(reordered, { independent: 14, circa: -3 }), predict(model, { independent: 14, circa: -3 }));
const sixExperts: CbbLevelStackExpert[] = [experts[0], ...Array.from({ length: 5 }, (_, i): CbbLevelStackExpert =>
  ({ id: `book_${i}`, kind: "market", book: `book_${i}`, market: "spread" }))];
const sixRows = sixExperts.map((_, i) => row(i + 1, 0, Object.fromEntries(sixExperts.map((expert, j) =>
  [expert.id, i === j ? Math.sqrt(6) * (j + 1) : 0]))));
const six = fitted(fit(sixRows, sixExperts)), inverseVarianceSum = sixExperts.reduce((s, _, i) => s + 1 / (i + 1) ** 2, 0);
six.weights.forEach((weight, i) => close(weight, 1 / (i + 1) ** 2 / inverseVarianceSum));

// Continuous fitted means have no independent-sign arbitration. The crossing
// below is earned by the synthetic training outcomes, not a winner constraint.
const crossing = fitted(fit([row(1, 0, { independent: 10, circa: 1 }), row(2, 0, { independent: -10, circa: 1 })]));
assert.ok(predict(crossing, { independent: 14, circa: -3 }) < 0);
assert.ok(predict(crossing, { independent: -14, circa: 3 }) > 0);
close(predict(crossing, { independent: .0001, circa: -3 }) - predict(crossing, { independent: -.0001, circa: -3 }), crossing.weights[0] * .0002);
const mirrored = fitted(fit(rows.map(r => ({ ...r, outcome: -r.outcome,
  values: { independent: -r.values.independent, circa: -r.values.circa } }))));
mirrored.weights.forEach((weight, i) => close(weight, model.weights[i]));
close(predict(mirrored, { independent: -14, circa: 3 }), -predict(model, { independent: 14, circa: -3 }));
const perturbed = fitted(fit(rows.map((r, i) => ({ ...r, values: { ...r.values, circa: r.values.circa + (i + 1) * 1e-7 } }))));
assert.ok(Math.abs(perturbed.weights[1] - model.weights[1]) < 1e-6);
const translated = fitted(fit(rows.map(r => ({ ...r, outcome: r.outcome + 100,
  values: { independent: r.values.independent + 100, circa: r.values.circa + 100 } }))));
translated.weights.forEach((weight, i) => close(weight, model.weights[i]));
close(predict(translated, { independent: 114, circa: 97 }), predict(model, { independent: 14, circa: -3 }) + 100);
for (const scale of [1e-8, 1e8]) {
  const scaled = fitted(fit(rows.map(r => ({ ...r, outcome: r.outcome * scale,
    values: { independent: r.values.independent * scale, circa: r.values.circa * scale } }))));
  scaled.weights.forEach((weight, i) => close(weight, model.weights[i]));
}

assert.equal(predictCbbMarketLevelStack(model, { independent: 14 }).status, "unsupported_source_pattern");
assert.equal(predictCbbMarketLevelStack(model, { independent: 14, circa: -3, pinnacle: -3 }).status, "unsupported_source_pattern");
assert.throws(() => predictCbbMarketLevelStack(model, { independent: 14, circa: NaN }), /nonfinite/);
assert.throws(() => fit(rows, [...experts, { id: "circa_ml", kind: "market", book: "CIRCA", market: "moneyline" }]), /physical book/);
assert.throws(() => fit(rows, [{ id: "independent", kind: "independent" },
  { id: "pin", kind: "market", book: "pinnacle", market: "spread" }, { id: "ps", kind: "market", book: "ps3838", market: "moneyline" }]), /physical book/);
assert.throws(() => fit(rows, [experts[0], { id: "circa", kind: "market", book: "circa", market: "total" }]), /coordinate/);
assert.throws(() => fit([...rows, rows[0]]), /duplicate game/);
assert.throws(() => fit(rows.map(r => ({ ...r, outcomeAvailableAt: "2026-03-02T00:00:00Z" }))), /future outcome/);
assert.throws(() => fit(rows.map(r => ({ ...r, values: { independent: r.values.independent } }))), /unsupported source pattern/);
assert.throws(() => fit(rows.map(r => ({ ...r, values: { ...r.values, circa: Infinity } }))), /nonfinite/);
assert.throws(() => fit(rows, [experts[0], ...Array.from({ length: 6 }, (_, i): CbbLevelStackExpert =>
  ({ id: `book_${i}`, kind: "market", book: `book_${i}`, market: "spread" }))]), /at most six/);
const total = fitCbbMarketLevelStack({ axis: "total", experts: [experts[0], { id: "circa", kind: "market", book: "circa", market: "total" }],
  rows, trainingCutoff: cutoff, sourceScope: "synthetic Total pattern" });
assert.equal(total.status, "fitted");
console.log("PASS offline CBB level stack: exact simplex risk, bias/shared-noise, fixed physical source patterns, identified/ambiguous singular faces, continuity, symmetry and earned full crossing; no real fit or live activation.");
