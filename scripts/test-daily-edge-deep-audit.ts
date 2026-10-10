import {
  auditDailyEdgeBoards,
  DAILY_EDGE_DEEP_AUDIT_SPORTS,
} from "../lib/services/dailyEdgeDeepAudit";
import { normalizeDailyEdgeActionability } from "../lib/services/dailyEdgeActionability";
import { readFileSync } from "node:fs";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (!cond) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

check(
  "deep audit covers every Daily Edge model individually",
  JSON.stringify(DAILY_EDGE_DEEP_AUDIT_SPORTS) ===
    JSON.stringify(["mlb", "wnba", "soccer", "ucl", "nfl", "cfb", "nhl", "nba"]),
);

const deepAuditRoute = readFileSync("app/api/internal/daily-edge-deep-audit/route.ts", "utf8");
check(
  "EPL deep audit reads the same immutable member snapshot as the site",
  deepAuditRoute.includes('sport === "soccer"') &&
    deepAuditRoute.includes("readCurrentEplMemberSnapshot") &&
    deepAuditRoute.indexOf("readCurrentEplMemberSnapshot") < deepAuditRoute.indexOf("dailyEdgeGet"),
);

function board(market: Record<string, unknown>) {
  return {
    games: [{
      awayTeam: "NYY",
      homeTeam: "BOS",
      lockState: "unlocked",
      markets: {
        moneyline: {
          pick: "BOS",
          grade: "market_watch",
          verdict: { key: "watchlist" },
          publicSplits: [{ side: "home", label: "BOS", moneyPct: 55, betsPct: 52 }],
          ...market,
        },
      },
    }],
  };
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      priceAmerican: -118,
      lineOpenAmerican: -120,
      lastMovePrevAmerican: -4900,
      lastMoveNextAmerican: -118,
      marketReadV2: { label: "Projection-Led", sourceSummary: {}, movement: { currentPrice: -118 } },
    }),
  });
  check("impossible odds are critical", result.summary.issueCounts.implausible_displayed_american_odds === 1);
}

{
  const result = auditDailyEdgeBoards({
    wnba: board({
      priceAmerican: -1587,
      lineOpenAmerican: -1400,
      marketReadV2: { label: "Projection-Led", sourceSummary: {}, movement: { currentPrice: -1587 } },
    }),
  });
  check(
    "verified-range WNBA heavy-favorite prices are not rejected by the read-only audit",
    (result.summary.issueCounts.implausible_displayed_american_odds ?? 0) === 0,
  );
}

{
  const result = auditDailyEdgeBoards({
    cfb: board({
      priceAmerican: -12_000,
      lineOpenAmerican: -50_000,
      marketReadV2: null,
    }),
  });
  check(
    "verified CFB moneyline extremes remain audit-visible",
    !result.summary.issueCounts.implausible_displayed_american_odds,
  );
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      priceAmerican: -177,
      lineOpenAmerican: -225,
      lastMovePrevAmerican: -159,
      lastMoveNextAmerican: -156,
      marketReadV2: { label: "Market Resistance", sourceSummary: {}, movement: { currentPrice: -177 } },
    }),
  });
  check("cross-source previous/current chain is critical", result.summary.issueCounts.source_chain_previous_not_current === 1);
}

{
  const result = auditDailyEdgeBoards({
    wnba: board({
      priceAmerican: -124,
      currentPriceAmerican: -128,
      lineOpenAmerican: -115,
      lastMovePrevAmerican: -130,
      lastMoveNextAmerican: -128,
      marketReadV2: {
        label: "Slight Market Support",
        sourceSummary: {},
        movement: { firstTrackedPrice: -115, currentPrice: -128 },
      },
    }),
  });
  check(
    "WNBA audit compares an unlocked trail to the current quote rather than the immutable grade price",
    !result.summary.issueCounts.source_chain_previous_not_current &&
      !result.summary.issueCounts.market_read_uses_hidden_price,
  );
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      priceAmerican: -135,
      lineOpenAmerican: -126,
      marketReadV2: { label: "Market Resistance", sourceSummary: {}, movement: { currentPrice: -135 } },
    }),
  });
  check("favorite moving more negative cannot be resistance", result.summary.issueCounts.market_read_direction_wrong_for_visible_trail === 1);
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      priceAmerican: -200,
      priceObservedAt: "2026-06-28T12:00:00Z",
      priceIsStale: true,
      lineOpenAmerican: -210,
      marketReadV2: { label: "Projection-Led", sourceSummary: {}, movement: { currentPrice: -200 } },
    }),
  });
  check("stale current price is critical", result.summary.issueCounts.stale_price_displayed_as_current === 1);
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      priceAmerican: -118,
      lineOpenAmerican: -120,
      publicSplits: [{ side: "home", label: "BOS", moneyPct: 58, betsPct: 54 }],
      marketReadV2: {
        label: "Projection-Led",
        sourceSummary: {},
        movement: { currentPrice: -118 },
        consensus: { moneyPct: 0.41, betsPct: 0.46 },
      },
    }),
  });
  check("consensus bar mismatch is warning", result.summary.issueCounts.consensus_bar_mismatch === 1);
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      publicSplits: [{ side: "home", label: "BOS", moneyPct: 65, betsPct: 61 }],
      recommendationDecision: {
        consensusSplits: {
          rows: [{ side: "home", label: "BOS", moneyPct: 63, betsPct: 59 }],
        },
      },
    }),
  });
  check("collapsed and expanded consensus mismatch is warning", result.summary.issueCounts.consensus_reader_mismatch === 1);
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      priceAmerican: -145,
      lineOpenAmerican: null,
      lockedLineAmerican: -145,
      marketReadV2: {
        label: "Projection-Led",
        sourceSummary: {},
        movement: { firstTrackedPrice: -133, currentPrice: -145, directionRelativeToPick: "neutral" },
      },
    }),
  });
  check("first-to-lock visible support cannot be projection-led", result.summary.issueCounts.projection_led_contradicts_visible_trail === 1);
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      priceAmerican: -133,
      lineOpenAmerican: -127,
      marketReadV2: { label: "Movement history limited", sourceSummary: {}, movement: { currentPrice: -133 } },
    }),
  });
  check(
    "limited-history neutral copy is not misclassified as projection-led",
    !result.summary.issueCounts.projection_led_contradicts_visible_trail,
  );
}

{
  const result = auditDailyEdgeBoards({
    ucl: board({
      priceAmerican: -1400,
      lineOpenAmerican: -1500,
      marketReadV2: null,
    }),
  });
  check(
    "legitimate heavy-favorite prices remain audit-visible",
    !result.summary.issueCounts.implausible_displayed_american_odds,
  );
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      grade: "best_signal",
      verdict: { key: "best_angle" },
      recommendationConfidence: 52,
      marketReadV2: { label: "Projection-Led", sourceSummary: {}, movement: { currentPrice: -118 } },
    }),
  });
  check("Best Angle below Rec threshold is critical", result.summary.issueCounts.best_angle_low_recommendation_score === 1);
  check("Best Angle low Rec fails audit", result.summary.criticalIssues === 1);
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      grade: "model_only",
      verdict: { key: "lean" },
      recommendationConfidence: 15,
      marketReadV2: { label: "Projection-Led", sourceSummary: {}, movement: { currentPrice: -118 } },
    }),
  });
  check("Lean with Rec 15 is critical", result.summary.issueCounts.lean_low_recommendation_score === 1);
}

{
  const normalized = normalizeDailyEdgeActionability({
    market: "first_inning",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 15,
    modelMarketGapPct: 1,
    marketReadV2: null,
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -110,
  });
  check("FI Lean with Rec 15 normalizes below Lean", normalized.finalVerdict.key !== "lean");
}

{
  const normalized = normalizeDailyEdgeActionability({
    market: "total",
    rawVerdict: { key: "watchlist", label: "Watchlist" },
    rawGrade: "market_watch",
    rawRecScore: 48,
    modelMarketGapPct: 4.5,
    marketReadV2: {
      label: "Market Support",
      score: 72,
      tone: "emerald",
      explanation: "Movement supports the pick.",
      copyMode: "context_only_not_pick_changing",
      exactLineEvidenceStatus: "valid",
      evidenceAsOf: "2026-07-10T12:00:00Z",
      generatedAt: "2026-07-10T12:00:00Z",
      validityStatus: "valid_directional",
      movement: {
        firstTrackedLine: 8.5,
        firstTrackedPrice: -110,
        currentLine: 8.5,
        currentPrice: -120,
        directionRelativeToPick: "support",
        observedAt: "2026-07-10T12:00:00Z",
      },
      consensus: null,
      sourceSummary: {
        priceAction: null,
        playbookConsensus: null,
        sharpApiSourceSpecific: null,
        sharpMoney: null,
      },
    },
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -120,
  });
  check("Market-supported Total Watchlist can promote to Lean",
        normalized.finalVerdict.key === "lean" &&
        normalized.capReasons.includes("market_support_promotion"));
}

{
  const normalized = normalizeDailyEdgeActionability({
    market: "total",
    rawVerdict: { key: "watchlist", label: "Watchlist" },
    rawGrade: "market_watch",
    rawRecScore: 48,
    modelMarketGapPct: 4.5,
    marketReadV2: {
      label: "Market Resistance",
      score: 35,
      tone: "amber",
      explanation: "Movement is against the pick.",
      copyMode: "context_only_not_pick_changing",
      exactLineEvidenceStatus: "valid",
      evidenceAsOf: "2026-07-10T12:00:00Z",
      generatedAt: "2026-07-10T12:00:00Z",
      validityStatus: "valid_directional",
      movement: {
        firstTrackedLine: 8.5,
        firstTrackedPrice: -110,
        currentLine: 8.5,
        currentPrice: 100,
        directionRelativeToPick: "resistance",
        observedAt: "2026-07-10T12:00:00Z",
      },
      consensus: null,
      sourceSummary: {
        priceAction: null,
        playbookConsensus: null,
        sharpApiSourceSpecific: null,
        sharpMoney: null,
      },
    },
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: 100,
  });
  check("Market resistance does not promote Total Watchlist",
        normalized.finalVerdict.key === "watchlist");
}

{
  const marketSupport = {
    label: "Market Support",
    score: 72,
    tone: "emerald" as const,
    explanation: "Movement supports the pick.",
    copyMode: "context_only_not_pick_changing" as const,
    exactLineEvidenceStatus: "valid" as const,
    evidenceAsOf: "2026-07-10T12:00:00Z",
    generatedAt: "2026-07-10T12:00:00Z",
    validityStatus: "valid_directional" as const,
    movement: {
      firstTrackedLine: 8.5,
      firstTrackedPrice: -110,
      currentLine: 8.5,
      currentPrice: -120,
      directionRelativeToPick: "support" as const,
      observedAt: "2026-07-10T12:00:00Z",
    },
    consensus: null,
    sourceSummary: {
      priceAction: null,
      playbookConsensus: null,
      sharpApiSourceSpecific: null,
      sharpMoney: null,
    },
  };
  const normalized = normalizeDailyEdgeActionability({
    market: "total",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 66,
    modelMarketGapPct: 6.2,
    totalProjectionGapRuns: 0.6,
    marketReadV2: marketSupport,
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -120,
  });
  check("Market-confirmed Total Lean can promote to Best Angle",
        normalized.finalVerdict.key === "best_angle" &&
        normalized.capReasons.includes("market_support_best_angle_promotion"));

  const mlNormalized = normalizeDailyEdgeActionability({
    market: "moneyline",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 66,
    modelMarketGapPct: 8,
    marketReadV2: marketSupport,
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -120,
  });
  check("Market-confirmed ML Lean does not use Total Best Angle promotion",
        mlNormalized.finalVerdict.key === "lean");
}

{
  const winnerQualityMl = normalizeDailyEdgeActionability({
    market: "moneyline",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 52,
    modelProbability: 0.6,
    modelMarketGapPct: 0.4,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -145,
  });
  check("Winner-quality ML Lean can promote to Best Angle without a huge value edge",
        winnerQualityMl.finalVerdict.key === "best_angle" &&
        winnerQualityMl.capReasons.includes("prediction_quality_best_angle_promotion"));

  const rawConvictionMl = normalizeDailyEdgeActionability({
    market: "moneyline",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 52,
    modelProbability: 0.58,
    rawModelProbability: 0.67,
    rawModelMarketGapPct: 11.9,
    modelMarketGapPct: 3,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -160,
  });
  check("Raw-conviction ML can promote when regularized edge remains positive",
        rawConvictionMl.finalVerdict.key === "best_angle" &&
        rawConvictionMl.capReasons.includes("prediction_quality_best_angle_promotion"));

  const overShrunkMl = normalizeDailyEdgeActionability({
    market: "moneyline",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 52,
    modelProbability: 0.555,
    rawModelProbability: 0.75,
    rawModelMarketGapPct: 21,
    modelMarketGapPct: 0.6,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -145,
  });
  check("Raw-conviction ML stays Lean when regularized edge is too thin",
        overShrunkMl.finalVerdict.key === "lean");

  const winnerQualityWatch = normalizeDailyEdgeActionability({
    market: "moneyline",
    rawVerdict: { key: "watchlist", label: "Watchlist" },
    rawGrade: "market_watch",
    rawRecScore: 46,
    modelProbability: 0.57,
    modelMarketGapPct: 0.2,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -125,
  });
  check("Winner-quality ML Watchlist can promote to Lean",
        winnerQualityWatch.finalVerdict.key === "lean" &&
        winnerQualityWatch.capReasons.includes("prediction_quality_promotion"));

  const eliteWatchlistTotal = normalizeDailyEdgeActionability({
    market: "total",
    rawVerdict: { key: "watchlist", label: "Watchlist" },
    rawGrade: "market_watch",
    rawRecScore: 50,
    modelProbability: 0.65,
    modelMarketGapPct: 4.5,
    totalProjectionGapRuns: 0.75,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -110,
  });
  check("Elite prediction-quality Total Watchlist can promote through Lean to Best Angle",
        eliteWatchlistTotal.finalVerdict.key === "best_angle" &&
        eliteWatchlistTotal.capReasons.includes("prediction_quality_promotion") &&
        eliteWatchlistTotal.capReasons.includes("prediction_quality_best_angle_promotion"));

  const resistedWinnerQualityMl = normalizeDailyEdgeActionability({
    market: "moneyline",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 52,
    modelProbability: 0.6,
    modelMarketGapPct: 0.4,
    marketReadV2: null,
    marketSupportSignal: "resistance",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -145,
  });
  check("Market resistance blocks winner-quality ML Best Angle promotion",
        resistedWinnerQualityMl.finalVerdict.key === "lean");

  const overpricedWinnerQualityMl = normalizeDailyEdgeActionability({
    market: "moneyline",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 52,
    modelProbability: 0.64,
    modelMarketGapPct: -0.1,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -210,
  });
  check("Overpriced ML favorite does not get winner-quality Best Angle promotion",
        overpricedWinnerQualityMl.finalVerdict.key === "lean");

  const predictionQualityTotal = normalizeDailyEdgeActionability({
    market: "total",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 52,
    modelProbability: 0.6,
    modelMarketGapPct: 0.4,
    totalProjectionGapRuns: 0.45,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -115,
  });
  check("Prediction-quality Total Lean can promote to Best Angle without a huge value edge",
        predictionQualityTotal.finalVerdict.key === "best_angle" &&
        predictionQualityTotal.capReasons.includes("prediction_quality_best_angle_promotion"));

  const thinProjectionTotal = normalizeDailyEdgeActionability({
    market: "total",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 52,
    modelProbability: 0.6,
    modelMarketGapPct: 0.4,
    totalProjectionGapRuns: 0.1,
    marketReadV2: null,
    marketSupportSignal: "neutral",
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -115,
  });
  check("Tiny total projection gap blocks prediction-quality Best Angle",
        thinProjectionTotal.finalVerdict.key === "lean");
}

{
  const normalized = normalizeDailyEdgeActionability({
    market: "total",
    rawVerdict: { key: "lean", label: "Lean" },
    rawGrade: "model_only",
    rawRecScore: 66,
    modelMarketGapPct: 7,
    totalProjectionGapRuns: 1,
    marketReadV2: {
      label: "Market Resistance",
      score: 35,
      tone: "amber",
      explanation: "Movement is against the pick.",
      copyMode: "context_only_not_pick_changing",
      exactLineEvidenceStatus: "valid",
      evidenceAsOf: "2026-07-10T12:00:00Z",
      generatedAt: "2026-07-10T12:00:00Z",
      validityStatus: "valid_directional",
      movement: {
        firstTrackedLine: 8.5,
        firstTrackedPrice: -110,
        currentLine: 8.5,
        currentPrice: 100,
        directionRelativeToPick: "resistance",
        observedAt: "2026-07-10T12:00:00Z",
      },
      consensus: null,
      sourceSummary: {
        priceAction: null,
        playbookConsensus: null,
        sharpApiSourceSpecific: null,
        sharpMoney: null,
      },
    },
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: -120,
  });
  check("Market resistance blocks Total Best Angle promotion",
        normalized.finalVerdict.key === "lean");
}

{
  const normalized = normalizeDailyEdgeActionability({
    market: "first_inning",
    rawVerdict: { key: "watchlist", label: "Watchlist" },
    rawGrade: "market_watch",
    rawRecScore: null,
    modelMarketGapPct: 0,
    marketReadV2: null,
    hasPick: true,
    held: false,
    dataQualityTier: "high",
    priceAmerican: null,
    neutralNonActionable: true,
  });
  check("FI Toss-Up stays No Play without a side price",
        normalized.finalVerdict.key === "no_play" &&
        !normalized.capReasons.includes("missing_price"));
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      grade: "market_watch",
      verdict: { key: "no_play" },
      recommendationConfidence: 35,
      modelMarketGapPct: 5,
      capReasons: ["low_action_score"],
      displayReason: "Edge exists, but we are skipping because the action score is too low.",
      guidedGuide: "Edge exists, but we are skipping because the action score is too low.",
      marketReadV2: { label: "Projection-Led", sourceSummary: {}, movement: { currentPrice: -118 } },
    }),
  });
  check("Positive-edge No Play with cap reason passes", !result.summary.issueCounts.no_play_positive_edge_needs_explanation);
}

{
  const result = auditDailyEdgeBoards({
    mlb: board({
      pick: "NRFI",
      grade: "market_watch",
      verdict: { key: "no_play" },
      modelMarketGapPct: 3.4,
      capReasons: [],
      displayReason: null,
      guidedGuide: "At -177, the FI edge is too thin to make NRFI actionable.",
      marketReadV2: { label: "No Clear Signal", sourceSummary: {}, movement: { currentPrice: -177 } },
    }),
  });
  check(
    "explicit exact-price thin-edge explanation satisfies the No Play audit",
    !result.summary.issueCounts.no_play_positive_edge_needs_explanation,
  );
}

{
  const result = auditDailyEdgeBoards({
    ucl: board({
      grade: null,
      verdict: { key: "no_play" },
      modelMarketGapPct: 24,
      capReasons: [
        "No Play: the model and market differ by more than 20 percentage points, so the forecast is held for calibration review.",
      ],
      displayReason: "The club model and coherent three-way book disagree.",
      marketReadV2: null,
    }),
  });
  check(
    "explicit calibration-review cap explains a positive-edge No Play",
    !result.summary.issueCounts.no_play_positive_edge_needs_explanation,
  );
}

{
  const lockedBoard: any = board({});
  lockedBoard.games[0]!.lockState = "locked";
  lockedBoard.games[0]!.markets = {
    first_inning: {
      pick: "Toss-Up",
      grade: null,
      verdict: { key: "no_play" },
      priceAmerican: null,
      lockedLineAmerican: -148,
      recommendationConfidence: null,
      displayReason: "No actionable side.",
    },
  };
  const result = auditDailyEdgeBoards({ mlb: lockedBoard });
  check(
    "Locked neutral FI No Play does not require an obsolete side price",
    !result.summary.issueCounts.locked_price_not_frozen,
  );
}

{
  const lockedBoard: any = board({});
  lockedBoard.games[0]!.lockState = "locked";
  lockedBoard.games[0]!.markets = {
    first_inning: {
      pick: "NRFI",
      grade: "model_only",
      verdict: { key: "lean" },
      priceAmerican: -135,
      lockedLineAmerican: -148,
      recommendationConfidence: 50,
    },
  };
  const result = auditDailyEdgeBoards({ mlb: lockedBoard });
  check(
    "Locked actionable FI still fails when its displayed price drifts",
    result.summary.issueCounts.locked_price_not_frozen === 1,
  );
}

{
  const cfbBoard: any = board({});
  cfbBoard.games[0]!.markets = {
    first_inning: {
      pick: "TROY -10.5",
      grade: "market_watch",
      verdict: { key: "watchlist" },
      priceAmerican: -110,
      lineOpenAmerican: -110,
      lastMovePrevAmerican: -110,
      lastMoveNextAmerican: -110,
      lastMoveLinePrev: -10.5,
      lastMoveLineNext: -11,
      marketReadV2: {
        label: "Market Support",
        sourceSummary: {},
        movement: { currentPrice: -110 },
      },
    },
  };
  const result = auditDailyEdgeBoards({ cfb: cfbBoard });
  check(
    "CFB first_inning transport slot is audited as Spread movement",
    !result.summary.issueCounts.directional_read_without_visible_move &&
      !result.summary.issueCounts.market_read_direction_wrong_for_visible_trail,
  );
}


{
  const wnbaBoard: any = board({});
  wnbaBoard.games[0]!.markets = {
    first_inning: {
      pick: "ATL -1.5",
      grade: "best_signal",
      verdict: { key: "best_angle" },
      priceAmerican: -110,
      currentPriceAmerican: -110,
      lineOpenAmerican: -114,
      lastMoveLinePrev: -2.5,
      lastMoveLineNext: -1.5,
      recommendationConfidence: 68,
      marketReadV2: {
        label: "Strong Market Support",
        sourceSummary: {},
        movement: {
          firstTrackedLine: -2.5,
          currentLine: -1.5,
          firstTrackedPrice: -114,
          currentPrice: -110,
        },
      },
    },
  };
  const result = auditDailyEdgeBoards({ wnba: wnbaBoard });
  check(
    "WNBA selected-side spread relief from -2.5 to -1.5 is correctly audited as support",
    !result.summary.issueCounts.market_read_direction_wrong_for_visible_trail,
  );
}

{
  const uclBoard: any = board({});
  uclBoard.games[0]!.markets = {
    spread: {
      pick: "BOS or Draw",
      grade: "market_watch",
      verdict: { key: "watchlist" },
      priceAmerican: null,
      recommendationConfidence: 40,
    },
  };
  const result = auditDailyEdgeBoards({ ucl: uclBoard });
  check(
    "UCL spread transport slot is audited as Double Chance",
    result.issues.some((issue) => issue.market === "double_chance"),
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
