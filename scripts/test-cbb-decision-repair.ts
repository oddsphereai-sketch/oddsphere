import assert from "node:assert/strict";
import { applyCbbDecisionHead, cbbProbitDecisionLoss, CBB_DECISION_RELEASES, type CbbDecisionHead } from "../lib/cbb/decisionResearch";
import { CBB_NEUTRAL_REPAIR_RELEASE } from "../lib/cbb/neutralRepairResearch";
import { cbbOvertimeMixtureMoments, cbbOvertimeMixtureProbabilitiesAtLine, fitCbbOvertimeMixture } from "../lib/cbb/overtimeDistributionResearch";
import result from "../lib/cbb/artifacts/decision-repair-r13-r16.json";
import type { CbbScoreFeatureRow } from "../lib/cbb/scoreResearch";
import type { CbbForecast, CbbTrainingGame } from "../lib/cbb/types";

const close = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const factors = { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 };
const uncertainty = { marginSd: 12, totalSd: 17, marginTotalCorrelation: 0, marginCorrection: 0,
  totalCorrection: 0, fitThroughSeason: 2022, games: 5000 };
const forecast = (id: number, margin: number, asOf: string): CbbForecast => ({ release: CBB_NEUTRAL_REPAIR_RELEASE,
  gameId: id, asOf, homeId: 1, awayId: 2, homeScore: (145 + margin) / 2, awayScore: (145 - margin) / 2,
  margin, total: 145, possessions: 70, homeWinProbability: 0.5, uncertainty, inputStatus: "complete", issues: [] });
const makeRow = (i: number): CbbScoreFeatureRow => {
  const overtime = i % 11 === 0, margin = (i % 14) - 7;
  const game: CbbTrainingGame = { id: i + 1, date: "2024-01-02T20:00:00.000Z", season: 2023,
    homeId: 1, awayId: 2, homeScore: overtime ? 80 : 75, awayScore: overtime ? 75 : 70,
    homeRegulation: overtime ? 70 : 75, awayRegulation: overtime ? 70 : 70,
    overtime, possessions: 70, tempo: 70, neutral: false, homeFactors: factors, awayFactors: factors };
  return { game, forecast: forecast(game.id, margin, "2024-01-02T00:00:00.000Z"), features: Array(69).fill(0) };
};
const training = Array.from({ length: 400 }, (_, i) => makeRow(i));
const overtimeHead = fitCbbOvertimeMixture(training, "2024-07-01T00:00:00.000Z");
assert.equal(overtimeHead.trainingGames, 400);
assert.equal(overtimeHead.overtimeGames, training.filter(r => r.game.overtime).length);
assert.equal(overtimeHead.converged, true);
close(overtimeHead.overtimeAddedPoints, 15);
const future = forecast(999, 4, "2024-11-01T00:00:00.000Z");
const moments = cbbOvertimeMixtureMoments(future, overtimeHead);
close((1 - moments.overtimeProbability) * moments.regulationMean + moments.overtimeProbability * moments.overtimeMean, future.total);
close(moments.withinComponentSd ** 2 + moments.overtimeProbability * (1 - moments.overtimeProbability) * moments.overtimeAddedPoints ** 2,
  future.uncertainty.totalSd ** 2);
for (const line of [135, 135.5, 140, 140.5, 145, 145.5, 150, 150.5]) {
  const p = cbbOvertimeMixtureProbabilitiesAtLine(moments, line);
  close(p.first + p.second + p.push, 1);
  assert.ok(p.first >= 0 && p.second >= 0 && p.push >= 0);
}
assert.ok(cbbOvertimeMixtureProbabilitiesAtLine(moments, 135.5).first > cbbOvertimeMixtureProbabilitiesAtLine(moments, 145.5).first);
close(cbbOvertimeMixtureMoments({ ...future, margin: -4 }, overtimeHead).overtimeProbability, moments.overtimeProbability);
close(cbbOvertimeMixtureProbabilitiesAtLine(cbbOvertimeMixtureMoments({ ...future, margin: -4 }, overtimeHead), 145.5).first,
  cbbOvertimeMixtureProbabilitiesAtLine(moments, 145.5).first);
assert.throws(() => cbbOvertimeMixtureMoments(training[0].forecast, overtimeHead), /in-sample/);
assert.throws(() => cbbOvertimeMixtureMoments({ ...future, gameId: training[0].game.id }, overtimeHead), /in-sample/);
assert.throws(() => fitCbbOvertimeMixture(training, "2024-01-02T21:00:00.000Z"), /chronology/);
assert.throws(() => cbbOvertimeMixtureProbabilitiesAtLine(moments, 140.1), /line/);

const side = { regressions: Array.from({ length: 50 }, () => Array(19).fill(0)), coefficients: Array(50).fill(0) };
const decisionHead: CbbDecisionHead = { release: CBB_DECISION_RELEASES.matched_total, variant: "matched_total",
  trainedThrough: "2024-07-01T00:00:00.000Z", trainingGameIds: training.map(r => r.game.id),
  margin: side, total: side, marginSource: "frozen_r12", numerical: {} };
const target: CbbScoreFeatureRow = { game: { ...training[0].game, id: 999, date: "2024-11-01T20:00:00.000Z", season: 2024 },
  forecast: future, features: Array(69).fill(0) };
const same = applyCbbDecisionHead(target, decisionHead).forecast;
close(same.margin, future.margin); close(same.total, future.total);
close(same.homeScore, future.homeScore); close(same.awayScore, future.awayScore);
assert.throws(() => applyCbbDecisionHead(target, { ...decisionHead, release: CBB_DECISION_RELEASES.median_total }), /incompatible/);
assert.throws(() => applyCbbDecisionHead({ ...target, game: training[0].game, forecast: training[0].forecast }, decisionHead), /in-sample/);
const smooth = cbbProbitDecisionLoss(151, 145, 17, [130.5, 140.5, 150.5, 160.5]);
const h = 1e-3;
const plus = cbbProbitDecisionLoss(151, 145 + h, 17, [130.5, 140.5, 150.5, 160.5]);
const minus = cbbProbitDecisionLoss(151, 145 - h, 17, [130.5, 140.5, 150.5, 160.5]);
close(smooth.gradient, (plus.loss - minus.loss) / (2 * h), 5e-5);
close(smooth.curvature, (plus.loss - 2 * smooth.loss + minus.loss) / (h * h), 5e-4);
assert.equal(result.status, "private_audit_only_not_promoted");
assert.equal(result.productionWrites, 0);
assert.equal(result.defaultPreviewUnchanged, true);
assert.equal(result.candidates.r13MatchedMean.opening635Total, 325);
assert.equal(result.candidates.r16OvertimeMixture.opening635Total, 329);
assert.ok(result.candidates.r13MatchedMean.opening635Total < result.baselineR2.opening635Total);
assert.ok(result.candidates.r16OvertimeMixture.opening635Total < result.baselineR2.opening635Total);
console.log("CBB decision repair: chronology, one-score coherence, overtime mixture moments, exact line probabilities and optimizer derivatives passed.");
