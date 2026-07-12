import { applyMlbSameDayGradeGuardrail } from "@/lib/services/dailyEdge/mlbSameDayGradeGuardrails";
import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";

function baseMarket(overrides: Partial<MarketEdgeDto>): MarketEdgeDto {
  return {
    pick: "NYM",
    confidence: 0.6,
    grade: "best_signal",
    signalType: null,
    marketSignal: null,
    sharpStatus: "mixed",
    held: false,
    verdict: { key: "best_angle", label: "Best Angle" },
    rawGrade: "best_signal",
    rawRecScore: 70,
    capReasons: [],
    finalGrade: "best_signal",
    finalRecScore: 70,
    actionabilityLabel: "Best Angle",
    displayReason: null,
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: 0.6,
    marketFairProb: null,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: -110,
    lineOpenAmerican: null,
    modelTotal: null,
    marketTotal: null,
    line: null,
    keyStats: [],
    modelTrustPct: 60,
    marketImpliedPct: 52,
    modelMarketGapPct: 7,
    recommendationConfidence: 70,
    marketSource: null,
    marketDataQuality: "two_sided_consensus",
    reviewFlags: [],
    reviewActionSummary: "keep",
    ...overrides,
  } as MarketEdgeDto;
}

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`ok ${name}`);
}

function withFlags(fn: () => void) {
  const previous = {
    MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED: process.env.MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED,
    MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED: process.env.MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED,
    MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED: process.env.MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED,
    MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED: process.env.MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED,
  };
  process.env.MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED = "true";
  process.env.MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED = "true";
  process.env.MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED = "true";
  process.env.MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED = "true";
  try {
    fn();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

withFlags(() => {
  const fiToss = applyMlbSameDayGradeGuardrail({
    market: "first_inning",
    dto: baseMarket({ pick: "Toss-Up", verdict: { key: "lean", label: "Lean" }, priceAmerican: null }),
  });
  check("FI Toss-Up caps to No Play", fiToss.market.verdict.key === "no_play");
  check("FI Toss-Up rule recorded", fiToss.appliedRules.includes("fi_tossup_no_play"));

  const fiMissingPrice = applyMlbSameDayGradeGuardrail({
    market: "first_inning",
    dto: baseMarket({ pick: "YRFI", verdict: { key: "lean", label: "Lean" }, priceAmerican: null }),
  });
  check("FI missing price caps actionable grade to Watchlist", fiMissingPrice.market.verdict.key === "watchlist");
  check("FI missing price rule recorded", fiMissingPrice.appliedRules.includes("fi_missing_price_blocks_grade_strengthening"));

  const totalThinLean = applyMlbSameDayGradeGuardrail({
    market: "total",
    dto: baseMarket({
      pick: "Under",
      verdict: { key: "lean", label: "Lean" },
      modelTotal: 9.1,
      line: 9.5,
      modelMarketGapPct: 4.2,
    }),
  });
  check("Total projection gap under .5 caps Lean to Watchlist", totalThinLean.market.verdict.key === "watchlist");
  check("Total thin gap rule recorded", totalThinLean.appliedRules.includes("totals_thin_gap_lean_cap"));

  const mlKnownResistance = applyMlbSameDayGradeGuardrail({
    market: "moneyline",
    dto: baseMarket({
      pick: "ATL",
      verdict: { key: "best_angle", label: "Best Angle" },
      modelMarketGapPct: 7.9,
      marketReadV2: {
        label: "Market Resistance",
        score: 40,
        tone: "amber",
        explanation: "",
        copyMode: "context_only_not_pick_changing",
        exactLineEvidenceStatus: "valid",
        evidenceAsOf: null,
        generatedAt: new Date().toISOString(),
        validityStatus: "valid_directional",
        movement: {
          firstTrackedLine: null,
          firstTrackedPrice: -130,
          currentLine: null,
          currentPrice: -125,
          directionRelativeToPick: "resistance",
          observedAt: null,
        },
        consensus: null,
        sourceSummary: {
          priceAction: null,
          playbookConsensus: null,
          sharpApiSourceSpecific: null,
          sharpMoney: null,
        },
      },
    }),
  });
  check("ML known resistance and edge < 8 caps Best Angle to Lean", mlKnownResistance.market.verdict.key === "lean");
  check("ML cap rule recorded", mlKnownResistance.appliedRules.includes("ml_best_angle_movement_edge_cap"));

  const mlPredictionQualityBestAngle = applyMlbSameDayGradeGuardrail({
    market: "moneyline",
    dto: baseMarket({
      pick: "SF",
      verdict: { key: "best_angle", label: "Best Angle" },
      modelMarketGapPct: 2.1,
      capReasons: ["prediction_quality_best_angle_promotion"],
      marketReadV2: {
        label: "Projection-Led",
        score: 50,
        tone: "gray",
        explanation: "",
        copyMode: "context_only_not_pick_changing",
        exactLineEvidenceStatus: "valid",
        evidenceAsOf: null,
        generatedAt: new Date().toISOString(),
        validityStatus: "valid_directional",
        movement: {
          firstTrackedLine: null,
          firstTrackedPrice: -160,
          currentLine: null,
          currentPrice: -159,
          directionRelativeToPick: "neutral",
          observedAt: null,
        },
        consensus: null,
        sourceSummary: {
          priceAction: null,
          playbookConsensus: null,
          sharpApiSourceSpecific: null,
          sharpMoney: null,
        },
      },
    }),
  });
  check("Prediction-quality ML Best Angle is not capped by old movement-edge rule",
        mlPredictionQualityBestAngle.market.verdict.key === "best_angle");
  check("Prediction-quality ML Best Angle records no movement-edge cap",
        !mlPredictionQualityBestAngle.appliedRules.includes("ml_best_angle_movement_edge_cap"));

  const mlUnknownMovement = applyMlbSameDayGradeGuardrail({
    market: "moneyline",
    dto: baseMarket({
      pick: "ATL",
      verdict: { key: "best_angle", label: "Best Angle" },
      modelMarketGapPct: 7.9,
      marketReadV2: null,
    }),
  });
  check("ML unknown movement does not fire", mlUnknownMovement.market.verdict.key === "best_angle");
  check("ML unknown movement has no rule", mlUnknownMovement.appliedRules.length === 0);
});
