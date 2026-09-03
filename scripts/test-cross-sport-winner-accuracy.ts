import assert from "node:assert/strict";

import {
  buildWinnerAccuracyScorecards,
  type WinnerAccuracyObservation,
} from "../lib/services/tracking/winnerAccuracyScorecard";

function row(overrides: Partial<WinnerAccuracyObservation> = {}): WinnerAccuracyObservation {
  return {
    recordId: 1,
    sport: "mlb",
    gameKey: "mlb:1",
    releaseKey: "mlb-r1",
    lockedAt: "2026-09-01T22:00:00.000Z",
    settledAt: "2026-09-02T02:00:00.000Z",
    modelPick: "home",
    actualOutcome: "home",
    modelProbabilities: { home: 0.6, away: 0.4 },
    marketProbabilities: { home: 0.55, away: 0.45 },
    exactPriceAmerican: -120,
    playGrade: "lean",
    noBet: false,
    closingPriceAmerican: -125,
    clvPct: 1.25,
    ...overrides,
  };
}

const binary = buildWinnerAccuracyScorecards([
  row(),
  row({
    recordId: 2,
    gameKey: "mlb:2",
    lockedAt: "2026-09-01T23:00:00.000Z",
    modelPick: "away",
    actualOutcome: "home",
    modelProbabilities: { home: 0.45, away: 0.55 },
    marketProbabilities: { home: 0.52, away: 0.48 },
    exactPriceAmerican: 110,
    playGrade: "no_play",
    noBet: true,
    closingPriceAmerican: null,
    clvPct: null,
  }),
])[0];
assert.equal(binary.winnerAccuracy.sample, 2);
assert.equal(binary.winnerAccuracy.correct, 1);
assert.equal(binary.marketFavoriteBenchmark.correct, 2);
assert.equal(binary.favoriteSelections.sample, 1);
assert.equal(binary.underdogSelections.sample, 1);
assert.equal(binary.upsetDetection.underdogPicks, 1);
assert.equal(binary.modelMarketDisagreements.sample, 1);
assert.equal(binary.modelMarketDisagreements.marketFavoriteCorrect, 1);
assert.equal(binary.exactPriceReturns.actionableOnly.resolved, 1);
assert.equal(binary.clv.actionableOnly.covered, 1);
assert.equal(binary.clv.allDirectionalCalls.coveragePct, 50);
assert.ok(Math.abs((binary.modelProbability.brierScore ?? 0) - 0.23125) < 1e-12);

const epl = buildWinnerAccuracyScorecards([
  row({
    recordId: 3,
    sport: "epl",
    gameKey: "epl:1",
    releaseKey: "epl-r1",
    modelPick: "draw",
    actualOutcome: "draw",
    modelProbabilities: { home: 0.31, draw: 0.38, away: 0.31 },
    marketProbabilities: { home: 0.45, draw: 0.3, away: 0.25 },
    exactPriceAmerican: 260,
  }),
  row({
    recordId: 4,
    sport: "epl",
    gameKey: "epl:2",
    releaseKey: "epl-r1",
    lockedAt: "2026-09-01T23:30:00.000Z",
    modelPick: "away",
    actualOutcome: "home",
    modelProbabilities: { home: 0.34, draw: 0.3, away: 0.36 },
    marketProbabilities: { home: 0.46, draw: 0.29, away: 0.25 },
  }),
])[0];
assert.equal(epl.drawDetection?.actualDraws, 1);
assert.equal(epl.drawDetection?.drawPicks, 1);
assert.equal(epl.drawDetection?.recallPct, 100);
assert.equal(epl.marketFavoriteBenchmark.correct, 1);
assert.equal(epl.upsetDetection.actualUpsets, 1);
assert.equal(epl.upsetDetection.correctlyCalledUpsets, 1);
assert.ok(Math.abs((epl.modelProbability.brierScore ?? 0) - 0.6159) < 1e-12);

const releaseSplit = buildWinnerAccuracyScorecards([
  row(),
  row({ recordId: 5, gameKey: "mlb:1", releaseKey: "mlb-r2" }),
]);
assert.equal(releaseSplit.length, 2, "same game under distinct immutable releases must not be blended");

assert.throws(
  () => buildWinnerAccuracyScorecards([row(), row({ recordId: 6 })]),
  /Duplicate locked release identity/,
  "an exact locked release duplicate must fail rather than select the strongest grade",
);

assert.throws(
  () => buildWinnerAccuracyScorecards([row({ modelProbabilities: { home: 0.7, away: 0.4 } })]),
  /sum to one/,
);

console.log("cross-sport winner accuracy scorecard: PASS");
