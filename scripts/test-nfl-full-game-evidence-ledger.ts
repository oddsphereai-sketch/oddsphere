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
    ...Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
      buildNflMarketState({
        market: name, evaluatedAt,
        snapshots: snapshots.map((capture) => ({ ...capture, markets: Object.fromEntries(
          (["moneyline", "spread", "total"] as const).map((marketName) => [marketName, {
            families: capture.markets[marketName].families.filter((family) => family[0] === "pinnacle"),
          }]),
        ) as typeof capture.markets })),
        current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
        playbookLine: null, playbookSplits: null, sharpSplits: null,
      }),
    ])) as typeof states,
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
assert.equal(singleNamedWithCurrentPriceLedger.marketContexts.moneyline.namedDirection, null,
  "the production state builder must leave a lone book unconfirmed before arbitration");
assert.equal(singleNamedWithCurrentPriceLedger.marketContexts.moneyline.candidateNamedDirection, 1);
assert.equal(singleNamedWithCurrentPrice.marketResolutions?.moneyline.corroboratedSingleEpisode, true,
  "the real builder-to-ledger-to-arbiter path must corroborate the retained episode");
for (const pairedPriceFamilyCounts of [{ margin: 1, total: 2 }, undefined]) {
  const selfConfirmingNamedMove = arbitrateNflFullGameEvidence({
    releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
    ledger: { ...singleNamedWithCurrentPriceLedger, pairedPriceFamilyCounts },
  });
  assert.equal(selfConfirmingNamedMove.finalHomeMargin, -3,
    "a lone named mover cannot corroborate itself through a one-family or unproven paired-price score");
  assert.equal(selfConfirmingNamedMove.marketResolutions?.moneyline.corroboratedSingleEpisode, false);
}
const independentlyCorroboratedNamedMove = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: { ...singleNamedWithCurrentPriceLedger, pairedPriceFamilyCounts: { margin: 2, total: 2 } },
});
assert.equal(independentlyCorroboratedNamedMove.finalHomeMargin, 2,
  "two canonical target-excluded families can independently corroborate the real single-book episode");
assert.equal(independentlyCorroboratedNamedMove.marketResolutions?.moneyline.corroboratedSingleEpisode, true);
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
const selfReferencedWithoutPrice = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: retailRegimeLedger(includedRetailStates),
});
assert.equal(selfReferencedWithoutPrice.sideStory, "market_story_unavailable",
  "captured follow-through cannot imply a winner correction when no numeric price coordinate exists");
assert.equal(selfReferencedWithoutPrice.finalHomeMargin, -3);
const excludedRetailWithoutPrice = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: retailRegimeLedger(excludedRetailStates),
});
assert.equal(excludedRetailWithoutPrice.sideStory, "market_story_unavailable",
  "excluding the target retailer preserves provenance but does not fabricate missing numeric score authority");
assert.equal(excludedRetailWithoutPrice.finalHomeMargin, -3,
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
assert.equal(totalDownArbitration.totalStory, "conflicted_market_story");
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
}).totalStory, "conflicted_market_story",
"a named Under path without a paired-price scoring implication cannot claim a changed environment");
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
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } }],
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
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: 24, expectedHomeScore: 21 } }],
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
const demotedMoneyline = applyNflFullGameSemanticGradePolicy({
  baseline: { evaluatedBets: [{ market: "moneyline", side: "HOME", grade: "Best Angle" }] } as never,
  candidate: { evaluatedBets: [{ market: "moneyline", side: "HOME", grade: "No Play",
    modelProbability: 0.6, expectedValue: -0.1, evaluatedQuote: { price: -200 } }] } as never,
  arbitration: sameWinnerArbitration,
});
assert.equal(demotedMoneyline.evaluatedBets[0]?.grade, "No Play",
  "the same coherent correction also preserves an exact-price evaluator's demotion instead of resurrecting the former Best Angle");
const promotedSpread = applyNflFullGameSemanticGradePolicy({
  baseline: { evaluatedBets: [{ market: "spread", side: "AWAY", grade: "Watchlist" }] } as never,
  candidate: { evaluatedBets: [{ market: "spread", side: "HOME", grade: "Watchlist",
    expectedValue: 0.03, modelProbability: 0.56, marketFairProbability: 0.53 }] } as never,
  arbitration: { ...sameWinnerArbitration, sideStory: "spread_only_repricing" },
});
assert.equal(promotedSpread.evaluatedBets[0]?.grade, "Lean",
  "a coherent same-input spread-side correction with positive value can promote a Watchlist");
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
assert.equal(unsupportedTie.sideStory, "market_story_unavailable",
  "a missing side price coordinate leaves the tied winner unresolved even if a separate Total path confirms its scoring side");
assert.equal(unsupportedTie.status, "neutral");

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

const reverseFlowSplit = { ...split, awayMoneyPct: 70, homeMoneyPct: 30 };
const reverseFlowStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
  buildNflMarketState({
    market: name, evaluatedAt, snapshots,
    current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
    playbookLine: null,
    playbookSplits: { moneyline: reverseFlowSplit, spread: split, total: split },
    sharpSplits: null,
  }),
])) as typeof states;
assert.equal(reverseFlowStates.moneyline.resistance, "reverse_flow");
const reverseFlowLedger = (homeMargin: number, moneylineHomeFairProbability: number) => buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: reverseFlowStates,
  playbookSplits: { moneyline: reverseFlowSplit, spread: split, total: split },
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, homeMargin, moneylineHomeFairProbability,
    spreadHomeFairProbability: 0.6, totalOverFairProbability: 0.6, total: 46 },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: (46 - homeMargin) / 2, expectedHomeScore: (46 + homeMargin) / 2 } }],
});
const reverseFlowConfirmed = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: reverseFlowLedger(2, 0.6),
});
assert.equal(reverseFlowConfirmed.finalHomeMargin, 2,
  "price resistance to opposing flow can select the price-confirmed winner without blindly following money");
assert.equal(reverseFlowConfirmed.marketResolutions?.moneyline.flow, "opposes_price");
assert.equal(reverseFlowConfirmed.marketResolutions?.moneyline.reason,
  "price_led_resistance_to_flow_with_current_price_confirmation");
assert.ok(reverseFlowConfirmed.marketResolutions?.moneyline.opposingSignalIds.some((id) =>
  reverseFlowLedger(2, 0.6).signals.some((signal) => signal.id === id && signal.kind === "split")),
"the opposed flow must remain attached to the final decision rather than disappear after a flip");
assert.equal(reverseFlowConfirmed.status, "applied");
assert.equal(reverseFlowConfirmed.finalTotal, 45);
assert.equal(reverseFlowConfirmed.totalStory, "conflicted_market_story",
  "a side correction cannot make an unchanged Total claim a scoring environment change");
assert.equal(reverseFlowConfirmed.marketResolutions?.moneyline.action, "changed");
assert.equal(reverseFlowConfirmed.marketResolutions?.total.action, "held");
assert.equal(reverseFlowConfirmed.marketResolutions?.total.reason,
  "current_price_does_not_confirm_named_path_retain_released_score");
const reverseFlowUnconfirmed = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: reverseFlowLedger(-2, 0.4),
});
assert.equal(reverseFlowUnconfirmed.finalHomeMargin, -2,
  "home-directed movement may weaken an away winner from -3 to -2 without forcing an outright home flip");
assert.equal(reverseFlowUnconfirmed.sideStory, "same_winner_repricing");
assert.equal(reverseFlowUnconfirmed.marketResolutions?.moneyline.action, "changed");
assert.notEqual(reverseFlowUnconfirmed.marketResolutions?.moneyline.reason,
  "current_price_does_not_confirm_named_path_retain_released_score",
  "a same-winner displacement in the movement direction is not a contrary current-price hold");
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
assert.equal(compensatedSideArbitration.sideStory, "market_story_unavailable",
  "a compensated price path without a numeric market coordinate remains unavailable for score authority");
assert.ok(compensatedSideArbitration.signalInterpretations.some((item) => item.roles.includes("number_price_divergence")),
  "unavailable numeric authority does not erase the number/juice conflict");
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
assert.equal(reversingSideArbitration.sideStory, "market_story_unavailable",
  "a reversing path without a numeric market coordinate remains unavailable for score authority");
assert.ok(reversingSideArbitration.signalInterpretations.some((item) => item.roles.includes("reversal")),
  "unavailable numeric authority does not erase the source reversal");
assert.equal(reversingSideArbitration.finalHomeMargin, -3,
  "one stable and one reversing named Spread trail cannot authorize a side score change");

const emptyAxisStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((marketName) => [marketName,
  buildNflMarketState({ market: marketName, evaluatedAt, snapshots: [],
    current: { spread: { homeLine: 3.5 }, total: { line: 44.5 } },
    playbookLine: null, playbookSplits: null, sharpSplits: null }),
])) as typeof states;
const standaloneTotalLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { ...emptyAxisStates, total: singleNamedStates.total },
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    homeMargin: 0, moneylineHomeFairProbability: 0.5, marginFamilyCount: 0, moneylineFamilyCount: 0,
    total: 44.5, totalOverFairProbability: 0.4, totalFamilyCount: 3, availableMarkets: ["total"] },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: 20, expectedHomeScore: 23 }, authoritativeMarkets: ["total"],
    marketValues: { total: 43 } }],
});
assert.equal(standaloneTotalLedger.marketContexts.total.namedDirection, null);
const standaloneTotalResult = arbitrateNflFullGameEvidence({ releasedForecast: ledgerArgs.finalForecast, ledger: standaloneTotalLedger });
assert.equal(standaloneTotalResult.marketResolutions?.total.corroboratedSingleEpisode, true,
  "held Total number with directional juice corroborates a real lone named price episode");
assert.equal(standaloneTotalResult.finalTotal, 43,
  "raw cohort line equal to evaluated line cannot erase the current price-implied Under");
assert.equal(standaloneTotalResult.finalHomeMargin, -3);

const standaloneMlForecast = { expectedAwayScore: 20, expectedHomeScore: 21 };
const standaloneMlLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs, finalForecast: standaloneMlForecast,
  states: { ...emptyAxisStates, moneyline: singleNamedStates.moneyline },
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    homeMargin: 0, moneylineHomeFairProbability: 0.6, marginFamilyCount: 0, moneylineFamilyCount: 3,
    total: 0, totalOverFairProbability: 0.5, totalFamilyCount: 0, availableMarkets: ["moneyline"] },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: 19, expectedHomeScore: 22 }, authoritativeMarkets: ["moneyline"],
    marketValues: { moneyline: 3 } }],
});
const standaloneMlResult = arbitrateNflFullGameEvidence({ releasedForecast: standaloneMlForecast, ledger: standaloneMlLedger });
assert.equal(standaloneMlResult.sideStory, "market_confirms_game");
assert.equal(standaloneMlResult.finalHomeMargin, 3,
  "a confirmed direct ML-only price may strengthen the same winner without any Spread cohort");
assert.equal(standaloneMlResult.finalTotal, 41);

const spreadTotalOnlyLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    moneylineFamilyCount: 0, availableMarkets: ["spread", "total"] },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: 20, expectedHomeScore: 23 }, authoritativeMarkets: ["spread", "total"],
    marketValues: { spread: 3, total: 43 } }],
});
assert.deepEqual(reconcileNflFullGameScoreTuple({ ledger: spreadTotalOnlyLedger,
  releasedHomeMargin: 2, releasedTotal: 45, proposedHomeMargin: 3, proposedTotal: 43 }),
{ homeMargin: 3, total: 43 }, "independently qualified Spread and Total coordinates form one coherent game without ML evidence");
assert.deepEqual(reconcileNflFullGameScoreTuple({ ledger: spreadTotalOnlyLedger,
  releasedHomeMargin: 2, releasedTotal: 45, proposedHomeMargin: 4, proposedTotal: 43 }),
{ homeMargin: 2, total: 45 }, "a proposed coordinate cannot borrow unrelated market authority merely because its direction agrees");

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

const retracingMoneyline = buildNflMarketState({
  market: "moneyline", evaluatedAt,
  snapshots: [
    { at: "2026-10-26T19:00:00.000Z", away: 100, home: -140 },
    { at: "2026-10-26T19:50:00.000Z", away: -105, home: -115 },
  ].map((point) => ({ capturedAt: point.at, markets: {
    moneyline: { families: ["circa", "pinnacle"].map((source) => [
      source, "s", source === "circa" ? "c" : "p", null,
      landmark("2026-10-26T18:00:00.000Z", null, -110, -110),
      landmark(point.at, null, point.away, point.home),
    ] as NflForwardContextMarket["families"][number]) },
    spread: { families: [] }, total: { families: [] },
  } })),
  current: { spread: null, total: null }, playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(retracingMoneyline.namedDirection, 1);
assert.equal(retracingMoneyline.trails[0]?.lastEconomicDirection, -1);
const retracingLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { moneyline: retracingMoneyline, spread: { ...noSideState, candidateNamedDirection: null },
    total: { ...noSideState, candidateNamedDirection: null } },
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, homeMargin: 2, moneylineHomeFairProbability: 0.6 },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } }],
  playbookSplits: null,
});
const resolvedRetracement = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 }, ledger: retracingLedger,
});
assert.ok(resolvedRetracement.signalInterpretations.some((item) =>
  item.market === "moneyline" && item.source === "circa" && item.roles.includes("partial_buyback")),
"the real price-only partial retracement reaches the full-game interpretation");
assert.equal(resolvedRetracement.finalHomeMargin, 2,
  "a late retracement is adjudicated by current prices rather than automatically vetoing the net direction");
const opposedRetracementLedger = structuredClone(retracingLedger);
for (const signal of opposedRetracementLedger.signals) {
  if (signal.market === "moneyline" && signal.source === "target_excluded_paired_price_score") {
    signal.value = -4;
    signal.side = "away";
  }
}
const heldRetracement = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 }, ledger: opposedRetracementLedger,
});
assert.equal(heldRetracement.sideStory, "conflicted_market_story");
assert.equal(heldRetracement.finalHomeMargin, -3,
  "a home-directed net move with late buyback and price-implied -3→-4 displacement holds the released score");
assert.ok(heldRetracement.signalInterpretations.some((item) => item.roles.includes("partial_buyback")),
  "holding the score cannot erase the late buyback evidence");

const loneEpisodeWithEarlyTick = (includeEarlyTick: boolean) => buildNflMarketState({
  market: "moneyline", evaluatedAt,
  snapshots: [
    ...(includeEarlyTick ? [{ at: "2026-10-26T19:00:00.000Z", away: -110, home: -109.999 }] : []),
    { at: "2026-10-26T19:50:00.000Z", away: -107, home: -113 },
  ].map((point) => ({ capturedAt: point.at, markets: {
    moneyline: { families: [[
      "circa", "s", "c", null,
      landmark("2026-10-26T18:00:00.000Z", null, -110, -110),
      landmark(point.at, null, point.away, point.home),
    ] as NflForwardContextMarket["families"][number]] },
    spread: { families: [] }, total: { families: [] },
  } })),
  current: { spread: null, total: null }, playbookLine: null, playbookSplits: null, sharpSplits: null,
});
const earlyTickLedgerArgs = (includeEarlyTick: boolean) => ({
  ...ledgerArgs,
  states: { moneyline: loneEpisodeWithEarlyTick(includeEarlyTick),
    spread: { ...noSideState, candidateNamedDirection: null },
    total: { ...noSideState, candidateNamedDirection: null } },
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, homeMargin: 2, moneylineHomeFairProbability: 0.6 },
  forecastCandidates: [{ source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } }],
  playbookSplits: null,
});
const adjudicateEarlyTick = (includeEarlyTick: boolean) => arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: buildNflFullGameEvidenceLedger(earlyTickLedgerArgs(includeEarlyTick)),
});
const withoutEarlyTick = adjudicateEarlyTick(false);
const withEarlyTick = adjudicateEarlyTick(true);
assert.equal(loneEpisodeWithEarlyTick(true).namedDirection, null);
assert.equal(loneEpisodeWithEarlyTick(true).candidateNamedDirection, 1);
assert.ok(loneEpisodeWithEarlyTick(true).trails[0]!.reversalMagnitude > 0);
assert.equal(withEarlyTick.finalHomeMargin, withoutEarlyTick.finalHomeMargin,
  "an early opposite tick cannot silently veto the same independently corroborated current lone-book episode");
assert.equal(withEarlyTick.finalHomeMargin, 2);
assert.equal(withEarlyTick.marketResolutions?.moneyline.corroboratedSingleEpisode, true);
assert.ok(withEarlyTick.signalInterpretations.some((item) => item.roles.includes("reversal")),
  "admitting the current episode does not erase its earlier opposite price path");
const earlyTickWithoutPrice = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: buildNflFullGameEvidenceLedger({ ...earlyTickLedgerArgs(true), forecastCandidates: [] }),
});
assert.equal(earlyTickWithoutPrice.finalHomeMargin, -3,
  "removing the blanket reversal veto cannot authorize an uncorroborated lone-book flip");
const earlyTickAgainstPrice = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: buildNflFullGameEvidenceLedger({ ...earlyTickLedgerArgs(true),
    targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, homeMargin: -4, moneylineHomeFairProbability: 0.4 },
    forecastCandidates: [{ source: "target_excluded_paired_price_score", forecast: { expectedAwayScore: 24, expectedHomeScore: 20 } }],
  }),
});
assert.equal(earlyTickAgainstPrice.finalHomeMargin, -3,
  "a paired-price displacement from -3 toward -4 opposes the home-directed path and prevents the lone-book correction");

const sideAxisOnlyLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    availableMarkets: ["moneyline", "spread"], homeMargin: 2, total: 99 },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    authoritativeMarkets: ["moneyline", "spread"],
    forecast: { expectedAwayScore: 48.5, expectedHomeScore: 50.5 } }],
});
for (const marketName of ["moneyline", "spread"] as const) {
  assert.ok(sideAxisOnlyLedger.signals.some((item) => item.kind === "target_excluded_market" &&
    item.market === marketName && item.status === "usable"));
  assert.ok(sideAxisOnlyLedger.signals.some((item) => item.kind === "forecast_expert" &&
    item.source === "target_excluded_paired_price_score" && item.market === marketName && item.status === "usable" && item.value === 2));
}
const missingTotalSignals = sideAxisOnlyLedger.signals.filter((item) => item.market === "total" &&
  ["target_excluded_market", "forecast_expert"].includes(item.kind));
assert.equal(missingTotalSignals.length, 2);
assert.ok(missingTotalSignals.every((item) => item.status === "unavailable" && item.value === null &&
  item.side === null && item.continuousMagnitude === null && item.observedAt === null),
"a missing Total cohort cannot borrow the coherent score's other axis as market evidence");

const totalAxisOnlyLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    availableMarkets: ["total"], homeMargin: 10, total: 44 },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    authoritativeMarkets: ["total"], forecast: { expectedAwayScore: 17, expectedHomeScore: 27 } }],
});
assert.ok(totalAxisOnlyLedger.signals.some((item) => item.kind === "target_excluded_market" &&
  item.market === "total" && item.status === "usable" && item.value === 44));
assert.ok(totalAxisOnlyLedger.signals.some((item) => item.kind === "forecast_expert" &&
  item.source === "target_excluded_paired_price_score" && item.market === "total" && item.status === "usable" && item.value === 44));
for (const marketName of ["moneyline", "spread"] as const) {
  const missing = totalAxisOnlyLedger.signals.filter((item) => item.market === marketName &&
    ["target_excluded_market", "forecast_expert"].includes(item.kind));
  assert.equal(missing.length, 2);
  assert.ok(missing.every((item) => item.status === "unavailable" && item.value === null && item.side === null),
    `a missing ${marketName} cohort cannot acquire authority from the coherent Total score`);
}
const independentAxesRemainAvailable = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  forecastCandidates: [{ source: "independent_exact_stat", authoritativeMarkets: [],
    forecast: { expectedAwayScore: 17, expectedHomeScore: 27 } }],
});
assert.equal(independentAxesRemainAvailable.signals.filter((item) =>
  item.source === "independent_exact_stat" && item.status === "usable").length, 3,
"market-axis authority restrictions do not mask a separately attributed independent forecast");

const moneylineOnlyAuthority = buildNflFullGameEvidenceLedger({
  ...earlyTickLedgerArgs(true),
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    availableMarkets: ["moneyline"], moneylineFamilyCount: 5, marginFamilyCount: 0, totalFamilyCount: 0,
    homeMargin: 123, total: 999, moneylineHomeFairProbability: 0.6 },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    authoritativeMarkets: ["moneyline"], marketValues: { moneyline: 2 },
    forecast: { expectedAwayScore: 21.5, expectedHomeScore: 23.5 } }],
});
const independentMoneylineCorrection = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 }, ledger: moneylineOnlyAuthority,
});
assert.equal(independentMoneylineCorrection.finalHomeMargin, 2,
  "a genuine Moneyline cohort can correct the winner while Spread and Total cohorts are absent");
assert.equal(independentMoneylineCorrection.finalTotal, 45,
  "a Moneyline-only correction preserves the independent scoring environment");
assert.equal(independentMoneylineCorrection.marketResolutions?.moneyline.corroboratedSingleEpisode, true,
  "Moneyline-specific family provenance does not depend on a missing Spread cohort");
for (const marketName of ["spread", "total"] as const) {
  assert.ok(moneylineOnlyAuthority.signals.filter((item) => item.market === marketName &&
    ["target_excluded_market", "forecast_expert"].includes(item.kind))
    .every((item) => item.status === "unavailable" && item.value === null && item.side === null),
  `the absent ${marketName} cohort remains explicitly unavailable through the correction`);
}

const totalOnlyAuthority = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  states: { moneyline: { ...noSideState, candidateNamedDirection: null },
    spread: { ...noSideState, candidateNamedDirection: null }, total: states.total },
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    availableMarkets: ["total"], moneylineFamilyCount: 0, marginFamilyCount: 0, totalFamilyCount: 5,
    homeMargin: 123, total: 44, totalOverFairProbability: 0.45 },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    authoritativeMarkets: ["total"], marketValues: { total: 44 },
    forecast: { expectedAwayScore: 23.5, expectedHomeScore: 20.5 } }],
  playbookSplits: null,
});
const independentTotalCorrection = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 }, ledger: totalOnlyAuthority,
});
assert.equal(independentTotalCorrection.finalTotal, 44,
  "a genuine Total cohort can change the scoring environment without Moneyline or Spread cohorts");
assert.equal(independentTotalCorrection.finalHomeMargin, -3,
  "a Total-only correction preserves the independent winner and margin");
for (const marketName of ["moneyline", "spread"] as const) {
  assert.ok(totalOnlyAuthority.signals.filter((item) => item.market === marketName &&
    ["target_excluded_market", "forecast_expert"].includes(item.kind))
    .every((item) => item.status === "unavailable" && item.value === null && item.side === null),
  `the absent ${marketName} cohort never acquires authority from a Total-only correction`);
}

const distinctMarketValueLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs,
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    authoritativeMarkets: ["moneyline", "spread", "total"],
    marketValues: { moneyline: 4, spread: -5, total: 50 },
    forecast: { expectedAwayScore: 21, expectedHomeScore: 23 } }],
});
const distinctPriceSignals = distinctMarketValueLedger.signals.filter((item) =>
  item.source === "target_excluded_paired_price_score");
assert.deepEqual(distinctPriceSignals.map((item) => [item.market, item.value, item.side]),
  [["moneyline", 4, "home"], ["spread", -5, "away"], ["total", 50, "over"]],
  "each market retains its own price-implied value and direction rather than borrowing the whole-score axis");

// Prospective semantic controls: movement direction is a displacement, not
// necessarily the final winner/cover/Over category at the evaluated contract.
const semanticSideTotal = 42.3855;
const semanticSideForecast = {
  expectedAwayScore: (semanticSideTotal + 0.729) / 2,
  expectedHomeScore: (semanticSideTotal - 0.729) / 2,
};
const awayMoneylineFlow = { ...split, homeMoneyPct: 20, awayMoneyPct: 80, homeBetsPct: 60, awayBetsPct: 40 };
const semanticSideSnapshots = [{ capturedAt: "2026-10-26T19:50:00.000Z", markets: {
  moneyline: { families: ["circa", "pinnacle"].map((source) => [
    source, "s", source === "circa" ? "c" : "p", null,
    landmark("2026-10-26T18:00:00.000Z", null, 210, -245),
    landmark("2026-10-26T19:50:00.000Z", null, 220, -260),
  ] as NflForwardContextMarket["families"][number]) },
  spread: { families: ["circa", "pinnacle"].map((source) => [
    source, "s", source === "circa" ? "c" : "p", null,
    landmark("2026-10-26T18:00:00.000Z", -5.5, -110, -110),
    landmark("2026-10-26T19:50:00.000Z", -6, -110, -110),
  ] as NflForwardContextMarket["families"][number]) },
  total: { families: [] },
} }];
const semanticSideStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
  buildNflMarketState({ market: name, evaluatedAt, snapshots: semanticSideSnapshots,
    current: { spread: { homeLine: -6.5 }, total: null }, playbookLine: null,
    playbookSplits: { moneyline: awayMoneylineFlow, spread: split, total: split }, sharpSplits: null }),
])) as typeof states;
assert.equal(semanticSideStates.moneyline.namedDirection, 1);
assert.equal(semanticSideStates.spread.namedDirection, 1);
assert.equal(semanticSideStates.moneyline.resistance, "reverse_flow");
const semanticSideLedger = buildNflFullGameEvidenceLedger({
  ...ledgerArgs, finalForecast: semanticSideForecast, currentSpreadBoundary: 6.5,
  states: semanticSideStates,
  targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket,
    availableMarkets: ["moneyline", "spread"], homeMargin: 6.3635,
    moneylineHomeFairProbability: 0.72, spreadHomeFairProbability: 0.49 },
  playbookSplits: { moneyline: awayMoneylineFlow, spread: split, total: split },
  forecastCandidates: [{ source: "target_excluded_paired_price_score",
    authoritativeMarkets: ["moneyline", "spread"], marketValues: { moneyline: 7.2786, spread: 6.3635 },
    forecast: { expectedAwayScore: (semanticSideTotal - 6.3635) / 2,
      expectedHomeScore: (semanticSideTotal + 6.3635) / 2 } }],
});
const semanticSideRead = arbitrateNflFullGameEvidence({ releasedForecast: semanticSideForecast, ledger: semanticSideLedger });
assert.ok(semanticSideRead.finalHomeMargin > 0 && semanticSideRead.finalHomeMargin < 6.5,
  "home-directed ML and Spread movement may correct a narrow away winner while retaining away cover at home -6.5");
assert.ok(Math.abs(semanticSideRead.finalHomeMargin - 6.3635) < 1e-9,
  "the offered-contract Spread implication reconciles home winner with away cover instead of forcing both to home");
assert.ok(Math.abs(semanticSideRead.finalTotal - semanticSideTotal) < 1e-9);
assert.ok(semanticSideRead.signalInterpretations.some((item) => item.market === "moneyline" &&
  item.roles.includes("source_flow_disagreement")),
"opposing qualified moneyline flow remains visible during current-price adjudication");

const descendingTotalSnapshots = [{ capturedAt: "2026-10-26T19:50:00.000Z", markets: {
  moneyline: { families: [] }, spread: { families: [] },
  total: { families: ["circa", "pinnacle"].map((source) => [
    source, "s", source === "circa" ? "c" : "p", null,
    landmark("2026-10-26T18:00:00.000Z", 46.5, -110, -110),
    landmark("2026-10-26T19:50:00.000Z", 43.5, -110, -110),
  ] as NflForwardContextMarket["families"][number]) },
} }];
const descendingTotalStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
  buildNflMarketState({ market: name, evaluatedAt, snapshots: descendingTotalSnapshots,
    current: { spread: null, total: { line: 43.5 } }, playbookLine: null, playbookSplits: null, sharpSplits: null }),
])) as typeof states;
assert.equal(descendingTotalStates.total.namedDirection, -1);
const readDescendingTotal = (independentTotal: number, priceTotal: number) => {
  const releasedForecast = { expectedAwayScore: (independentTotal + 3) / 2,
    expectedHomeScore: (independentTotal - 3) / 2 };
  return arbitrateNflFullGameEvidence({ releasedForecast,
    ledger: buildNflFullGameEvidenceLedger({ ...ledgerArgs, finalForecast: releasedForecast,
      states: descendingTotalStates, currentTotalLine: 43.5,
      targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, availableMarkets: ["total"],
        total: priceTotal, totalOverFairProbability: priceTotal > 43.5 ? 0.51 : 0.49 },
      playbookSplits: null,
      forecastCandidates: [{ source: "target_excluded_paired_price_score", authoritativeMarkets: ["total"],
        marketValues: { total: priceTotal }, forecast: { expectedAwayScore: (priceTotal + 3) / 2,
          expectedHomeScore: (priceTotal - 3) / 2 } }],
    }),
  });
};
const lowerButStillOver = readDescendingTotal(46.6035, 44.1829);
assert.ok(Math.abs(lowerButStillOver.finalTotal - 44.1829) < 1e-9,
  "a downward 46.5→43.5 path can reduce 46.6035 to 44.1829 without forcing the final prediction Under 43.5");
assert.ok(lowerButStillOver.finalTotal > 43.5);
assert.ok(Math.abs(lowerButStillOver.finalHomeMargin + 3) < 1e-9,
  "Total displacement preserves the independent winner and margin");
const underPriceButUpwardDisplacement = readDescendingTotal(40, 42);
assert.ok(Math.abs(underPriceButUpwardDisplacement.finalTotal - 40) < 1e-9,
  "a downward named path cannot increase an independent 40 merely because the paired 42 remains Under 43.5");
const overPriceAndUpwardDisplacement = readDescendingTotal(46.6035, 47);
assert.ok(Math.abs(overPriceAndUpwardDisplacement.finalTotal - 46.6035) < 1e-9,
  "a downward named path cannot authorize upward score displacement on the Over side either");

const awayMovingMoneylineSnapshots = [{ capturedAt: "2026-10-26T19:50:00.000Z", markets: {
  moneyline: { families: ["circa", "pinnacle"].map((source) => [
    source, "s", source === "circa" ? "c" : "p", null,
    landmark("2026-10-26T18:00:00.000Z", null, 220, -260),
    landmark("2026-10-26T19:50:00.000Z", null, 180, -210),
  ] as NflForwardContextMarket["families"][number]) },
  spread: { families: [] }, total: { families: [] },
} }];
const awayMovingMoneylineStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
  buildNflMarketState({ market: name, evaluatedAt, snapshots: awayMovingMoneylineSnapshots,
    current: { spread: null, total: null }, playbookLine: null, playbookSplits: null, sharpSplits: null }),
])) as typeof states;
assert.equal(awayMovingMoneylineStates.moneyline.namedDirection, -1);
const readAwayMovingMoneyline = (priceMargin: number) => arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 19, expectedHomeScore: 27 },
  ledger: buildNflFullGameEvidenceLedger({ ...ledgerArgs,
    finalForecast: { expectedAwayScore: 19, expectedHomeScore: 27 }, states: awayMovingMoneylineStates,
    targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, availableMarkets: ["moneyline"],
      homeMargin: 0, moneylineHomeFairProbability: 0.65, moneylineFamilyCount: 5, marginFamilyCount: 0, totalFamilyCount: 0 },
    playbookSplits: null,
    forecastCandidates: [{ source: "target_excluded_paired_price_score", authoritativeMarkets: ["moneyline"],
      marketValues: { moneyline: priceMargin }, forecast: { expectedAwayScore: (46 - priceMargin) / 2,
        expectedHomeScore: (46 + priceMargin) / 2 } }],
  }),
});
const weakerHomeWinner = readAwayMovingMoneyline(4);
assert.equal(weakerHomeWinner.sideStory, "same_winner_repricing");
assert.equal(weakerHomeWinner.finalHomeMargin, 4,
  "away-directed Moneyline movement can weaken a projected home margin from 8 to 4 while home remains the winner");
assert.equal(weakerHomeWinner.finalTotal, 46);
const strongerHomeAgainstAwayMove = readAwayMovingMoneyline(9);
assert.equal(strongerHomeAgainstAwayMove.finalHomeMargin, 8,
  "an away-directed Moneyline path cannot strengthen the home forecast just because current prices still favor home");

const partialSpreadSnapshots = [
  { capturedAt: "2026-10-26T19:00:00.000Z", markets: {
    moneyline: { families: semanticSideSnapshots[0]!.markets.moneyline.families.map((value) =>
      [value[0], value[1], value[2], value[3], value[4], landmark("2026-10-26T19:00:00.000Z", null, 220, -260)] as NflForwardContextMarket["families"][number]) },
    spread: { families: semanticSideSnapshots[0]!.markets.spread.families.map((value) =>
      [value[0], value[1], value[2], value[3], value[4], landmark("2026-10-26T19:00:00.000Z", -7.5, -110, -110)] as NflForwardContextMarket["families"][number]) },
    total: { families: descendingTotalSnapshots[0]!.markets.total.families.map((value) =>
      [value[0], value[1], value[2], value[3], value[4], landmark("2026-10-26T19:00:00.000Z", 44.5, -110, -110)] as NflForwardContextMarket["families"][number]) },
  } },
  { capturedAt: "2026-10-26T19:50:00.000Z", markets: {
    ...semanticSideSnapshots[0]!.markets, total: descendingTotalSnapshots[0]!.markets.total,
  } },
];
const partialSpreadStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
  buildNflMarketState({ market: name, evaluatedAt, snapshots: partialSpreadSnapshots,
    current: { spread: { homeLine: -6.5 }, total: { line: 43.5 } }, playbookLine: null,
    playbookSplits: { moneyline: awayMoneylineFlow, spread: split, total: split }, sharpSplits: null }),
])) as typeof states;
assert.equal(partialSpreadStates.moneyline.namedDirection, 1);
assert.equal(partialSpreadStates.spread.namedDirection, 1);
assert.equal(partialSpreadStates.spread.trails[0]?.lastEconomicDirection, -1);
assert.ok(partialSpreadStates.spread.trails[0]!.retracementNumberMagnitude! > 0);
const readIndependentSideCohorts = (availableMarkets: Array<"moneyline" | "spread" | "total">) => {
  const releasedTotal = 46.6035;
  const releasedForecast = { expectedAwayScore: (releasedTotal + 0.729) / 2,
    expectedHomeScore: (releasedTotal - 0.729) / 2 };
  const candidateMargin = availableMarkets.includes("moneyline") ? 7.2786
    : availableMarkets.includes("spread") ? 6.3635 : -0.729;
  const candidateTotal = availableMarkets.includes("total") ? 44.1829 : releasedTotal;
  const cohortLedger = buildNflFullGameEvidenceLedger({
    ...ledgerArgs, finalForecast: releasedForecast, states: partialSpreadStates,
    currentSpreadBoundary: 6.5, currentTotalLine: 43.5,
    targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, availableMarkets,
      homeMargin: 6.3635, total: 44.1829, moneylineHomeFairProbability: 0.72,
      spreadHomeFairProbability: 0.49, totalOverFairProbability: 0.51,
      moneylineFamilyCount: availableMarkets.includes("moneyline") ? 5 : 0,
      marginFamilyCount: availableMarkets.includes("spread") ? 5 : 0,
      totalFamilyCount: availableMarkets.includes("total") ? 5 : 0 },
    playbookSplits: { moneyline: awayMoneylineFlow, spread: split, total: split },
    forecastCandidates: [{ source: "target_excluded_paired_price_score", authoritativeMarkets: availableMarkets,
      marketValues: { moneyline: 7.2786, spread: 6.3635, total: 44.1829 },
      forecast: { expectedAwayScore: (candidateTotal - candidateMargin) / 2,
        expectedHomeScore: (candidateTotal + candidateMargin) / 2 } }],
  });
  return { ledger: cohortLedger, read: arbitrateNflFullGameEvidence({ releasedForecast, ledger: cohortLedger }) };
};
const mlWithMissingRetracingSpread = readIndependentSideCohorts(["moneyline"]);
assert.ok(Math.abs(mlWithMissingRetracingSpread.read.finalHomeMargin - 7.2786) < 1e-9,
  "an unavailable Spread price cohort with a late partial buyback cannot veto a genuine Moneyline winner correction");
assert.ok(Math.abs(mlWithMissingRetracingSpread.read.finalTotal - 46.6035) < 1e-9);
assert.ok(mlWithMissingRetracingSpread.ledger.signals.some((item) => item.kind === "book_trail" &&
  item.market === "spread" && item.marketPath?.lastEconomicDirection === -1),
"missing Spread price authority does not erase its observed price path");
const mlAndTotalWithMissingSpread = readIndependentSideCohorts(["moneyline", "total"]);
assert.ok(Math.abs(mlAndTotalWithMissingSpread.read.finalHomeMargin - 7.2786) < 1e-9);
assert.ok(Math.abs(mlAndTotalWithMissingSpread.read.finalTotal - 44.1829) < 1e-9,
  "the same missing Spread cohort cannot veto a separately qualified Total displacement");
const spreadWithMissingMoneyline = readIndependentSideCohorts(["spread"]);
assert.ok(Math.abs(spreadWithMissingMoneyline.read.finalHomeMargin - 6.3635) < 1e-9,
  "a genuine Spread-implied home margin owns the correction even when a Moneyline price cohort is absent");
assert.ok(spreadWithMissingMoneyline.read.finalHomeMargin > 0 && spreadWithMissingMoneyline.read.finalHomeMargin < 6.5);
const noSideCohort = readIndependentSideCohorts(["total"]);
assert.ok(Math.abs(noSideCohort.read.finalHomeMargin + 0.729) < 1e-9,
  "observed named side moves cannot manufacture a margin when neither side price cohort is available");
assert.ok(Math.abs(noSideCohort.read.finalTotal - 44.1829) < 1e-9);
for (const result of [mlWithMissingRetracingSpread, mlAndTotalWithMissingSpread, spreadWithMissingMoneyline, noSideCohort]) {
  for (const missing of ["moneyline", "spread", "total"] as const) {
    const price = result.ledger.signals.find((item) => item.source === "target_excluded_paired_price_score" && item.market === missing)!;
    if (price.status === "unavailable") {
      assert.equal(price.value, null);
      assert.equal(price.side, null);
    }
  }
}

const spreadOnlyCorrection = (independentMargin: number, priceMargin: number, pathDirection: 1 | -1) => {
  const pureSpreadSnapshots = [{ capturedAt: "2026-10-26T19:50:00.000Z", markets: {
    moneyline: { families: [] }, total: { families: [] },
    spread: { families: ["circa", "pinnacle"].map((source) => [
      source, "s", source === "circa" ? "c" : "p", null,
      landmark("2026-10-26T18:00:00.000Z", pathDirection === 1 ? -2 : -3, -110, -110),
      landmark("2026-10-26T19:50:00.000Z", pathDirection === 1 ? -3 : -2, -110, -110),
    ] as NflForwardContextMarket["families"][number]) },
  } }];
  const pureSpreadStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((name) => [name,
    buildNflMarketState({ market: name, evaluatedAt, snapshots: pureSpreadSnapshots,
      current: { spread: { homeLine: -2.5 }, total: null }, playbookLine: null, playbookSplits: null, sharpSplits: null }),
  ])) as typeof states;
  const releasedForecast = { expectedAwayScore: (45 - independentMargin) / 2,
    expectedHomeScore: (45 + independentMargin) / 2 };
  return arbitrateNflFullGameEvidence({ releasedForecast,
    ledger: buildNflFullGameEvidenceLedger({ ...ledgerArgs,
      finalForecast: releasedForecast, currentSpreadBoundary: 2.5, states: pureSpreadStates,
      targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, availableMarkets: ["spread"],
        homeMargin: priceMargin, marginFamilyCount: 5, moneylineFamilyCount: 0, totalFamilyCount: 0 },
      playbookSplits: null,
      forecastCandidates: [{ source: "target_excluded_paired_price_score", authoritativeMarkets: ["spread"],
        marketValues: { spread: priceMargin }, forecast: { expectedAwayScore: (45 - priceMargin) / 2,
          expectedHomeScore: (45 + priceMargin) / 2 } }],
    }),
  });
};
for (const [independentMargin, priceMargin, pathDirection] of [[2, 4, 1], [8, 4, -1], [-3, 2, 1], [0, 2, 1]] as const) {
  const read = spreadOnlyCorrection(independentMargin, priceMargin, pathDirection);
  assert.ok(Math.abs(read.finalHomeMargin - priceMargin) < 1e-9,
    `Spread-only priced displacement ${independentMargin}→${priceMargin} must own its margin without a Moneyline cohort`);
  assert.ok(Math.abs(read.finalTotal - 45) < 1e-9,
    "Spread-only strengthening, weakening, winner crossing and tie resolution preserve a missing Total axis");
}
const staticMoneylineCannotOwnSpread = arbitrateNflFullGameEvidence({
  releasedForecast: { expectedAwayScore: 24, expectedHomeScore: 21 },
  ledger: buildNflFullGameEvidenceLedger({ ...ledgerArgs,
    states: { moneyline: emptyAxisStates.moneyline, spread: states.spread, total: emptyAxisStates.total },
    targetExcludedMarket: { ...ledgerArgs.targetExcludedMarket, availableMarkets: ["moneyline", "spread"],
      homeMargin: -2, moneylineHomeFairProbability: 0.8, moneylineFamilyCount: 5, marginFamilyCount: 5 },
    playbookSplits: null,
    forecastCandidates: [{ source: "target_excluded_paired_price_score", authoritativeMarkets: ["moneyline", "spread"],
      marketValues: { moneyline: 7, spread: -2 }, forecast: { expectedAwayScore: 23.5, expectedHomeScore: 21.5 } }],
  }),
});
assert.equal(staticMoneylineCannotOwnSpread.finalHomeMargin, -2,
  "a home-directed Spread path weakens away -3→-2; a static Moneyline +7 cannot lend its untriggered coordinate to force a home flip");
assert.equal(staticMoneylineCannotOwnSpread.finalTotal, 45);

console.log("NFL full-game evidence ledger tests passed");
