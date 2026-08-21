import assert from "node:assert/strict";
import {
  FOOTBALL_AS_OF_DATASET_RELEASE,
  auditAsOfFootballGame,
  buildFootballExpandingWindowFolds,
  buildPregameFeatureSnapshot,
  type AsOfFootballGame,
} from "../lib/services/football/footballAsOfDataset";
import { predictDynamicMargin, type CompletedMarginGame, type DynamicMarginConfig } from "../lib/services/football/footballDynamicMarginBenchmark";
import { evaluateFootballPointForecasts, evaluateFootballProbabilities } from "../lib/services/football/footballEvaluation";
import { buildFootballMarketOnlyBenchmark } from "../lib/services/football/footballMarketBaseline";
import type { FootballMarketObservation } from "../lib/services/football/footballModelContract";

function asOfGame(season: number, week: number, id: string): AsOfFootballGame {
  const kickoff = `${season}-09-${String(week).padStart(2, "0")}T17:00:00Z`;
  return {
    datasetRelease: FOOTBALL_AS_OF_DATASET_RELEASE,
    identity: { league: "nfl", providerGameId: id, season, week, seasonPhase: "regular", scheduledStart: kickoff, homeTeamId: "A", awayTeamId: "B", neutralSite: false, venue: null },
    decisionTimestamp: `${season}-09-${String(week).padStart(2, "0")}T16:00:00Z`,
    observations: [{ feature: "qb_adjustment", value: 1.5, firstKnownAt: `${season}-09-${String(week).padStart(2, "0")}T15:00:00Z`, source: "test", sourceRecordId: null }],
    final: { homeScore: 24, awayScore: 17, finalizedAt: `${season}-09-${String(week).padStart(2, "0")}T21:00:00Z` },
  };
}

const clean = asOfGame(2024, 1, "g1");
assert.equal(auditAsOfFootballGame(clean).length, 0);
const withFuture = { ...clean, observations: [...clean.observations, { feature: "closing_line", value: -3, firstKnownAt: "2024-09-01T18:00:00Z", source: "test", sourceRecordId: null }] };
assert.equal(auditAsOfFootballGame(withFuture).some((finding) => finding.code === "future_feature"), true);
assert.throws(() => buildPregameFeatureSnapshot(withFuture), /future_feature/);

const revised = { ...clean, observations: [...clean.observations, { feature: "qb_adjustment", value: 2, firstKnownAt: "2024-09-01T15:30:00Z", source: "test", sourceRecordId: "new" }] };
assert.equal(buildPregameFeatureSnapshot(revised).get("qb_adjustment")?.value, 2);

const foldGames = [asOfGame(2023, 1, "a"), asOfGame(2023, 2, "b"), asOfGame(2024, 1, "c")];
const folds = buildFootballExpandingWindowFolds({ games: foldGames, league: "nfl", minimumTrainingGames: 1 });
assert.equal(folds.length, 2);
assert.deepEqual(folds[0].train.map((row) => row.identity.providerGameId), ["a"]);
assert.deepEqual(folds[0].test.map((row) => row.identity.providerGameId), ["b"]);
assert.equal(folds[0].train.some((row) => folds[0].test.includes(row)), false);

const config: DynamicMarginConfig = {
  initialTeamVariance: 16,
  weeklyEvolutionVariance: 1,
  offseasonEvolutionVariance: 9,
  seasonCarryover: 0.7,
  observationVariance: 100,
  homeFieldPoints: 2,
};
const history: CompletedMarginGame[] = [
  { league: "nfl", gameId: "h1", season: 2025, week: 1, seasonPhase: "regular", kickoff: "2025-09-01T17:00:00Z", homeTeamId: "A", awayTeamId: "B", neutralSite: false, homeScore: 31, awayScore: 10 },
  { league: "nfl", gameId: "h2", season: 2025, week: 2, seasonPhase: "regular", kickoff: "2025-09-08T17:00:00Z", homeTeamId: "C", awayTeamId: "A", neutralSite: false, homeScore: 14, awayScore: 28 },
  { league: "nfl", gameId: "future", season: 2025, week: 4, seasonPhase: "regular", kickoff: "2025-09-22T17:00:00Z", homeTeamId: "B", awayTeamId: "A", neutralSite: false, homeScore: 60, awayScore: 0 },
];
const target = { league: "nfl" as const, gameId: "target", season: 2025, week: 3, seasonPhase: "regular" as const, kickoff: "2025-09-15T17:00:00Z", decisionTimestamp: "2025-09-15T16:00:00Z", homeTeamId: "A", awayTeamId: "B", neutralSite: false };
const prediction = predictDynamicMargin({ history, target, config, includedHistoryPhases: ["regular"] });
assert.equal(prediction.trainingGames, 2, "future outcomes must be excluded");
assert.ok(prediction.projectedHomeMargin > config.homeFieldPoints, "strong prior results should lift the home team above generic home field");
assert.ok(prediction.homeWinProbability > 0.5 && prediction.homeWinProbability < 1);
const neutral = predictDynamicMargin({ history, target: { ...target, neutralSite: true }, config, includedHistoryPhases: ["regular"] });
assert.ok(Math.abs((prediction.projectedHomeMargin - neutral.projectedHomeMargin) - config.homeFieldPoints) < 1e-9);
const changedFuture = predictDynamicMargin({ history: history.map((row) => row.gameId === "future" ? { ...row, homeScore: 0, awayScore: 100 } : row), target, config, includedHistoryPhases: ["regular"] });
assert.equal(changedFuture.projectedHomeMargin, prediction.projectedHomeMargin, "changing a future final cannot alter a prior forecast");
const ignoredPreseason = predictDynamicMargin({
  history: [...history, { league: "nfl", gameId: "preseason", season: 2025, week: 1, seasonPhase: "preseason", kickoff: "2025-08-01T17:00:00Z", homeTeamId: "A", awayTeamId: "B", neutralSite: false, homeScore: 0, awayScore: 70 }],
  target,
  config,
  includedHistoryPhases: ["regular"],
});
assert.equal(ignoredPreseason.projectedHomeMargin, prediction.projectedHomeMargin, "preseason results must not enter a regular-only benchmark");

function marketPrice(overrides: Partial<FootballMarketObservation>): FootballMarketObservation {
  return {
    provider: "test-provider",
    sourceKey: "test-book",
    sportsbook: "Test Book",
    sourceType: "sportsbook",
    providerEventId: "target",
    market: "moneyline",
    side: "home",
    lineValue: null,
    americanPrice: -150,
    observedAt: "2025-09-15T15:00:00Z",
    fetchedAt: "2025-09-15T15:00:01Z",
    isOpening: false,
    isClosing: false,
    ...overrides,
  };
}

const market = buildFootballMarketOnlyBenchmark({
  providerEventId: "target",
  decisionTimestamp: target.decisionTimestamp,
  moneyline: [marketPrice({}), marketPrice({ side: "away", americanPrice: 130 })],
  spread: [
    marketPrice({ market: "spread", side: "home", lineValue: -3, americanPrice: -110 }),
    marketPrice({ market: "spread", side: "away", lineValue: 3, americanPrice: -110 }),
  ],
  total: [
    marketPrice({ market: "total", side: "over", lineValue: 44.5, americanPrice: -105 }),
    marketPrice({ market: "total", side: "under", lineValue: 44.5, americanPrice: -115 }),
  ],
});
assert.equal(market.projectedHomeMargin, 3);
assert.equal(market.projectedTotal, 44.5);
assert.ok((market.homeWinProbability ?? 0) > 0.5);
assert.throws(() => buildFootballMarketOnlyBenchmark({
  providerEventId: "target",
  decisionTimestamp: target.decisionTimestamp,
  moneyline: [marketPrice({ observedAt: "2025-09-15T18:00:00Z" }), marketPrice({ side: "away", americanPrice: 130, observedAt: "2025-09-15T18:00:00Z" })],
}), /future market observation/);

const probabilityEvaluations = evaluateFootballProbabilities([
  { modelRelease: "candidate-a", league: "nfl", gameId: "1", market: "spread", side: "home", decisionTimestamp: "2025-09-01T16:00:00Z", predictedProbability: 0.6, americanPrice: -110, outcome: "win" },
  { modelRelease: "candidate-a", league: "nfl", gameId: "2", market: "spread", side: "home", decisionTimestamp: "2025-09-08T16:00:00Z", predictedProbability: 0.6, americanPrice: -110, outcome: "push" },
  { modelRelease: "candidate-b", league: "nfl", gameId: "3", market: "spread", side: "away", decisionTimestamp: "2025-09-15T16:00:00Z", predictedProbability: 0.4, americanPrice: 120, outcome: "loss" },
]);
assert.equal(probabilityEvaluations.length, 2, "model releases must remain isolated");
const candidateA = probabilityEvaluations.find((row) => row.modelRelease === "candidate-a")!;
assert.equal(candidateA.resolved, 1);
assert.equal(candidateA.pushes, 1);
assert.ok(Math.abs((candidateA.brierScore ?? 0) - 0.16) < 1e-12, "pushes must not enter probability accuracy");
assert.ok(Math.abs(candidateA.profitUnits - (100 / 110)) < 1e-12);
assert.ok(Math.abs((candidateA.roiPerUnitRisked ?? 0) - (50 / 110)) < 1e-12, "push stakes remain part of units risked");

const pointEvaluations = evaluateFootballPointForecasts([
  { modelRelease: "candidate-a", league: "nfl", gameId: "1", forecast: "home_margin", decisionTimestamp: "2025-09-01T16:00:00Z", predictedValue: 3, actualValue: 7 },
  { modelRelease: "candidate-b", league: "nfl", gameId: "2", forecast: "home_margin", decisionTimestamp: "2025-09-08T16:00:00Z", predictedValue: 6, actualValue: 7 },
]);
assert.equal(pointEvaluations.length, 2, "point metrics must not blend candidate releases");

console.log("Football model research: as-of, dynamic, market baseline, and evaluation tests passed");
