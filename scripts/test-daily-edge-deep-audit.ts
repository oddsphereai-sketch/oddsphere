import { auditDailyEdgeBoards } from "../lib/services/dailyEdgeDeepAudit";
import { normalizeDailyEdgeActionability } from "../lib/services/dailyEdgeActionability";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (!cond) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

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

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
