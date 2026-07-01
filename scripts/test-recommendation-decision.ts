import { buildRecommendationDecision } from "../lib/services/recommendationDecision";
import { buildEdgeStackRows } from "../app/lab/lib/edgeStackRows";
import type { MarketEdgeDto } from "../app/lab/lib/labTypes";
import type { MarketReadV2Dto } from "../lib/types/domain/MarketIntelligenceV2";

let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else {
    fail++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function read(opts: {
  consensusMoney?: number;
  consensusBets?: number;
  sharp?: "support" | "resistance" | null;
  move?: "support" | "resistance" | "neutral";
}): MarketReadV2Dto {
  return {
    label: "Market Support",
    score: 2,
    tone: "emerald",
    explanation: "Market context.",
    copyMode: "context_only_not_pick_changing",
    exactLineEvidenceStatus: "ok",
    evidenceAsOf: "2026-06-28T16:00:00.000Z",
    generatedAt: "2026-06-28T16:00:00.000Z",
    validityStatus: "valid_directional",
    movement: {
      firstTrackedLine: null,
      firstTrackedPrice: -110,
      currentLine: null,
      currentPrice: -120,
      directionRelativeToPick: opts.move ?? "neutral",
      observedAt: "2026-06-28T16:00:00.000Z",
    },
    consensus: {
      moneyPct: opts.consensusMoney ?? null,
      betsPct: opts.consensusBets ?? null,
      booksUsed: 9,
      lineBasis: "provider_explicit",
    },
    sourceSummary: {
      priceAction: null,
      playbookConsensus: "Consensus: 66% money / 62% bets.",
      sharpApiSourceSpecific: null,
      sharpMoney: opts.sharp === "support"
        ? "Sharp Money: sharp-book price action moved with our pick."
        : opts.sharp === "resistance"
          ? "Sharp Money: sharp-book price action moved against our pick."
          : null,
    },
  };
}

const baseMarket = {
  key: "moneyline" as const,
  pick: "CWS",
  selectedSide: "away" as const,
  modelProbability: 0.58,
  marketImplied: 52,
  edgePp: 6,
  price: -110,
  playGrade: "Lean",
  quickRead: "CWS has a playable model edge.",
  riskNote: "Watch price drift.",
  publicSplits: [
    { side: "away" as const, label: "CWS", moneyPct: 66, betsPct: 62, observedAt: "2026-06-28T16:00:00.000Z" },
    { side: "home" as const, label: "KC", moneyPct: 34, betsPct: 38, observedAt: "2026-06-28T16:00:00.000Z" },
  ],
  marketReadV2Enabled: true,
};

const aligned = buildRecommendationDecision({
  sport: "mlb",
  slateDate: "2026-06-28",
  gameId: "game-1",
  homeTeam: "KC",
  awayTeam: "CWS",
  markets: [{ ...baseMarket, playGrade: "Best Angle", marketReadV2: read({ consensusMoney: 0.66, consensusBets: 0.62, sharp: "support", move: "support" }) }],
});
check("MLB both sources renders consensus", aligned.markets.moneyline?.consensusSplits?.label === "Consensus Splits");
check("MLB sharp resistance without bars renders sharp book signal", aligned.markets.moneyline?.sharpBookSplits?.label === "Sharp Book Signal");
check("Aligned market read supports Best Angle", aligned.markets.moneyline?.resolvedMarketRead.status === "aligned");

const mixed = buildRecommendationDecision({
  sport: "mlb",
  slateDate: "2026-06-28",
  gameId: "game-2",
  homeTeam: "KC",
  awayTeam: "CWS",
  markets: [{ ...baseMarket, playGrade: "Best Angle", marketReadV2: read({ consensusMoney: 0.66, consensusBets: 0.62, sharp: "resistance", move: "support" }) }],
});
check("Consensus support plus sharp resistance is mixed", mixed.markets.moneyline?.resolvedMarketRead.status === "mixed");
check("Best Angle with mixed source state is capped", mixed.markets.moneyline?.playGrade !== "Best Angle");
check("Mixed quick read names conflict", mixed.markets.moneyline?.quickRead.toLowerCase().includes("mixed market signals") === true);
check("Source conflict tracked", mixed.sourceState.sourceConflict === true);
const mixedEdgeRows = buildEdgeStackRows("moneyline", {
  pick: "CWS",
  pinnacleEvPct: null,
  modelProb: 0.6,
  marketFairProb: null,
  marketImpliedPct: 54,
  modelMarketGapPct: 6,
  marketDataQuality: "two_sided_consensus",
  marketSource: "consensus",
  publicSplits: baseMarket.publicSplits,
  moneyPct: 66,
  betsPct: 62,
  lineOpenAmerican: -110,
  priceAmerican: -120,
  lastMoveLinePrev: null,
  lastMoveLineNext: null,
  marketReadV2Enabled: true,
  marketReadV2: null,
  recommendationDecision: mixed.markets.moneyline,
} as unknown as MarketEdgeDto);
check("Supporting Evidence includes Consensus Splits", mixedEdgeRows.some((r) => r.label === "Consensus Splits"));
check("Supporting Evidence includes Sharp Book Signal", mixedEdgeRows.some((r) => r.label === "Sharp Book Signal"));
check("Supporting Evidence shows Mixed Market Read", mixedEdgeRows.some((r) => r.label === "Market Read" && r.evidence.includes("Mixed")));

const wnba = buildRecommendationDecision({
  sport: "wnba",
  slateDate: "2026-06-28",
  gameId: "game-3",
  homeTeam: "NY",
  awayTeam: "LV",
  markets: [{ ...baseMarket, pick: "LV", playGrade: "Lean", marketReadV2: read({ consensusMoney: 0.61, consensusBets: 0.59, sharp: null }) }],
});
check("WNBA consensus-only omits sharp book section", wnba.markets.moneyline?.sharpBookSplits === null);
check("WNBA consensus-only resolves consensus support", wnba.markets.moneyline?.resolvedMarketRead.status === "consensus_support");
check("No provider names in canonical decision", !JSON.stringify(wnba).match(/\b(Playbook|SharpAPI)\b/));

const noEdge = buildRecommendationDecision({
  sport: "mlb",
  slateDate: "2026-06-28",
  gameId: "game-4",
  homeTeam: "KC",
  awayTeam: "CWS",
  markets: [{ ...baseMarket, edgePp: 0.4, playGrade: "No Play", marketReadV2: read({ consensusMoney: 0.51, consensusBets: 0.50, sharp: null }) }],
});
check("No Play can be used with present data", noEdge.markets.moneyline?.playGrade === "No Play" && noEdge.markets.moneyline.consensusSplits !== null);

if (fail > 0) process.exit(1);
console.log("\nAll recommendation decision tests passed.");
