import assert from "node:assert/strict";

import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import type { NflForwardContextMarket } from "../lib/services/football/nflForwardEvidenceCapture";
import type { NflForwardPlaybookSplit } from "../lib/services/football/nflForwardEvidence";
import type { NflRegularSharpSplit } from "../lib/services/football/sharpApiNflSplits";
import {
  applyNflUnifiedTotalMarketInterpreter,
  NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE,
  NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE,
} from "../lib/services/football/nflUnifiedTotalMarketInterpreter";
import {
  buildNflIndependentScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
} from "../lib/services/football/nflV1WeekOneOutcome";

const evaluatedAt = "2026-10-25T16:00:00.000Z";
const independent = buildNflIndependentScoreBaseForecast({
  baseForecast: getNflV1WeekOneOutcomeForecast({
    providerGameId: "unified-total-test",
    awayTeam: "AWY",
    homeTeam: "HME",
    weeklyFallback: { projectedHomeMargin: 3, marketTotal: 44 },
  }),
  independentScore: {
    expectedHomeMargin: 3,
    expectedTotal: 44,
    marketInputPolicy: "prohibited_from_independent_score",
  },
});
const current: NflPreviewBookOdds = {
  providerGameId: "unified-total-test",
  sportsbook: "fanduel",
  observedAt: "2026-10-25T15:55:00.000Z",
  moneyline: { awayPrice: 120, homePrice: -140 },
  spread: { awayLine: 3, homeLine: -3, awayPrice: -110, homePrice: -110 },
  total: { line: 47, overPrice: -108, underPrice: -112 },
};
const namedTotalFamilies: NflForwardContextMarket["families"] = [
  ["circa", "s", "c", null,
    ["2026-10-25T14:00:00.000Z", 120, "f", 45, -110, -110],
    ["2026-10-25T15:45:00.000Z", 15, "f", 47, -108, -112]],
  ["draftkings", "b", "b", null,
    ["2026-10-25T14:00:00.000Z", 120, "f", 45, -110, -110],
    ["2026-10-25T15:45:00.000Z", 15, "f", 46.5, -105, -115]],
];
const excludedTargetFamily: NflForwardContextMarket["families"][number] =
  ["fanduel", "b", "b", null,
    ["2026-10-25T14:00:00.000Z", 120, "f", 45, -110, -110],
    ["2026-10-25T15:45:00.000Z", 15, "f", 60, -200, 160]];

const apply = (families: NflForwardContextMarket["families"],
  overrides: Partial<Parameters<typeof applyNflUnifiedTotalMarketInterpreter>[0]> = {}) => applyNflUnifiedTotalMarketInterpreter({
  forecast: independent,
  independentForecast: independent,
  evaluatedAt,
  gameStartsAt: "2026-10-25T16:55:00.000Z",
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: [] },
      spread: { families: [] },
      total: { families },
    },
  }],
  current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  excludedFamilies: ["fanduel"],
  targetExcludedAnchor: {
    total: 47,
    totalOverFairProbability: 0.505,
    totalFamilyCount: 5,
  },
  ...overrides,
});

const interpreted = apply([...namedTotalFamilies, excludedTargetFamily]);
const withoutExcludedTarget = apply(namedTotalFamilies);
const interpretation = interpreted.unifiedTotalMarketInterpreter;
assert.ok(interpretation);
assert.equal(interpretation.release, NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE);
assert.equal(interpretation.artifactRelease, NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE);
assert.equal(interpretation.evidencePolicy, "target_excluded_continuous_residual");
assert.equal(interpretation.status, "applied");
assert.equal(interpretation.reason, "qualified_t60_support");
assert.ok(Math.abs(interpretation.independentTotal - 44) < 1e-6);
assert.equal(interpretation.marketTotal, 47);
assert.ok(Math.abs(
  interpreted.expectedHomeScore + interpreted.expectedAwayScore - interpretation.finalTotal,
) < 1e-9, "the public score must equal the interpreted Total center");
assert.ok(Math.abs(
  interpreted.expectedHomeScore - interpreted.expectedAwayScore - 3,
) < 1e-9, "the Total reader must preserve the qualified side margin");
assert.ok(Math.abs(
  (withoutExcludedTarget.expectedHomeScore + withoutExcludedTarget.expectedAwayScore) - interpretation.finalTotal,
) < 1e-9, "the evaluated sportsbook cannot influence its own Total forecast");
assert.ok(interpreted.totalDistribution.probabilities.every((probability) => probability >= 0));
assert.ok(Math.abs(interpreted.totalDistribution.probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);

// The T-60 regression consumes features after market-state qualification. Raw
// retained split rows must not bypass the same source-clock/contract rules.
const publicSplit: NflForwardPlaybookSplit = {
  provider: "playbook", capturedAt: "2026-10-25T15:50:00.000Z", booksUsed: 6,
  homeMoneyPct: 50, awayMoneyPct: 50, homeBetsPct: 50, awayBetsPct: 50,
  overMoneyPct: 90, underMoneyPct: 10, overBetsPct: 10, underBetsPct: 90,
};
const publicSet = (row: NflForwardPlaybookSplit) => ({ moneyline: row, spread: row, total: row });
const publicLine = {
  provider: "playbook" as const, capturedAt: publicSplit.capturedAt, sourceTier: null,
  homeSpread: -3, awaySpread: 3, homeMoneyline: -140, awayMoneyline: 120, total: 47,
};
const noFlow = apply(namedTotalFamilies);
const rejectsPublic = (label: string, row: NflForwardPlaybookSplit, line = publicLine) => {
  const result = apply(namedTotalFamilies, { playbookLine: line, playbookSplits: publicSet(row) });
  assert.equal(result.unifiedTotalMarketInterpreter?.featureValues.playbook_total_gap, 0, label);
  assert.equal(result.unifiedTotalMarketInterpreter?.finalTotal,
    noFlow.unifiedTotalMarketInterpreter?.finalTotal, `${label}: rejected flow cannot change the Total`);
  assert.deepEqual(result.totalDistribution, noFlow.totalDistribution,
    `${label}: rejected flow cannot change prediction probabilities`);
};
rejectsPublic("30-hour retained public flow is stale at T-60", {
  ...publicSplit, capturedAt: "2026-10-24T10:00:00.000Z",
});
rejectsPublic("future public flow cannot direct an earlier evaluation", {
  ...publicSplit, capturedAt: "2026-10-25T16:01:00.000Z",
});
rejectsPublic("off-line public flow cannot direct the selected Total", publicSplit,
  { ...publicLine, total: 47.5 });
const missingPublicLine = apply(namedTotalFamilies, { playbookLine: null, playbookSplits: publicSet(publicSplit) });
assert.equal(missingPublicLine.unifiedTotalMarketInterpreter?.featureValues.playbook_total_gap, 0,
  "public flow without a verified source line cannot be assigned to the current contract");
const freshPublic = apply(namedTotalFamilies, { playbookLine: publicLine, playbookSplits: publicSet(publicSplit) });
assert.equal(freshPublic.unifiedTotalMarketInterpreter?.featureValues.playbook_total_gap, 0.8);
assert.notEqual(freshPublic.unifiedTotalMarketInterpreter?.finalTotal, noFlow.unifiedTotalMarketInterpreter?.finalTotal,
  "fresh exact-contract flow reaches the actual score path");
const smallPublic = apply(namedTotalFamilies, {
  playbookLine: publicLine, playbookSplits: publicSet({ ...publicSplit, overMoneyPct: 51, overBetsPct: 50 }),
});
assert.equal(smallPublic.unifiedTotalMarketInterpreter?.featureValues.playbook_total_gap, 0.01,
  "qualification must preserve small genuine flow rather than add a magnitude gate");

const sharpSplit: NflRegularSharpSplit = {
  ...publicSplit, provider: "owls", providerGameId: current.providerGameId,
  sourceEventId: "verified-event", sourceSportsbook: "circa", sourceLine: 47,
  providerFetchedAt: "2026-10-25T15:45:00.000Z",
};
const sharpSet = (row: NflRegularSharpSplit) => ({ moneyline: row, spread: row, total: row });
const rejectsSharp = (label: string, row: NflRegularSharpSplit) => {
  const result = apply(namedTotalFamilies, { sharpSplits: sharpSet(row) });
  assert.equal(result.unifiedTotalMarketInterpreter?.featureValues.sharp_total_gap, 0, label);
  assert.equal(result.unifiedTotalMarketInterpreter?.finalTotal,
    noFlow.unifiedTotalMarketInterpreter?.finalTotal, `${label}: rejected flow cannot change the Total`);
};
rejectsSharp("a fresh retrieval cannot refresh a 30-hour-old provider observation", {
  ...sharpSplit, providerFetchedAt: "2026-10-24T10:00:00.000Z",
});
rejectsSharp("future sharp observation is unavailable", {
  ...sharpSplit, providerFetchedAt: "2026-10-25T16:01:00.000Z",
});
rejectsSharp("the evaluated sportsbook cannot direct its own Total", { ...sharpSplit, sourceSportsbook: "FanDuel" });
rejectsSharp("sharp flow at a different line is context only", { ...sharpSplit, sourceLine: 47.5 });
rejectsSharp("unknown sharp source line cannot direct the selected contract", { ...sharpSplit, sourceLine: null });
rejectsSharp("unknown sharp sportsbook cannot establish target exclusion", { ...sharpSplit, sourceSportsbook: null });
const freshSharp = apply(namedTotalFamilies, { sharpSplits: sharpSet(sharpSplit) });
assert.equal(freshSharp.unifiedTotalMarketInterpreter?.featureValues.sharp_total_gap, 0.8);
assert.notEqual(freshSharp.unifiedTotalMarketInterpreter?.finalTotal, noFlow.unifiedTotalMarketInterpreter?.finalTotal);
const smallSharp = apply(namedTotalFamilies, { sharpSplits: sharpSet({ ...sharpSplit, overMoneyPct: 51, overBetsPct: 50 }) });
assert.equal(smallSharp.unifiedTotalMarketInterpreter?.featureValues.sharp_total_gap, 0.01,
  "a small fresh sharp gap remains a continuous feature");

const outsideFrozenT60 = applyNflUnifiedTotalMarketInterpreter({
  forecast: independent,
  independentForecast: independent,
  evaluatedAt,
  gameStartsAt: "2026-10-25T20:00:00.000Z",
  snapshots: [],
  current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  excludedFamilies: ["fanduel"],
  targetExcludedAnchor: { total: 47, totalOverFairProbability: 0.505, totalFamilyCount: 5 },
});
assert.equal(outsideFrozenT60.unifiedTotalMarketInterpreter?.status, "unavailable");
assert.equal(outsideFrozenT60.unifiedTotalMarketInterpreter?.reason, "outside_frozen_t60_support");
assert.ok(Math.abs(outsideFrozenT60.expectedHomeScore + outsideFrozenT60.expectedAwayScore - 44) < 1e-6,
  "the T-60 artifact must remain neutral outside its frozen timing support");

console.log("NFL unified Total market interpreter: continuous residual, target exclusion, and score coherence passed");
