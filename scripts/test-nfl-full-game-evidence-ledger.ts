import assert from "node:assert/strict";

import {
  applyNflFullGameSemanticGradePolicy,
  arbitrateNflFullGameEvidence,
  reconcileNflFullGameScoreTuple,
} from "@/lib/services/football/nflFullGameEvidenceArbiter";
import { buildNflFullGameEvidenceLedger } from "@/lib/services/football/nflFullGameEvidenceLedger";
import { applyNflFullGameEvidenceRuntime } from "@/lib/services/football/nflFullGameEvidenceRuntime";
import { buildNflMarketState } from "@/lib/services/football/nflMarketState";
import type { NflForwardContextMarket } from "@/lib/services/football/nflForwardEvidenceCapture";

const evaluatedAt = "2026-10-26T20:00:00.000Z";
const landmark = (observedAt: string, line: number | null, firstPrice: number, secondPrice: number) =>
  [observedAt, 10, "f", line, firstPrice, secondPrice] as const;
const market = (name: "moneyline" | "spread" | "total", line: number | null): Pick<NflForwardContextMarket, "families"> => ({
  families: ["circa", "pinnacle"].map((source) => [
    source, "s", "c", null,
    landmark("2026-10-26T18:00:00.000Z", line, -110, -110),
    landmark("2026-10-26T19:50:00.000Z", line, -100, -120),
  ] as NflForwardContextMarket["families"][number]),
});
const snapshots = [{
  capturedAt: "2026-10-26T19:50:00.000Z",
  markets: {
    moneyline: market("moneyline", null),
    spread: market("spread", 3.5),
    total: market("total", 44.5),
  },
}];
const split = {
  provider: "playbook" as const,
  capturedAt: "2026-10-26T19:58:00.000Z",
  booksUsed: 1,
  awayMoneyPct: 49,
  awayBetsPct: 50,
  homeMoneyPct: 51,
  homeBetsPct: 50,
  overMoneyPct: 51,
  overBetsPct: 50,
  underMoneyPct: 49,
  underBetsPct: 50,
};
const states = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
  buildNflMarketState({
    market: name,
    evaluatedAt,
    snapshots,
    current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
    playbookLine: null,
    playbookSplits: { moneyline: split, spread: split, total: split },
    sharpSplits: null,
  }),
])) as Parameters<typeof buildNflFullGameEvidenceLedger>[0]["states"];

assert.equal(states.moneyline.splits.length, 0, "the released directional state still filters a one-point split gap");

const ledgerArgs = {
  evaluatedAt,
  finalForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  currentSpreadBoundary: -3.5,
  currentTotalLine: 44.5,
  targetExcludedMarket: {
    homeMargin: -3.5,
    total: 44.5,
    moneylineHomeFairProbability: 0.35,
    spreadHomeFairProbability: 0.5,
    totalOverFairProbability: 0.5,
    marginFamilyCount: 5,
    totalFamilyCount: 5,
  },
  states,
  excludedFamiliesByMarket: {
    moneyline: ["fanduel"],
    spread: ["fanduel"],
    total: ["fanduel"],
  },
  playbookSplits: { moneyline: split, spread: split, total: split },
  sharpSplits: null,
  forecastCandidates: [
    { source: "exact_stat", forecast: { expectedAwayScore: 20, expectedHomeScore: 23 } },
    { source: "player_aware", forecast: { expectedAwayScore: 25, expectedHomeScore: 19 } },
  ],
  availability: {
    injuriesAvailable: true,
    injuryReportUpdatedAt: "2026-10-26T18:30:00.000Z",
    injuryPlayerCount: 4,
    expectedQuarterbacksAvailable: true,
    playerAwareForecastAvailable: true,
    weatherAvailable: true,
  },
} satisfies Parameters<typeof buildNflFullGameEvidenceLedger>[0];
const ledger = buildNflFullGameEvidenceLedger(ledgerArgs);
const coherentExpertTuple = reconcileNflFullGameScoreTuple({
  ledger,
  releasedHomeMargin: -3,
  releasedTotal: 45,
  proposedHomeMargin: 28,
  proposedTotal: 24,
});
assert.deepEqual(coherentExpertTuple, { homeMargin: -3, total: 45 },
  "unrelated statistical and player-aware experts cannot substitute for one paired-price whole-game read");
const noJointExpertTuple = reconcileNflFullGameScoreTuple({
  ledger: { ...ledger, signals: ledger.signals.filter((signal) => signal.kind !== "forecast_expert") },
  releasedHomeMargin: -3,
  releasedTotal: 45,
  proposedHomeMargin: 28,
  proposedTotal: 24,
});
assert.deepEqual(noJointExpertTuple, { homeMargin: -3, total: 45 },
  "without a joint market score, two proposed axes cannot be stitched into an impossible hybrid");
const pairedPriceLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  forecastCandidates: [
    ...ledgerArgs.forecastCandidates,
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 23, expectedHomeScore: 25 } },
  ],
});
assert.ok(pairedPriceLedger.signals.filter((signal) =>
  signal.source === "target_excluded_paired_price_score").every((signal) => signal.targetExcluded === true),
"every paired-price score axis retains target-excluded source provenance");
assert.deepEqual(reconcileNflFullGameScoreTuple({
  ledger: pairedPriceLedger,
  releasedHomeMargin: -3,
  releasedTotal: 45,
  proposedHomeMargin: 2,
  proposedTotal: 48,
}), { homeMargin: 2, total: 48 },
"a single target-excluded paired-price score may coherently resolve both axes");

const totalWithOpposingRetail = buildNflMarketState({
  market: "total", evaluatedAt,
  snapshots: [{
    capturedAt: "2026-10-26T19:50:00.000Z",
    markets: {
      moneyline: { families: [] }, spread: { families: [] },
      total: { families: [
        ...["circa", "pinnacle"].map((source) => [
          source, "s", source === "circa" ? "c" : "p", null,
          landmark("2026-10-26T18:00:00.000Z", 44.5, -110, -110),
          landmark("2026-10-26T19:50:00.000Z", 44.5, -120, -100),
        ] as NflForwardContextMarket["families"][number]),
        ["fanduel", "b", "n", null,
          landmark("2026-10-26T18:00:00.000Z", 44.5, -110, -110),
          landmark("2026-10-26T19:50:00.000Z", 44.5, -100, -120),
        ] as NflForwardContextMarket["families"][number],
      ] },
    },
  }],
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(totalWithOpposingRetail.namedDirection, 1);
assert.equal(totalWithOpposingRetail.resistance, "retail_price_resistance");
const noSideState = { ...states.moneyline, namedDirection: null, trails: [], splits: [], resistance: "none" as const };
const retailResistanceLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 22, expectedHomeScore: 21 },
  states: { moneyline: noSideState, spread: { ...states.spread, ...noSideState, market: "spread" },
    total: totalWithOpposingRetail },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: 23, expectedHomeScore: 24 } }],
});
const retailResistanceRead = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 22, expectedHomeScore: 21 },
  ledger: retailResistanceLedger,
});
assert.equal(retailResistanceRead.totalStory, "scoring_environment_change");
assert.equal(retailResistanceRead.finalTotal, 47,
  "retail opposition remains visible but cannot masquerade as a Circa/Pinnacle conflict veto");

const publicMoneyline = ledger.signals.find((value) =>
  value.kind === "split" && value.market === "moneyline" && value.source === "public_consensus");
assert.ok(publicMoneyline, "a captured sub-threshold split must remain in the full-game ledger");
assert.equal(publicMoneyline.value, 1);
assert.equal(publicMoneyline.disposition, "resists");
assert.equal(ledger.signals.find((value) => value.source === "exact_stat" && value.market === "moneyline")?.disposition, "resists");
assert.equal(ledger.signals.find((value) => value.source === "player_aware" && value.market === "moneyline")?.disposition, "supports");
assert.equal(ledger.accounting.allUsableAccounted, true);
assert.equal(ledger.accounting.accountedUsable, ledger.accounting.usable);
assert.ok(ledger.accounting.resists > 0);
assert.ok(ledger.accounting.supports > 0);

const concentratedFavoriteSplit = {
  ...split,
  homeMoneyPct: 80, homeBetsPct: 80,
  awayMoneyPct: 20, awayBetsPct: 20,
};
const concentratedLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { ...states, moneyline: { ...states.moneyline, namedDirection: -1 } },
  playbookSplits: { moneyline: concentratedFavoriteSplit, spread: split, total: split },
});
const concentratedSignal = concentratedLedger.signals.find((value) =>
  value.kind === "split" && value.market === "moneyline" && value.source === "public_consensus");
assert.equal(concentratedSignal?.splitContext?.sharedMajoritySide, "home");
assert.equal(concentratedSignal?.splitContext?.qualifiedForDirection, false,
  "equal money and ticket share must not invent a sharp-bettor differential");
const concentrationRead = arbitrateNflFullGameEvidence({
  releasedForecast: ledgerArgs.finalForecast, ledger: concentratedLedger,
}).signalInterpretations.find((item) => item.signalId === concentratedSignal?.id);
assert.ok(concentrationRead?.roles.includes("shared_flow_concentration"));
assert.ok(concentrationRead?.roles.includes("price_resistance"),
  "a named price path opposite shared favorite concentration must remain an explicit conflict");
assert.equal(concentrationRead?.affects, "context_only",
  "concentration alone cannot fabricate a score adjustment or a sharp-bettor identity");

const wideSplit = {
  ...split,
  awayMoneyPct: 30,
  homeMoneyPct: 70,
};
const mismatchedSpreadState = buildNflMarketState({
  market: "spread", evaluatedAt, snapshots,
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
  playbookLine: {
    provider: "playbook", capturedAt: split.capturedAt, sourceTier: "consensus",
    homeMoneyline: null, awayMoneyline: null, homeSpread: 4.5, awaySpread: -4.5, total: 44.5,
  },
  playbookSplits: { moneyline: split, spread: wideSplit, total: split },
  sharpSplits: null,
});
assert.equal(mismatchedSpreadState.splits.length, 0, "mismatched public spread line must fail state admission");
const mismatchLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { ...states, spread: mismatchedSpreadState },
  playbookSplits: { moneyline: split, spread: wideSplit, total: split },
});
const rejectedPublicSpread = mismatchLedger.signals.find((value) =>
  value.kind === "split" && value.market === "spread" && value.source === "public_consensus");
assert.equal(rejectedPublicSpread?.splitContext?.qualifiedForDirection, false,
  "full-game ledger must not restore directional authority to an upstream-rejected line");

const sharpSpread = {
  ...wideSplit,
  provider: "sharpapi" as const,
  providerGameId: "test-game", sourceEventId: "test-event", sourceSportsbook: "circa",
  providerFetchedAt: wideSplit.capturedAt,
};
const sharpSplits = { moneyline: sharpSpread, spread: sharpSpread, total: sharpSpread };
const acceptedSharpState = buildNflMarketState({
  market: "spread", evaluatedAt, snapshots,
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
  playbookLine: {
    provider: "playbook", capturedAt: split.capturedAt, sourceTier: "consensus",
    homeMoneyline: null, awayMoneyline: null, homeSpread: 4.5, awaySpread: -4.5, total: 44.5,
  },
  playbookSplits: { moneyline: split, spread: wideSplit, total: split },
  sharpSplits,
});
const sharpLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { ...states, spread: acceptedSharpState },
  playbookSplits: { moneyline: split, spread: wideSplit, total: split },
  sharpSplits,
});
assert.equal(sharpLedger.signals.find((value) =>
  value.kind === "split" && value.market === "spread" && value.source === "circa")?.splitContext?.qualifiedForDirection, true,
"a source-specific sharp split is not disqualified by a different public line mismatch");
const excludedSharpState = buildNflMarketState({
  market: "spread", evaluatedAt, snapshots, excludedFamilies: ["circa"],
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits,
});
const excludedSharpLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { ...states, spread: excludedSharpState },
  excludedFamiliesByMarket: { ...ledgerArgs.excludedFamiliesByMarket, spread: ["circa"] },
  sharpSplits,
});
assert.equal(excludedSharpLedger.signals.find((value) =>
  value.kind === "split" && value.market === "spread" && value.source === "circa")?.splitContext?.qualifiedForDirection, false,
"a split from the evaluated sportsbook cannot direct its own decision");
const evaluatedCircaStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
  buildNflMarketState({
    market: name,
    evaluatedAt,
    snapshots,
    excludedFamilies: ["circa"],
    current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
    playbookLine: null,
    playbookSplits: null,
    sharpSplits: null,
  }),
])) as typeof states;
assert.equal(evaluatedCircaStates.moneyline.namedDirection, null,
  "the evaluated book cannot become its own second independent named-book vote");
const evaluatedCircaLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: evaluatedCircaStates,
  excludedFamiliesByMarket: { moneyline: ["circa"], spread: ["circa"], total: ["circa"] },
});
assert.ok(!evaluatedCircaLedger.signals.some((value) =>
  value.kind === "book_trail" && value.source === "circa"),
"the evaluated sportsbook must not re-enter the arbiter through the evidence ledger");
assert.equal(arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: evaluatedCircaLedger,
}).status, "neutral",
"a single remaining named book cannot manufacture a score correction");
const singleNamedWithCurrentPriceLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  targetExcludedMarket: {
    ...ledgerArgs.targetExcludedMarket, homeMargin: 2, moneylineHomeFairProbability: 0.6,
  },
  states: {
    ...states,
    moneyline: { ...states.moneyline,
      trails: states.moneyline.trails.filter((trail) => trail.source === "pinnacle") },
    spread: { ...states.spread, namedDirection: null },
  },
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 24, expectedHomeScore: 21 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } },
  ],
});
const singleNamedWithCurrentPrice = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: singleNamedWithCurrentPriceLedger,
});
assert.equal(singleNamedWithCurrentPrice.sideStory, "winner_regime_change",
  "one clean named ML move can be corroborated by an independent target-excluded current price");
assert.equal(singleNamedWithCurrentPrice.finalHomeMargin, 2,
  "the independently corroborated paired price, not a reflected independent score, supplies the new margin");
const singleNamedWithoutMatchingPrice = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: { ...singleNamedWithCurrentPriceLedger,
    signals: singleNamedWithCurrentPriceLedger.signals.filter((signal) =>
      signal.source !== "target_excluded_paired_price_score") },
});
assert.equal(singleNamedWithoutMatchingPrice.finalHomeMargin, -3,
  "an uncorroborated lone named move cannot flip the released game");
const retailFollowingSnapshots = [{
  ...snapshots[0],
  markets: Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name, {
    families: [
      ...snapshots[0]!.markets[name].families,
      ["fanatics", "s", "c", null,
        landmark("2026-10-26T18:00:00.000Z", name === "moneyline" ? null : name === "spread" ? 3.5 : 44.5, -110, -110),
        landmark("2026-10-26T19:55:00.000Z", name === "moneyline" ? null : name === "spread" ? 3.5 : 44.5, -100, -120),
      ] as NflForwardContextMarket["families"][number],
    ],
  }])) as typeof snapshots[0]["markets"],
}];
const retailFollowingState = (name: "moneyline" | "spread", excludedFamilies: string[]) =>
  buildNflMarketState({
    market: name, evaluatedAt, snapshots: retailFollowingSnapshots, excludedFamilies,
    current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
    playbookLine: null, playbookSplits: null, sharpSplits: null,
  });
const includedRetailStates = {
  moneyline: retailFollowingState("moneyline", []),
  spread: retailFollowingState("spread", []),
  total: states.total,
};
const excludedRetailStates = {
  moneyline: retailFollowingState("moneyline", ["fanatics"]),
  spread: retailFollowingState("spread", ["fanatics"]),
  total: states.total,
};
assert.ok(includedRetailStates.moneyline.followerSources.includes("fanatics"));
assert.ok(!excludedRetailStates.moneyline.followerSources.includes("fanatics"),
  "the evaluated retailer cannot count as independent follow-through of a named-book move");
const retailRegimeLedger = (scenarioStates: typeof includedRetailStates) => buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    homeMargin: 3, moneylineHomeFairProbability: 0.65 },
  states: scenarioStates,
  excludedFamiliesByMarket: { moneyline: ["fanatics"], spread: ["fanatics"], total: [] },
});
assert.equal(arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: retailRegimeLedger(includedRetailStates),
}).sideStory, "winner_regime_change",
"the old self-referential path would mistake the evaluated book for independent follow-through");
assert.equal(arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: retailRegimeLedger(excludedRetailStates),
}).sideStory, "conflicted_market_story",
"with the target retailer removed, the unsupported winner flip must not publish");

const totalDownSnapshots = [{
  capturedAt: "2026-10-26T19:50:00.000Z",
  markets: {
    moneyline: market("moneyline", null),
    spread: market("spread", 3.5),
    total: { families: ["circa", "pinnacle", "fanduel"].map((source) => [
      source, source === "fanduel" ? "b" : "s", "c", null,
      landmark("2026-10-26T18:00:00.000Z", 47, -110, -110),
      landmark("2026-10-26T19:50:00.000Z", 43, -110, -110),
    ] as NflForwardContextMarket["families"][number]) },
  },
}];
const totalDownState = buildNflMarketState({
  market: "total", evaluatedAt, snapshots: totalDownSnapshots,
  current: { spread: { homeLine: 3.5 }, total: { line: 43 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(totalDownState.namedDirection, -1);
const totalDownLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 23, expectedHomeScore: 24 },
  currentTotalLine: 43,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, total: 43 },
  states: { ...states, total: totalDownState },
  playbookSplits: null,
  forecastCandidates: [
    { source: "independent_exact_stat", forecast: { expectedAwayScore: 23, expectedHomeScore: 24 } },
    { source: "player_aware", forecast: { expectedAwayScore: 20, expectedHomeScore: 21 } },
  ],
});
const totalDownArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 23, expectedHomeScore: 24 }, ledger: totalDownLedger,
});
assert.equal(totalDownArbitration.totalStory, "scoring_environment_change");
assert.equal(totalDownArbitration.finalTotal, 47,
  "a player-aware estimate cannot stand in for an observed target-excluded price-implied total");
const pricedTotalDownLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 23, expectedHomeScore: 24 }, currentTotalLine: 43,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, total: 43 },
  states: { ...states, total: totalDownState }, playbookSplits: null,
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 23, expectedHomeScore: 24 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 20, expectedHomeScore: 21 } },
  ],
});
const pricedTotalDownArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 23, expectedHomeScore: 24 }, ledger: pricedTotalDownLedger,
});
assert.equal(pricedTotalDownArbitration.finalTotal, 41,
  "a paired-price-implied whole-game score can move the Total without synthesizing points from a line");
const divergentTotalContract = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 23, expectedHomeScore: 23 },
  currentTotalLine: 45,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, total: 47 },
  states: { ...states, total: totalDownState },
  playbookSplits: null,
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 23, expectedHomeScore: 23 } },
    { source: "player_aware", forecast: { expectedAwayScore: 22, expectedHomeScore: 22 } },
  ],
});
assert.equal(divergentTotalContract.evaluatedContract.totalLine, 45);
assert.equal(arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 23, expectedHomeScore: 23 },
  ledger: divergentTotalContract,
}).totalStory, "scoring_environment_change",
"an inferred target-free Total level is not the evaluated Over/Under contract boundary");
const confirmedUnderLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 21, expectedHomeScore: 21 },
  currentTotalLine: 43,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, total: 43 },
  states: { ...states, total: totalDownState },
  playbookSplits: null,
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 21, expectedHomeScore: 21 } },
    { source: "player_aware", forecast: { expectedAwayScore: 20, expectedHomeScore: 20 } },
  ],
});
const confirmedUnder = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 21, expectedHomeScore: 21 }, ledger: confirmedUnderLedger,
});
assert.equal(confirmedUnder.totalStory, "market_confirms_scoring_environment");
assert.equal(confirmedUnder.finalTotal, 42,
  "a named Under move cannot borrow an unrelated expert score to strengthen an already-Under game");
const weakerUnderLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 21, expectedHomeScore: 21 },
  currentTotalLine: 43,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, total: 43 },
  states: { ...states, total: totalDownState },
  playbookSplits: null,
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 21, expectedHomeScore: 21 } },
    { source: "player_aware", forecast: { expectedAwayScore: 21.25, expectedHomeScore: 21.25 } },
  ],
});
assert.equal(arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 21, expectedHomeScore: 21 }, ledger: weakerUnderLedger,
}).finalTotal, 42,
"a weaker same-side expert must not be selected as false confirmation of the Under move");
const baselineTotalDecision = { market: "total", side: "Over 43", grade: "Lean" };
const candidateTotalDecision = { market: "total", side: "Under 43", grade: "Lean" };
const totalDecisionAfterArbitration = applyNflFullGameSemanticGradePolicy({
  baseline: { evaluatedBets: [baselineTotalDecision] } as never,
  candidate: { evaluatedBets: [candidateTotalDecision] } as never,
  arbitration: pricedTotalDownArbitration,
});
assert.equal(totalDecisionAfterArbitration.evaluatedBets[0]?.side, "Under 43",
  "a changed coherent Total score cannot retain the contradictory old Total pick");
const totalScenario = (state: typeof totalDownState, playerTotal: number | null) => {
  const scenarioLedger = buildNflFullGameEvidenceLedger({
    ...ledgerArgs,
    finalForecast: { expectedAwayScore: 23, expectedHomeScore: 24 }, currentTotalLine: 43,
    targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, total: 43 },
    states: { ...states, total: state }, playbookSplits: null,
    forecastCandidates: [
      { source: "independent_exact_stat", forecast: { expectedAwayScore: 23, expectedHomeScore: 24 } },
      { source: "target_excluded_paired_price_score", forecast: playerTotal === null
        ? null : { expectedAwayScore: playerTotal / 2, expectedHomeScore: playerTotal / 2 } },
    ],
  });
  return arbitrateNflFullGameEvidence({
    releasedForecast: { expectedAwayScore: 23, expectedHomeScore: 24 }, ledger: scenarioLedger,
  });
};
const withNamedTrails = (edit: (trail: typeof totalDownState.trails[number]) => typeof totalDownState.trails[number]) => ({
  ...totalDownState,
  trails: totalDownState.trails.map((trail) => trail.sourceClass === "named" ? edit(trail) : trail),
});
assert.equal(totalScenario(withNamedTrails((trail) => ({
  ...trail, priceDirection: 1,
})), 41).finalTotal, 41, "the current paired-price implication may resolve an older number/price contradiction");
assert.equal(totalScenario(withNamedTrails((trail) => ({
  ...trail, reversalMagnitude: 2,
})), 41).finalTotal, 41, "a net paired-price implication can survive an earlier reversal");
assert.equal(totalScenario(withNamedTrails((trail) => ({
  ...trail, buybackToOpening: true,
})), 41).finalTotal, 41, "a buyback is context, not an automatic veto of the final paired price");
assert.equal(totalScenario(totalDownState, null).finalTotal, 47,
  "a line move alone cannot manufacture an alternative score when no coherent expert is available");
const targetOnlyTotalState = buildNflMarketState({
  market: "total", evaluatedAt, snapshots: totalDownSnapshots,
  excludedFamilies: ["circa", "pinnacle"],
  current: { spread: { homeLine: 3.5 }, total: { line: 43 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(totalScenario(targetOnlyTotalState, 41).finalTotal, 47,
  "the evaluated or unavailable named books cannot direct a Total response");
const totalPriceOnlySnapshots = [{
  capturedAt: "2026-10-26T19:50:00.000Z",
  markets: {
    moneyline: market("moneyline", null),
    spread: market("spread", 3.5),
    total: { families: ["circa", "pinnacle"].map((source) => [
      source, "s", "c", null,
      landmark("2026-10-26T18:00:00.000Z", 43, -110, -110),
      landmark("2026-10-26T19:50:00.000Z", 43, 105, -125),
    ] as NflForwardContextMarket["families"][number]) },
  },
}];
const totalPriceOnlyState = buildNflMarketState({
  market: "total", evaluatedAt, snapshots: totalPriceOnlySnapshots,
  current: { spread: { homeLine: 3.5 }, total: { line: 43 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(totalPriceOnlyState.namedDirection, -1);
assert.equal(totalScenario(totalPriceOnlyState, 41).finalTotal, 41,
  "persistent named-book Under price-only movement at a fixed Total can select a coherent scoring expert");

const heldPriceSnapshots = [{
  capturedAt: "2026-10-26T19:50:00.000Z",
  markets: {
    moneyline: { families: ["circa", "pinnacle"].map((source) => [
      source, "s", "c", null,
      landmark("2026-10-26T18:00:00.000Z", null, -110, -110),
      landmark("2026-10-26T19:50:00.000Z", null, -110, -110),
    ] as NflForwardContextMarket["families"][number]) },
    spread: market("spread", 3.5),
    total: market("total", 44.5),
  },
}];
const heldMoneylineState = buildNflMarketState({
  market: "moneyline", evaluatedAt, snapshots: heldPriceSnapshots,
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
  playbookLine: null,
  playbookSplits: { moneyline: wideSplit, spread: split, total: split },
  sharpSplits: null,
});
assert.equal(heldMoneylineState.resistance, "flow_resistance");
const heldMoneylineLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { ...states, moneyline: heldMoneylineState },
  playbookSplits: { moneyline: wideSplit, spread: split, total: split },
});
const heldMoneylineArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: heldMoneylineLedger,
});
assert.ok(heldMoneylineArbitration.signalInterpretations.some((item) =>
  item.market === "moneyline" && item.source === "public_consensus" &&
  item.roles.includes("unconfirmed_flow_pressure") && item.affects === "context_only"),
"money pressure against a held price must be recognized as resistance without inventing the opposite sharp side");
assert.equal(heldMoneylineArbitration.spreadDirection, 1,
  "the fixture expects named Spread repricing toward home");
assert.equal(heldMoneylineLedger.signals.find((signal) =>
  signal.kind === "split" && signal.market === "moneyline" && signal.source === "public_consensus")?.side,
"home", "the fixture expects Home money pressure");
assert.equal(heldMoneylineLedger.marketContexts.moneyline.resistance, "flow_resistance");
assert.equal(heldMoneylineLedger.marketContexts.moneyline.namedDirection, null);
assert.equal(heldMoneylineArbitration.sideStory, "conflicted_market_story",
  "a held ML price under money pressure challenges a same-side Spread move");
assert.equal(heldMoneylineArbitration.finalHomeMargin, -3,
  "the conflicting held-price story must not move the score on a single Spread path");
const awayMoneyPressure = { ...wideSplit,
  awayMoneyPct: 70, homeMoneyPct: 30,
};
const heldAwayMoneyState = buildNflMarketState({
  market: "moneyline", evaluatedAt, snapshots: heldPriceSnapshots,
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
  playbookLine: null,
  playbookSplits: { moneyline: awayMoneyPressure, spread: split, total: split },
  sharpSplits: null,
});
const spreadSupportedByResistance = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { ...states, moneyline: heldAwayMoneyState },
  playbookSplits: { moneyline: awayMoneyPressure, spread: split, total: split },
});
const alreadyCovering = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: spreadSupportedByResistance,
});
assert.equal(alreadyCovering.sideStory, "spread_only_repricing");
assert.equal(alreadyCovering.finalHomeMargin, -3,
  "a named Home-cover read cannot be reflected to Away when the released score already covers Home");
const spreadCrossingLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 25, expectedHomeScore: 21 },
  states: { ...states, moneyline: heldAwayMoneyState },
  playbookSplits: { moneyline: awayMoneyPressure, spread: split, total: split },
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 25, expectedHomeScore: 21 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 24, expectedHomeScore: 21 } },
  ],
});
const spreadCrossing = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 25, expectedHomeScore: 21 },
  ledger: spreadCrossingLedger,
});
assert.equal(spreadCrossing.finalHomeMargin, -3,
  "a Home-cover market story may cross the Spread boundary while retaining an Away outright winner");

const sameWinnerLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 21, expectedHomeScore: 25 },
  currentSpreadBoundary: 3,
  targetExcludedMarket: {
    ...ledgerArgs.targetExcludedMarket,
    homeMargin: 3,
    moneylineHomeFairProbability: 0.55,
  },
  states: {
    ...states,
    moneyline: { ...states.moneyline, namedDirection: -1,
      trails: states.moneyline.trails.map((trail) => trail.sourceClass === "named"
        ? { ...trail, direction: -1 as const, priceDirection: -1 as const, numberDirection: null }
        : trail) },
    spread: { ...states.spread, namedDirection: -1,
      trails: states.spread.trails.map((trail) => trail.sourceClass === "named"
        ? { ...trail, direction: -1 as const, priceDirection: -1 as const, numberDirection: null }
        : trail) },
  },
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 21, expectedHomeScore: 25 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 21, expectedHomeScore: 22 } },
  ],
});
const sameWinnerArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 21, expectedHomeScore: 25 },
  ledger: sameWinnerLedger,
});
assert.equal(sameWinnerArbitration.sideStory, "same_winner_repricing");
assert.equal(sameWinnerArbitration.finalHomeMargin, 1,
  "named opposition may change the spread-cover story without flipping the outright winner");
assert.equal(sameWinnerArbitration.expectedHomeScore - sameWinnerArbitration.expectedAwayScore, 1);
const promotedMoneyline = applyNflFullGameSemanticGradePolicy({
  baseline: { evaluatedBets: [{ market: "moneyline", side: "HOME", grade: "Watchlist" }] } as never,
  candidate: { evaluatedBets: [{ market: "moneyline", side: "HOME", grade: "Lean" }] } as never,
  arbitration: sameWinnerArbitration,
});
assert.equal(promotedMoneyline.evaluatedBets[0]?.grade, "Lean",
  "the final candidate grade must not be silently capped when a paired-price-supported score changes");
assert.ok(sameWinnerArbitration.signalInterpretations.some((item) =>
  item.source === "target_excluded_paired_price_score" && item.market === "spread" &&
  item.roles.includes("target_excluded_price_score")),
"the paired-price cover score must be represented in the interpretation ledger");
const divergentWinnerCoverLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 20, expectedHomeScore: 24 },
  currentSpreadBoundary: 3.5,
  targetExcludedMarket: {
    ...ledgerArgs.targetExcludedMarket,
    homeMargin: 2,
    moneylineHomeFairProbability: 0.6,
  },
  states: {
    ...states,
    spread: { ...states.spread, namedDirection: -1,
      trails: states.spread.trails.map((trail) => trail.sourceClass === "named"
        ? { ...trail, direction: -1 as const, priceDirection: -1 as const, numberDirection: null }
        : trail) },
  },
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 20, expectedHomeScore: 24 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } },
  ],
});
const divergentWinnerCover = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 20, expectedHomeScore: 24 },
  ledger: divergentWinnerCoverLedger,
});
assert.equal(divergentWinnerCover.sideStory, "winner_cover_divergence");
assert.equal(divergentWinnerCover.finalHomeMargin, 2,
  "opposing ML and Spread moves can retain the winner while changing the cover and coherent score");
assert.equal(divergentWinnerCover.expectedHomeScore, 23);
assert.equal(divergentWinnerCover.expectedAwayScore, 21);
const noCoherentDivergence = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 20, expectedHomeScore: 24 },
  ledger: { ...divergentWinnerCoverLedger,
    signals: divergentWinnerCoverLedger.signals.filter((signal) => signal.source !== "target_excluded_paired_price_score") },
});
assert.equal(noCoherentDivergence.finalHomeMargin, 4,
  "opposing market directions without a coherent winner-and-cover forecast cannot invent a margin");
const confirmationLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 21, expectedHomeScore: 23 },
  targetExcludedMarket: {
    ...ledgerArgs.targetExcludedMarket,
    homeMargin: 2,
    moneylineHomeFairProbability: 0.6,
  },
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 20, expectedHomeScore: 24 } },
  ],
});
const confirmedWinner = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 21, expectedHomeScore: 23 }, ledger: confirmationLedger,
});
assert.equal(confirmedWinner.sideStory, "market_confirms_game");
assert.equal(confirmedWinner.finalHomeMargin, 4,
  "market confirmation may strengthen an already-correct winner with a coherent spread expert");
assert.equal(confirmedWinner.expectedHomeScore - confirmedWinner.expectedAwayScore, 4);
const weakerConfirmationLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 21, expectedHomeScore: 23 },
  targetExcludedMarket: {
    ...ledgerArgs.targetExcludedMarket,
    homeMargin: 2,
    moneylineHomeFairProbability: 0.6,
  },
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 21, expectedHomeScore: 22 } },
  ],
});
assert.equal(arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 21, expectedHomeScore: 23 }, ledger: weakerConfirmationLedger,
}).finalHomeMargin, 2,
"a weaker same-winner expert is not falsely treated as stronger market confirmation");
const regimeMarket = {
  ...ledgerArgs.targetExcludedMarket,
  homeMargin: 2,
  moneylineHomeFairProbability: 0.6,
};
const regimeLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  targetExcludedMarket: regimeMarket,
});
assert.equal(arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 }, ledger: regimeLedger,
}).finalHomeMargin, -3,
"named books without observed retail follow-through cannot force an outright winner regime change");
const followedSnapshots = [{
  ...snapshots[0]!,
  markets: {
    ...snapshots[0]!.markets,
    moneyline: { families: [...snapshots[0]!.markets.moneyline.families, [
      "draftkings", "b", "c", null,
      landmark("2026-10-26T18:00:00.000Z", null, -110, -110),
      landmark("2026-10-26T19:55:00.000Z", null, -100, -120),
    ] as NflForwardContextMarket["families"][number]] },
  },
}];
const followedMoneylineState = buildNflMarketState({
  market: "moneyline", evaluatedAt, snapshots: followedSnapshots,
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: { moneyline: split, spread: split, total: split },
  sharpSplits: null,
});
assert.ok(followedMoneylineState.followerSources.includes("draftkings"));
const followedRegimeLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  targetExcludedMarket: regimeMarket,
  states: { ...states, moneyline: followedMoneylineState },
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 24, expectedHomeScore: 21 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 21, expectedHomeScore: 24 } },
  ],
});
const followedRegime = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 }, ledger: followedRegimeLedger,
});
assert.equal(followedRegime.sideStory, "winner_regime_change");
assert.ok(followedRegime.finalHomeMargin > 0,
  "named ML/Spread agreement, target-free market regime, and later retail follow-through can flip the winner");
assert.ok(followedRegime.signalInterpretations.some((item) =>
  item.source === "draftkings" && item.roles.includes("retail_follow_through")));
const tiedLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  finalForecast: { expectedAwayScore: 22, expectedHomeScore: 22 },
  targetExcludedMarket: regimeMarket,
  forecastCandidates: [
    { source: "released_current", forecast: { expectedAwayScore: 22, expectedHomeScore: 22 } },
    { source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 20, expectedHomeScore: 23 } },
  ],
});
const resolvedTie = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 22, expectedHomeScore: 22 }, ledger: tiedLedger,
});
assert.equal(resolvedTie.sideStory, "tie_resolution");
assert.equal(resolvedTie.finalHomeMargin, 3,
  "clean named ML/Spread agreement and a target-free winner may resolve a tied score through a coherent expert");
const unsupportedTie = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 22, expectedHomeScore: 22 },
  ledger: buildNflFullGameEvidenceLedger({
    ...ledgerArgs,
    finalForecast: { expectedAwayScore: 22, expectedHomeScore: 22 },
    targetExcludedMarket: regimeMarket,
    forecastCandidates: [{ source: "released_current", forecast: { expectedAwayScore: 22, expectedHomeScore: 22 } }],
  }),
});
assert.equal(unsupportedTie.finalHomeMargin, 0,
  "a tied score must not be manufactured into a winner when no coherent forecast supports the market read");
assert.equal(unsupportedTie.reason, "coherent_evidence_without_score_authority");

const arbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger,
});
assert.ok([
  "market_confirms_game",
  "same_winner_repricing",
  "winner_regime_change",
  "spread_only_repricing",
  "conflicted_market_story",
  "market_story_unavailable",
].includes(arbitration.sideStory));
assert.ok(!("moneylineNarrative" in arbitration), "semantic arbiter must not expose a numeric blend");
assert.ok(!("spreadNarrative" in arbitration), "semantic arbiter must not expose a numeric blend");
assert.equal(arbitration.interpretationAccounting.allCapturedInterpreted, true,
  "every captured signal must receive an explicit semantic interpretation");
assert.equal(arbitration.interpretationAccounting.allUsableInterpreted, true,
  "every usable signal must be interpreted rather than merely routed");
assert.equal(arbitration.signalInterpretations.length, ledger.signals.length);
assert.deepEqual(
  [...new Set(arbitration.signalInterpretations.map((value) => value.signalId))].sort(),
  ledger.signals.map((value) => value.id).sort(),
  "the interpretation ledger must reference every captured signal exactly once",
);
assert.ok(arbitration.signalInterpretations.every((value) => value.roles.length > 0 && value.explanation.length > 0));
assert.ok(arbitration.signalInterpretations.some((value) => value.roles.includes("originating_price_discovery")));
assert.ok(arbitration.signalInterpretations.some((value) => value.roles.includes("unqualified_flow_context")),
  "a sub-threshold split must be understood as context, not silently discarded");
assert.equal(arbitration.finalHomeMargin, -3, "conflicted evidence preserves the released margin");
assert.equal(arbitration.finalTotal, 45,
  "named price-only paths are interpreted, but an unrelated scoring expert cannot stand in for a paired-price score");
assert.ok(Math.abs(arbitration.expectedAwayScore + arbitration.expectedHomeScore - arbitration.finalTotal) < 1e-9);
assert.ok(arbitration.signalInterpretations.some((item) =>
  item.source === "injuries" && item.roles.includes("availability_precedes_market") &&
  item.affects === "context_only"),
"an injury report before the observed market move is context, not an automatic second scoring adjustment");
const afterMoveInjuryLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  availability: {
    ...ledgerArgs.availability,
    injuryReportUpdatedAt: "2026-10-26T19:55:00.000Z",
  },
});
const afterMoveInjuryArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: afterMoveInjuryLedger,
});
assert.ok(afterMoveInjuryArbitration.signalInterpretations.some((item) =>
  item.source === "injuries" && item.roles.includes("market_precedes_availability") &&
  item.affects === "context_only"),
"a report after the first observed move cannot be falsely attributed as that move's cause");
assert.equal(afterMoveInjuryArbitration.finalHomeMargin, arbitration.finalHomeMargin);
assert.equal(afterMoveInjuryArbitration.finalTotal, arbitration.finalTotal,
"changing only uncertain injury chronology must not manufacture a score move");
const singleNamedSnapshots = snapshots.map((capture) => ({
  ...capture,
  markets: Object.fromEntries((['moneyline', 'spread', 'total'] as const).map((marketName) => [
    marketName, { ...capture.markets[marketName], families: capture.markets[marketName].families.slice(0, 1) },
  ])) as typeof capture.markets,
}));
const singleNamedStates = Object.fromEntries((['moneyline', 'spread', 'total'] as const).map((marketName) => [
  marketName, buildNflMarketState({
    market: marketName, evaluatedAt, snapshots: singleNamedSnapshots,
    current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
    playbookLine: null,
    playbookSplits: { moneyline: split, spread: split, total: split },
    sharpSplits: null,
  }),
])) as typeof states;
const singleNamedArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: buildNflFullGameEvidenceLedger({ ...ledgerArgs, states: singleNamedStates }),
});
assert.equal(singleNamedArbitration.finalHomeMargin, -3,
  "one named-book lead without independent confirmation cannot flip the score");
assert.equal(singleNamedArbitration.finalTotal, 45,
  "one named-book Total lead cannot command a new scoring environment");
const compensatedSideLedger = structuredClone(ledger);
compensatedSideLedger.marketContexts.spread.namedDirection = 1;
for (const signal of compensatedSideLedger.signals) {
  if (signal.kind === "book_trail" && signal.market === "spread" && signal.sourceClass === "named" &&
      signal.marketObservation) {
    signal.marketObservation.numberDirection = 1;
    signal.marketObservation.priceDirection = -1;
  }
}
const compensatedSideArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: compensatedSideLedger,
});
assert.equal(compensatedSideArbitration.sideStory, "conflicted_market_story");
assert.equal(compensatedSideArbitration.finalHomeMargin, -3,
  "an NFL Spread number with opposing juice cannot be followed as a clean side flip");
const reversingSideLedger = structuredClone(ledger);
for (const signal of reversingSideLedger.signals) {
  if (signal.kind === "book_trail" && signal.market === "spread" && signal.sourceClass === "named" &&
      signal.source === "circa" && signal.marketPath) {
    signal.marketPath.reversalMagnitude = 1;
  }
}
const reversingSideArbitration = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: reversingSideLedger,
});
assert.equal(reversingSideArbitration.sideStory, "conflicted_market_story");
assert.equal(reversingSideArbitration.finalHomeMargin, -3,
  "one stable and one reversing named Spread trail cannot authorize a side score change");

const immutableForecast = { expectedAwayScore: 24, expectedHomeScore: 21 } as never;
const immutableProduction = { marker: "stored-lock-must-win" } as never;
const lockedRuntime = applyNflFullGameEvidenceRuntime({
  providerGameId: "locked-game",
  awayTeam: "AWY",
  homeTeam: "HME",
  gameStartsAt: "2026-10-26T21:00:00.000Z",
  evaluatedAt,
  releasedForecast: immutableForecast,
  baselineProduction: immutableProduction,
  current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } } as never,
  comparableCurrentBooks: [],
  shadowMoneyline: {} as never,
  targetExcludedMarket: null,
  states,
  excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] },
  playbookSplits: { moneyline: split, spread: split, total: split },
  sharpSplits: null,
  forecastCandidates: [{ source: "released_current", forecast: immutableForecast }],
  availability: {
    injuriesAvailable: true,
    injuryReportUpdatedAt: "2026-10-26T18:30:00.000Z",
    injuryPlayerCount: 4,
    expectedQuarterbacksAvailable: true,
    playerAwareForecastAvailable: false,
    weatherAvailable: true,
  },
  existingLockedRecord: true,
});
assert.equal(lockedRuntime.outcome, immutableForecast,
  "an existing locked score must retain exact stored-object precedence");
assert.equal(lockedRuntime.production, immutableProduction,
  "an existing locked decision bundle must retain exact stored-object precedence");

console.log("NFL full-game evidence ledger tests passed");
