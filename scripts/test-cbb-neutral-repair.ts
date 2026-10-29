import assert from "node:assert/strict";
import { cbbThresholdProbabilities, forecastCbbGame } from "../lib/cbb/model";
import { forecastCbbCandidateR2 } from "../lib/cbb/candidateR2Runtime";
import artifact from "../lib/cbb/artifacts/candidate-r2.json";
import { correctCbbScoreForecast, type CbbScoreCorrection } from "../lib/cbb/scoreResearch";
import { applyCbbNoise, applyCbbSymmetricHead, cbbRepairRowFromState, cbbReverseNeutralRow,
  fitCbbNoise, fitCbbSymmetricHead, projectCbbNeutralR2, CBB_NEUTRAL_REPAIR_RELEASE, type CbbRepairRow } from "../lib/cbb/neutralRepairResearch";
import type { CbbTrainingGame } from "../lib/cbb/types";
import { applyCbbResidualStats, cbbResidualStatDesign, fitCbbResidualStats } from "../lib/cbb/residualStatResearch";
import results from "../lib/cbb/artifacts/repair-r10-r12.json";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const fixture = { id: 10882407, date: "2026-11-01T14:30:00.000Z", season: 2026, homeId: 92, awayId: 11, neutral: true };
const state = forecastCbbCandidateR2(fixture, "2026-10-28T20:00:00.000Z").state;
const factors = { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 };
const game: CbbTrainingGame = { ...fixture, homeScore: 90, awayScore: 70, homeRegulation: 90, awayRegulation: 70,
  homeFactors: factors, awayFactors: factors, overtime: false, possessions: 70, tempo: 70 };
const correction = artifact.correction as CbbScoreCorrection;
function raw(g: CbbTrainingGame, history: CbbTrainingGame[] = []): CbbRepairRow {
  return cbbRepairRowFromState(forecastCbbGame(state, g, artifact.uncertainty), state, g, history);
}
for (const history of [[], [
  { ...game, id: 1, date: "2026-10-20T18:00:00.000Z", homeId: 92, awayId: 100 },
  { ...game, id: 2, date: "2026-10-21T18:00:00.000Z", homeId: 100, awayId: 11 },
]]) {
  const a = raw(game, history), transformed = cbbReverseNeutralRow(a), actual = raw(transformed.game, history);
  actual.features.forEach((v, i) => close(v, transformed.features[i]));
  const twice = cbbReverseNeutralRow(transformed); twice.features.forEach((v, i) => close(v, a.features[i]));
  const forward = projectCbbNeutralR2(a, correction), backward = projectCbbNeutralR2(actual, correction);
  close(forward.margin, -backward.margin); close(forward.total, backward.total);
  close(forward.homeScore, backward.awayScore); close(forward.awayScore, backward.homeScore);
  close(forward.homeWinProbability + backward.homeWinProbability, 1);
  close(cbbThresholdProbabilities(forward, "spread", 0).first, forward.homeWinProbability);
  for (const line of [-6, -3, 0, 3, 6]) {
    const x = cbbThresholdProbabilities(forward, "spread", line), y = cbbThresholdProbabilities(backward, "spread", -line);
    close(x.first, y.second); close(x.push, y.push);
  }
  const poisoned = { ...a, game: { ...a.game, homeScore: 1, awayScore: 200, overtime: true, tempo: 200 } };
  assert.deepEqual(projectCbbNeutralR2(poisoned, correction), forward);
}
const home = raw({ ...game, neutral: false });
const before = correctCbbScoreForecast(home.forecast, home.features, correction, 2026);
assert.deepEqual(projectCbbNeutralR2(home, correction), { ...before, release: CBB_NEUTRAL_REPAIR_RELEASE });
assert.notEqual(home.forecast.margin, raw(game).forecast.margin); // Real home advantage remains.
assert.throws(() => cbbReverseNeutralRow(home), /verified neutral/);

const source = raw(game);
const training: CbbRepairRow[] = Array.from({ length: 300 }, (_, i) => ({ ...source,
  game: { ...game, id: i + 1, season: 2023, date: "2024-01-01T18:00:00.000Z", homeScore: 70 + i % 25, awayScore: 70 },
  forecast: { ...source.forecast, asOf: "2024-01-01T00:00:00.000Z" },
  features: source.features.map((v, j) => j === 1 ? i / 100 : v),
}));
const mean = fitCbbSymmetricHead(training, "2024-02-01T00:00:00.000Z");
const a = applyCbbSymmetricHead(source, mean), b = applyCbbSymmetricHead(cbbReverseNeutralRow(source), mean);
close(a.margin, -b.margin); close(a.total, b.total); close(a.homeWinProbability + b.homeWinProbability, 1);
assert.throws(() => fitCbbSymmetricHead(training, "2024-01-01T23:59:59.000Z"), /future/);
assert.throws(() => applyCbbSymmetricHead(source, { ...mean, trainingGameIds: [game.id] }), /in-sample/);
assert.throws(() => applyCbbSymmetricHead(source, { ...mean, trainedThrough: "invalid" }), /in-sample/);
assert.throws(() => applyCbbSymmetricHead(source, { ...mean, trainedThrough: "2026-11-01T00:00:00.000Z" }), /in-sample/);
const noiseTraining = training.map((r, i) => ({ ...r, forecast: { ...a, asOf: r.forecast.asOf, possessions: 60 + i % 20 }, minimumTeamGames: i % 30 }));
for (const kind of ["constant", "conditional"] as const) {
  const noise = fitCbbNoise(noiseTraining, "2024-02-01T00:00:00.000Z", kind, "refit");
  const x = applyCbbNoise({ ...source, forecast: a }, noise), y = applyCbbNoise({ ...source, forecast: b }, noise);
  close(x.margin, a.margin); close(x.total, a.total); close(x.homeWinProbability + y.homeWinProbability, 1);
  assert.ok(x.uncertainty.marginSd > 0 && x.uncertainty.totalSd > 0);
  close(x.uncertainty.marginSd, y.uncertainty.marginSd); close(x.uncertainty.totalSd, y.uncertainty.totalSd);
  assert.throws(() => applyCbbNoise({ ...source, forecast: a }, { ...noise, trainingGameIds: [game.id] }), /in-sample/);
  assert.throws(() => applyCbbNoise({ ...source, forecast: a }, { ...noise, trainedThrough: "2026-11-01T00:00:00.000Z" }), /in-sample/);
  assert.throws(() => applyCbbNoise(source, noise), /incompatible/);
}
const extra = Array.from({ length: 50 }, (_, i) => Math.sin(i + 1) / 2);
const offsetTraining = training.map((r, i) => ({ ...r, forecast: { ...a, asOf: r.forecast.asOf },
  features: [...r.features, ...extra.map((v, j) => v + Math.sin(i * (j + 1)) / 3)] }));
const offset = fitCbbResidualStats(offsetTraining, "2024-02-01T00:00:00.000Z", "squared");
const offsetInput = { ...source, forecast: a, features: [...source.features, ...extra] };
const mirroredFeatures = offsetInput.features.map((v, i) => {
  const probe = { ...offsetInput, features: offsetInput.features.map((_, j) => i === j ? 1 : 0) };
  return cbbResidualStatDesign(probe, "margin")[i] ? -v : v;
});
const offsetReverse = { ...offsetInput, game: cbbReverseNeutralRow(source).game, forecast: b, features: mirroredFeatures };
const oa = applyCbbResidualStats(offsetInput, offset).forecast, ob = applyCbbResidualStats(offsetReverse, offset).forecast;
close(oa.margin, -ob.margin); close(oa.total, ob.total); close(oa.homeWinProbability + ob.homeWinProbability, 1);
assert.throws(() => applyCbbResidualStats(offsetInput, { ...offset, trainingGameIds: [game.id] }), /in-sample/);
assert.throws(() => fitCbbResidualStats(offsetTraining, "2024-01-01T23:59:59.000Z", "squared"), /future/);
assert.throws(() => applyCbbResidualStats({ ...offsetInput, features: extra }, offset), /features/);
assert.equal(results.status, "private_audit_only_not_promoted");
assert.equal(results.defaultPreviewUnchanged, true); assert.equal(results.productionWrites, 0); assert.equal(results.providerCalls, 0);
assert.equal(results.diagnostic2025.r12.wins - results.diagnostic2025.r2.wins, results.diagnostic2025.r12Paired.net);
assert.equal(results.diagnostic2025.r12Paired.corrections - results.diagnostic2025.r12Paired.harms, results.diagnostic2025.r12Paired.net);
assert.equal(results.invariants.r10.neutralGames, 689); assert.equal(results.invariants.r12.games, 689);
assert.equal(results.invariants.r10.nonNeutralNumericalChanges, 0);
for (const cohort of [...Object.values(results.threeMarket353), results.openingTotal635]) {
  for (const row of Object.values(cohort)) {
    assert.equal(row.wins + row.losses + row.pushes + row.passes, cohort.r2.wins + cohort.r2.losses + cohort.r2.pushes + cohort.r2.passes);
    assert.equal(row.wins - cohort.r2.wins, row.corrections - row.harms);
  }
}
assert.ok(results.openingTotal635.r12.wins < results.openingTotal635.r2.wins);
assert.ok(results.threeMarket353.moneyline.r12.wins < results.threeMarket353.moneyline.r2.wins);
console.log("CBB repair: neutral reflection, actual-state feature parity, real home advantage, coherent alternate lines, no outcome dependency, chronology and positive invariant uncertainty passed.");
