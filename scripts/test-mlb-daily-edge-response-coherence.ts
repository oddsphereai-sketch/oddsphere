import assert from "node:assert/strict";

import {
  auditDailyEdgeResponseCoherence,
  finalizeDailyEdgeResponseCoherence,
} from "../app/lab/lib/dailyEdgeResponseCoherence";
import type { DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";

function market(overrides: Partial<MarketEdgeDto> = {}): MarketEdgeDto {
  return {
    pick: "Under",
    confidence: 0.54,
    grade: "LEAN",
    signalType: null,
    marketSignal: null,
    sharpStatus: "neutral",
    held: false,
    verdict: { key: "lean", label: "Lean" },
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: 0.54,
    marketFairProb: 0.51,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: -110,
    gradePriceAmerican: -110,
    currentPriceAmerican: -108,
    currentPriceSportsbook: "onexbet",
    currentPriceObservedAt: "2026-08-25T11:45:00.000Z",
    lineOpenAmerican: null,
    oddsTrail: [{ american: -108, line: 8.5, observedAt: "2026-08-25T11:45:00.000Z", sportsbook: "onexbet", source: "current_line", label: "current" }],
    lineTrail: [{ american: -108, line: 8.5, observedAt: "2026-08-25T11:45:00.000Z", sportsbook: "onexbet", source: "current_line", label: "current" }],
    opposingOddsTrail: {
      side: "over",
      label: "Over",
      stops: [{ american: -101, line: 8.5, observedAt: "2026-08-25T11:45:00.000Z", sportsbook: "onexbet", source: "current_line", label: "current" }],
    },
    marketReadV2: {
      label: "Market support",
      score: 2,
      tone: "emerald",
      explanation: "Old movement read",
      copyMode: "context_only_not_pick_changing",
      exactLineEvidenceStatus: "exact",
      evidenceAsOf: "2026-08-25T11:40:00.000Z",
      generatedAt: "2026-08-25T11:40:00.000Z",
      validityStatus: "valid_directional",
      movement: {
        firstTrackedLine: 8,
        firstTrackedPrice: -110,
        currentLine: 6.5,
        currentPrice: -110,
        directionRelativeToPick: "support",
        observedAt: "2026-08-25T11:40:00.000Z",
      },
      consensus: null,
      sourceSummary: { priceAction: "old", playbookConsensus: null, sharpApiSourceSpecific: null, sharpMoney: null },
    },
    marketReadV2Enabled: true,
    modelTotal: 7.9,
    marketTotal: 8.5,
    line: 8.5,
    keyStats: [],
    modelTrustPct: 54,
    marketImpliedPct: 51,
    modelMarketGapPct: 3,
    recommendationConfidence: 60,
    marketDataQuality: "complete",
    recommendationDecision: null,
    ...overrides,
  } as MarketEdgeDto;
}

function response(total = market(), extraTotal: MarketEdgeDto | null = null): DailyEdgeResponse {
  const game = (id: string, totalMarket: MarketEdgeDto) => {
    const moneyline = market({ pick: "ATL", line: null, marketTotal: null, modelTotal: null, marketReadV2: null, oddsTrail: [], lineTrail: [], opposingOddsTrail: null });
    const firstInning = market({ pick: "Toss-Up", line: 0.5, marketTotal: 0.5, modelTotal: 0.48, marketReadV2: null, oddsTrail: [], lineTrail: [], opposingOddsTrail: null });
    return {
      id,
      sport: "mlb" as const,
      external_id: Number(id.replace(/\D/g, "")) || 1,
      awayTeam: "LAD",
      awayTeamLogo: null,
      homeTeam: "ATL",
      homeTeamLogo: null,
      gameTime: "7:10 PM",
      gameStartMinutes: 1150,
      scheduledLockAt: "2026-08-25T22:10:00.000Z",
      lockState: "open" as const,
      lockedAt: null,
      updatedAt: null,
      generatedAt: null,
      holdReason: null,
      homeStarter: null,
      awayStarter: null,
      predictions: {} as never,
      markets: { moneyline, total: totalMarket, first_inning: firstInning },
      decisionLine: "",
      projected: { away: 4, home: 3 },
      sharpSignals: [],
      status: {} as never,
      result: null,
      breakdown: {} as never,
    };
  };
  return {
    as_of: "2026-08-25T11:45:46.320Z",
    sport: "mlb",
    date: "2026-08-25",
    requested_date: "2026-08-25",
    fallback_used: false,
    slateState: "today_published",
    slate_status: "published",
    last_slate_update_at: null,
    games: [game("mlb-5059756", total), ...(extraTotal ? [game("mlb-5059757", extraTotal)] : [])],
  };
}

const staleContradiction = response();
const originalDecision = {
  pick: staleContradiction.games[0]!.markets.total.pick,
  probability: staleContradiction.games[0]!.markets.total.modelProb,
  grade: staleContradiction.games[0]!.markets.total.grade,
  evaluatedPrice: staleContradiction.games[0]!.markets.total.gradePriceAmerican,
};
finalizeDailyEdgeResponseCoherence(staleContradiction);
const repaired = staleContradiction.games[0]!.markets.total;
assert.equal(repaired.marketReadV2?.movement?.currentLine, 8.5, "stale 6.5 movement must resolve to selected 8.5");
assert.equal(repaired.marketReadV2?.movement?.currentPrice, -108, "movement must resolve to the current selected quote");
assert.equal(repaired.marketReadV2?.movement?.firstTrackedLine, null, "incompatible opening movement must be withheld");
assert.equal(repaired.marketReadV2?.validityStatus, "valid_nondirectional", "repaired movement cannot retain a directional claim");
assert.equal(repaired.evidenceCoherence?.status, "limited");
assert.deepEqual({
  pick: repaired.pick,
  probability: repaired.modelProb,
  grade: repaired.grade,
  evaluatedPrice: repaired.gradePriceAmerican,
}, originalDecision, "display repair must not alter the prediction/grade tuple");
assert.deepEqual(auditDailyEdgeResponseCoherence(staleContradiction), [], "repaired response must pass the read-only audit");

const wrongTrail = market({
  oddsTrail: [{ american: -120, line: 7.5, observedAt: null, sportsbook: "otherbook", source: "current_line", label: "current" }],
});
const coherentPeer = market({
  marketReadV2: null,
  sharpBookAvailability: { status: "pending", message: "Awaiting provider data", lastUpdated: null },
});
const mixedSlate = response(wrongTrail, coherentPeer);
finalizeDailyEdgeResponseCoherence(mixedSlate);
assert.equal(mixedSlate.games.length, 2, "one contradictory market must not suppress the slate");
assert.deepEqual(mixedSlate.games[0]!.markets.total.oddsTrail, [], "the incompatible trail must fail closed per market");
assert.equal(mixedSlate.games[0]!.markets.total.evidenceCoherence?.status, "limited");
assert.equal(mixedSlate.games[1]!.markets.total.evidenceCoherence?.status, "coherent", "the coherent peer market must remain publishable");
assert.equal(mixedSlate.games[1]!.markets.total.oddsTrail?.length, 1, "the coherent peer evidence must remain intact");
assert.deepEqual(auditDailyEdgeResponseCoherence(mixedSlate), []);

const sharpFallback = response(market({
  sharpBookAvailability: undefined,
  recommendationDecision: undefined,
}));
finalizeDailyEdgeResponseCoherence(sharpFallback);
assert.equal(sharpFallback.games[0]!.markets.total.sharpBookAvailability?.status, "pending");
assert.equal(sharpFallback.games[0]!.markets.first_inning.sharpBookAvailability?.status, "unavailable");

console.log("MLB Daily Edge response coherence: PASS");
