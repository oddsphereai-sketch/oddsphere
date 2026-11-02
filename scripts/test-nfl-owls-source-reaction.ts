import { readNflMarketInnovation } from "@/lib/services/football/nflMarketInnovationRuntime";
import { getNflV1WeekOneOutcomeForecast } from "@/lib/services/football/nflV1WeekOneOutcome";
import assert from "node:assert/strict";
import { nflPublishedSourcePressure, qualifyNflOwlsSplitsForModel, qualifyNflOwlsSplitsForSourceReaction } from "@/lib/services/football/nflOwlsSplits";
import type { NflRegularSharpSplit, NflRegularSharpSplitSet } from "@/lib/services/football/sharpApiNflSplits";
import type { NflEpisodeHistoryBook } from "@/lib/services/football/nflMoneylineEpisodeTransport";

const observedAt = "2026-11-02T14:00:00.000Z";
const evaluatedAt = "2026-11-02T14:30:00.000Z";
const quoteAt = "2026-11-02T13:45:00.000Z";
const gameStartsAt = "2026-11-02T18:00:00.000Z";
const row = (market: "moneyline" | "spread" | "total"): NflRegularSharpSplit => ({
  provider: "owls", providerGameId: "exact-game", sourceEventId: "exact-event", sourceSportsbook: "circa",
  capturedAt: evaluatedAt, providerFetchedAt: observedAt,
  sourceLine: market === "spread" ? -3.5 : market === "total" ? 45.5 : null,
  homeMoneyPct: market === "total" ? null : 60, awayMoneyPct: market === "total" ? null : 40,
  homeBetsPct: market === "total" ? null : 40, awayBetsPct: market === "total" ? null : 60,
  overMoneyPct: market === "total" ? 60 : null, underMoneyPct: market === "total" ? 40 : null,
  overBetsPct: market === "total" ? 40 : null, underBetsPct: market === "total" ? 60 : null,
});
const splits: NflRegularSharpSplitSet = { moneyline: row("moneyline"), spread: row("spread"), total: row("total") };
const paired: NflEpisodeHistoryBook = {
  providerGameId: "exact-game", providerEventId: "exact-event", provider: "owls", sportsbook: "circa", observedAt: quoteAt,
  moneyline: { homePrice: -110, awayPrice: -110 },
  spread: { homeLine: -3.5, awayLine: 3.5, homePrice: -110, awayPrice: -110 },
  total: { line: 45.5, overPrice: -110, underPrice: -110 },
};
const args = { splits, providerGameId: "exact-game", evaluatedAt, gameStartsAt,
  history: [paired], excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] } };
const direct = qualifyNflOwlsSplitsForModel({ splits, providerGameId: "exact-game", evaluatedAt,
  currentHomeSpread: -4, currentTotal: 46.5 });
assert.deepEqual(direct.qualifiedMarkets, ["moneyline"]);
assert.equal(direct.splits!.total.overMoneyPct, null);
const before = JSON.stringify(args);
const source = qualifyNflOwlsSplitsForSourceReaction(args);
const roundedInput = { ...splits, moneyline: { ...splits.moneyline,
  homeMoneyPct: 86, awayMoneyPct: 14, homeBetsPct: 43, awayBetsPct: 58 } };
const roundedBefore = JSON.stringify(roundedInput);
const roundedFlow = qualifyNflOwlsSplitsForSourceReaction({ ...args, splits: roundedInput });
assert.equal(roundedFlow.flows.moneyline?.[0]?.direction, 1,
  "actual provider 43/58 ticket rounding must not discard the clear 86/14 money pressure");
assert.equal(roundedFlow.flows.moneyline?.[0]?.ticketPct, 43,
  "retain the published number instead of inventing complementary percentages");
assert.equal(roundedFlow.flows.moneyline?.[0]?.observedAt, observedAt);
assert.equal(JSON.stringify(roundedInput), roundedBefore);
assert.equal(nflPublishedSourcePressure([14, 86, 58, 43])?.direction, -1);
assert.equal(nflPublishedSourcePressure([86, 14, 43, 56])?.direction, 1,
  "99-percent rounded totals are equally interpretable");
for (const invalid of [[86, 14, 43, 59], [86, 14, 43, 55], [86, 14, 43.1, 57.9],
  [86, null, 43, 58], [101, -1, 43, 58], [NaN, 14, 43, 58]]) {
  assert.equal(nflPublishedSourcePressure(invalid), null,
    "larger discrepancy, unsupported decimal rounding, missing and invalid percentages remain rejected");
}
const ambiguous = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  splits: { ...splits, moneyline: { ...splits.moneyline,
    homeMoneyPct: 50, awayMoneyPct: 50, homeBetsPct: 51, awayBetsPct: 50 } } });
assert.equal(ambiguous.flows.moneyline, undefined);
assert.equal(ambiguous.reasons.moneyline, "ambiguous_rounded_source_pressure");
assert.equal(nflPublishedSourcePressure([60, 40, 40, 60])?.direction, 1);
assert.equal(nflPublishedSourcePressure([40, 60, 60, 40])?.direction, -1);
assert.equal(nflPublishedSourcePressure([50, 50, 50, 50])?.direction, 0);
assert.equal(qualifyNflOwlsSplitsForSourceReaction({ ...args, splits: roundedInput,
  excludedFamiliesByMarket: { ...args.excludedFamiliesByMarket, moneyline: ["circa"] } }).flows.moneyline, undefined);
assert.equal(qualifyNflOwlsSplitsForSourceReaction({ ...args, splits: roundedInput,
  history: [{ ...paired, providerEventId: "wrong-event" }] }).flows.moneyline, undefined);
assert.deepEqual(Object.keys(source.flows), ["moneyline", "spread", "total"],
  "the source's own complete contracts remain interpretable when target spread/total differ");
for (const market of ["moneyline", "spread", "total"] as const) {
  const flow = source.flows[market]![0]!;
  assert.equal(flow.observedAt, observedAt);
  assert.equal(flow.pairedQuoteObservedAt, quoteAt);
  assert.equal(flow.direction, 1);
  assert.equal(flow.book, "circa");
  assert.equal(flow.authority, "source_contract_reaction_context_only");
  assert.equal(flow.moneyTicketDifferencePp, 20);
  assert.equal(flow.sourceLine, market === "total" ? 45.5 : market === "spread" ? -3.5 : null);
}
assert.equal(JSON.stringify(args), before, "source qualification does not mutate direct-target inputs or original source clocks");
for (const invalid of [
  { ...paired, sportsbook: "pinnacle" },
  { ...paired, providerGameId: "other-game" },
  { ...paired, providerEventId: "other-event" },
  { ...paired, observedAt: "2026-11-02T14:01:00.000Z" },
  { ...paired, observedAt: "2026-11-02T11:00:00.000Z" },
]) assert.deepEqual(qualifyNflOwlsSplitsForSourceReaction({ ...args, history: [invalid] }).flows, {},
  "wrong identity, future-only, or stale source quotes cannot attest pressure on a current source contract");
const wrongLine = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  history: [{ ...paired, spread: { ...paired.spread!, homeLine: -4, awayLine: 4 }, total: { ...paired.total!, line: 46.5 } }] });
assert.equal(wrongLine.flows.spread, undefined);
assert.equal(wrongLine.flows.total, undefined);
assert.ok(wrongLine.flows.moneyline);
const incomplete = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  history: [{ ...paired, spread: { ...paired.spread!, awayLine: 4 }, total: { ...paired.total!, underPrice: NaN } }] });
assert.equal(incomplete.flows.spread, undefined);
assert.equal(incomplete.flows.total, undefined);
const conflicting = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  history: [paired, { ...paired, total: { ...paired.total!, overPrice: -115 } }] });
assert.equal(conflicting.reasons.total, "conflicting_source_contract_pairs");
const originalClock = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  history: [{ ...paired, observedAt: "2026-11-02T14:20:00.000Z", marketObservedAt: { moneyline: quoteAt, spread: quoteAt, total: quoteAt } }] });
assert.equal(originalClock.flows.total![0]!.pairedQuoteObservedAt, quoteAt,
  "capture refresh does not rewrite original per-market source clocks");
const staleSplit = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  splits: { ...splits, total: { ...splits.total, providerFetchedAt: "2026-11-02T11:00:00.000Z" } } });
assert.equal(staleSplit.flows.total, undefined);
const futureSplit = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  splits: { ...splits, total: { ...splits.total, providerFetchedAt: "2026-11-02T14:31:00.000Z" } } });
assert.equal(futureSplit.flows.total, undefined);
const excluded = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  excludedFamiliesByMarket: { moneyline: [], spread: [], total: ["Circa"] } });
assert.equal(excluded.flows.total, undefined);
assert.ok(excluded.flows.spread);
const heavyEqual = qualifyNflOwlsSplitsForSourceReaction({ ...args, splits: { ...splits,
  total: { ...splits.total, overMoneyPct: 90, underMoneyPct: 10, overBetsPct: 90, underBetsPct: 10 } } });
assert.equal(heavyEqual.flows.total![0]!.direction, 1,
  "held heavy same-side pressure remains observable even without a money-ticket difference");
const brokenPercentages = qualifyNflOwlsSplitsForSourceReaction({ ...args, splits: { ...splits,
  total: { ...splits.total, underMoneyPct: 20 } } });
assert.equal(brokenPercentages.flows.total, undefined);
console.log("NFL Owl source-contract reaction: own-line continuity, exact source clocks/pairs, identity and target isolation passed.");

// Historical pressure on a real older contract remains evidence, while the
// actual latest pre-flow price becomes the economic reaction baseline.
const pressureAt = "2026-11-02T13:00:00.000Z";
const earlyOwnAt = "2026-11-02T12:50:00.000Z";
const revisedBeforeFlowAt = "2026-11-02T12:55:00.000Z";
const totalQuote = (sportsbook: string, clock: string, line: number): NflEpisodeHistoryBook => ({
  ...paired, sportsbook, observedAt: clock, moneyline: null, spread: null,
  total: { line, overPrice: -110, underPrice: -110 },
});
const reactionHistory = [
  totalQuote("circa", earlyOwnAt, 45.5),
  totalQuote("circa", revisedBeforeFlowAt, 47.5),
  totalQuote("circa", observedAt, 47.5),
  totalQuote("pinnacle", "2026-11-02T12:00:00.000Z", 45.5),
  totalQuote("pinnacle", "2026-11-02T12:30:00.000Z", 44.5),
  totalQuote("pinnacle", observedAt, 44.5),
];
const retainedPressure = qualifyNflOwlsSplitsForSourceReaction({ ...args, history: reactionHistory,
  splits: { ...splits, total: { ...splits.total, sourceLine: 45.5, providerFetchedAt: pressureAt } } });
assert.equal(retainedPressure.flows.total![0]!.pairedQuoteObservedAt, earlyOwnAt);
assert.equal(retainedPressure.flows.total![0]!.reactionBaselineObservedAt, revisedBeforeFlowAt);
assert.equal(retainedPressure.flows.total![0]!.sourceLine, 45.5,
  "the known own-contract pressure is retained without relabeling its handicap or quote clock");
assert.equal(source.flows.total![0]!.reactionBaselineObservedAt, quoteAt,
  "the original exact latest own-contract case retains its clock");

const reactionForecast = { ...getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX" }),
  providerGameId: args.providerGameId };
const noInventedReaction = readNflMarketInnovation({ independentForecast: reactionForecast,
  independentInputPolicy: "market_inputs_prohibited", history: reactionHistory,
  evaluatedAt, gameStartsAt, excludedFamiliesByMarket: args.excludedFamiliesByMarket,
  marketReactionContext: { total: { books: [], flows: retainedPressure.flows.total! } } });
assert.equal(noInventedReaction.receipt.reasons.total, "opposed_named_economic_episodes");
assert.equal(noInventedReaction.receipt.selectedSources.total, undefined);
assert.strictEqual(noInventedReaction.outcome, reactionForecast,
  "a move completed before the pressure observation cannot become an invented post-flow reaction");
const baselineConflict = qualifyNflOwlsSplitsForSourceReaction({ ...args,
  history: [...reactionHistory, totalQuote("circa", revisedBeforeFlowAt, 48.5)],
  splits: { ...splits, total: { ...splits.total, sourceLine: 45.5, providerFetchedAt: pressureAt } } });
assert.equal(baselineConflict.flows.total, undefined);
assert.equal(baselineConflict.reasons.total, "conflicting_source_economic_baselines");
console.log("NFL source-reaction clocks: historical own-contract context and latest actual pre-flow economic baseline passed");
