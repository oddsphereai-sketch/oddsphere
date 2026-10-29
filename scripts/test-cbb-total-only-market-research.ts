import assert from "node:assert/strict";
import { CBB_SCORE_RESEARCH_RELEASE } from "../lib/cbb/scoreResearch";
import { applyCbbTotalOnlyMarketHead, chooseCbbCompleteTargetBook, CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE,
  type CbbTotalOnlyMarketHead } from "../lib/cbb/totalOnlyMarketResearch";
import type { CbbForecast, CbbQuote } from "../lib/cbb/types";

const forecast: CbbForecast = {
  release: CBB_SCORE_RESEARCH_RELEASE, gameId: 42, asOf: "2026-11-01T12:00:00.000Z",
  homeId: 1, awayId: 2, homeScore: 78, awayScore: 72, margin: 6, total: 150,
  possessions: 70, homeWinProbability: 0.7, inputStatus: "complete", issues: [],
  uncertainty: { marginSd: 10, totalSd: 14, marginTotalCorrelation: 0,
    marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2024, games: 100 },
};
const head: CbbTotalOnlyMarketHead = {
  release: CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE, independentRelease: CBB_SCORE_RESEARCH_RELEASE,
  mode: "trees", trainedThrough: "2026-03-27T00:00:00.000Z", trainingGameIds: [1], margin: [], total: [],
  trees: { fitThroughSeason: 2025, options: { depth: 2, rounds: 1, learningRate: 1, minLeaf: 50, bins: 16 },
    margin: { intercept: 100, learningRate: 1, trees: [{ value: 0 }] },
    total: { intercept: 4, learningRate: 1, trees: [{ value: 0 }] } },
};
const features = Array(16).fill(0) as number[];
const absent = applyCbbTotalOnlyMarketHead(forecast, features, head);
assert.equal(absent.applied, false);
assert.strictEqual(absent.forecast, forecast, "missing reference preserves exact independent object");
features[13] = 0.2;
const applied = applyCbbTotalOnlyMarketHead(forecast, features, head);
assert.equal(applied.applied, true);
assert.equal(applied.forecast.release, CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE);
assert.equal(applied.forecast.total, 154);
assert.equal(applied.forecast.homeScore, 80);
assert.equal(applied.forecast.awayScore, 74);
assert.equal(applied.forecast.margin, forecast.margin);
assert.equal(applied.forecast.homeWinProbability, forecast.homeWinProbability);
assert.equal(applied.forecast.homeScore + applied.forecast.awayScore, applied.forecast.total);
assert.equal(applied.forecast.homeScore - applied.forecast.awayScore, applied.forecast.margin);
assert.throws(() => applyCbbTotalOnlyMarketHead({ ...forecast, asOf: "2026-03-01T00:00:00.000Z" }, features, head), /chronology/);
assert.throws(() => applyCbbTotalOnlyMarketHead({ ...forecast, gameId: 1 }, features, head), /chronology/);
assert.throws(() => applyCbbTotalOnlyMarketHead({ ...forecast, release: "cbb_r1" }, features, head), /release/);
assert.throws(() => applyCbbTotalOnlyMarketHead(forecast, features.slice(1), head), /feature/);
const bookQuotes = (book: string, gameId = 42): CbbQuote[] => (["moneyline", "spread", "total"] as const)
  .map(market => ({ gameId, sportsbook: book, market, line: market === "moneyline" ? null : 3.5,
    firstPrice: -110, secondPrice: -110, providerObservedAt: forecast.asOf, fetchedAt: forecast.asOf,
    phase: "current" }));
assert.equal(chooseCbbCompleteTargetBook([...bookQuotes("betr"), ...bookQuotes("draftkings")]), "draftkings");
assert.equal(chooseCbbCompleteTargetBook(bookQuotes("draftkings").slice(0, 2)), null);
assert.equal(chooseCbbCompleteTargetBook([...bookQuotes("draftkings"), ...bookQuotes("fanduel", 43)]), null);
console.log("CBB r17 Total-only private reader: no-reference identity, one-score coherence, ML/Spread preservation and chronology passed.");
