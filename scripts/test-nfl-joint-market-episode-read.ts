import assert from "node:assert/strict";

import {
  readNflJointMarketEpisode,
  readNflJointMarketEpisodesByBook,
  reconcileNflNamedBookEpisodeReads,
  mergeNflJointEpisodeIntoUntouchedAxes,
} from "@/lib/services/football/nflJointMarketEpisodeRead";
import type { NflPreviewBookOdds } from "@/lib/services/football/balldontlieNflPreviewSlate";
import {
  buildNflIndependentScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
  buildNflUnifiedMarketAdjustedForecast,
} from "@/lib/services/football/nflV1WeekOneOutcome";

const raw = getNflV1WeekOneOutcomeForecast({
  providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX",
});
const total = raw.expectedHomeScore + raw.expectedAwayScore;
const base = buildNflIndependentScoreBaseForecast({
  baseForecast: raw,
  independentScore: {
    expectedHomeMargin: 0.3,
    expectedTotal: total,
    marketInputPolicy: "prohibited_from_independent_score",
  },
});
const openingAt = "2026-10-30T18:00:00.000Z";
const currentAt = "2026-10-31T15:00:00.000Z";
const statisticalKnowledgeAt = "2026-10-30T17:00:00.000Z";
const moneyline = {
  source: "circa", openingAt, currentAt,
  openingHomeFairProbability: 0.53,
  currentHomeFairProbability: 0.46,
};
const spreadFair = nflV1WeekOneLineProbabilities({
  forecast: base, homeSpread: -3, totalLine: total,
}).spread.homeCoverProbability;
const overFair = nflV1WeekOneLineProbabilities({
  forecast: base, homeSpread: 0, totalLine: 45,
}).total.overProbability;
const spread = {
  market: "spread" as const, source: "circa", openingAt, currentAt,
  openingNumber: 3, currentNumber: 3,
  openingFirstFairProbability: spreadFair,
  currentFirstFairProbability: spreadFair,
};
const gameTotal = {
  market: "total" as const, source: "pinnacle", openingAt, currentAt,
  openingNumber: 45, currentNumber: 46,
  openingFirstFairProbability: overFair,
  currentFirstFairProbability: overFair,
};
const args = {
  statisticalForecast: base, statisticalKnowledgeAt,
  moneyline, spread, total: gameTotal,
};
const read = readNflJointMarketEpisode(args);
assert.equal(read.status, "applied");
assert.equal(read.constraints.length, 3);
for (const constraint of read.constraints) {
  assert.ok(Math.abs(constraint.targetProbability - constraint.achievedProbability) < 1e-7,
    `${constraint.market} must agree with the single final score law`);
}
assert.ok(read.outcome.homeWinProbability < base.homeWinProbability);
assert.ok(read.outcome.expectedHomeScore - read.outcome.expectedAwayScore < 0,
  "the final score can flip a tight statistical winner");
assert.ok(read.outcome.expectedHomeScore + read.outcome.expectedAwayScore > total,
  "the same final score must respond to total movement");
assert.ok(read.outcome.expectedHomeScore > 0 && read.outcome.expectedAwayScore > 0);
assert.deepEqual(readNflJointMarketEpisode(args), read,
  "a refresh of identical evidence must not compound the episode");
assert.ok(Math.abs(base.expectedHomeScore - base.expectedAwayScore - 0.3) < 1e-9,
  "the independent score input is immutable");

const wrongBook = readNflJointMarketEpisode({
  ...args, spread: { ...spread, source: "pinnacle" },
});
assert.equal(wrongBook.status, "unidentified");
assert.equal(wrongBook.reason, "cross_book_margin_synthesis_rejected");
assert.deepEqual(wrongBook.outcome, base);

const staleKnowledge = readNflJointMarketEpisode({
  ...args, statisticalKnowledgeAt: "2026-10-31T14:00:00.000Z",
});
assert.equal(staleKnowledge.status, "unidentified");
assert.deepEqual(staleKnowledge.outcome, base);

const noEvidence = readNflJointMarketEpisode({
  ...args, moneyline: null, spread: null, total: null,
});
assert.equal(noEvidence.status, "neutral");
assert.deepEqual(noEvidence.outcome, base);

const nearSpread = buildNflIndependentScoreBaseForecast({
  baseForecast: raw,
  independentScore: {
    expectedHomeMargin: 3.6,
    expectedTotal: total,
    marketInputPolicy: "prohibited_from_independent_score",
  },
});
const openingSpreadFair = nflV1WeekOneLineProbabilities({
  forecast: nearSpread, homeSpread: -3, totalLine: total,
}).spread.homeCoverProbability;
const spreadOnly = readNflJointMarketEpisode({
  statisticalForecast: nearSpread, statisticalKnowledgeAt,
  moneyline: null, total: null,
  spread: {
    market: "spread", source: "circa", openingAt, currentAt,
    openingNumber: 3, currentNumber: 4,
    openingFirstFairProbability: openingSpreadFair,
    currentFirstFairProbability: openingSpreadFair,
  },
});
assert.equal(spreadOnly.status, "applied");
const beforeLine = nflV1WeekOneLineProbabilities({
  forecast: nearSpread, homeSpread: -4, totalLine: total,
}).spread;
const afterLine = nflV1WeekOneLineProbabilities({
  forecast: spreadOnly.outcome, homeSpread: -4, totalLine: total,
}).spread;
assert.ok(beforeLine.homeCoverProbability < beforeLine.awayCoverProbability);
assert.ok(afterLine.homeCoverProbability > afterLine.awayCoverProbability,
  "number-plus-price evidence can flip the cover side without changing the winner");
assert.ok(spreadOnly.outcome.homeWinProbability > spreadOnly.outcome.awayWinProbability);

const history = (sportsbook: string, observedAt: string, homePrice: number,
  awayPrice: number): NflPreviewBookOdds => ({
  providerGameId: base.providerGameId, providerEventId: "exact-event",
  provider: "owls", sportsbook, observedAt, targetEligible: false,
  marketObservedAt: { moneyline: observedAt },
  moneyline: { homePrice, awayPrice }, spread: null, total: null,
});
const byBook = readNflJointMarketEpisodesByBook({
  statisticalForecast: base, statisticalKnowledgeAt,
  evaluatedAt: "2026-10-31T16:00:00.000Z",
  history: [
    history("circa", openingAt, -115, 105),
    history("circa", currentAt, 105, -115),
    history("pinnacle", openingAt, -110, 100),
    history("pinnacle", currentAt, -110, 100),
  ],
});
assert.equal(byBook.circa.status, "applied");
assert.equal(byBook.pinnacle.status, "neutral");
assert.ok(byBook.circa.outcome.homeWinProbability < byBook.pinnacle.outcome.homeWinProbability,
  "opposed physical books must remain distinguishable, not silently blended");
const excludedTarget = readNflJointMarketEpisodesByBook({
  statisticalForecast: base, statisticalKnowledgeAt,
  evaluatedAt: "2026-10-31T16:00:00.000Z",
  history: [
    history("circa", openingAt, -115, 105),
    history("circa", currentAt, 105, -115),
  ],
  excludedFamiliesByMarket: { moneyline: ["Circa"], spread: [], total: [] },
});
assert.equal(excludedTarget.circa.status, "neutral",
  "the evaluated book's own quote cannot become its prediction authority");
const oneBook = reconcileNflNamedBookEpisodeReads({ statisticalForecast: base, reads: byBook });
assert.equal(oneBook.status, "applied");
assert.equal(oneBook.marginSource, "circa");
assert.equal(oneBook.marginReason, "one_moving_book");
assert.ok(oneBook.outcome.homeWinProbability < base.homeWinProbability);
const opposedBooks = readNflJointMarketEpisodesByBook({
  statisticalForecast: base, statisticalKnowledgeAt,
  evaluatedAt: "2026-10-31T16:00:00.000Z",
  history: [
    history("circa", openingAt, -115, 105),
    history("circa", currentAt, 105, -115),
    history("pinnacle", openingAt, -110, 100),
    history("pinnacle", currentAt, -125, 115),
  ],
});
const opposed = reconcileNflNamedBookEpisodeReads({
  statisticalForecast: base, reads: opposedBooks,
});
assert.equal(opposed.status, "conflicted");
assert.equal(opposed.marginReason, "opposed_book_moves");
assert.equal(opposed.marginSource, null);
assert.deepEqual(opposed.outcome, base,
  "opposed book moves cannot be silently averaged into a false consensus");
const alreadyAdjustedTotal = buildNflUnifiedMarketAdjustedForecast({
  baseForecast: base,
  expectedHomeMargin: base.expectedHomeScore - base.expectedAwayScore,
  expectedTotal: total + 3,
  marketInputPolicy: "target_excluded_continuous_residual",
});
const gapFill = mergeNflJointEpisodeIntoUntouchedAxes({
  independentForecast: base,
  incumbentForecast: alreadyAdjustedTotal,
  reconciliation: oneBook,
});
assert.equal(gapFill.margin, "episode_applied");
assert.equal(gapFill.total, "no_resolved_episode");
assert.ok(gapFill.outcome.homeWinProbability < base.homeWinProbability);
assert.ok(Math.abs(gapFill.outcome.expectedHomeScore + gapFill.outcome.expectedAwayScore -
  (alreadyAdjustedTotal.expectedHomeScore + alreadyAdjustedTotal.expectedAwayScore)) < 1e-9,
"the named margin episode cannot erase an existing Total market consequence");
const alreadyAdjustedMargin = buildNflUnifiedMarketAdjustedForecast({
  baseForecast: base,
  expectedHomeMargin: 2,
  expectedTotal: total,
  marketInputPolicy: "target_excluded_continuous_residual",
});
const noDoubleApply = mergeNflJointEpisodeIntoUntouchedAxes({
  independentForecast: base,
  incumbentForecast: alreadyAdjustedMargin,
  reconciliation: oneBook,
});
assert.equal(noDoubleApply.margin, "already_market_adjusted");
assert.deepEqual(noDoubleApply.outcome, alreadyAdjustedMargin,
  "a previously adjusted margin cannot receive the price episode a second time");

console.log("NFL joint margin, total, and moneyline episode read tests passed");
