import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "@/lib/services/football/balldontlieNflPreviewSlate";
import { readNflMarketInnovation } from "@/lib/services/football/nflMarketInnovationRuntime";
import { readNflJointMarketEpisode } from "@/lib/services/football/nflJointMarketEpisodeRead";
import { buildNflV1ActionableGradeBundle } from "@/lib/services/football/nflV1ActionableGradeCandidate";
import {
  buildNflIndependentScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
} from "@/lib/services/football/nflV1WeekOneOutcome";

const raw = getNflV1WeekOneOutcomeForecast({
  providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX",
});
const base = (margin = 8.9, total = 47) => buildNflIndependentScoreBaseForecast({
  baseForecast: raw,
  independentScore: { expectedHomeMargin: margin, expectedTotal: total,
    marketInputPolicy: "prohibited_from_independent_score" },
});
const openingAt = "2026-11-01T12:00:00.000Z";
const currentAt = "2026-11-01T14:00:00.000Z";
const evaluatedAt = "2026-11-01T14:30:00.000Z";
const gameStartsAt = "2026-11-01T18:00:00.000Z";
const exclusions = { moneyline: [], spread: [], total: [] };
const american = (p: number) => p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
const ml = (p: number) => ({ homePrice: american(p), awayPrice: american(1 - p) });
const sp = (homeLine: number, homePrice = -110, awayPrice = -110) => ({
  homeLine, awayLine: -homeLine, homePrice, awayPrice,
});
const tot = (line: number, overPrice = -110, underPrice = -110) => ({ line, overPrice, underPrice });
const quote = (book: string, at: string, markets: Partial<Pick<NflPreviewBookOdds,
  "moneyline" | "spread" | "total">>): NflPreviewBookOdds => ({
  providerGameId: raw.providerGameId, providerEventId: "exact-event", provider: "owls",
  sportsbook: book, observedAt: at, targetEligible: false,
  moneyline: null, spread: null, total: null, ...markets,
});
const read = (history: NflPreviewBookOdds[], forecast = base(), extra: Partial<Parameters<typeof readNflMarketInnovation>[0]> = {}) =>
  readNflMarketInnovation({ independentForecast: forecast, independentInputPolicy: "market_inputs_prohibited",
    history, evaluatedAt, gameStartsAt, excludedFamiliesByMarket: exclusions, ...extra });
const margin = (forecast: ReturnType<typeof base>) => forecast.expectedHomeScore - forecast.expectedAwayScore;
const total = (forecast: ReturnType<typeof base>) => forecast.expectedHomeScore + forecast.expectedAwayScore;
const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);

// A static level is evidence, not permission to overwrite the independent edge.
const original = base();
const noChange = read([
  quote("circa", openingAt, { moneyline: ml(.60), spread: sp(-3.5), total: tot(45) }),
  quote("circa", currentAt, { moneyline: ml(.60), spread: sp(-3.5), total: tot(45) }),
], original, { staticMarketCoordinates: { moneyline: 3.5, spread: 3.5, total: 45 } });
assert.deepEqual(noChange.outcome, original);
assert.deepEqual(noChange.receipt.selectedSources, {});
assert.equal(noChange.receipt.informationOverlap, "not_attested");
assert.equal(noChange.receipt.referencePolicy, "observed_same_book_episode");
assert.deepEqual(noChange.receipt.staticMarketCoordinates, { moneyline: 3.5, spread: 3.5, total: 45 });
assert.equal(noChange.receipt.constraints.length, 0, "held prices must not constrain another moving market");

const vigOnly = read([
  quote("circa", openingAt, { moneyline: { homePrice: -110, awayPrice: -110 }, spread: sp(-3.5), total: tot(45) }),
  quote("circa", currentAt, { moneyline: { homePrice: -120, awayPrice: -120 },
    spread: sp(-3.5, -120, -120), total: tot(45, -120, -120) }),
]);
assert.deepEqual(vigOnly.outcome, base(), "pure vig changes have no fair economic displacement");

const tinyHistory = [quote("circa", openingAt, { moneyline: ml(.60) }),
  quote("circa", currentAt, { moneyline: ml(.60 - 1e-8) })];
const tiny = read(tinyHistory, original, { staticMarketCoordinates: { moneyline: 3.5, spread: 3.5, total: 45 } });
assert.ok(margin(tiny.outcome) < margin(original));
assert.ok(Math.abs(margin(tiny.outcome) - margin(original)) < .0001,
  "a tiny adverse tick cannot erase a large independent edge or jump to the current market level");
assert.deepEqual(tiny.outcome.totalDistribution, original.totalDistribution);
assert.deepEqual(read(tinyHistory, original), read(tinyHistory, original), "same frozen inputs never compound an update");

const strongOpposition = read([
  quote("circa", openingAt, { moneyline: ml(.75) }),
  quote("circa", currentAt, { moneyline: ml(.25) }),
]);
assert.ok(margin(strongOpposition.outcome) < 0 && strongOpposition.outcome.homeWinProbability < .5,
  "a material observed innovation can overturn the independent winner");

// Buffalo-style number/juice compensation: -3.5 (+100/-120) -> -3 (-115/-105)
// strengthens home economically despite the half-point number move toward away.
const compensated = read([
  quote("circa", openingAt, { spread: sp(-3.5, 100, -120) }),
  quote("circa", currentAt, { spread: sp(-3, -115, -105) }),
], original);
assert.equal(compensated.receipt.episodes[0]?.direction, 1);
assert.ok(margin(compensated.outcome) > margin(original));
assert.ok(margin(compensated.outcome) > 8, "number alone cannot collapse Buffalo's independent edge to 3.5");
assert.deepEqual(compensated.outcome.totalDistribution, original.totalDistribution);

const opposedHistory = [
  quote("circa", openingAt, { moneyline: ml(.5) }),
  quote("circa", currentAt, { moneyline: ml(.55) }),
  quote("pinnacle", openingAt, { moneyline: ml(.5), total: tot(45) }),
  quote("pinnacle", currentAt, { moneyline: ml(.45), total: tot(47) }),
];
const opposed = read(opposedHistory, original);
assert.equal(opposed.receipt.reasons.moneyline, "opposed_named_economic_episodes");
assert.equal(opposed.receipt.selectedSources.moneyline, undefined);
assert.equal(opposed.receipt.episodes.filter(x => x.market === "moneyline").length, 2);
assert.ok(opposed.receipt.episodes.filter(x => x.market === "moneyline").every(x => !x.selected),
  "both opposed candidates remain visible without claiming either was selected");
assert.deepEqual(opposed.outcome.marginDistribution, original.marginDistribution);
close(opposed.outcome.homeWinProbability, original.homeWinProbability);
assert.ok(total(opposed.outcome) > total(original), "a side conflict cannot erase an independent valid Total episode");
assert.equal(opposed.receipt.selectedSources.total, "pinnacle");

const earlyMoveAt = "2026-11-01T12:30:00.000Z";
const flowAt = "2026-11-01T13:00:00.000Z";
const reactionHistory = [
  quote("circa", openingAt, { moneyline: ml(.5) }),
  quote("circa", "2026-11-01T13:15:00.000Z", { moneyline: ml(.51) }),
  quote("circa", currentAt, { moneyline: ml(.55) }),
  quote("pinnacle", openingAt, { moneyline: ml(.5) }),
  quote("pinnacle", earlyMoveAt, { moneyline: ml(.45) }),
  quote("pinnacle", "2026-11-01T13:15:00.000Z", { moneyline: ml(.45) }),
  quote("pinnacle", currentAt, { moneyline: ml(.45) }),
];
const reactionContext = { moneyline: { flows: [{ observedAt: flowAt, direction: 1 as const }], books: [
  { book: "circa", lastEconomicMoveAt: currentAt, lastEconomicDirection: 1 as const },
  { book: "pinnacle", lastEconomicMoveAt: earlyMoveAt, lastEconomicDirection: -1 as const },
] } };
const withoutReaction = read(reactionHistory, original);
assert.equal(withoutReaction.receipt.reasons.moneyline, "opposed_named_economic_episodes");
const reacted = read(reactionHistory, original, { marketReactionContext: reactionContext });
assert.equal(reacted.receipt.selectedSources.moneyline, "circa");
assert.equal(reacted.receipt.reasons.moneyline, "price_reaction_adjudicates_older_opposed_episode");
assert.ok(margin(reacted.outcome) > margin(original));
close(margin(reacted.outcome), margin(read(reactionHistory.filter(q => q.sportsbook === "circa"), original).outcome));
assert.ok(reacted.receipt.episodes.some(e => e.book === "pinnacle" && !e.selected),
  "the older opposed episode remains explicit after observed reaction adjudication");
const contraryFlow = read(reactionHistory, original, { marketReactionContext: {
  moneyline: { ...reactionContext.moneyline, flows: [{ observedAt: flowAt, direction: -1 }] },
} });
assert.equal(contraryFlow.receipt.selectedSources.moneyline, "circa");
close(margin(contraryFlow.outcome), margin(reacted.outcome), 1e-9);
assert.ok(margin(contraryFlow.outcome) > margin(original),
  "a price reaction against money flow represents resistance; flow direction cannot replace observed price direction");
const afterReactionFlow = read(reactionHistory, original, { marketReactionContext: {
  moneyline: { ...reactionContext.moneyline, flows: [{ observedAt: "2026-11-01T14:15:00.000Z", direction: 1 }] },
} });
assert.equal(afterReactionFlow.receipt.reasons.moneyline, "opposed_named_economic_episodes");
assert.deepEqual(afterReactionFlow.outcome.marginDistribution, original.marginDistribution,
  "flow observed after the last move cannot establish a post-flow price reaction");
const onePostFlowQuote = read(reactionHistory, original, { marketReactionContext: {
  moneyline: { ...reactionContext.moneyline, flows: [{ observedAt: "2026-11-01T13:59:00.000Z", direction: 1 }] },
} });
assert.equal(onePostFlowQuote.receipt.reasons.moneyline, "opposed_named_economic_episodes",
  "one fresh quote after flow cannot establish a paired economic reaction");
const buybackHistory = [...reactionHistory,
  quote("circa", "2026-11-01T13:35:00.000Z", { moneyline: ml(.58) })];
const buybackReaction = read(buybackHistory, original, { marketReactionContext: {
  moneyline: { ...reactionContext.moneyline,
    flows: [{ observedAt: "2026-11-01T13:32:00.000Z", direction: 1 }], books: [
    { book: "circa", lastEconomicMoveAt: currentAt, lastEconomicDirection: -1 },
    reactionContext.moneyline.books[1]!,
  ] },
} });
assert.equal(buybackReaction.receipt.reasons.moneyline, "opposed_named_economic_episodes");
assert.deepEqual(buybackReaction.outcome.marginDistribution, original.marginDistribution,
  "a last-leg buyback opposing the net direction cannot confirm the full old net episode");
const compensatedReaction = read([
  quote("circa", openingAt, { spread: sp(-3.5, 100, -120) }),
  quote("circa", "2026-11-01T13:15:00.000Z", { spread: sp(-3.5, 100, -120) }),
  quote("circa", currentAt, { spread: sp(-3, -115, -105) }),
  quote("pinnacle", openingAt, { spread: sp(-3.5) }),
  quote("pinnacle", earlyMoveAt, { spread: sp(-3) }),
  quote("pinnacle", "2026-11-01T13:15:00.000Z", { spread: sp(-3) }),
  quote("pinnacle", currentAt, { spread: sp(-3) }),
], original, { marketReactionContext: { spread: {
  flows: [{ observedAt: flowAt, direction: -1 }],
  books: [{ book: "circa", lastEconomicMoveAt: currentAt, lastEconomicDirection: -1 },
    { book: "pinnacle", lastEconomicMoveAt: earlyMoveAt, lastEconomicDirection: -1 }],
} } });
assert.equal(compensatedReaction.receipt.selectedSources.spread, "circa",
  "economic number-plus-juice confirmation must supersede a contrary raw number-first last-direction field");
assert.ok(margin(compensatedReaction.outcome) > margin(original));

// One physical book supplies both constraints on the same score distribution.
const jointHistory = [
  quote("circa", openingAt, { moneyline: ml(.50), spread: sp(-3.5), total: tot(45) }),
  quote("circa", currentAt, { moneyline: ml(.52), spread: sp(-3.5, -115, -105), total: tot(46) }),
];
const joint = read(jointHistory, original);
const expectedJoint = readNflJointMarketEpisode({ statisticalForecast: original,
  statisticalKnowledgeAt: null, informationOverlap: "not_attested",
  moneyline: { source: "circa", openingAt, currentAt, openingHomeFairProbability: .5,
    currentHomeFairProbability: .52 },
  spread: { market: "spread", source: "circa", openingAt, currentAt,
    openingNumber: 3.5, currentNumber: 3.5, openingFirstFairProbability: .5,
    currentFirstFairProbability: (115 / 215) / (115 / 215 + 105 / 205) },
  total: { market: "total", source: "circa", openingAt, currentAt,
    openingNumber: 45, currentNumber: 46, openingFirstFairProbability: .5, currentFirstFairProbability: .5 },
});
assert.deepEqual(joint.receipt.selectedSources, { moneyline: "circa", spread: "circa", total: "circa" });
close(margin(joint.outcome), margin(expectedJoint.outcome));
close(total(joint.outcome), total(expectedJoint.outcome));
for (const constraint of joint.receipt.constraints) close(constraint.achievedProbability, constraint.targetProbability, 1e-7);

// Chronology chooses the physical leader, not the smaller update or book count.
const middleAt = "2026-11-01T13:00:00.000Z";
const leaderHistory = [
  quote("circa", openingAt, { moneyline: ml(.5) }),
  quote("circa", middleAt, { moneyline: ml(.51) }),
  quote("circa", currentAt, { moneyline: ml(.55) }),
  quote("pinnacle", openingAt, { moneyline: ml(.5) }),
  quote("pinnacle", "2026-11-01T13:30:00.000Z", { moneyline: ml(.501) }),
  quote("pinnacle", currentAt, { moneyline: ml(.501) }),
];
const leader = read([...leaderHistory].reverse());
assert.equal(leader.receipt.selectedSources.moneyline, "circa");
assert.equal(leader.receipt.episodes.find(x => x.book === "circa")?.firstMoveAt, middleAt);
close(margin(leader.outcome), margin(read(leaderHistory.filter(x => x.sportsbook === "circa")).outcome));

const malformedLeader = read([
  ...leaderHistory,
  { ...quote("pinnacle", "2026-11-01T12:01:00.000Z", { moneyline: ml(.52) }),
    provider: "other-provider" as NflPreviewBookOdds["provider"] },
]);
assert.equal(malformedLeader.receipt.selectedSources.moneyline, "circa",
  "an unqualified early row cannot create a false originating book");
assert.equal(malformedLeader.receipt.episodes.find(x => x.book === "pinnacle")?.firstMoveAt,
  "2026-11-01T13:30:00.000Z");

const jointImpossible = read([
  quote("circa", openingAt, { moneyline: ml(.5), spread: sp(-3), total: tot(45) }),
  quote("circa", currentAt, { moneyline: ml(.01), spread: sp(-3, -120, -100), total: tot(47) }),
], original);
assert.deepEqual(jointImpossible.outcome.marginDistribution, original.marginDistribution,
  "an inconsistent joint margin law cannot fabricate a compromise margin");
assert.ok(total(jointImpossible.outcome) > total(original),
  "unidentifiable ML/Spread constraints must not discard a usable independent Total episode");
assert.equal(jointImpossible.receipt.selectedSources.total, "circa");

const totalOnly = read([quote("circa", openingAt, { total: tot(47) }),
  quote("circa", currentAt, { total: tot(45) })], original);
assert.ok(total(totalOnly.outcome) < total(original));
assert.deepEqual(totalOnly.outcome.marginDistribution, original.marginDistribution);
close(totalOnly.outcome.homeWinProbability, original.homeWinProbability);
const tinyTotal = read([quote("circa", openingAt, { total: tot(45) }),
  quote("circa", currentAt, { total: tot(45, -110.00001, -110) })], original);
assert.ok(total(tinyTotal.outcome) > total(original));
assert.ok(Math.abs(total(tinyTotal.outcome) - total(original)) < .0001,
  "tiny total juice cannot replace the independent total with the current line");

const excluded = read(tinyHistory, original, { excludedFamiliesByMarket: { moneyline: ["Circa"], spread: [], total: [] } });
assert.deepEqual(excluded.outcome, original);
assert.equal(excluded.receipt.selectedSources.moneyline, undefined);
const stale = read([quote("circa", openingAt, { moneyline: ml(.5) }),
  quote("circa", "2026-11-01T12:15:00.000Z", { moneyline: ml(.6) })], original);
assert.deepEqual(stale.outcome, original, "an episode whose latest source quote is older than two hours cannot direct the score");
const future = read([quote("circa", openingAt, { moneyline: ml(.5) }),
  quote("circa", "2026-11-01T15:00:00.000Z", { moneyline: ml(.6) })], original);
assert.deepEqual(future.outcome, original);
assert.deepEqual(read(tinyHistory, original, { evaluatedAt: gameStartsAt }).outcome, original,
  "post-start evidence cannot create a pregame innovation");
for (const invalidHistory of [
  tinyHistory.map(x => ({ ...x, providerGameId: "other-game" })),
  tinyHistory.map(x => ({ ...x, provider: "other-provider" as NflPreviewBookOdds["provider"] })),
  tinyHistory.map((x, i) => ({ ...x, providerEventId: i ? "other-event" : x.providerEventId })),
]) assert.deepEqual(read(invalidHistory, original).outcome, original);
assert.throws(() => read(tinyHistory, original, {
  independentInputPolicy: "unknown" as "market_inputs_prohibited",
}), /attested market-free independent forecast/);

// Qualification removes the obsolete direction-availability veto. It must not
// bypass the final distribution, probability, EV, edge or comparator gates.
const gradedTotal = (forecast: ReturnType<typeof base>, qualifiedJointForecast: boolean,
  price = -110, bookCount = 3) => {
  const books = ["draftkings", "fanduel", "betmgm"].slice(0, bookCount).map((book) =>
    quote(book, currentAt, { moneyline: ml(.5), spread: sp(-3.5), total: tot(45.5, price, price) }));
  const shadowMoneyline = {
    health: { blockingReasons: [] }, decisionStage: "unlocked", lockedAt: null,
    evaluatedAt, evaluatedQuote: { sportsbook: books[0]!.sportsbook, line: null,
      price: -110, observedAt: currentAt }, team: "JAX", modelProbability: forecast.homeWinProbability,
    otherBooksConsensusFairProbability: .5,
  } as unknown as Parameters<typeof buildNflV1ActionableGradeBundle>[0]["shadowMoneyline"];
  return buildNflV1ActionableGradeBundle({ providerGameId: raw.providerGameId,
    awayTeam: "CLE", homeTeam: "JAX", gameStartsAt, current: books[0]!, comparableCurrentBooks: books,
    shadowMoneyline, outcomeForecast: { ...forecast, marketEvidence: undefined }, qualifiedJointForecast,
  }).evaluatedBets.find(bet => bet.market === "total")!;
};
const strongTotal = base(3, 39);
assert.equal(gradedTotal(strongTotal, false).grade, "Watchlist");
const qualifiedStrong = gradedTotal(strongTotal, true);
assert.equal(qualifiedStrong.grade, "Best Angle");
assert.equal(qualifiedStrong.side, "Under 45.5");
assert.ok(qualifiedStrong.modelProbability >= .535 && qualifiedStrong.expectedValue >= .035);
const qualifiedWeak = gradedTotal(base(3, 45.5), true);
assert.ok(qualifiedWeak.grade === "No Play" || qualifiedWeak.grade === "Watchlist",
  "qualification cannot promote a near-even final distribution");
const scarceComparators = gradedTotal(strongTotal, true, -110, 2);
assert.equal(scarceComparators.grade, "Watchlist",
  "one comparator without an attested target-excluded replacement cannot promote an actionable Total");
const costlyTotal = gradedTotal(base(3, 43), true, -200);
assert.ok(costlyTotal.expectedValue < 0);
assert.ok(costlyTotal.grade === "No Play" || costlyTotal.grade === "Watchlist",
  "qualifying the joint law cannot waive negative expected value");

console.log("NFL market innovation runtime contract tests passed.");
