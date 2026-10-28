import assert from "node:assert/strict";
import { auditCbbQuotePair, cbbLossComponentAccounting, cbbLossDateUncertainty, cbbQuoteDateUncertainty, compareCbbNeutralOrientations, decomposeCbbScoreHeadChange, groupCbbLossPairs, pairCbbLossAudit, summarizeCbbLossPairs } from "../lib/cbb/lossAudit";
import { CBB_DEVELOPMENT_UNCERTAINTY } from "../lib/cbb/evaluation";
import type { CbbForecast, CbbQuote, CbbTrainingGame } from "../lib/cbb/types";
import auditResults from "../lib/cbb/artifacts/loss-audit-r1.json";
const factors = { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 };
const game: CbbTrainingGame = { id: 1, date: "2025-11-10T20:00:00.000Z", season: 2025, homeId: 10, awayId: 11,
  homeScore: 79, awayScore: 77, homeRegulation: 70, awayRegulation: 70, overtime: true, possessions: 75, tempo: 66.6666666667,
  neutral: false, homeFactors: factors, awayFactors: factors };
const forecast: CbbForecast = { release: "audit_fixture", gameId: 1, asOf: "2025-11-10T00:00:00.000Z", homeId: 10, awayId: 11,
  margin: 5, total: 145, homeScore: 75, awayScore: 70, possessions: 70, homeWinProbability: 0.65, uncertainty: CBB_DEVELOPMENT_UNCERTAINTY, inputStatus: "complete", issues: [] };
const next = { ...forecast, release: "audit_candidate", margin: -5, homeScore: 70, awayScore: 75, homeWinProbability: 0.35 };
const oldRows = [{ game, forecast }], newRows = [{ game, forecast: next }];
const past = { ...game, id: 5, date: "2025-11-09T17:00:00.000Z" }, unavailable = { ...game, id: 6, date: "2025-11-09T23:00:00.000Z" };
const pairs = pairCbbLossAudit(oldRows, newRows, [past, unavailable, game]);
assert.equal(pairs[0].minimumTeamGames, 1, "six-hour result holdback");
const summary = summarizeCbbLossPairs(pairs);
assert.equal(summary.harms, 1); assert.equal(summary.corrections, 0); assert.equal(summary.netWinners, -1);
assert.equal(summary.baseline.expectedLosses, 0.35); assert.equal(summary.candidate.expectedLosses, 0.35);
assert.equal(summary.baseline.losses, 0); assert.equal(summary.candidate.losses, 1);
assert.deepEqual(cbbLossDateUncertainty(pairs), cbbLossDateUncertainty(pairs));
assert.equal(cbbLossDateUncertainty(pairs).dates, 1);
assert.equal(cbbQuoteDateUncertainty([{ date: game.date, delta: -1 }]).netWinDeltaPerGame95[0], -1);
assert.deepEqual(cbbQuoteDateUncertainty([{ date: game.date, delta: 1 }]), cbbQuoteDateUncertainty([{ date: game.date, delta: 1 }]));
assert.throws(() => cbbQuoteDateUncertainty([{ date: game.date, delta: 2 }]), /invalid/);
for (const groups of Object.values(groupCbbLossPairs(pairs))) assert.equal(Object.values(groups).reduce((s, g) => s + g.baseline.games, 0), pairs.length);
assert.equal(cbbLossComponentAccounting(pairs).baseline.games, 1);
assert.equal(cbbLossComponentAccounting(pairs).baseline.meanSignedComponents.overtime, 16);
assert.throws(() => pairCbbLossAudit(oldRows, [...newRows, ...newRows], []), /unpaired/);
assert.throws(() => pairCbbLossAudit(oldRows, [{ game: { ...game, homeScore: 80 }, forecast: next }], []), /cohort/);
assert.throws(() => pairCbbLossAudit(oldRows, [{ game, forecast: { ...next, asOf: "invalid" } }], []), /cohort/);
assert.throws(() => pairCbbLossAudit(oldRows, [{ game, forecast: { ...next, homeId: 12 } }], []), /identity/);
const quote: CbbQuote = { gameId: 1, market: "spread", line: -3, sportsbook: "test", firstPrice: -110, secondPrice: -110,
  providerObservedAt: forecast.asOf, fetchedAt: "2026-10-28T00:00:00.000Z", phase: "opening" };
const bet = auditCbbQuotePair(game, forecast, next, quote);
assert.equal(bet.correction, true); assert.equal(bet.harm, false);
assert.equal(bet.baseline.result, "loss"); assert.equal(bet.candidate.result, "win");
assert.equal(auditCbbQuotePair({ ...game, homeScore: 80, awayScore: 77 }, forecast, next, quote).baseline.result, "push");
assert.equal(auditCbbQuotePair(game, forecast, next, { ...quote, market: "total", line: 145 }).baseline.result, "pass");
assert.throws(() => auditCbbQuotePair(game, forecast, next, { ...quote, providerObservedAt: game.date }), /cutoff/);
assert.throws(() => auditCbbQuotePair(game, forecast, next, { ...quote, gameId: 2 }), /identity/);
assert.throws(() => auditCbbQuotePair(game, forecast, next, { ...quote, providerObservedAt: "bad" }), /cutoff/);
assert.throws(() => auditCbbQuotePair(game, forecast, next, { ...quote, line: null }), /exact/);
assert.equal(oldRows[0].forecast.margin, 5); assert.equal(game.homeScore, 79);
const neutral = { ...game, neutral: true }, reversed = { ...next, homeId: game.awayId, awayId: game.homeId };
const invariant = compareCbbNeutralOrientations(neutral, forecast, reversed);
assert.equal(invariant.absoluteMarginDiscrepancy, 0); assert.equal(invariant.totalDiscrepancy, 0); assert.equal(invariant.winnerChangesFromListingOnly, false);
const biased = compareCbbNeutralOrientations(neutral, forecast, { ...forecast, homeId: game.awayId, awayId: game.homeId });
assert.equal(biased.absoluteMarginDiscrepancy, 10); assert.equal(biased.winnerChangesFromListingOnly, true);
assert.throws(() => compareCbbNeutralOrientations(game, forecast, reversed), /neutral/);
assert.throws(() => compareCbbNeutralOrientations(neutral, forecast, next), /neutral/);
assert.throws(() => compareCbbNeutralOrientations(neutral, forecast, { ...reversed, homeWinProbability: 2 }), /neutral/);
const features = Array(137).fill(0) as number[]; features[0] = 1; features[1] = 2;
const coefficients = features.map((_, i) => i === 0 ? 3 : i === 1 ? 4 : 0);
const attribution = decomposeCbbScoreHeadChange(features.slice(0, 19), features,
  { mode: "affine", featureIndexes: [0, 1], coefficientsMargin: [1, 2], coefficientsTotal: [1, 2], fitThroughSeason: 2024 },
  { release: "test", throughSeason: 2024, penalty: 100, loss: "huber", margin: coefficients, total: coefficients });
assert.equal(attribution.margin, 6); assert.equal(attribution.total, 6);
assert.throws(() => decomposeCbbScoreHeadChange([1], [], { mode: "none", featureIndexes: [], coefficientsMargin: [], coefficientsTotal: [], fitThroughSeason: 2024 },
  { release: "test", throughSeason: 2024, penalty: 100, loss: "huber", margin: [], total: [] }), /schema/);
assert.equal(auditResults.productionWrites + auditResults.providerCalls + auditResults.predictionChanges, 0);
assert.equal(auditResults.all.baseline.losses, auditResults.ledgerCounts.both_wrong + auditResults.ledgerCounts.correction);
assert.equal(auditResults.all.candidate.losses, auditResults.ledgerCounts.both_wrong + auditResults.ledgerCounts.harm);
for (const groups of Object.values(auditResults.pregameGroups)) assert.equal(Object.values(groups).reduce((s, g) => s + g.n, 0), auditResults.all.baseline.games);
assert.equal(auditResults.neutralOrientation.r2.games, auditResults.pregameGroups.venue.neutral.n);
assert.ok(auditResults.neutralOrientation.r2.winnerChangesFromListingOnly > 0, "record exposes, not suppresses, the failed model invariant");
console.log("CBB loss audit: full paired census, prior-only cohorts, deterministic date blocks, expected losses, exact quote W/L/push/pass, diagnostic accounting, source identity and no input mutation passed.");
