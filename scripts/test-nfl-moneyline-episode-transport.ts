import assert from "node:assert/strict";

import {
  selectNflNamedMoneylineEpisodeAfterKnowledge,
  selectNflNamedPricedLineEpisodeAfterKnowledge,
  transportNflMoneylineEpisode,
  transportNflPricedLineEpisode,
} from "@/lib/services/football/nflMoneylineEpisodeTransport";
import type { NflPreviewBookOdds } from "@/lib/services/football/balldontlieNflPreviewSlate";
import {
  buildNflIndependentScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
} from "@/lib/services/football/nflV1WeekOneOutcome";

const raw = getNflV1WeekOneOutcomeForecast({
  providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX",
});
const total = raw.expectedHomeScore + raw.expectedAwayScore;
const statisticalAt = (margin: number) => buildNflIndependentScoreBaseForecast({
  baseForecast: raw,
  independentScore: {
    expectedHomeMargin: margin,
    expectedTotal: total,
    marketInputPolicy: "prohibited_from_independent_score",
  },
});
const episode = (openingHomeFairProbability: number, currentHomeFairProbability: number) => ({
  source: "circa",
  openingAt: "2026-10-30T18:00:00.000Z",
  currentAt: "2026-10-31T15:00:00.000Z",
  openingHomeFairProbability,
  currentHomeFairProbability,
});
const statisticalKnowledgeAt = "2026-10-30T17:00:00.000Z";
const quote = (observedAt: string, homePrice: number, awayPrice: number): NflPreviewBookOdds => ({
  providerGameId: "1392224", sportsbook: "circa", provider: "owls",
  providerEventId: "owls-exact-game-1392224", observedAt,
  marketObservedAt: { moneyline: observedAt }, targetEligible: false,
  moneyline: { homePrice, awayPrice }, spread: null, total: null,
});
const history = [
  quote("2026-10-30T16:00:00.000Z", -140, 120),
  quote("2026-10-30T18:00:00.000Z", -120, 100),
  quote("2026-10-31T15:00:00.000Z", 105, -125),
];
const selected = selectNflNamedMoneylineEpisodeAfterKnowledge({
  history, sportsbook: "circa", providerGameId: "1392224", statisticalKnowledgeAt,
  evaluatedAt: "2026-10-31T16:00:00.000Z",
});
assert.ok(selected);
assert.equal(selected.openingAt, "2026-10-30T18:00:00.000Z",
  "market movement before the statistical input is not reapplied");
assert.ok(selected.currentHomeFairProbability < selected.openingHomeFairProbability);
const pricedHistory: NflPreviewBookOdds[] = [
  { ...quote("2026-10-30T18:00:00.000Z", -120, 100),
    marketObservedAt: { spread: "2026-10-30T18:00:00.000Z", total: "2026-10-30T18:00:00.000Z" },
    spread: { homeLine: -3, awayLine: 3, homePrice: -110, awayPrice: -110 },
    total: { line: 45, overPrice: -110, underPrice: -110 } },
  { ...quote("2026-10-31T15:00:00.000Z", 105, -125),
    marketObservedAt: { spread: "2026-10-31T15:00:00.000Z", total: "2026-10-31T15:00:00.000Z" },
    spread: { homeLine: -4, awayLine: 4, homePrice: 105, awayPrice: -125 },
    total: { line: 46, overPrice: -120, underPrice: 100 } },
];
const selectedSpread = selectNflNamedPricedLineEpisodeAfterKnowledge({
  history: pricedHistory, market: "spread", sportsbook: "circa",
  providerGameId: "1392224", statisticalKnowledgeAt, evaluatedAt: "2026-10-31T16:00:00.000Z",
});
assert.ok(selectedSpread);
assert.equal(selectedSpread.openingNumber, 3);
assert.equal(selectedSpread.currentNumber, 4);
assert.ok(selectedSpread.currentFirstFairProbability < selectedSpread.openingFirstFairProbability);
const selectedTotal = selectNflNamedPricedLineEpisodeAfterKnowledge({
  history: pricedHistory, market: "total", sportsbook: "circa",
  providerGameId: "1392224", statisticalKnowledgeAt, evaluatedAt: "2026-10-31T16:00:00.000Z",
});
assert.ok(selectedTotal);
assert.equal(selectedTotal.currentNumber, 46);
assert.ok(selectedTotal.currentFirstFairProbability > selectedTotal.openingFirstFairProbability);
assert.equal(selectNflNamedPricedLineEpisodeAfterKnowledge({
  history: [...pricedHistory, { ...pricedHistory[1]!, spread: {
    ...pricedHistory[1]!.spread!, homePrice: -110, awayPrice: -110,
  } }],
  market: "spread", sportsbook: "circa", providerGameId: "1392224",
  statisticalKnowledgeAt, evaluatedAt: "2026-10-31T16:00:00.000Z",
}), null, "contradictory same-source same-time spread prices must not be selected");
assert.equal(selectNflNamedMoneylineEpisodeAfterKnowledge({
  history, sportsbook: "circa", providerGameId: "1392224",
  statisticalKnowledgeAt: "2026-10-31T14:00:00.000Z",
  evaluatedAt: "2026-10-31T16:00:00.000Z",
}), null, "one post-update quote is static context, not fabricated movement");
assert.equal(selectNflNamedMoneylineEpisodeAfterKnowledge({
  history: [...history, { ...history[2]!, moneyline: { homePrice: -110, awayPrice: -110 } }],
  sportsbook: "circa", providerGameId: "1392224", statisticalKnowledgeAt,
  evaluatedAt: "2026-10-31T16:00:00.000Z",
}), null, "contradictory same-source same-time quotes cannot be cherry-picked");

const close = statisticalAt(0.3);
const opposed = transportNflMoneylineEpisode({
  statisticalForecast: close,
  statisticalKnowledgeAt,
  episode: episode(0.53, 0.46),
});
assert.equal(opposed.status, "transported");
assert.ok(opposed.finalHomeMargin < close.expectedHomeScore - close.expectedAwayScore,
  "a weakening favorite price must actually move the coherent margin");
assert.ok(opposed.finalHomeMargin < 0,
  "a sufficiently strong opposing episode must be able to flip a tight statistical winner");
assert.ok(opposed.finalHomeWinProbability < opposed.statisticalHomeWinProbability);

const strong = statisticalAt(9);
const strongResult = transportNflMoneylineEpisode({
  statisticalForecast: strong,
  statisticalKnowledgeAt,
  episode: episode(0.53, 0.46),
});
assert.equal(strongResult.status, "transported");
assert.ok(strongResult.finalHomeMargin > 0,
  "the same observed move must not automatically flip a strong statistical winner");
assert.ok(strongResult.finalHomeMargin < 9);

const held = transportNflMoneylineEpisode({
  statisticalForecast: close,
  statisticalKnowledgeAt,
  episode: episode(0.53, 0.53),
});
assert.equal(held.status, "unchanged");
assert.equal(held.finalHomeMargin, close.expectedHomeScore - close.expectedAwayScore);

const slight = transportNflMoneylineEpisode({
  statisticalForecast: close,
  statisticalKnowledgeAt,
  episode: episode(0.53, 0.529),
});
assert.equal(slight.status, "transported", "valid small moves must not meet an arbitrary activation floor");
assert.ok(slight.finalHomeMargin < close.expectedHomeScore - close.expectedAwayScore);
assert.ok(slight.finalHomeMargin > opposed.finalHomeMargin);

const invalid = transportNflMoneylineEpisode({
  statisticalForecast: close,
  statisticalKnowledgeAt,
  episode: episode(1, 0.46),
});
assert.equal(invalid.status, "unidentified", "an impossible paired fair probability cannot direct a score");

const reversedClock = transportNflMoneylineEpisode({
  statisticalForecast: close,
  statisticalKnowledgeAt,
  episode: { ...episode(0.53, 0.46), currentAt: "2026-10-29T15:00:00.000Z" },
});
assert.equal(reversedClock.status, "unidentified", "a regressed source clock cannot become a causal episode");

const overlappingKnowledge = transportNflMoneylineEpisode({
  statisticalForecast: close,
  statisticalKnowledgeAt: "2026-10-31T14:00:00.000Z",
  episode: episode(0.53, 0.46),
});
assert.equal(overlappingKnowledge.status, "unidentified",
  "a price move that predates the statistical source cannot be applied again wholesale");
assert.equal(overlappingKnowledge.reason, "episode_overlaps_statistical_knowledge");

const repeated = transportNflMoneylineEpisode({
  statisticalForecast: close,
  statisticalKnowledgeAt,
  episode: episode(0.53, 0.46),
});
assert.deepEqual(repeated, opposed, "a refresh must not compound an already-known price episode");

const openingHomeCover = nflV1WeekOneLineProbabilities({
  forecast: close, homeSpread: -3, totalLine: total,
}).spread.homeCoverProbability;
const currentHomeCoverAtSameScore = nflV1WeekOneLineProbabilities({
  forecast: close, homeSpread: -4, totalLine: total,
}).spread.homeCoverProbability;
const compensatedSpread = transportNflPricedLineEpisode({
  statisticalForecast: close, statisticalKnowledgeAt,
  episode: {
    market: "spread", source: "circa", openingAt: episode(0.5, 0.5).openingAt,
    currentAt: episode(0.5, 0.5).currentAt,
    openingNumber: 3, currentNumber: 4,
    openingFirstFairProbability: openingHomeCover,
    currentFirstFairProbability: currentHomeCoverAtSameScore,
  },
});
assert.equal(compensatedSpread.status, "unchanged",
  "a line move with exactly countervailing juice cannot manufacture margin movement");
assert.ok(Math.abs(compensatedSpread.finalMean - 0.3) < 1e-7);

const movedSpread = transportNflPricedLineEpisode({
  statisticalForecast: close, statisticalKnowledgeAt,
  episode: {
    market: "spread", source: "circa", openingAt: episode(0.5, 0.5).openingAt,
    currentAt: episode(0.5, 0.5).currentAt,
    openingNumber: 3, currentNumber: 4,
    openingFirstFairProbability: openingHomeCover,
    currentFirstFairProbability: openingHomeCover,
  },
});
assert.equal(movedSpread.status, "transported");
assert.ok(movedSpread.finalMean > close.expectedHomeScore - close.expectedAwayScore,
  "a stronger home margin implied by line/juice must move the score coordinate");

const openingOver = nflV1WeekOneLineProbabilities({
  forecast: close, homeSpread: 0, totalLine: 45,
}).total.overProbability;
const movedTotal = transportNflPricedLineEpisode({
  statisticalForecast: close, statisticalKnowledgeAt,
  episode: {
    market: "total", source: "pinnacle", openingAt: episode(0.5, 0.5).openingAt,
    currentAt: episode(0.5, 0.5).currentAt,
    openingNumber: 45, currentNumber: 46,
    openingFirstFairProbability: openingOver,
    currentFirstFairProbability: openingOver,
  },
});
assert.equal(movedTotal.status, "transported");
assert.ok(movedTotal.finalMean > total,
  "a Total line increase at unchanged de-vig price raises the scoring coordinate");

console.log("NFL Moneyline, Spread, and Total episode transport tests passed");
