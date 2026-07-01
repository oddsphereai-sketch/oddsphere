import assert from "node:assert/strict";
import {
  buildAiAuditorCompactPayload,
  buildAiAuditorCostPreview,
  auditPayloadHash,
} from "@/lib/services/aiAuditor/costPreview";
import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";

function market(overrides: Partial<MarketEdgeDto> = {}): MarketEdgeDto {
  return {
    pick: "CWS",
    confidence: 0.6,
    grade: "A",
    signalType: null,
    marketSignal: null,
    sharpStatus: "neutral",
    held: false,
    verdict: { key: "lean", label: "Lean" },
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: 60,
    marketFairProb: 53,
    pinnacleEvPct: null,
    moneyPct: 66,
    betsPct: 62,
    publicSplits: [],
    priceAmerican: -120,
    lineOpenAmerican: -110,
    marketSource: "consensus",
    marketDataQuality: "two_sided_consensus",
    reviewFlags: [],
    reviewActionSummary: "keep",
    modelTotal: null,
    marketTotal: null,
    line: null,
    keyStats: [],
    modelTrustPct: 60,
    marketImpliedPct: 53,
    modelMarketGapPct: 7,
    recommendationDecision: {
      market: "moneyline",
      pick: "CWS",
      modelProbabilityPct: 60,
      marketProbabilityPct: 53,
      modelEdgePp: 7,
      playGrade: "Lean",
      quickRead: "Mixed market signals: consensus supports CWS while sharp-book signal shows resistance.",
      resolvedMarketRead: {
        status: "mixed",
        label: "Mixed",
        tone: "amber",
        copy: "Consensus support conflicts with sharp-book resistance.",
      },
      sourceConflict: true,
      reasonCodes: ["source_conflict"],
      consensusSplits: {
        label: "Consensus Splits",
        rows: [
          { side: "away", label: "CWS", moneyPct: 66, betsPct: 62 },
          { side: "home", label: "KC", moneyPct: 34, betsPct: 38 },
        ],
      },
      sharpBookSplits: {
        label: "Sharp Book Signal",
        summary: "Sharp-book signal shows resistance.",
        rows: [],
      },
    },
    ...overrides,
  } as MarketEdgeDto;
}

const game = {
  id: "mlb-1",
  sport: "mlb",
  external_id: 1,
  awayTeam: "CWS",
  awayTeamLogo: null,
  homeTeam: "KC",
  homeTeamLogo: null,
  gameTime: "7:10 PM",
  gameStartMinutes: 19 * 60 + 10,
  scheduledLockAt: "2026-06-28T22:10:00.000Z",
  lockState: "open",
  lockedAt: null,
  updatedAt: "2026-06-28T12:00:00.000Z",
  generatedAt: null,
  holdReason: null,
  homeStarter: null,
  awayStarter: null,
  predictions: {} as DailyEdgeGameDto["predictions"],
  markets: {
    moneyline: market(),
    total: market({ pick: "Over", line: 8.5 }),
    first_inning: market({ pick: "NRFI" }),
  },
  recommendationDecision: {
    gameId: "mlb-1",
    sourceState: {
      consensusSplitsAvailable: true,
      sharpBookSplitsAvailable: true,
      staleSources: [],
      missingExpectedSources: [],
      sourceConflict: true,
    },
    markets: {} as never,
  } as unknown as DailyEdgeGameDto["recommendationDecision"],
  decisionLine: "Lean CWS",
  projected: { away: 4.6, home: 4.1 },
  sharpSignals: [],
  status: { state: "scheduled", label: "Scheduled" },
  result: null,
  breakdown: {} as DailyEdgeGameDto["breakdown"],
} as unknown as DailyEdgeGameDto;

const response = {
  as_of: "2026-06-28T12:00:00.000Z",
  sport: "mlb",
  date: "2026-06-28",
  requested_date: "2026-06-28",
  fallback_used: false,
  slateState: "today_published",
  slate_status: "published",
  last_slate_update_at: "2026-06-28T12:00:00.000Z",
  games: [game],
} as DailyEdgeResponse;

const payload = buildAiAuditorCompactPayload({
  response,
  game,
  markets: ["moneyline", "total", "first_inning"],
  oneCallPerGameCard: true,
});
const hash = auditPayloadHash(payload);
assert.equal(payload.guardrails.noMemberFacingChanges, true);
assert.equal(payload.guardrails.noPostgameResultsIncluded, true);
assert.equal(payload.markets.length, 3);
assert.equal(typeof hash, "string");
assert.equal(hash.length, 64);

process.env.AI_AUDITOR_COST_PREVIEW_ONLY = "true";
const preview = buildAiAuditorCostPreview({
  sport: "mlb",
  from: "2026-06-28",
  to: "2026-06-28",
  markets: ["moneyline", "total", "first_inning"],
  refreshesPerDay: 8,
  miniEscalationRates: [0.05, 0.1, 0.2],
  skipUnchangedPayloads: true,
  oneCallPerGameCard: true,
  includePeakSlateAssumptions: true,
  payloadsByDate: [{ date: "2026-06-28", response }],
  existingPayloadHashes: new Set([hash]),
});
assert.equal(preview.noOpenAiCalls, true);
assert.equal(preview.gameCardPayloadsBuilt, 1);
assert.equal(preview.estimatedAiCalls, 0);
assert.equal(preview.estimatedCacheSkips, 1);
assert.equal(preview.payloads[0]?.skipReason, "audit_payload_hash_seen");

process.env.AI_AUDITOR_COST_PREVIEW_ONLY = "false";
assert.throws(() => buildAiAuditorCostPreview({
  sport: "mlb",
  from: "2026-06-28",
  to: "2026-06-28",
  markets: ["moneyline"],
  refreshesPerDay: 1,
  miniEscalationRates: [0.1],
  skipUnchangedPayloads: true,
  oneCallPerGameCard: true,
  includePeakSlateAssumptions: false,
  payloadsByDate: [{ date: "2026-06-28", response }],
}), /AI_AUDITOR_COST_PREVIEW_ONLY=true/);

console.log("✓ AI auditor cost preview payload/hash/cost guard tests passed");
