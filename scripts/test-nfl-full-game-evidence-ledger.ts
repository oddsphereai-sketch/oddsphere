import assert from "node:assert/strict";

import {
  arbitrateNflFullGameEvidence,
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

const ledger = buildNflFullGameEvidenceLedger({
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
});

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
assert.equal(arbitration.finalTotal, 45, "conflicted evidence preserves the released total");
assert.ok(Math.abs(arbitration.expectedAwayScore + arbitration.expectedHomeScore - arbitration.finalTotal) < 1e-9);

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
