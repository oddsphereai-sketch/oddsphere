import assert from "node:assert/strict";
import { readNflMarketInnovation, type NflInnovationReactionContext } from "@/lib/services/football/nflMarketInnovationRuntime";
import { qualifyNflPublicSourceReaction } from "@/lib/services/football/nflPublicSourceReaction";
import { qualifyNflOwlsSplitsForSourceReaction } from "@/lib/services/football/nflOwlsSplits";
import type { NflForwardPlaybookSplitSet } from "@/lib/services/football/nflForwardEvidence";
import type { NflRegularSharpSplitSet } from "@/lib/services/football/sharpApiNflSplits";
import type { NflEpisodeHistoryBook } from "@/lib/services/football/nflMoneylineEpisodeTransport";
import { buildNflIndependentScoreBaseForecast, getNflV1WeekOneOutcomeForecast } from "@/lib/services/football/nflV1WeekOneOutcome";

type Market = "moneyline" | "spread" | "total";
const raw = getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX" });
const base = buildNflIndependentScoreBaseForecast({ baseForecast: raw,
  independentScore: { expectedHomeMargin: 3, expectedTotal: 47, marketInputPolicy: "prohibited_from_independent_score" } });
const at = (clock: string) => `2026-11-02T${clock}:00.000Z`;
const flowAt = at("13:00"), priorAt = at("12:50"), evaluatedAt = at("14:30"), gameStartsAt = at("18:00");
const american = (p: number) => p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
const q = (market: Market, book: string, clock: string, value: number): NflEpisodeHistoryBook => ({
  providerGameId: raw.providerGameId, providerEventId: "exact-event", provider: "owls", sportsbook: book, observedAt: at(clock),
  moneyline: market === "moneyline" ? { homePrice: american(value), awayPrice: american(1 - value) } : null,
  spread: market === "spread" ? { homeLine: -value, awayLine: value, homePrice: -110, awayPrice: -110 } : null,
  total: market === "total" ? { line: value, overPrice: -110, underPrice: -110 } : null,
});
const publicRow = { provider: "playbook" as const, capturedAt: flowAt, booksUsed: 11,
  homeMoneyPct: 60, awayMoneyPct: 40, homeBetsPct: 40, awayBetsPct: 60,
  overMoneyPct: 60, underMoneyPct: 40, overBetsPct: 40, underBetsPct: 60 };
const publicSplits: NflForwardPlaybookSplitSet = { moneyline: { ...publicRow }, spread: { ...publicRow }, total: { ...publicRow } };
const exclusions = { moneyline: [], spread: [], total: [] };
const books = [{ book: "circa", lastEconomicMoveAt: at("14:00"), lastEconomicDirection: 1 as const },
  { book: "pinnacle", lastEconomicMoveAt: at("12:30"), lastEconomicDirection: -1 as const }];

for (const market of ["moneyline", "spread", "total"] as const) {
  const initial = market === "moneyline" ? .5 : market === "spread" ? 3.5 : 45.5;
  const up = market === "moneyline" ? .55 : initial + 2;
  const down = market === "moneyline" ? .45 : initial - 1;
  const history = [q(market, "circa", "12:50", initial), q(market, "circa", "14:00", up),
    q(market, "pinnacle", "12:00", initial), q(market, "pinnacle", "12:30", down), q(market, "pinnacle", "14:00", down)];
  const common = { independentForecast: base, independentInputPolicy: "market_inputs_prohibited" as const,
    evaluatedAt, gameStartsAt, excludedFamiliesByMarket: exclusions, history };
  const publicQualified = qualifyNflPublicSourceReaction({ providerGameId: raw.providerGameId, evaluatedAt, gameStartsAt,
    splits: publicSplits, line: { provider: "playbook", capturedAt: at("12:55"), sourceTier: null,
      homeMoneyline: -110, awayMoneyline: -110, homeSpread: -3.5, awaySpread: 3.5, total: 45.5 },
    history, excludedFamiliesByMarket: exclusions });
  assert.ok(publicQualified[market]!.flows[0]!.contractAttestations?.some(pair => pair.book === "circa" && pair.observedAt === priorAt));
  const publicContext: NflInnovationReactionContext = { [market]: { ...publicQualified[market]!, books } };
  const attested = readNflMarketInnovation({ ...common, marketReactionContext: publicContext });
  assert.equal(attested.receipt.selectedSources[market], "circa");
  assert.equal(attested.receipt.reasons[market], "price_reaction_adjudicates_older_opposed_episode");
  const withRedundantHold = readNflMarketInnovation({ ...common,
    history: [...history, q(market, "circa", "13:15", initial)], marketReactionContext: publicContext });
  assert.deepEqual(attested.outcome, withRedundantHold.outcome,
    `${market}: a redundant unchanged post-flow quote cannot be required to discover an already attested before/after reaction`);
  const namedRow = { ...publicRow, provider: "owls" as const, providerGameId: raw.providerGameId,
    sourceEventId: "exact-event", sourceSportsbook: "circa", providerFetchedAt: flowAt,
    sourceLine: market === "spread" ? -initial : market === "total" ? initial : null };
  const namedSplits: NflRegularSharpSplitSet = { moneyline: { ...namedRow, sourceLine: null },
    spread: { ...namedRow, sourceLine: -3.5 }, total: { ...namedRow, sourceLine: 45.5 } };
  const namedQualified = qualifyNflOwlsSplitsForSourceReaction({ splits: namedSplits,
    providerGameId: raw.providerGameId, evaluatedAt, gameStartsAt, history, excludedFamiliesByMarket: exclusions });
  assert.equal(namedQualified.flows[market]![0]!.pairedQuoteObservedAt, priorAt);
  const namedContext: NflInnovationReactionContext = { [market]: { books, flows: namedQualified.flows[market]! } };
  const namedAttested = readNflMarketInnovation({ ...common, marketReactionContext: namedContext });
  assert.deepEqual(namedAttested.outcome, attested.outcome,
    "named own-book pressure and public own-contract pressure use the same actual price consequence, not added source votes");

  const unverified = readNflMarketInnovation({ ...common, marketReactionContext: {
    [market]: { books, flows: [{ observedAt: flowAt, direction: 1 }] },
  } });
  assert.equal(unverified.receipt.reasons[market], "opposed_named_economic_episodes");
  assert.equal(unverified.receipt.selectedSources[market], undefined,
    "an unattested old quote cannot replace the two-real-post-flow-pairs guard");
  for (const invalidAt of [at("12:45"), at("13:15"), at("10:00")]) {
    const invalid = readNflMarketInnovation({ ...common, marketReactionContext: {
      [market]: { books, flows: [{ observedAt: flowAt, direction: 1, book: "circa", pairedQuoteObservedAt: invalidAt }] },
    } });
    assert.equal(invalid.receipt.reasons[market], "opposed_named_economic_episodes",
      "a missing, future, or stale baseline clock cannot attest a price reaction");
  }
  const wrongBook = readNflMarketInnovation({ ...common, marketReactionContext: {
    [market]: { books, flows: [{ observedAt: flowAt, direction: 1,
      contractAttestations: [{ book: "pinnacle", observedAt: priorAt }] }] },
  } });
  assert.equal(wrongBook.receipt.reasons[market], "opposed_named_economic_episodes");
}
console.log("NFL source reaction adjudication: named/public attested pre-flow baselines, redundant holds and unverified guards passed.");
