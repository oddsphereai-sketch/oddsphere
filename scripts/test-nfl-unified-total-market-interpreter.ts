import assert from "node:assert/strict";

import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import type { NflForwardContextMarket } from "../lib/services/football/nflForwardEvidenceCapture";
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

const apply = (families: NflForwardContextMarket["families"]) => applyNflUnifiedTotalMarketInterpreter({
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
