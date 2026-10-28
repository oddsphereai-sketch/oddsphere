import assert from "node:assert/strict";
import { CBB_CANDIDATES, cbbThresholdProbabilities, fitCbbRatings, forecastCbbGame } from "../lib/cbb/model";
import { CBB_DEVELOPMENT_UNCERTAINTY } from "../lib/cbb/evaluation";
import { cbbScoreFeatures, correctCbbScoreForecast, fitCbbScoreCorrection, fitCbbScoreResearchState, type CbbScoreFeatureRow } from "../lib/cbb/scoreResearch";
import { trainCbbScoreTrees, applyCbbScoreTrees } from "../lib/cbb/scoreTrees";
import { forecastCbbCandidateR2 } from "../lib/cbb/candidateR2Runtime";
import type { CbbTrainingGame } from "../lib/cbb/types";
import paired from "../lib/cbb/artifacts/paired-r2.json";

const games: CbbTrainingGame[] = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, date: new Date(Date.UTC(2023, 10, 1 + i)).toISOString(), season: 2023, homeId: i % 2 ? 1 : 2, awayId: i % 2 ? 2 : 1,
  homeScore: 90, awayScore: 80, homeRegulation: 90, awayRegulation: 80, overtime: false, possessions: 80, tempo: 80, neutral: false,
  homeFactors: { efg: 0.55, turnoverRate: 0.12, offensiveReboundRate: 0.3, freeThrowRate: 0.3 },
  awayFactors: { efg: 0.5, turnoverRate: 0.15, offensiveReboundRate: 0.28, freeThrowRate: 0.3 },
}));
const options = { season: 2023, asOf: "2024-01-01T00:00:00.000Z", config: CBB_CANDIDATES[0] };
const r1 = fitCbbRatings(games, options);
const parity = fitCbbScoreResearchState(games, { ...options, config: { ...options.config, paceRidge: options.config.ridge } });
for (const key of Object.keys(r1.teams)) assert.ok(Math.abs(r1.teams[Number(key)].pace - parity.teams[Number(key)].pace) < 1e-10);
const r2 = fitCbbScoreResearchState(games, { ...options, config: { ...options.config, paceRidge: 0.25 } });
const fixture = { id: 100, date: "2024-01-02T18:00:00.000Z", homeId: 1, awayId: 2, neutral: false };
const old = forecastCbbGame(r1, fixture, CBB_DEVELOPMENT_UNCERTAINTY), next = forecastCbbGame(r2, fixture, CBB_DEVELOPMENT_UNCERTAINTY);
assert.ok(Math.abs(next.possessions - 80) < Math.abs(old.possessions - 80));
const features = cbbScoreFeatures(next, r2, fixture, games);
assert.throws(() => cbbScoreFeatures(next, r2, fixture, [{ ...games[0], date: "2024-01-02T00:00:00Z" }]), /future/);
const rows: CbbScoreFeatureRow[] = Array.from({ length: 300 }, (_, i) => {
  const x = (i % 30) / 10, residual = x > 1.5 ? 6 : -4;
  return { game: { ...games[i % games.length], id: i, homeScore: 85 + residual, awayScore: 70 },
    forecast: { ...next, margin: 15, total: 155, homeScore: 85, awayScore: 70 }, features: features.map((v, j) => j === 0 ? 1 : j === 1 ? x : v) };
});
const correction = fitCbbScoreCorrection(rows, "matchup", 2023);
assert.throws(() => correctCbbScoreForecast(next, features, correction, 2023), /in-sample/);
const corrected = correctCbbScoreForecast(next, features, correction, 2024);
assert.equal(corrected.homeScore + corrected.awayScore, corrected.total);
assert.ok(Math.abs(corrected.homeScore - corrected.awayScore - corrected.margin) < 1e-10);
const trees = trainCbbScoreTrees(rows, 2023, { depth: 2, rounds: 30, learningRate: 0.1, minLeaf: 20, bins: 16 });
assert.throws(() => applyCbbScoreTrees(rows, trees), /in-sample/);
const evaluation = rows.map(row => ({ ...row, game: { ...row.game, season: 2024 } }));
const treeScores = applyCbbScoreTrees(evaluation, JSON.parse(JSON.stringify(trees)));
const error = (rs: CbbScoreFeatureRow[]) => rs.reduce((sum, row) => sum + Math.abs(row.forecast.margin - row.game.homeScore + row.game.awayScore), 0);
assert.ok(error(treeScores) < error(evaluation));
const liveFixture = { id: 10882407, date: "2026-11-01T14:30:00.000Z", season: 2026, homeId: 92, awayId: 11, neutral: true };
const a = forecastCbbCandidateR2(liveFixture, "2026-10-28T20:00:00.000Z").forecast;
const b = forecastCbbCandidateR2(liveFixture, "2026-10-28T20:00:00.000Z").forecast;
assert.deepEqual(a, b);
assert.ok(Math.abs(cbbThresholdProbabilities(a, "spread", 0).first - a.homeWinProbability) < 1e-10);
assert.ok(cbbThresholdProbabilities(a, "spread", 0).push < 1e-12);
assert.throws(() => forecastCbbCandidateR2({ ...liveFixture, season: 2027 }, "2026-10-28T20:00:00.000Z"), /prior-season/);
assert.throws(() => forecastCbbCandidateR2(liveFixture, "2026-10-28T20:00:00.000Z", [{ ...games[0], season: 2026, date: "2026-11-01T00:00:00Z" }]), /future/);
assert.equal(paired.games, paired.baseline.games); assert.equal(paired.games, paired.candidate.games);
assert.equal(paired.candidate.wins - paired.baseline.wins, paired.corrections - paired.harms);
assert.ok(paired.candidate.marginMae < paired.baseline.marginMae);
assert.ok(paired.candidate.totalMae < paired.baseline.totalMae);
console.log("CBB r2: tempo precision/parity, chronology, learned heads, tree serialization, score/market coherence and paired cohort passed.");
