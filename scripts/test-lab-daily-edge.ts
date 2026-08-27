/**
 * Tests for /api/lab/daily-edge (Phase 5B).
 *
 * Test design: the DB state for this slate is NOT fully deterministic across
 * test runs — Phase 4 suites (test-admin-upload, verdict regeneration) modify
 * game_predictions + sharp_signals between runs. Rather than couple the test
 * to a specific seed snapshot, this suite asserts:
 *
 *   1. Structural correctness (route returns 200, expected shape, 12 games)
 *   2. Server-side verdict aggregation is INTERNALLY CONSISTENT — for every
 *      game returned, its verdict matches the per-market sharpStatus values
 *      it carries (Decision G — server is the single source of truth)
 *   3. The sharpStatus mapping function correctly handles the actual signal
 *      rows in DB (strong + matching side ⇒ confirm; strong + opposite side
 *      ⇒ caution; null/moderate/missing ⇒ mixed)
 *
 * This way the test stays green regardless of what previous suites mutated.
 *
 * Run with: npm run test:lab-daily-edge
 */

// Fix 5.1 (Flag C1): the production source filter now fails CLOSED by
// default — filters mock rows unless ODDSPHERE_DATA_MODE === "development".
// This suite exercises the seed slate's mock data and depends on the dev-
// mode pass-through, so opt in explicitly here. Runs before the route's
// module imports any filter helpers; isProductionDataMode reads env at
// call time, so this assignment is effective.
process.env.ODDSPHERE_DATA_MODE = "development";

import { readFileSync } from "node:fs";
import { GET as dailyEdge, __TEST__ as dailyEdgeTest } from "../app/api/lab/daily-edge/route";
import { supabase } from "../lib/db/supabase";
import { collectMemberHeldExceptionFindings } from "../lib/services/dailyEdge/dailyEdgeDataHealthMonitor";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  SharpStatus,
} from "../app/lab/lib/labTypes";
import {
  headlineGrade,
  headlinePrimaryMarket,
} from "../app/lab/lib/perPickHeadline";
import { getAttribution } from "../app/lab/lib/gradeAttribution";
import {
  canonicalSplitRows,
  displayedConsensusSection,
  splitLeanStrength,
  splitSectionSignal,
} from "../app/lab/lib/marketPulsePresentation";
import type { MarketSplitDisplaySection } from "../lib/types/domain/RecommendationDecision";
import { firstInningSupportTone } from "../app/lab/lib/firstInningPresentation";
import type {
  Grade,
  MarketSignal,
  SignalType,
} from "../lib/types/domain/Grade";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const SLATE_DATE = "2026-05-22";

const VALID_GRADES = new Set<Grade>([
  "best_signal",
  "sharp_confirmed",
  "market_led",
  "model_only",
  "market_watch",
  "public_smoke",
  "sharp_conflict",
]);

const VALID_SIGNAL_TYPES = new Set<SignalType>([
  "model_dominant",
  "market_dominant",
  "balanced",
  "model_only",
  "market_only",
]);

const VALID_MARKET_SIGNALS = new Set<MarketSignal>([
  "market_confirmed",
  "market_neutral",
  "market_resistance",
  "public_smoke",
  "steam_alert",
]);

async function main() {
section("Market Pulse presentation coherence");

{
  const moneylineRows = canonicalSplitRows({
    label: "Sharp Book Splits",
    rows: [
      { side: "home", label: "CLE", moneyPct: 62, betsPct: 58 },
      { side: "away", label: "DET", moneyPct: 38, betsPct: 42 },
    ],
    signal: null,
    lastUpdated: null,
  });
  const totalRows = canonicalSplitRows({
    label: "Consensus Splits",
    rows: [
      { side: "under", label: "Under", moneyPct: 45, betsPct: 48 },
      { side: "over", label: "Over", moneyPct: 55, betsPct: 52 },
    ],
    signal: null,
    lastUpdated: null,
  });
  check(
    "all team split sources render away above home regardless of provider row order",
    moneylineRows.map((row) => row.label).join(",") === "DET,CLE",
  );
  check(
    "all total split sources render Over above Under regardless of provider row order",
    totalRows.map((row) => row.label).join(",") === "Over,Under",
  );
}
  {
    const currentRows: MarketSplitDisplaySection["rows"] = [
      { side: "over", label: "Over", moneyPct: 54, betsPct: 57, observedAt: "2026-08-10T18:30:00Z", isStale: false },
      { side: "under", label: "Under", moneyPct: 46, betsPct: 43, observedAt: "2026-08-10T18:30:00Z", isStale: false },
    ];
    const olderDecisionRows: MarketSplitDisplaySection["rows"] = [
      { side: "over", label: "Over", moneyPct: 49, betsPct: 62, observedAt: "2026-08-10T18:05:00Z", isStale: false },
      { side: "under", label: "Under", moneyPct: 51, betsPct: 38, observedAt: "2026-08-10T18:05:00Z", isStale: false },
    ];
    const displayed = displayedConsensusSection({
      publicSplits: currentRows,
      recommendationDecision: { consensusSplits: { label: "Consensus Splits", rows: olderDecisionRows, signal: null, lastUpdated: "2026-08-10T18:05:00Z" } } as never,
    });
    check("response-time consensus rows override older recommendation-time display evidence", displayed?.rows === currentRows);
    check(
      "53% money / 52% tickets is labeled a slight sharp-book lean, not full support",
      splitLeanStrength({ label: "Sharp Book Splits", rows: [
        { side: "over", label: "Over", moneyPct: 47, betsPct: 48, observedAt: "2026-08-10T18:02:00Z", isStale: false },
        { side: "under", label: "Under", moneyPct: 53, betsPct: 52, observedAt: "2026-08-10T18:02:00Z", isStale: false },
      ], signal: null, lastUpdated: "2026-08-10T18:02:00Z" }, "Under") === "slight",
    );
    const internallySplitConsensus = splitSectionSignal({
      label: "Consensus Splits",
      rows: olderDecisionRows,
      signal: null,
      lastUpdated: "2026-08-10T18:05:00Z",
    });
    check(
      "51% Under money / 62% Over tickets is mixed consensus, not an Over lean",
      internallySplitConsensus.internallySplit && internallySplitConsensus.direction === null && internallySplitConsensus.moneyLeader === "Under" && internallySplitConsensus.ticketLeader === "Over",
    );
    const previewSource = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
    check(
      "mobile hides the persistent top reader while desktop retains it",
      previewSource.includes('className="hidden scroll-mt-4 sm:block"'),
    );
    check(
      "FI recent-result color labels remain distinct from the calibrated model grade",
      previewSource.includes("Recent context aligns with ${pick}") &&
        previewSource.includes("This is recent-result context, not the model grade itself"),
    );
    check(
      "FI odds-board explanation distinguishes a directional pick from a Toss-Up",
      previewSource.includes("Both outcomes are shown for context. Directional support for ${market.pick}") &&
        previewSource.includes("Both outcomes are shown because a Toss-Up has no selected side"),
    );
    check("each FI side independently supports the pick at 6/10 or better", firstInningSupportTone(6, 10) === "support");
    check("each FI side independently challenges the pick at 4/10 or worse", firstInningSupportTone(4, 10) === "challenge");
    check("FI context remains neutral in the middle band", firstInningSupportTone(5, 10) === "neutral");
  }

  section("Authoritative corrected-market grade");
  {
    const leanOverride = { key: "lean" as const, label: "Lean" };
    const frozenGrade = dailyEdgeTest.effectivePredictionRecordPlayGrade({
      play_grade: "market_aligned",
      best_angle: false,
      snapshot_json: {
        member_facing_at_lock: { grade: "lean", play_grade: "lean" },
      },
    });
    check("member-facing lock grade wins over the mutable stored fallback", frozenGrade === "lean");
    const explicitNoPlay = dailyEdgeTest.effectivePredictionRecordPlayGrade({
      play_grade: null,
      best_angle: false,
      snapshot_json: {
        member_facing_at_lock: { grade: null, play_grade: null },
        decision_pipeline: {
          board_action: "no_play",
          actionable_grade: null,
        },
      },
    });
    check(
      "explicit writer no-play cannot be rebuilt as an actionable reader grade",
      explicitNoPlay === "market_aligned" &&
        dailyEdgeTest.resolveLockedVerdict(explicitNoPlay, false, false)?.key === "watchlist",
    );
    const explicitLean = dailyEdgeTest.effectivePredictionRecordPlayGrade({
      play_grade: null,
      best_angle: false,
      snapshot_json: {
        member_facing_at_lock: { grade: null, play_grade: null },
        decision_pipeline: {
          board_action: "bet",
          actionable_grade: "lean",
        },
      },
    });
    check(
      "explicit writer actionable grade remains authoritative when legacy grade is null",
      explicitLean === "lean",
    );
    check(
      "frozen inversion Lean resolves to the public Lean verdict",
      dailyEdgeTest.resolveLockedVerdict(frozenGrade, false, false)?.key === "lean",
    );
    check(
      "stored final-side inversion Lean is not capped back to Watchlist",
      dailyEdgeTest.shouldCapCorrectedMarketVerdict({
        correctedMarket: true,
        validatedCorrectedBestAngle: false,
        hasStoredPredictionRecord: true,
        writerOverride: leanOverride,
        verdictKey: "lean",
      }) === false,
    );
    check(
      "unresolved corrected candidate remains capped at Watchlist",
      dailyEdgeTest.shouldCapCorrectedMarketVerdict({
        correctedMarket: true,
        validatedCorrectedBestAngle: false,
        hasStoredPredictionRecord: false,
        writerOverride: null,
        verdictKey: "lean",
      }) === true,
    );
    check(
      "correction status alone still cannot preserve an unvalidated Best Angle",
      dailyEdgeTest.shouldCapCorrectedMarketVerdict({
        correctedMarket: true,
        validatedCorrectedBestAngle: false,
        hasStoredPredictionRecord: false,
        writerOverride: null,
        verdictKey: "best_angle",
      }) === true,
    );
    check(
      "stored Lean is capped when its current price is missing",
      dailyEdgeTest.shouldHonorLiveMissingPriceCap({
        storedVerdict: leanOverride,
        normalizedVerdict: { key: "watchlist", label: "Watchlist" },
        normalizedCapReasons: ["missing_price"],
      }) === true,
    );
    check(
      "stored Lean is restored when a reliable current price is available",
      dailyEdgeTest.shouldHonorLiveMissingPriceCap({
        storedVerdict: leanOverride,
        normalizedVerdict: leanOverride,
        normalizedCapReasons: [],
      }) === false,
    );
    const freshPriceAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const marketReadWithPrice = {
      label: "Projection-Led",
      score: 0,
      tone: "gray" as const,
      explanation: "Current exact-line price is available.",
      copyMode: "context_only_not_pick_changing" as const,
      exactLineEvidenceStatus: "available",
      evidenceAsOf: freshPriceAt,
      generatedAt: freshPriceAt,
      validityStatus: "valid_nondirectional" as const,
      movement: {
        firstTrackedLine: 8.5,
        firstTrackedPrice: -106,
        currentLine: 8.5,
        currentPrice: -104,
        directionRelativeToPick: "neutral" as const,
        observedAt: freshPriceAt,
      },
      consensus: null,
      sourceSummary: {
        priceAction: null,
        playbookConsensus: null,
        sharpApiSourceSpecific: null,
        sharpMoney: null,
      },
    };
    check(
      "fresh canonical market read restores the exact-line total price",
      dailyEdgeTest.currentPriceFromMarketRead({
        read: marketReadWithPrice,
        market: "total",
        expectedLine: 8.5,
        locked: false,
      })?.american === -104,
    );
    check(
      "canonical market read cannot price a different total line",
      dailyEdgeTest.currentPriceFromMarketRead({
        read: marketReadWithPrice,
        market: "total",
        expectedLine: 9,
        locked: false,
      }) === null,
    );
    check(
      "canonical live price never overrides a locked market",
      dailyEdgeTest.currentPriceFromMarketRead({
        read: marketReadWithPrice,
        market: "total",
        expectedLine: 8.5,
        locked: true,
      }) === null,
    );
  }

  section("Incomplete MLB market safety");
  {
    const healthMonitorSource = readFileSync("lib/services/dailyEdge/dailyEdgeDataHealthMonitor.ts", "utf8");
    const healthRepairSource = readFileSync("lib/services/dailyEdge/dailyEdgeDataHealthRepair.ts", "utf8");
    const refreshStatusSource = readFileSync("app/api/lab/refresh-status/route.ts", "utf8");
    const dailyEdgeRouteSource = readFileSync("app/api/lab/daily-edge/route.ts", "utf8");
    const held = dailyEdgeTest.forceIncompleteMlbMarketNoPlay({
      held: false,
      rawGrade: "best_signal",
      grade: "best_signal",
      finalGrade: "best_signal",
      verdict: { key: "best_angle", label: "Best Angle" },
      actionabilityLabel: "Best Angle",
      capReasons: [],
    } as unknown as Parameters<typeof dailyEdgeTest.forceIncompleteMlbMarketNoPlay>[0]);
    check("incomplete unlocked markets fail closed", held.held === true && held.verdict.key === "no_play" && held.actionabilityLabel === "No Play" && held.capReasons?.includes("incomplete_required_data_no_play") === true);
    const heldHealthFindings = collectMemberHeldExceptionFindings({
      sport: "mlb",
      date: "2026-08-26",
      games: [{
        external_id: 5059773,
        awayTeam: "HOU",
        homeTeam: "NYY",
        lockState: "open",
        lockedAt: null,
        markets: {
          moneyline: { held: true, capReasons: ["incomplete_required_data_no_play"], reviewFlags: ["missing_starter"] },
          total: { held: true, capReasons: ["incomplete_required_data_no_play"], reviewFlags: ["missing_starter"] },
          first_inning: { held: true, capReasons: ["incomplete_required_data_no_play"], reviewFlags: ["missing_starter"] },
        },
      }],
    } as unknown as DailyEdgeResponse);
    check("public No Play preserves one internal high-severity recovery finding", heldHealthFindings.length === 1 && heldHealthFindings[0]?.severity === "high" && heldHealthFindings[0]?.code === "member_held_needs_attention" && heldHealthFindings[0]?.details?.externalId === 5059773);
    check("targeted starter recovery is bounded and scoped", healthRepairSource.includes("MAX_TARGETED_STARTER_REPAIR_GAMES = 3") && healthRepairSource.includes("externalIdsFilter: uniqueEligibleExternalIds") && healthRepairSource.includes("starter_only"));
    check("starter-only recovery cannot rewrite predictions or grades", healthRepairSource.includes('if (repairMode === "starter_only")') && healthRepairSource.includes("this recovery lane never rewrites predictions, probabilities, or grades"));
    check("starter-only recovery cannot publish a mixed-time response snapshot", healthRepairSource.includes('if (repairMode === "full") {') && healthRepairSource.includes("the next normal leased writer cycle owns evaluation and coherent snapshot publication"));
    const incompleteAudit = (missingFields: string[], lockProtected = false) => ({
      status: "incomplete_missing_required_data" as const,
      canPublishNormal: false,
      bestAngleAllowed: false,
      repairEligible: true,
      lockProtected,
      lastRepairAttemptAt: null,
      missingFields,
      degradedFields: [],
      fallbackReasons: [],
      repairActions: [],
      starterPolicy: { away: "confirmed", home: "confirmed" },
      statsPolicy: { pitcher: "complete", bullpen: "complete", offense: "complete", parkWeather: "complete" },
    });
    const totalOnlyGap = incompleteAudit(["over_price", "under_price"]);
    check("Total-only gaps hold Total", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(totalOnlyGap, "total") === true);
    check("Total-only gaps preserve Moneyline", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(totalOnlyGap, "moneyline") === false);
    check("Total-only gaps preserve First Inning", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(totalOnlyGap, "first_inning") === false);
    const moneylineOnlyGap = incompleteAudit(["home_moneyline_price"]);
    check("Moneyline-only gaps hold Moneyline", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(moneylineOnlyGap, "moneyline") === true);
    check("Moneyline-only gaps preserve Total", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(moneylineOnlyGap, "total") === false);
    check("Moneyline-only gaps preserve First Inning", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(moneylineOnlyGap, "first_inning") === false);
    const firstInningOnlyGap = incompleteAudit(["nrfi_price", "yrfi_price"]);
    check("First Inning-only gaps hold First Inning", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(firstInningOnlyGap, "first_inning") === true);
    check("First Inning-only gaps preserve Moneyline", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(firstInningOnlyGap, "moneyline") === false);
    check("First Inning-only gaps preserve Total", dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(firstInningOnlyGap, "total") === false);
    const sharedGap = incompleteAudit(["away_probable_pitcher"]);
    check("shared starter gaps hold every market", (["moneyline", "total", "first_inning"] as const).every((market) => dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(sharedGap, market)));
    check("unknown required gaps fail every market closed", (["moneyline", "total", "first_inning"] as const).every((market) => dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(incompleteAudit(["future_required_field"]), market)));
    check("lock-protected cards are never rewritten by the reader", (["moneyline", "total", "first_inning"] as const).every((market) => !dailyEdgeTest.shouldForceIncompleteMlbMarketNoPlay(incompleteAudit(["over_price"], true), market)));
    check("incomplete-market safety runs after all support promotions", dailyEdgeRouteSource.indexOf("const forceIncompleteMoneylineNoPlay") > dailyEdgeRouteSource.indexOf("applyHighConvictionTotalPromotion") && dailyEdgeRouteSource.indexOf("const forceIncompleteMoneylineNoPlay") < dailyEdgeRouteSource.indexOf("ml.recommendationDecision = recommendationDecision.markets.moneyline"));
    check("FI health requires a real starter gap before reporting ingestion failure", healthMonitorSource.includes("hasActualStarterIngestionGap") && healthMonitorSource.includes('featureReasonCodes.includes("fi_starter_missing")') && healthMonitorSource.includes('return "fi_model_hold_provider_gap"') && healthMonitorSource.includes('return "fi_legit_model_toss_up"'));
    check("FI health treats mapped starters without MLB history as sparse data", healthMonitorSource.includes("hasOnlyStarterStatsGap") && healthMonitorSource.includes('return "fi_sparse_starter_history"'));
    check("FI repair reruns canonical starter reconciliation after player readiness", healthRepairSource.includes("runStarterRefreshCycle") && healthRepairSource.indexOf("const readiness = await repairMlbModelReadiness") < healthRepairSource.indexOf("const starterRefresh = await runStarterRefreshCycle"));
    check("starter repair targets exact flagged game IDs instead of a full-slate prefix", healthRepairSource.includes("externalIdsFilter: uniqueEligibleExternalIds") && healthRepairSource.includes("limit: uniqueEligibleExternalIds.length") && !healthRepairSource.includes("limit: Math.max(1, args.report.gameCount)"));
    check("Daily Edge repair republishes the coherent member snapshot before post-repair health", healthRepairSource.includes("refreshDailyEdgeResponseSnapshot") && healthRepairSource.includes('source: "daily_edge_data_health_repair"') && healthRepairSource.indexOf("await refreshDailyEdgeResponseSnapshot") < healthRepairSource.indexOf("if (args.postRepairMonitor)"));
    check("Daily Edge repair targets missing ML and total market evidence", ['finding.code === "evidence_blocked"', 'finding.code === "actionable_price_missing"', 'finding.code === "actionable_edge_missing"', 'finding.code === "total_price_missing"'].every((needle) => healthRepairSource.includes(needle)));
    check("refresh pill follows each live league's actual cron", refreshStatusSource.includes('data_source: "wnba_daily_refresh"') && refreshStatusSource.includes('cadence_minutes: 30') && refreshStatusSource.includes('data_source: "soccer_daily_refresh"') && refreshStatusSource.includes('cadence_minutes: 60') && refreshStatusSource.includes("cronConfigsForSport(effectiveSport)"));
    check("visible Under line drop is classified as market support", dailyEdgeTest.visibleTotalPointMarketReadScore("Under", 9.5, 8.5) === 3);
    check("visible Over line drop is classified as market resistance", dailyEdgeTest.visibleTotalPointMarketReadScore("Over", 9.5, 8.5) === -3);
    check("flat total line remains projection-led when price is also flat", dailyEdgeTest.visibleTotalPointMarketReadScore("Under", 8.5, 8.5) === null);
    const alignedFiResistance = dailyEdgeTest.alignMarketReadV2ToVisibleOdds({
      read: null,
      enabled: true,
      market: "first_inning",
      pick: "NRFI",
      openAmerican: -120,
      currentAmerican: -114,
      previousLine: null,
      currentLine: null,
      observedAt: "2026-08-14T13:00:00Z",
      generatedAt: "2026-08-14T13:00:00Z",
    });
    check(
      "FI Market Read classifies the displayed selected-side price trail",
      alignedFiResistance?.movement?.firstTrackedPrice === -120 &&
        alignedFiResistance.movement.currentPrice === -114 &&
        alignedFiResistance.movement.directionRelativeToPick === "resistance" &&
        alignedFiResistance.label === "Slight Market Resistance",
    );
  }

  section("Odds movement coherence");
  {
    const market = {
      lastMovePrevAmerican: -234,
      lastMoveNextAmerican: -123,
      lastMoveLinePrev: 8,
      lastMoveLineNext: 7.5,
    };
    const response = {
      games: [{ markets: { moneyline: { ...market }, total: market, first_inning: { ...market } } }],
    } as unknown as DailyEdgeResponse;
    dailyEdgeTest.suppressIncomparableLineMovePrices(response);
    check("line-number changes suppress incomparable price pairs", response.games[0]?.markets.total.lastMovePrevAmerican === null && response.games[0]?.markets.total.lastMoveNextAmerican === null);
    check("line-number changes remain available as 8 → 7.5", response.games[0]?.markets.total.lastMoveLinePrev === 8 && response.games[0]?.markets.total.lastMoveLineNext === 7.5);
    const fiHalfRunHistory = dailyEdgeTest.fiBoardHistorySide({
      candidates: [
        { id: 1, game_id: 1, market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 0.5, odds_american: -110, recorded_at: "2026-08-12T10:00:00Z" },
        { id: 2, game_id: 1, market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 1.5, odds_american: -265, recorded_at: "2026-08-12T10:30:00Z" },
        { id: 3, game_id: 1, market_type: "first_inning_total", sportsbook: "ballybet", side: "under", line_value: 0.5, odds_american: -113, recorded_at: "2026-08-12T11:00:00Z" },
      ],
      side: "under",
      sportsbook: "ballybet",
      currentAmerican: -113,
      lineValue: 0.5,
    });
    check("FI half-run history excludes 1.5-run alternate prices", fiHalfRunHistory.openAmerican === -110 && fiHalfRunHistory.previousAmerican === -110);
  }

  section("Source-aware split sections");
  {
    const sections = dailyEdgeTest.buildSourceAwareSplitSectionsFromRows(
      [
        {
          canonical_event_id: "12345",
          market_type: "moneyline",
          selection_key: "12345:moneyline:away",
          provider: "sharpapi",
          source_book: "circa",
          source_type: "sharp_adjacent_book",
          bets_pct: 0.62,
          money_pct: 0.58,
          source_observed_at: "2026-07-10T13:00:00Z",
          fetched_at: "2026-07-10T13:00:00Z",
        },
        {
          canonical_event_id: "12345",
          market_type: "moneyline",
          selection_key: "12345:moneyline:home",
          provider: "sharpapi",
          source_book: "circa",
          source_type: "sharp_adjacent_book",
          bets_pct: 0.38,
          money_pct: 0.42,
          source_observed_at: "2026-07-10T13:00:00Z",
          fetched_at: "2026-07-10T13:00:00Z",
        },
      ],
      [
        {
          external_id: 12345,
          away_team: { abbreviation: "BOS" },
          home_team: { abbreviation: "NYY" },
        },
      ] as never,
    );
    const sharpBook = sections.get("12345::moneyline")?.sharpBook ?? null;
    check("Circa source rows render Sharp Book Splits", sharpBook?.label === "Sharp Book Splits");
    check("Circa source rows keep both sides", sharpBook?.rows.length === 2, `got: ${sharpBook?.rows.length ?? 0}`);
    check("Circa source rows normalize percentages", sharpBook?.rows[0]?.moneyPct === 58 && sharpBook.rows[1]?.moneyPct === 42);
  }
  {
    const common = {
      canonical_event_id: "24680",
      market_type: "moneyline",
      provider: "sharpapi",
      source_book: "circa",
      source_type: "sharp_adjacent_book",
    } as const;
    const sections = dailyEdgeTest.buildSourceAwareSplitSectionsFromRows(
      [
        {
          ...common,
          selection_key: "24680:moneyline:away",
          bets_pct: 0.47,
          money_pct: 0.52,
          source_observed_at: "2026-08-07T14:09:00Z",
          fetched_at: "2026-08-07T14:07:00Z",
        },
        {
          ...common,
          selection_key: "24680:moneyline:home",
          bets_pct: 0.53,
          money_pct: 0.48,
          source_observed_at: "2026-08-07T14:09:00Z",
          fetched_at: "2026-08-07T14:07:00Z",
        },
        {
          ...common,
          selection_key: "24680:moneyline:away",
          bets_pct: 0.45,
          money_pct: 0.61,
          source_observed_at: "2026-08-07T15:04:00Z",
          fetched_at: "2026-08-07T15:07:00Z",
        },
        {
          ...common,
          selection_key: "24680:moneyline:away",
          bets_pct: 0.46,
          money_pct: 0.62,
          source_observed_at: "2026-08-07T14:59:00Z",
          fetched_at: "2026-08-07T15:07:00Z",
        },
        {
          ...common,
          selection_key: "24680:moneyline:home",
          bets_pct: 0.54,
          money_pct: 0.38,
          source_observed_at: "2026-08-07T14:59:00Z",
          fetched_at: "2026-08-07T15:07:00Z",
        },
        {
          ...common,
          selection_key: "24680:moneyline:home",
          bets_pct: 0.55,
          money_pct: 0.39,
          source_observed_at: "2026-08-07T15:04:00Z",
          fetched_at: "2026-08-07T15:07:00Z",
        },
      ],
      [{ external_id: 24680, away_team: { abbreviation: "TB" }, home_team: { abbreviation: "SEA" } }] as never,
    );
    const sharpBook = sections.get("24680::moneyline")?.sharpBook ?? null;
    check("source-aware split selection prefers the newest verified ingestion batch", sharpBook?.rows.every((row) => row.freshnessCheckedAt === "2026-08-07T15:07:00Z") === true);
    check("source-aware split selection keeps the newest coherent source pair", sharpBook?.rows[0]?.moneyPct === 61 && sharpBook.rows[1]?.moneyPct === 39);
    check("source-aware split selection uses matching latest source timestamps", sharpBook?.rows.every((row) => row.observedAt === "2026-08-07T15:04:00Z") === true);
  }
  {
    const sections = dailyEdgeTest.buildSourceAwareSplitSectionsFromRows(
      [
        {
          canonical_event_id: "67890",
          market_type: "total",
          selection_key: "67890:total:over",
          provider: "sharpapi",
          source_book: null,
          source_type: "sharp_adjacent_book",
          bets_pct: 0.44,
          money_pct: 0.61,
          source_observed_at: "2026-07-10T13:00:00Z",
          fetched_at: "2026-07-10T13:00:00Z",
        },
        {
          canonical_event_id: "67890",
          market_type: "total",
          selection_key: "67890:total:under",
          provider: "sharpapi",
          source_book: null,
          source_type: "sharp_adjacent_book",
          bets_pct: 0.56,
          money_pct: 0.39,
          source_observed_at: "2026-07-10T13:00:00Z",
          fetched_at: "2026-07-10T13:00:00Z",
        },
      ],
      [
        {
          external_id: 67890,
          away_team: { abbreviation: "BOS" },
          home_team: { abbreviation: "NYY" },
        },
      ] as never,
    );
    const sharpBook = sections.get("67890::total")?.sharpBook ?? null;
    check("Locked sharp-adjacent snapshots without source_book render Sharp Book Splits", sharpBook?.rows.length === 2);
  }
  {
    const legacySignals = [
      {
        market_type: "moneyline",
        side: "away",
        public_betting_pct: 61,
        public_money_pct: null,
        public_betting_pct_observed_at: "2026-07-20T12:06:00Z",
        public_money_pct_observed_at: null,
        computed_at: "2026-07-20T12:06:00Z",
      },
      {
        market_type: "moneyline",
        side: "home",
        public_betting_pct: 39,
        public_money_pct: null,
        public_betting_pct_observed_at: "2026-07-20T12:06:00Z",
        public_money_pct_observed_at: null,
        computed_at: "2026-07-20T12:06:00Z",
      },
    ];
    const fallback = dailyEdgeTest.resolveSharpBookSplitSection(undefined, {
      direction: "support",
      pick: "BOS",
      signals: [] as never,
      dbMarket: "moneyline",
      market: "moneyline",
      homeAbbr: "BOS",
      awayAbbr: "NYY",
    });
    check("Consensus percentages are not relabeled as Sharp Book Splits", fallback === null);

    const legacyFallback = dailyEdgeTest.resolveSharpBookSplitSection(undefined, {
      direction: "support",
      pick: "BOS",
      signals: legacySignals as never,
      dbMarket: "moneyline",
      market: "moneyline",
      homeAbbr: "BOS",
      awayAbbr: "NYY",
    });
    check("Ticket-only legacy data does not claim complete Sharp Book Splits", legacyFallback?.label === "Sharp Book Signal" && legacyFallback.rows.length === 0);
    check("Ticket-only legacy data preserves a qualitative sharp signal", typeof legacyFallback?.signal === "string" && legacyFallback.signal.length > 0);

    const sourceAware = { label: "Sharp Book Splits" as const, rows: [], signal: "source-aware", lastUpdated: null };
    const preferred = dailyEdgeTest.resolveSharpBookSplitSection({ sharpBook: sourceAware }, {
      direction: "support",
      pick: "BOS",
      signals: legacySignals as never,
      dbMarket: "moneyline",
      market: "moneyline",
      homeAbbr: "BOS",
      awayAbbr: "NYY",
    });
    check("Source-aware Sharp Book Splits remain preferred when available", preferred === sourceAware);
  }

  // ─── Happy path: MLB slate ────────────────────────────────────────────────
  section("GET /api/lab/daily-edge?sport=mlb&date=2026-05-22");

  const res = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=mlb&date=${SLATE_DATE}`)
  );
  check("returns 200", res.status === 200);

  const body = (await res.json()) as DailyEdgeResponse;
  check("body.sport = 'mlb'", body.sport === "mlb");
  check(`body.date = '${SLATE_DATE}'`, body.date === SLATE_DATE);
  check(
    "body.as_of is recent ISO",
    typeof body.as_of === "string" && Date.now() - new Date(body.as_of).getTime() < 5_000
  );
  check("body.games is an array", Array.isArray(body.games));
  check(`12 games on the slate`, body.games.length === 12, `got: ${body.games.length}`);

  if (body.games.length === 0) {
    console.error("No games returned — aborting downstream assertions");
    process.exit(1);
  }

  // ─── DTO shape (first game) ──────────────────────────────────────────────
  section("Per-game DTO shape");

  const first = body.games[0]!;
  check("game.id is a non-empty string", typeof first.id === "string" && first.id.length > 0);
  check("game.external_id is numeric", typeof first.external_id === "number");
  check("game.sport = 'mlb'", first.sport === "mlb");
  check(
    "game.awayTeam / homeTeam are populated abbreviations",
    typeof first.awayTeam === "string" && first.awayTeam.length > 0 && first.awayTeam !== "home" && first.awayTeam !== "away" &&
    typeof first.homeTeam === "string" && first.homeTeam.length > 0 && first.homeTeam !== "home" && first.homeTeam !== "away"
  );
  check(
    "game.gameTime looks like 'H:MM AM/PM'",
    /^\d{1,2}:\d{2}\s+(AM|PM)$/.test(first.gameTime),
    `got: ${first.gameTime}`
  );
  check("game.gameStartMinutes >= 0", first.gameStartMinutes >= 0);
  check("game.predictions has ml, total, nrfi", typeof first.predictions === "object" && "ml" in first.predictions && "total" in first.predictions && "nrfi" in first.predictions);
  // Fix 7.2.5: total.line is nullable. INVARIANT (not a live-value assertion):
  // it is null OR a positive finite number — never a fake 0 or a predicted_total
  // substitution. Whether a given live game currently has a line is data-
  // dependent and intentionally NOT asserted (that was a flake source).
  {
    const l = first.predictions.total.line;
    check(
      "game.predictions.total.line is null or a positive finite number",
      l === null || (typeof l === "number" && Number.isFinite(l) && l > 0)
    );
  }
  check(
    "game.predictions.total.pick is 'Over' or 'Under'",
    first.predictions.total.pick === "Over" || first.predictions.total.pick === "Under",
    `got: ${first.predictions.total.pick}`
  );
  check(
    "game.predictions.nrfi.pick is NRFI or YRFI",
    first.predictions.nrfi.pick === "NRFI" || first.predictions.nrfi.pick === "YRFI"
  );
  check(
    "game.predictions.ml.pick is a team abbreviation (not 'home'/'away') or null for held",
    first.predictions.ml.pick === null ||
      (first.predictions.ml.pick !== "home" &&
        first.predictions.ml.pick !== "away" &&
        first.predictions.ml.pick.length > 0)
  );
  check("game.projected is { away, home }", typeof first.projected === "object" && typeof first.projected.away === "number" && typeof first.projected.home === "number");
  check("game.sharpSignals is an array", Array.isArray(first.sharpSignals));

  // V2.1.1 (Phase 6.3.5e): legacy top-level grade / signalType /
  // marketSignal / primaryMarket fields were dropped from the DTO.
  // Per-pick fields (predictions.{ml,total,nrfi}.{grade,signalType,marketSignal})
  // are the new source of truth — invariants below cover them.

  // ─── V2.1.1 per-pick DTO invariants (Phase 6.3.5c) ────────────────────────
  section("Per-pick DTO invariants");

  // 9 union checks — grade × {ml,total,nrfi} × {grade, signalType, marketSignal}
  for (const market of ["ml", "total", "nrfi"] as const) {
    const tile = first.predictions[market];
    check(
      `first.predictions.${market}.grade is null or in the canonical Grade union`,
      tile.grade === null || VALID_GRADES.has(tile.grade),
      `got: ${tile.grade}`
    );
    check(
      `first.predictions.${market}.signalType is null or in the canonical SignalType union`,
      tile.signalType === null || VALID_SIGNAL_TYPES.has(tile.signalType),
      `got: ${tile.signalType}`
    );
    check(
      `first.predictions.${market}.marketSignal is null or in the canonical MarketSignal union`,
      tile.marketSignal === null || VALID_MARKET_SIGNALS.has(tile.marketSignal),
      `got: ${tile.marketSignal}`
    );
  }

  // Co-derivation / skip-NULL coherence: when any per-pick field is null,
  // the other two on the same tile must also be null. Verified across all
  // 12 games, all 3 tiles.
  let perPickTripletNonAtomic = 0;
  for (const g of body.games) {
    for (const market of ["ml", "total", "nrfi"] as const) {
      const tile = g.predictions[market];
      const nullCount =
        (tile.grade === null ? 1 : 0) +
        (tile.signalType === null ? 1 : 0) +
        (tile.marketSignal === null ? 1 : 0);
      // Atomic: either all 3 null or all 3 populated. Never mixed.
      if (nullCount !== 0 && nullCount !== 3) perPickTripletNonAtomic++;
    }
  }
  check(
    "per-pick triplet is atomic: all 3 fields null together or all 3 populated",
    perPickTripletNonAtomic === 0
  );

  // Internal consistency: for every game with a primary pick, the legacy
  // top-level grade/signalType/marketSignal MUST match
  // predictions[primaryMarket].* (precedence-1 dual-shape parity).
  type DtoMarketKey = "ml" | "total" | "nrfi";
  const PRIMARY_TO_TILE: Record<string, DtoMarketKey> = {
    moneyline: "ml",
    total: "total",
    first_inning_total: "nrfi",
  };
  // 6.3.5e: the dual-shape parity assertion (legacy top-level fields ===
  // predictions[primaryMarket].*) was removed when the legacy DTO fields
  // were dropped. perPickHeadline.ts now derives the headline client-side
  // for UI consumers; there's nothing on the wire to compare against.

  // Sanity: at least one game has a non-null per-pick grade triplet on
  // ML (the precedence-1 market). Confirms the V13 columns are being
  // populated end-to-end through marketSignalDerivationService +
  // gradeDerivationService + the route SELECT + the DTO mapping.
  const mlGradedCount = body.games.filter(
    (g) => g.predictions.ml.grade !== null
  ).length;
  check(
    "at least one game has a non-null predictions.ml.grade (V13 pipeline end-to-end)",
    mlGradedCount > 0,
    `mlGradedCount=${mlGradedCount}`
  );

  // ─── Confidence values are in [0, 1] for every game ───────────────────────
  section("Confidence range");

  // Phase 4.2.C.2 — confidence is nullable (held markets). Null is
  // acceptable; only non-null values must be in [0, 1].
  const allInRange = body.games.every((g) =>
    [g.predictions.ml.confidence, g.predictions.total.confidence, g.predictions.nrfi.confidence].every(
      (c) => c === null || (c >= 0 && c <= 1)
    )
  );
  check("every game's ml/total/nrfi confidence is null or in [0, 1]", allInRange);

  // ─── Sort order: gameStartMinutes ascending ──────────────────────────────
  section("Sort order");

  const isSorted = body.games.every((g, i, arr) =>
    i === 0 ? true : arr[i - 1]!.gameStartMinutes <= g.gameStartMinutes
  );
  check("games sorted by gameStartMinutes asc", isSorted);

  // ─── V2.1.1 per-pick grade invariants (post-6.3.5e) ───────────────────────
  // The legacy row-level grade/signalType/marketSignal/primaryMarket fields
  // were removed from the DTO in 6.3.5e. Equivalent invariants now run
  // against the per-pick triplets — covered in the "Per-pick DTO invariants"
  // section above (atomicity + union checks per tile + pipeline sanity).

  // ─── sharpStatus mapping consistency against DB sharp_signals ─────────────
  section("sharpStatus mapping consistency");

  // Pull raw sharp_signals rows for the slate's games and verify the route's
  // per-market sharpStatus values follow our rule:
  //   strong + same side as predicted ⇒ confirm
  //   strong + opposite side          ⇒ caution
  //   caution + same side             ⇒ caution
  //   else                            ⇒ mixed
  const gameIds = body.games.map((g) => g.external_id);
  const { data: gameRows } = await supabase
    .from("games")
    .select(
      `id, external_id,
       game_predictions ( predicted_ml_winner, predicted_ou_side, predicted_nrfi )`
    )
    .in("external_id", gameIds);

  const idByExternal = new Map<number, number>();
  const predByExternal = new Map<
    number,
    { ml: string; ou: string; nrfi: boolean }
  >();
  for (const row of (gameRows ?? []) as unknown as Array<{
    id: number;
    external_id: number;
    game_predictions: { predicted_ml_winner: string | null; predicted_ou_side: string | null; predicted_nrfi: boolean | null } | null;
  }>) {
    idByExternal.set(row.external_id, row.id);
    const p = row.game_predictions;
    if (p) {
      predByExternal.set(row.external_id, {
        ml: p.predicted_ml_winner ?? "home",
        ou: p.predicted_ou_side ?? "under",
        nrfi: p.predicted_nrfi ?? true,
      });
    }
  }

  // Fix 4.1 (Gap-18+19, Flag D1): sharpStatus derives from per-pick grade,
  // not from legacy signal_strength. Mirror the route's deriveSharpStatus()
  // rule here for the cross-check:
  //   best_signal / sharp_confirmed → confirm
  //   sharp_conflict                → caution
  //   everything else (incl. null)  → mixed
  function expectStatusFromGrade(grade: Grade | null): SharpStatus {
    if (grade === "best_signal" || grade === "sharp_confirmed") return "confirm";
    if (grade === "sharp_conflict") return "caution";
    return "mixed";
  }

  let mapFailures = 0;
  for (const g of body.games) {
    const expectedMl = expectStatusFromGrade(g.predictions.ml.grade);
    const expectedTotal = expectStatusFromGrade(g.predictions.total.grade);
    const expectedNrfi = expectStatusFromGrade(g.predictions.nrfi.grade);
    if (
      g.predictions.ml.sharpStatus !== expectedMl ||
      g.predictions.total.sharpStatus !== expectedTotal ||
      g.predictions.nrfi.sharpStatus !== expectedNrfi
    ) {
      mapFailures++;
      console.log(
        `    map mismatch ext_id=${g.external_id} ml: got=${g.predictions.ml.sharpStatus} expect=${expectedMl} | total: got=${g.predictions.total.sharpStatus} expect=${expectedTotal} | nrfi: got=${g.predictions.nrfi.sharpStatus} expect=${expectedNrfi}`
      );
    }
  }
  check(
    `route's per-market sharpStatus matches the grade-based deriveSharpStatus rule for every game (Fix 4.1)`,
    mapFailures === 0
  );

  // ─── sharpSignals[] count matches DB row count ────────────────────────────
  section("sharpSignals[] count");

  // Fix 4.1: re-query sharp_signals (now without signal_strength column).
  const gameDbIds = Array.from(idByExternal.values());
  const { data: signalRows } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type")
    .in("game_id", gameDbIds);
  const dbSignalCount = signalRows?.length ?? 0;
  const responseSignalCount = body.games.reduce((acc, g) => acc + g.sharpSignals.length, 0);
  check(
    `total sharpSignals across response (${responseSignalCount}) matches DB rows (${dbSignalCount})`,
    responseSignalCount === dbSignalCount
  );

  // At least one signal carries actionable direction (positive or negative)
  // — i.e., the route correctly surfaces grade-aligned signals.
  if (dbSignalCount > 0) {
    const actionable = body.games.flatMap((g) => g.sharpSignals).filter((s) => s.direction !== "neutral");
    check(
      `at least one sharpSignal has direction in {positive, negative}`,
      actionable.length > 0,
      `none of ${responseSignalCount} signals were actionable`
    );
  }

  // ─── Non-live sport → empty games array ───────────────────────────────────
  section("Non-live sport returns empty games");

  const nbaRes = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=nba&date=${SLATE_DATE}`)
  );
  check("returns 200 (not 404)", nbaRes.status === 200);
  const nbaBody = (await nbaRes.json()) as DailyEdgeResponse;
  check("nba body.sport = 'nba'", nbaBody.sport === "nba");
  check("nba body.games = [] (empty, not error)", Array.isArray(nbaBody.games) && nbaBody.games.length === 0);

  // ─── Invalid sport → falls back to MLB ────────────────────────────────────
  section("Invalid sport falls back to MLB");

  const bogusRes = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=quidditch&date=${SLATE_DATE}`)
  );
  check("returns 200", bogusRes.status === 200);
  const bogusBody = (await bogusRes.json()) as DailyEdgeResponse;
  check("falls back to mlb", bogusBody.sport === "mlb");
  check("still returns 12 games", bogusBody.games.length === 12);

  // ─── Invalid date → falls back to today UTC ───────────────────────────────
  section("Invalid date falls back to today UTC");

  const badDateRes = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=mlb&date=not-a-date`)
  );
  check("returns 200", badDateRes.status === 200);
  const badDateBody = (await badDateRes.json()) as DailyEdgeResponse;
  check(
    "date param normalized to YYYY-MM-DD",
    /^\d{4}-\d{2}-\d{2}$/.test(badDateBody.date),
    `got: ${badDateBody.date}`
  );

  // ─── perPickHeadline rank-based selection (6.3.5e-fix-2) ──────────────
  // Pre-fix the headline used first-non-null precedence (ML → OU → NRFI)
  // which buried a sharp_conflict on Total under a market_watch on ML. The
  // fix sorts per-pick candidates by GRADE_RANK desc with ML→OU→NRFI as
  // the tiebreaker. These pure-function tests lock the rank table + tie
  // behavior; the end-to-end smoke is covered by the live slate audit
  // below.
  section("perPickHeadline rank-based selection (6.3.5e-fix-2)");

  function mkDto(
    ml: Grade | null,
    total: Grade | null,
    nrfi: Grade | null
  ): DailyEdgeGameDto {
    const tile = (grade: Grade | null) => ({
      pick: "X",
      confidence: 0.5,
      sharpStatus: "mixed" as SharpStatus,
      grade,
      signalType: null,
      marketSignal: null,
    });
    // 4.1.10 — stub MarketEdgeDto for fixtures that test headline-grade
    // ranking, which targets the legacy `predictions` block. The new
    // per-market enriched fields are not exercised by these assertions.
    const stubMarket = () => ({
      pick: "X",
      confidence: 0.5,
      grade: null,
      signalType: null,
      marketSignal: null,
      sharpStatus: "mixed" as SharpStatus,
      held: false,  // Phase 4.2.C.2 — stub default
      verdict: { key: "no_play" as const, label: "No Play" },
      guidedGuide: "stub",
      guidedWatchOut: "stub",
      whyLine: "stub",
      riskLine: "stub",
      modelProb: null,
      marketFairProb: null,
      pinnacleEvPct: null,
      moneyPct: null,
      betsPct: null,
      publicSplits: [],
      priceAmerican: null,
      lineOpenAmerican: null,
      modelTotal: null,
      marketTotal: null,
      line: null,
      keyStats: [],
      modelTrustPct: null,
      marketImpliedPct: null,
      modelMarketGapPct: null,
      marketSource: null,
      marketDataQuality: "unavailable" as const,
      reviewFlags: [],
      reviewActionSummary: "keep" as const,
    });
    return {
      id: "test-1",
      sport: "mlb",
      external_id: 1,
      awayTeam: "AAA",
      awayTeamLogo: null,
      homeTeam: "BBB",
      homeTeamLogo: null,
      gameTime: "7:10 PM",
      gameStartMinutes: 0,
      scheduledLockAt: "2026-05-29T23:10:00.000Z",
      lockState: "open" as const,
      lockedAt: null,
      updatedAt: null,
      generatedAt: null,
      holdReason: null,
      homeStarter: null,
      awayStarter: null,
      predictions: {
        ml: tile(ml),
        total: { ...tile(total), line: 9 },
        nrfi: tile(nrfi),
      },
      markets: {
        moneyline: stubMarket(),
        total: stubMarket(),
        first_inning: stubMarket(),
      },
      decisionLine: "stub decision line",
      projected: { away: 0, home: 0 },
      sharpSignals: [],
      status: {
        lineupConfirmed: null,
        linesLocked: false,
        sharpSignalPending: true,
        marketDataLimited: false,
      },
      result: null,
      // Phase 4.1.8.B — breakdown is non-nullable on the DTO. Headline-grade
      // tests don't exercise breakdown semantics; supply a minimal stub that
      // satisfies the type. The verdict + sharpRead derivation are tested
      // separately below.
      breakdown: {
        verdict: { key: "no_play", label: "No Play" },
        sharpRead: {
          key: "no_data",
          sentence: "No clear sharp read on this matchup yet.",
        },
        modelBreakdown: null,
      },
    };
  }

  // WSH @ ATL pattern: weak ML + strong OU caution → OU wins
  check(
    "ML=market_watch + Total=sharp_conflict + NRFI=market_watch → headline grade = sharp_conflict (WSH @ ATL pattern)",
    headlineGrade(mkDto("market_watch", "sharp_conflict", "market_watch")) ===
      "sharp_conflict"
  );
  check(
    "ML=market_watch + Total=sharp_conflict + NRFI=market_watch → headline market = total",
    headlinePrimaryMarket(
      mkDto("market_watch", "sharp_conflict", "market_watch")
    ) === "total"
  );

  // 6.3.5d core pattern: ML carries the strongest grade — ML wins (precedence-1)
  check(
    "ML=sharp_confirmed + Total=market_watch → headline grade = sharp_confirmed (preserves 6.3.5d core 4 cards)",
    headlineGrade(mkDto("sharp_confirmed", "market_watch", "market_watch")) ===
      "sharp_confirmed"
  );
  check(
    "ML=sharp_confirmed + Total=market_watch → headline market = moneyline",
    headlinePrimaryMarket(
      mkDto("sharp_confirmed", "market_watch", "market_watch")
    ) === "moneyline"
  );

  // Rank ordering: best_signal beats sharp_confirmed beats sharp_conflict
  check(
    "best_signal on NRFI outranks sharp_confirmed on ML (rank 70 > 60)",
    headlineGrade(mkDto("sharp_confirmed", "market_watch", "best_signal")) ===
      "best_signal" &&
      headlinePrimaryMarket(
        mkDto("sharp_confirmed", "market_watch", "best_signal")
      ) === "first_inning_total"
  );
  check(
    "sharp_confirmed on OU outranks sharp_conflict on ML (rank 60 > 50)",
    headlineGrade(
      mkDto("sharp_conflict", "sharp_confirmed", "market_watch")
    ) === "sharp_confirmed" &&
      headlinePrimaryMarket(
        mkDto("sharp_conflict", "sharp_confirmed", "market_watch")
      ) === "total"
  );
  check(
    "sharp_conflict on OU outranks market_led on ML (rank 50 > 40)",
    headlineGrade(mkDto("market_led", "sharp_conflict", "market_watch")) ===
      "sharp_conflict" &&
      headlinePrimaryMarket(
        mkDto("market_led", "sharp_conflict", "market_watch")
      ) === "total"
  );
  check(
    "public_smoke outranks model_only (rank 30 > 20)",
    headlineGrade(mkDto("model_only", "public_smoke", "market_watch")) ===
      "public_smoke"
  );
  check(
    "model_only outranks market_watch (rank 20 > 10)",
    headlineGrade(mkDto("market_watch", "model_only", "market_watch")) ===
      "model_only"
  );

  // Tiebreaker: equal grades → ML → OU → NRFI precedence
  check(
    "ML=sharp_confirmed + Total=sharp_confirmed → ML wins (precedence tiebreaker)",
    headlinePrimaryMarket(
      mkDto("sharp_confirmed", "sharp_confirmed", "market_watch")
    ) === "moneyline"
  );
  check(
    "Total=sharp_confirmed + NRFI=sharp_confirmed (ML=market_watch) → Total wins (precedence over NRFI)",
    headlinePrimaryMarket(
      mkDto("market_watch", "sharp_confirmed", "sharp_confirmed")
    ) === "total"
  );

  // Fix 1.3 (Gap-21): all-null grades → null (NOT market_watch fallback).
  // Pre-Fix-1.3 this branch returned market_watch as a defensive coerce,
  // which falsely implied market activity per framework §"Edge Case
  // Handling — Model didn't pick the market". Post-Fix-1.3 the UI renders
  // the honest "No Pick" treatment via GradeBadge's null variant.
  check(
    "all per-pick grades null → headlineGrade returns null (No Pick — Fix 1.3 Gap-21)",
    headlineGrade(mkDto(null, null, null)) === null
  );
  check(
    "all per-pick grades null → headlinePrimaryMarket returns null",
    headlinePrimaryMarket(mkDto(null, null, null)) === null
  );

  // Partial-null: NRFI has the only grade → NRFI is the headline
  check(
    "ML/Total null + NRFI=best_signal → headline = best_signal on NRFI",
    headlineGrade(mkDto(null, null, "best_signal")) === "best_signal" &&
      headlinePrimaryMarket(mkDto(null, null, "best_signal")) ===
        "first_inning_total"
  );

  // Fix 1.3 (Gap-21/26/27): getAttribution accepts null and returns the
  // "No Pick" copy. Locks the Flag D1 copy at the test boundary so a future
  // edit doesn't silently drift the member-facing message.
  check(
    "getAttribution(null, ...) returns 'Model didn't generate a pick...' (Flag D1 copy)",
    getAttribution(null, "—") ===
      "Model didn't generate a pick for this market."
  );

  // Live-slate audit: every game in the API response should have a
  // headline grade and market that match a non-null per-pick triplet.
  // Fix 1.3: games with all-null grades skip the rank check (they would
  // produce headlineGrade=null — covered by the pure-function test above).
  section("perPickHeadline live-slate consistency");
  let headlineMismatches = 0;
  const GRADE_RANK_LOCAL: Record<Grade, number> = {
    best_signal: 70,
    sharp_confirmed: 60,
    sharp_conflict: 50,
    market_led: 40,
    public_smoke: 30,
    model_only: 20,
    market_watch: 10,
  };
  for (const g of body.games) {
    const hg = headlineGrade(g);
    const candidates: Grade[] = [];
    if (g.predictions.ml.grade !== null) candidates.push(g.predictions.ml.grade);
    if (g.predictions.total.grade !== null)
      candidates.push(g.predictions.total.grade);
    if (g.predictions.nrfi.grade !== null)
      candidates.push(g.predictions.nrfi.grade);
    if (candidates.length === 0) {
      // All-null row — headline must be null too (Fix 1.3 Gap-21).
      if (hg !== null) headlineMismatches++;
      continue;
    }
    if (hg === null) {
      headlineMismatches++;
      continue;
    }
    const strongestRank = Math.max(...candidates.map((c) => GRADE_RANK_LOCAL[c]));
    if (GRADE_RANK_LOCAL[hg] !== strongestRank) headlineMismatches++;
  }
  check(
    "every live-slate game's headline grade equals the strongest per-pick grade (or null when all picks null)",
    headlineMismatches === 0
  );

  // ─── Fix 7.2.5 — Total card line priority (PURE unit test, no prod mutation) ─
  // The priority chain (sportsbook line > operator listed_line > null) is now a
  // pure function (app/lab/lib/selectTotalLine), verified deterministically. The
  // prior version mutated prod data (delete/insert `lines`, update sport_specific)
  // and read it back through the live route — which mutated production AND could
  // not isolate sportsbookTotalLine's LKG / line_history sources, so it failed at
  // random as live data shifted. Pure unit test = no flake, no prod mutation.
  section("Fix 7.2.5 — total.line priority chain (pure)");
  {
    const { selectTotalLine } = await import("../app/lab/lib/selectTotalLine");
    check("Fix 7.2.5: lines present \u2192 lines wins over listed_line", selectTotalLine(7.0, 9.5) === 7.0);
    check("Fix 7.2.5: no lines + listed_line \u2192 listed_line", selectTotalLine(null, 9.5) === 9.5);
    check("Fix 7.2.5: neither \u2192 null (never predicted_total)", selectTotalLine(null, null) === null);
    check("Fix 7.2.5: lines present, no listed \u2192 lines", selectTotalLine(8.5, null) === 8.5);
    check("Fix 7.2.5: 0 is a real line, not falsy-coalesced", selectTotalLine(0, 9.5) === 0);
  }
  // Tolerant integration invariant (NO prod mutation): every live DTO total.line
  // is null OR a positive finite number \u2014 never a fake 0 / predicted_total
  // substitution. Exact values are live-data-dependent and intentionally NOT
  // asserted (that was the source of the flake).
  {
    const res725 = await dailyEdge(new Request("http://x?sport=mlb&date=2026-05-22"));
    const body725 = (await res725.json()) as DailyEdgeResponse;
    const allValid725 = body725.games.every((g) => {
      const l = g.predictions.total.line;
      return l === null || (typeof l === "number" && Number.isFinite(l) && l > 0);
    });
    check("Fix 7.2.5 (integration): every total.line is null or a positive finite number", allValid725);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 4.1.8.B — DTO extension: model-side breakdown extraction + verdict
  // and Sharp Read derivation in the API
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type ExtractFn = (s: unknown) => string | null;
    type DeriveVerdictFn = (
      pred: Record<string, unknown>,
      signals?: Array<Record<string, unknown>>,
    ) => {
      headlineGrade: string | null;
      headlineMarket: string | null;
      verdict: string;
    };
    type ProjectFn = (
      signals: Array<Record<string, unknown>>,
      pred: Record<string, unknown>
    ) => Array<{ market: string; direction: string }>;
    type BuildBreakdownFn = (
      pred: Record<string, unknown>,
      signals: Array<Record<string, unknown>>
    ) => {
      verdict: { key: string; label: string };
      sharpRead: { key: string; sentence: string };
      modelBreakdown: string | null;
    };
    type MarketAwareBreakdownFn = (
      pred: Record<string, unknown>,
      signals: Array<Record<string, unknown>>,
      markets: {
        moneyline: { verdict: { key: string; label: string } };
        total: { verdict: { key: string; label: string } };
        firstInning: { verdict: { key: string; label: string } };
      }
    ) => {
      verdict: { key: string; label: string };
      sharpRead: { key: string; sentence: string };
      modelBreakdown: string | null;
    };
    const {
      extractModelBreakdown,
      deriveVerdictForRow,
      projectSharpSignalsForRead,
      buildBreakdownDto,
      marketAwareBreakdownDto,
      GRADE_RANK,
    } = await import("../app/api/lab/daily-edge/route").then(
      (m) =>
        // Cast through unknown so the test helper signatures (which use loose
        // Record<string,unknown> shapes) can address the strictly-typed
        // production __TEST__ exports. Mirrors the existing loose-cast pattern
        // used elsewhere in this file for the pre-4.1.8 extractMemberBreakdown.
        (m as unknown as {
          __TEST__: {
            extractModelBreakdown: ExtractFn;
            deriveVerdictForRow: DeriveVerdictFn;
            projectSharpSignalsForRead: ProjectFn;
            buildBreakdownDto: BuildBreakdownFn;
            marketAwareBreakdownDto: MarketAwareBreakdownFn;
            GRADE_RANK: Record<string, number>;
          };
        }).__TEST__
    );

    // ─── extractModelBreakdown: v2 namespace + legacy fallback ─────────────
    section("Phase 4.1.8.B — extractModelBreakdown reader");
    {
      // 1. v2 happy path
      const r = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "Cole has been sharp early." },
      });
      check(
        "[4.1.8.B.1] sport_specific.breakdown_v2.model_breakdown populated → returns string",
        r === "Cole has been sharp early."
      );
    }
    {
      // 2. Legacy fallback
      const r = extractModelBreakdown({
        member_summary: "Legacy single-blob copy from Phase 4.1.5.",
      });
      check(
        "[4.1.8.B.2] sport_specific.member_summary only → falls back to legacy",
        r === "Legacy single-blob copy from Phase 4.1.5."
      );
    }
    {
      // 3. Both present → v2 wins
      const r = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "v2 wins." },
        member_summary: "stale v1 should not appear",
      });
      check(
        "[4.1.8.B.3] both v2 and legacy present → v2 wins",
        r === "v2 wins."
      );
    }
    {
      // 4. Neither present
      const r = extractModelBreakdown({ other_key: "x" });
      check("[4.1.8.B.4] neither v2 nor legacy present → null", r === null);
    }
    {
      // 5. Null sport_specific
      check(
        "[4.1.8.B.5] sport_specific null → null",
        extractModelBreakdown(null) === null
      );
    }
    {
      // 6. Undefined sport_specific
      check(
        "[4.1.8.B.6] sport_specific undefined → null",
        extractModelBreakdown(undefined) === null
      );
    }
    {
      // 7. v2 with empty model_breakdown → falls through to legacy/null
      const r1 = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "" },
        member_summary: "legacy here",
      });
      check(
        "[4.1.8.B.7a] v2.model_breakdown empty + legacy present → returns legacy",
        r1 === "legacy here"
      );
      const r2 = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "" },
      });
      check("[4.1.8.B.7b] v2.model_breakdown empty + no legacy → null", r2 === null);
    }
    {
      // 8. v2 with non-string model_breakdown → falls through
      const r = extractModelBreakdown({
        breakdown_v2: { model_breakdown: 42 },
        member_summary: "ok legacy",
      });
      check(
        "[4.1.8.B.8] v2.model_breakdown non-string + legacy present → returns legacy",
        r === "ok legacy"
      );
    }
    {
      // 9. Legacy non-string → null
      const r = extractModelBreakdown({ member_summary: 123 });
      check("[4.1.8.B.9] legacy non-string + no v2 → null", r === null);
    }
    {
      // 10. Malformed v2 (not an object) is gracefully ignored
      const r = extractModelBreakdown({
        breakdown_v2: "should-be-object",
        member_summary: "fallback works",
      });
      check(
        "[4.1.8.B.10] v2 not an object → falls back to legacy",
        r === "fallback works"
      );
    }

    // ─── deriveVerdictForRow: mirrors perPickHeadline + verdictDerivation ──
    section("Phase 4.1.8.B — deriveVerdictForRow");
    function predRow(over: Record<string, unknown>): Record<string, unknown> {
      return {
        ml_grade: null,
        ou_grade: null,
        nrfi_grade: null,
        ml_confidence: null,
        ou_confidence: null,
        nrfi_confidence: null,
        sport_specific: {},
        ...over,
      };
    }
    {
      const r = deriveVerdictForRow(predRow({}));
      check(
        "[4.1.8.B.11] all grades null → verdict=no_play",
        r.verdict === "no_play" && r.headlineGrade === null && r.headlineMarket === null
      );
    }
    {
      const r = deriveVerdictForRow(
        predRow({ ml_grade: "best_signal", ml_confidence: 60 })
      );
      check(
        "[4.1.8.B.12] ml=best_signal @ 0.60 conf → verdict=best_angle, market=ml",
        r.verdict === "best_angle" && r.headlineMarket === "ml"
      );
    }
    {
      // ML has weaker grade than total — total wins headline
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "market_watch",
          ml_confidence: 64,
          ou_grade: "sharp_conflict",
          ou_confidence: 55,
        })
      );
      check(
        "[4.1.8.B.13] WSH @ ATL pattern: total=sharp_conflict outranks ml=market_watch → market=total, verdict=caution",
        r.headlineMarket === "total" && r.verdict === "caution"
      );
    }
    {
      // sharp_conflict + low confidence → still caution (4.1.8.A invariant
      // exercised through the API surface)
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "sharp_conflict",
          ml_confidence: 51,
          ou_confidence: 51,
          nrfi_confidence: 51,
        })
      );
      check(
        "[4.1.8.B.14] sharp_conflict + all confidences below floor → verdict=caution (NEVER no_play)",
        r.verdict === "caution"
      );
    }
    {
      // best_signal + all confidences below floor → no_play (floor wins
      // when sharp_conflict is NOT the grade)
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 52,
          ou_confidence: 52,
          nrfi_confidence: 52,
        })
      );
      check(
        "[4.1.8.B.15] best_signal + all confidences below 0.53 → verdict=no_play",
        r.verdict === "no_play"
      );
    }
    {
      // Cross-equivalence with GRADE_RANK
      check(
        "[4.1.8.B.16] GRADE_RANK ordering: best_signal > sharp_confirmed > sharp_conflict",
        GRADE_RANK.best_signal > GRADE_RANK.sharp_confirmed &&
          GRADE_RANK.sharp_confirmed > GRADE_RANK.sharp_conflict
      );
    }

    // ─── Phase 6B.25 — locked-game verdict freeze ────────────────────
    section("Phase 6B.25 — locked-game verdict freeze");
    {
      // Locked game with a live opposing-money signal that would normally
      // be evaluated. The 6B.25 freeze passes empty signals to the
      // conflict / support helpers for locked games, so the frozen
      // sport_specific override propagates and live drift cannot flip
      // the displayed verdict away from what was locked.
      const opposingMoneyConflictSignal = [
        { market_type: "moneyline", side: "away", public_money_pct: 78, public_betting_pct: 50 },
      ];
      const lockedPred = predRow({
        ml_grade: "best_signal",
        ml_confidence: 60,
        predicted_ml_winner: "home",
        sport_specific: { ml_best_angle_eligible: true },
        locked_at: "2026-06-07T19:15:05Z",
      });
      const locked = deriveVerdictForRow(lockedPred, opposingMoneyConflictSignal as any);
      check(
        "[6B.25.1] LOCKED game ignores live opposing-money signal — frozen best_angle preserved",
        locked.verdict === "best_angle",
      );
    }
    {
      // Locked-grade sharp_conflict (frozen in pred.ml_grade itself) is
      // NOT a live signal — locked snapshot already includes that decision.
      // The 6B.25 freeze must NOT change locked-grade-driven verdicts.
      const locked = deriveVerdictForRow(
        predRow({
          ml_grade: "sharp_conflict",
          ml_confidence: 60,
          predicted_ml_winner: "home",
          locked_at: "2026-06-07T19:15:05Z",
        }),
        [],
      );
      check(
        "[6B.25.2] locked game with locked sharp_conflict GRADE still routes to caution",
        locked.verdict === "caution",
      );
    }
    {
      // Unlocked games still respect live signals — 6B.25 only freezes
      // when locked_at !== null. Anti-regression for pre-lock UX.
      const unlocked = deriveVerdictForRow(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 60,
          predicted_ml_winner: "home",
          sport_specific: { ml_best_angle_eligible: true },
          locked_at: null,
        }),
        [],
      );
      check(
        "[6B.25.3] unlocked game + no signals still resolves to best_angle (no regression)",
        unlocked.verdict === "best_angle",
      );
    }

    // ─── MLB-P0 (2026-06-13) — pre-lock requires-confirmation gate ────────
    // A would-be Best Angle whose RAW edge was capped (requires_market_
    // confirmation) must NOT surface as Best Angle PRE-LOCK: the verdict path
    // has no line-direction signal, and an unavailable signal can't confirm.
    // It silently softening to Lean at lock is the unqualified-BA the contract
    // forbids. These exercise a DOWNGRADED grade the override re-promotes.
    section("MLB-P0 — pre-lock requires-confirmation gate");
    {
      // Pre-lock + eligible + requires-confirmation → re-promotion suppressed.
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "market_watch",
          ml_confidence: 60,
          predicted_ml_winner: "home",
          sport_specific: { v2_2_audit: { ml_best_angle_eligible: true, ml_requires_market_confirmation: true, ml_edge_pct: 4 } },
          locked_at: null,
        }),
        [],
      );
      check(
        "[MLB-P0.1] pre-lock + requires_confirmation → NOT best_angle (held)",
        r.verdict !== "best_angle",
      );
    }
    {
      // Pre-lock + eligible + NOT requiring confirmation → promotes normally.
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "market_watch",
          ml_confidence: 60,
          predicted_ml_winner: "home",
          sport_specific: { v2_2_audit: { ml_best_angle_eligible: true, ml_requires_market_confirmation: false, ml_edge_pct: 4 } },
          locked_at: null,
        }),
        [],
      );
      check(
        "[MLB-P0.2] pre-lock + no confirmation needed → best_angle (no over-suppression)",
        r.verdict === "best_angle",
      );
    }
    {
      // LOCKED + requires-confirmation → pre-lock gate does NOT apply; the
      // frozen eligibility propagates (locked snapshot already resolved it).
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "market_watch",
          ml_confidence: 60,
          predicted_ml_winner: "home",
          sport_specific: { v2_2_audit: { ml_best_angle_eligible: true, ml_requires_market_confirmation: true, ml_edge_pct: 4 } },
          locked_at: "2026-06-13T19:15:05Z",
        }),
        [],
      );
      check(
        "[MLB-P0.3] LOCKED + requires_confirmation → gate scoped to pre-lock (frozen flag propagates)",
        r.verdict === "best_angle",
      );
    }

    // ─── projectSharpSignalsForRead: market normalization + direction ─────
    section("Phase 4.1.8.B — projectSharpSignalsForRead");
    {
      const projected = projectSharpSignalsForRead(
        [
          { market_type: "moneyline" },
          { market_type: "total" },
          { market_type: "first_inning_total" },
        ],
        predRow({
          ml_grade: "best_signal",
          ou_grade: "sharp_conflict",
          nrfi_grade: null,
        })
      );
      check(
        "[4.1.8.B.17] moneyline → market=ml, best_signal → direction=positive",
        projected[0]?.market === "ml" && projected[0]?.direction === "positive"
      );
      check(
        "[4.1.8.B.18] total → market=total, sharp_conflict → direction=negative",
        projected[1]?.market === "total" && projected[1]?.direction === "negative"
      );
      check(
        "[4.1.8.B.19] first_inning_total → market=nrfi, null grade → direction=neutral",
        projected[2]?.market === "nrfi" && projected[2]?.direction === "neutral"
      );
    }

    // ─── buildBreakdownDto: integration through the full surface ──────────
    section("Phase 4.1.8.B — buildBreakdownDto integration");
    {
      // 20. Empty row → no_play + no_data + null modelBreakdown
      const r = buildBreakdownDto(predRow({}), []);
      check(
        "[4.1.8.B.20] empty row → verdict=no_play + sharpRead=no_data + modelBreakdown=null",
        r.verdict.key === "no_play" &&
          r.verdict.label === "No Play" &&
          r.sharpRead.key === "no_data" &&
          r.modelBreakdown === null
      );
    }
    {
      // 21. Strong play + sharp support
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 60,
          sport_specific: {
            breakdown_v2: { model_breakdown: "Cole has been sharp early." },
          },
        }),
        [{ market_type: "moneyline" }]
      );
      check(
        "[4.1.8.B.21] best_signal + sharp signal on ml → verdict=best_angle + sharpRead=support + modelBreakdown=v2",
        r.verdict.key === "best_angle" &&
          r.verdict.label === "Best Angle" &&
          r.sharpRead.key === "support" &&
          r.sharpRead.sentence === "Sharp signals support this pick." &&
          r.modelBreakdown === "Cole has been sharp early."
      );
    }
    {
      // 22. Caution: sharp_conflict on total
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "market_watch",
          ou_grade: "sharp_conflict",
          ou_confidence: 55,
          sport_specific: {
            breakdown_v2: { model_breakdown: "Top of the order adds risk." },
          },
        }),
        [{ market_type: "total" }]
      );
      check(
        "[4.1.8.B.22] sharp_conflict on total → verdict=caution + sharpRead=push_against",
        r.verdict.key === "caution" &&
          r.sharpRead.key === "push_against" &&
          r.sharpRead.sentence ===
            "Sharp signals push against the model, so use caution."
      );
    }
    {
      // 23. Legacy fallback path still works (no v2 namespace)
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "market_watch",
          ml_confidence: 64,
          sport_specific: {
            member_summary: "Pre-4.1.8.B legacy text.",
          },
        }),
        []
      );
      check(
        "[4.1.8.B.23] legacy member_summary surfaces as modelBreakdown when v2 absent",
        r.modelBreakdown === "Pre-4.1.8.B legacy text." &&
          r.verdict.key === "watchlist" &&
          r.sharpRead.key === "no_data"
      );
    }
    {
      // 24. Operator keys never leak — verify the returned object has only
      //     the three approved fields
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 60,
          sport_specific: {
            breakdown_v2: { model_breakdown: "ok" },
            operator_detail: "INTERNAL: should never leak",
            breakdown_version: "v2.0",
            breakdown_generated_at: "2026-05-30T12:00:00Z",
          },
        }),
        []
      );
      const keys = Object.keys(r).sort();
      check(
        "[4.1.8.B.24a] breakdown DTO has exactly {verdict, sharpRead, modelBreakdown}",
        keys.length === 3 &&
          keys[0] === "modelBreakdown" &&
          keys[1] === "sharpRead" &&
          keys[2] === "verdict"
      );
      check(
        "[4.1.8.B.24b] breakdown DTO does not include operator_detail",
        !("operator_detail" in r) && !("operatorDetail" in r)
      );
      check(
        "[4.1.8.B.24c] breakdown DTO does not include breakdown_version",
        !("breakdown_version" in r) && !("breakdownVersion" in r)
      );
      check(
        "[4.1.8.B.24d] breakdown DTO does not include breakdown_generated_at",
        !("breakdown_generated_at" in r) && !("breakdownGeneratedAt" in r)
      );
    }
    {
      // 25. v2 wins over legacy when both present (integration form)
      const r = buildBreakdownDto(
        predRow({
          sport_specific: {
            breakdown_v2: { model_breakdown: "v2 fresh text" },
            member_summary: "stale v1 lingering",
          },
        }),
        []
      );
      check(
        "[4.1.8.B.25] both v2 and legacy present → modelBreakdown is v2",
        r.modelBreakdown === "v2 fresh text"
      );
    }
    {
      const r = marketAwareBreakdownDto(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 64,
          sport_specific: {
            breakdown_v2: { model_breakdown: "legacy row grade says Best Angle." },
          },
        }),
        [],
        {
          moneyline: { verdict: { key: "lean", label: "Lean" } },
          total: { verdict: { key: "watchlist", label: "Watchlist" } },
          firstInning: { verdict: { key: "no_play", label: "No Play" } },
        }
      );
      check(
        "[4.1.8.B.26] market-aware breakdown cannot show game Best Angle when strongest tracked market is Lean",
        r.verdict.key === "lean" && r.verdict.label === "Lean"
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 4.1.8.B — cross-equivalence with perPickHeadline.ts (Sub-D2 risk R3)
  // ═══════════════════════════════════════════════════════════════════════════
  // Confirm the inlined GRADE_RANK + ordering in route.ts matches the
  // client helper at app/lab/lib/perPickHeadline.ts. Single failure here
  // means the two derivations drifted; consolidate before shipping.
  {
    const { headlineGrade } = await import("../app/lab/lib/perPickHeadline");
    const { deriveVerdictForRow } = await import(
      "../app/api/lab/daily-edge/route"
    ).then(
      (m) =>
        (m as unknown as {
          __TEST__: {
            deriveVerdictForRow: (
              p: Record<string, unknown>
            ) => { headlineGrade: string | null; headlineMarket: string | null };
          };
        }).__TEST__
    );

    // Three patterns drawn from observed 5/22 slate behavior
    const fixtures: Array<{
      label: string;
      ml: string | null;
      ou: string | null;
      nrfi: string | null;
      expectGrade: string | null;
    }> = [
      {
        label: "WSH @ ATL pattern: ml=market_watch + total=sharp_conflict + nrfi=market_watch",
        ml: "market_watch",
        ou: "sharp_conflict",
        nrfi: "market_watch",
        expectGrade: "sharp_conflict",
      },
      {
        label: "NYM @ PHI pattern: ml=sharp_confirmed + rest=market_watch",
        ml: "sharp_confirmed",
        ou: "market_watch",
        nrfi: "market_watch",
        expectGrade: "sharp_confirmed",
      },
      {
        label: "All null pattern: no grades",
        ml: null,
        ou: null,
        nrfi: null,
        expectGrade: null,
      },
    ];

    for (const fx of fixtures) {
      const clientGrade = headlineGrade({
        predictions: {
          ml: { grade: fx.ml as never, signalType: null, marketSignal: null } as never,
          total: {
            grade: fx.ou as never,
            signalType: null,
            marketSignal: null,
          } as never,
          nrfi: {
            grade: fx.nrfi as never,
            signalType: null,
            marketSignal: null,
          } as never,
        },
      } as never);
      const serverResult = deriveVerdictForRow({
        ml_grade: fx.ml,
        ou_grade: fx.ou,
        nrfi_grade: fx.nrfi,
        ml_confidence: 60,
        ou_confidence: 60,
        nrfi_confidence: 60,
      });
      check(
        `[4.1.8.B.equiv] ${fx.label} — server headlineGrade matches client (${
          serverResult.headlineGrade ?? "null"
        })`,
        serverResult.headlineGrade === fx.expectGrade &&
          clientGrade === fx.expectGrade
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 4.1.10 — per-market enrichment + status + lock placeholders
  // ──────────────────────────────────────────────────────────────────────
  section("4.1.10: DTO additives (per-market markets, status, lock placeholders)");
  {
    // Use the same live response we fetched at the top of main().
    const liveRes = await dailyEdge(
      new Request(`https://x/api/lab/daily-edge?sport=mlb&date=${SLATE_DATE}`)
    );
    const liveBody = (await liveRes.json()) as DailyEdgeResponse;
    if (!liveBody.games || liveBody.games.length === 0) {
      check("response has at least one game (precondition)", false);
    } else {
      const sample = liveBody.games[0]!;

      // ── lock fields (Phase 4.2.B) ──
      check(
        "[4.1.10] scheduledLockAt is a valid ISO string",
        typeof sample.scheduledLockAt === "string" &&
          !Number.isNaN(Date.parse(sample.scheduledLockAt))
      );
      // Phase 4.2.B — lockState is now driven by classifyLockState. The
      // visible-slate fallback (2026-05-22) has game_date in the past so
      // classifier returns "already_started", which the DTO maps to
      // "locked". For an actively-running slate the value would be "open"
      // or "locking". Accept any of the three valid enum values.
      check(
        `[4.2.B] lockState is one of "open"|"locking"|"locked"`,
        sample.lockState === "open" ||
          sample.lockState === "locking" ||
          sample.lockState === "locked"
      );
      // Pre-Phase 4.2.D cron activation, locked_at is NULL for every
      // existing row (the DDL added the column with no backfill). Lock
      // transitions only happen when pregame-sweep cron runs. So this
      // assertion still holds: until cron is scheduled, lockedAt stays
      // null even though lockState may map to "locked" (via the
      // already_started fallback for past slates).
      check(`[4.2.B] lockedAt === null pre-cron-activation`, sample.lockedAt === null);
      check(
        `[4.2.B] updatedAt is string|null`,
        sample.updatedAt === null || typeof sample.updatedAt === "string"
      );
      check(
        `[4.1.10] generatedAt is string|null`,
        sample.generatedAt === null || typeof sample.generatedAt === "string"
      );
      check(`[4.1.10] result === null pre-grading`, sample.result === null);

      // ── status block ──
      check(
        "[4.1.10] status.lineupConfirmed is boolean|null",
        sample.status.lineupConfirmed === null || typeof sample.status.lineupConfirmed === "boolean"
      );
      check("[4.1.10] status.linesLocked is boolean", typeof sample.status.linesLocked === "boolean");
      check("[4.1.10] status.sharpSignalPending is boolean", typeof sample.status.sharpSignalPending === "boolean");
      check("[4.1.10] status.marketDataLimited is boolean", typeof sample.status.marketDataLimited === "boolean");

      // ── decisionLine ──
      check("[4.1.10] decisionLine is a non-empty string", typeof sample.decisionLine === "string" && sample.decisionLine.length > 0);

      // ── markets block: all three present ──
      check("[4.1.10] markets.moneyline is present", typeof sample.markets?.moneyline === "object" && sample.markets.moneyline !== null);
      check("[4.1.10] markets.total is present", typeof sample.markets?.total === "object" && sample.markets.total !== null);
      check("[4.1.10] markets.first_inning is present", typeof sample.markets?.first_inning === "object" && sample.markets.first_inning !== null);

      // ── per-market shape ──
      const m = sample.markets.moneyline;
      check("[4.1.10] moneyline.verdict.key set", typeof m.verdict?.key === "string");
      check("[4.1.10] moneyline.verdict.label set", typeof m.verdict?.label === "string");
      check("[4.1.10] moneyline.guidedGuide non-empty", typeof m.guidedGuide === "string" && m.guidedGuide.length > 0);
      check("[4.1.10] moneyline.guidedWatchOut non-empty", typeof m.guidedWatchOut === "string" && m.guidedWatchOut.length > 0);
      check("[4.1.10] moneyline.whyLine non-empty", typeof m.whyLine === "string" && m.whyLine.length > 0);
      check("[4.1.10] moneyline.riskLine non-empty", typeof m.riskLine === "string" && m.riskLine.length > 0);
      check("[4.1.10] moneyline.modelProb is number 0-1", typeof m.modelProb === "number" && m.modelProb >= 0 && m.modelProb <= 1);
      check("[4.1.10] moneyline.keyStats is an array", Array.isArray(m.keyStats));

      // ── first_inning: splits fields are always null in V1 ──
      const fi = sample.markets.first_inning;
      check("[4.1.10] first_inning.moneyPct === null (V1)", fi.moneyPct === null);
      check("[4.1.10] first_inning.betsPct === null (V1)", fi.betsPct === null);
      // First-inning copy must not reference public splits / sharps
      const fiCopy = `${fi.guidedGuide} ${fi.guidedWatchOut} ${fi.whyLine} ${fi.riskLine}`.toLowerCase();
      const forbidden = ["public split", "public bet", "public money", "handle %", "bet %", "sharp action", "sharp money"];
      const dirty = forbidden.find((t) => fiCopy.includes(t));
      check(`[4.1.10] first_inning copy does not reference splits/sharps`, dirty === undefined, dirty ? `contained "${dirty}"` : undefined);

      // ── totals-only fields ──
      const t = sample.markets.total;
      check(`[4.1.10] total.modelTotal is number|null`, t.modelTotal === null || typeof t.modelTotal === "number");
      check(`[4.1.10] total.marketTotal is number|null`, t.marketTotal === null || typeof t.marketTotal === "number");

      // ── existing `predictions` block STILL present (backwards compat) ──
      check("[4.1.10] predictions.ml still present (backwards compat)", typeof sample.predictions?.ml === "object");
      check("[4.1.10] predictions.total still present", typeof sample.predictions?.total === "object");
      check("[4.1.10] predictions.nrfi still present", typeof sample.predictions?.nrfi === "object");

      // ── no banned terms in user-facing copy across ALL games ──
      const allCopyOk = liveBody.games.every((g) => {
        const fields = [
          g.decisionLine,
          g.markets.moneyline.guidedGuide,
          g.markets.moneyline.guidedWatchOut,
          g.markets.moneyline.whyLine,
          g.markets.moneyline.riskLine,
          g.markets.total.guidedGuide,
          g.markets.total.guidedWatchOut,
          g.markets.total.whyLine,
          g.markets.total.riskLine,
          g.markets.first_inning.guidedGuide,
          g.markets.first_inning.guidedWatchOut,
          g.markets.first_inning.whyLine,
          g.markets.first_inning.riskLine,
          ...g.markets.moneyline.keyStats.map((k) => k.label),
          ...g.markets.total.keyStats.map((k) => k.label),
          ...g.markets.first_inning.keyStats.map((k) => k.label),
        ];
        // Replicate the banned-terms regex locally to keep the test self-contained.
        const bannedRe = /\b(pinnacle|expected value|vig|vigorish|juice|consensus|reverse line movement|closing line value|book hold|arbitrage|arb)\b|\+\s*EV\b|\bEV\b|\bRLM\b|\bCLV\b|\bno[- ]vig\b|\bde[- ]vig(?:ged)?\b/i;
        return fields.every((f) => !bannedRe.test(f));
      });
      check(`[4.1.10] no banned terms across ${liveBody.games.length} games × all copy fields`, allCopyOk);
    }
  }

  // ─── Phase 6B.30A — Daily Edge never silently drops scheduled games ────
  section("Phase 6B.30A — no silent drop of scheduled games");
  {
    // Get today's official scheduled game count from `games` table for
    // any slate_date that has games. Compare to Daily Edge card count.
    // Pre-6B.30A: route returned null for games without game_predictions
    // → card count < game count when a starter was unresolved.
    // Post-6B.30A: every scheduled game emits a card, with a pending
    // hold_reason when no prediction row exists yet.
    const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const { data: dbGames } = await supabase
      .from("games")
      .select("id, external_id, game_predictions(id)")
      .eq("sport", "mlb")
      .eq("slate_date", ET_TODAY)
      .in("slate_status", ["published", "preview_only"]);
    const dbGameCount = (dbGames ?? []).length;
    const dbGamesWithPred = (dbGames ?? []).filter(
      (g: any) => g.game_predictions && (Array.isArray(g.game_predictions) ? g.game_predictions.length > 0 : !!g.game_predictions)
    ).length;

    // Fetch Daily Edge response for today
    const req6B30 = new Request(`http://localhost/api/lab/daily-edge?sport=mlb&date=${ET_TODAY}`);
    const res6B30 = await dailyEdge(req6B30);
    if (res6B30.status === 200) {
      const body6B30 = (await res6B30.json()) as DailyEdgeResponse;
      check(
        `[6B.30A] Daily Edge card count (${body6B30.games.length}) equals official games table count (${dbGameCount}), not games-with-predictions count (${dbGamesWithPred})`,
        body6B30.games.length === dbGameCount,
        `If they don't match, the silent-drop bug has regressed.`
      );
      // For each game in body, every game must be present — the prior bug was that games
      // without predictions returned null and were filtered out.
      const dbExternalIds = new Set((dbGames ?? []).map((g: any) => g.external_id));
      const apiExternalIds = new Set(body6B30.games.map((g) => g.external_id));
      const missingFromApi = Array.from(dbExternalIds).filter((id) => !apiExternalIds.has(id as number));
      check(
        `[6B.30A] zero scheduled games are missing from Daily Edge response`,
        missingFromApi.length === 0,
        missingFromApi.length > 0 ? `missing external_ids: ${missingFromApi.join(", ")}` : undefined
      );
      // For any card whose game has NO game_predictions row in DB, assert
      // it renders as a held/pending card (no actionable picks).
      const dbGamesNoPred = (dbGames ?? []).filter(
        (g: any) => !(g.game_predictions && (Array.isArray(g.game_predictions) ? g.game_predictions.length > 0 : !!g.game_predictions))
      );
      let pendingCardsWithBadShape = 0;
      let pendingCardsCount = 0;
      for (const dbg of dbGamesNoPred as any[]) {
        const card = body6B30.games.find((g) => g.external_id === dbg.external_id);
        if (!card) continue;
        pendingCardsCount++;
        // Pending card: all market picks must be null AND holdReason must be set
        const allPicksNull =
          card.predictions.ml.pick === null &&
          card.predictions.total.pick === null &&
          card.predictions.nrfi.pick === null;
        const allConfidencesNull =
          card.predictions.ml.confidence === null &&
          card.predictions.total.confidence === null &&
          card.predictions.nrfi.confidence === null;
        const reasonPresent = card.holdReason !== null;
        if (!allPicksNull || !allConfidencesNull || !reasonPresent) {
          pendingCardsWithBadShape++;
          console.log(`     pending card ${dbg.external_id}: allPicksNull=${allPicksNull} allConfidencesNull=${allConfidencesNull} reasonPresent=${reasonPresent}`);
        }
      }
      check(
        `[6B.30A] all pending cards (${pendingCardsCount}) carry null picks + null confidence + holdReason`,
        pendingCardsWithBadShape === 0
      );
    } else {
      check(`[6B.30A] Daily Edge route returns 200 for today`, false, `got status ${res6B30.status}`);
    }
  }

  // ─── Phase 6B.30C++ — formatPickWithLine null state by market ────────────
  //
  // FI null/held renders as "Toss-Up" — the existing model-emitted neutral
  // state with its own visual treatment (R-16H Fix 2, R-16J 47-53%
  // threshold). Grading treats null FI and emitted Toss-Up identically
  // as no_bet, so the customer-facing pill matches a conservative-call
  // appearance without polluting tracking or prediction_records.
  //
  // ML/OU null/held continues to render as "Held" — these markets have
  // no model-defined neutral middle band, so "Held" is the honest copy
  // for the genuinely unsafe / no-pick state.
  //
  // Regression guard: the bare em-dash "—" must never leak through for
  // null picks on any market.
  section("Phase 6B.30C++ — formatPickWithLine null state (FI → Toss-Up, ML/OU → Held)");
  {
    const mod = await import("../app/lab/components/daily-edge/DailyEdgeShell");
    const fn = (mod as { formatPickWithLine?: (m: "moneyline" | "total" | "first_inning", p: string | null, l: number | null) => string }).formatPickWithLine;
    if (typeof fn === "function") {
      // ── Null pick — branched by market ──
      check(`[6B.30C++] formatPickWithLine(first_inning, null, null) → "Toss-Up"`, fn("first_inning", null, null) === "Toss-Up");
      check(`[6B.30C++] formatPickWithLine(moneyline, null, null) → "Held" (no model neutral state for ML)`, fn("moneyline", null, null) === "Held");
      check(`[6B.30C++] formatPickWithLine(total, null, 8.5) → "Held" (no model neutral state for OU)`, fn("total", null, 8.5) === "Held");
      // ── Real pick — unaffected by null branch ──
      check(`[6B.30C++] formatPickWithLine(moneyline, "PHI", null) → "PHI" (real pick unaffected)`, fn("moneyline", "PHI", null) === "PHI");
      check(`[6B.30C++] formatPickWithLine(total, "Over", 8.5) → "Over 8.5" (real pick + line unaffected)`, fn("total", "Over", 8.5) === "Over 8.5");
      check(`[6B.30C++] formatPickWithLine(first_inning, "NRFI", null) → "NRFI" (real pick unaffected)`, fn("first_inning", "NRFI", null) === "NRFI");
      check(`[6B.30C++] formatPickWithLine(first_inning, "YRFI", null) → "YRFI" (real pick unaffected)`, fn("first_inning", "YRFI", null) === "YRFI");
      check(`[6B.30C++] formatPickWithLine(first_inning, "Toss-Up", null) → "Toss-Up" (model-emitted Toss-Up passthrough)`, fn("first_inning", "Toss-Up", null) === "Toss-Up");
      // ── Regression guards ──
      check(`[6B.30C++] formatPickWithLine never returns "—" for null pick`,
        fn("moneyline", null, null) !== "—" && fn("total", null, null) !== "—" && fn("first_inning", null, null) !== "—");
      check(`[6B.30C++] formatPickWithLine FI null and ML null are intentionally different`,
        fn("first_inning", null, null) !== fn("moneyline", null, null));
      check(`[6B.30C++] formatPickWithLine FI null and OU null are intentionally different`,
        fn("first_inning", null, null) !== fn("total", null, null));
      check(`[6B.30C++] formatPickWithLine ML null and OU null share the "Held" copy`,
        fn("moneyline", null, null) === fn("total", null, null));
    } else {
      check(`[6B.30C++] formatPickWithLine is not exported — fix can't be verified at unit level`, false, "expose formatPickWithLine for testing");
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  section("Locked movement keeps the sportsbook identity captured at lock");
  {
    const recommendationSnapshot = { game_id: 2, market_type: "moneyline", sportsbook: "recommendation_snapshot", side: "home", line_value: null, odds_american: -152, fetched_at: "2026-08-10T17:44:00Z" };
    const currentBallybet = { game_id: 2, market_type: "moneyline", sportsbook: "ballybet", side: "home", line_value: null, odds_american: -152, fetched_at: "2026-08-10T17:43:00Z" };
    const resolvedTrailRow = dailyEdgeTest.resolveTrailPriceRow({
      priceRow: recommendationSnapshot,
      bestAvailablePriceRow: currentBallybet,
      currentAmerican: -152,
      currentLine: null,
      locked: false,
    });
    check(
      "recommendation-snapshot current price recovers a matching real-book trail identity",
      resolvedTrailRow?.sportsbook === "ballybet" && resolvedTrailRow?.odds_american === -152,
    );
    check(
      "recommendation-snapshot price never borrows a mismatched real-book quote",
      dailyEdgeTest.resolveTrailPriceRow({
        priceRow: recommendationSnapshot,
        bestAvailablePriceRow: { ...currentBallybet, odds_american: -141 },
        currentAmerican: -152,
        currentLine: null,
        locked: false,
      })?.sportsbook === "recommendation_snapshot",
    );

    const sportsbook = dailyEdgeTest.readLockedSnapshotSportsbook(
      { odds_source_at_lock_ou: { under: { book: "pinnacle", line: 9.5, odds: -130 } } },
      "total",
      "under",
    );
    const trail = dailyEdgeTest.buildPersistedOddsTrail({
      candidates: [
        { id: 1, game_id: 1, market_type: "total", sportsbook: "sx_bet", side: "under", line_value: 9.5, odds_american: -118, recorded_at: "2026-08-09T10:00:00Z" },
        { id: 2, game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 9.5, odds_american: -120, recorded_at: "2026-08-09T10:01:00Z" },
        { id: 3, game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 9.5, odds_american: -117, recorded_at: "2026-08-09T10:02:00Z" },
        { id: 4, game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 9.5, odds_american: 460, recorded_at: "2026-08-09T10:04:00Z" },
      ],
      priceRow: { game_id: 1, market_type: "total", sportsbook: "locked_snapshot", side: "under", line_value: 9.5, odds_american: -130, fetched_at: "2026-08-09T10:03:00Z" },
      currentAmerican: -130,
      currentLine: 9.5,
      currentObservedAt: "2026-08-09T10:03:00Z",
      lockedAmerican: -130,
      lockedAt: "2026-08-09T10:03:00Z",
      terminalSportsbook: sportsbook,
    });
    check("locked total source resolves the selected side's book", sportsbook === "pinnacle");
    check(
      "locked trail excludes cross-book opener fallbacks",
      trail.length === 3 && trail.every((stop) => stop.sportsbook === "pinnacle") && trail[0]?.american === -120 && trail[2]?.american === -130,
    );
    check(
      "locked trail excludes every post-lock line-history observation",
      trail.every((stop) =>
        stop.american !== 460 &&
        (stop.observedAt === null || Date.parse(stop.observedAt) <= Date.parse("2026-08-09T10:03:00Z"))
      ),
    );
    const opposingHistoryTrail = dailyEdgeTest.buildPersistedOddsTrail({
      candidates: [
        { id: 5, game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 9.5, odds_american: 104, recorded_at: "2026-08-09T10:01:00Z" },
        { id: 6, game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 9.5, odds_american: 108, recorded_at: "2026-08-09T10:02:00Z" },
      ],
      priceRow: { game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 9.5, odds_american: 108, fetched_at: null, odds_american_observed_at: "2026-08-09T10:02:00Z" },
      currentAmerican: 108,
      currentLine: 9.5,
      currentObservedAt: "2026-08-09T10:02:00Z",
      lockedAmerican: null,
      lockedAt: "2026-08-09T10:03:00Z",
      terminalSportsbook: "pinnacle",
      terminalSource: "line_history",
    });
    check(
      "locked opposing trails retain a truthful history-backed terminal",
      opposingHistoryTrail.length === 2 &&
        opposingHistoryTrail[1]?.source === "line_history" &&
        opposingHistoryTrail[1]?.label === "current" &&
        opposingHistoryTrail[1]?.american === 108,
    );

    const cachedLockedBody = {
      games: [{
        lockState: "locked",
        lockedAt: "2026-08-09T10:03:00Z",
        generatedAt: "2026-08-09T10:10:00Z",
        updatedAt: "2026-08-09T10:10:00Z",
        markets: {
          moneyline: {
            pick: "ATL",
            oddsTrail: [
              { american: -155, line: null, observedAt: "2026-08-09T10:02:00Z", sportsbook: "ballybet", source: "line_history", label: "first" },
              { american: 460, line: null, observedAt: "2026-08-09T10:04:00Z", sportsbook: "ballybet", source: "line_history", label: "move" },
              { american: -155, line: null, observedAt: "2026-08-09T10:03:00Z", sportsbook: "ballybet", source: "locked_snapshot", label: "locked" },
            ],
            opposingOddsTrail: {
              side: "away",
              label: "NYM",
              stops: [
                { american: 135, line: null, observedAt: "2026-08-09T10:02:00Z", sportsbook: "ballybet", source: "line_history", label: "first" },
                { american: 138, line: null, observedAt: "2026-08-09T10:02:30Z", sportsbook: "ballybet", source: "line_history", label: "move" },
                { american: -550, line: null, observedAt: "2026-08-09T10:04:00Z", sportsbook: "ballybet", source: "line_history", label: "move" },
              ],
            },
            publicSplits: [
              { side: "home", label: "ATL", moneyPct: 72, betsPct: 64, observedAt: "2026-08-09T10:04:00Z" },
              { side: "away", label: "NYM", moneyPct: 28, betsPct: 36, observedAt: "2026-08-09T10:04:00Z" },
            ],
            marketReadV2: { generatedAt: "2026-08-09T10:04:00Z", evidenceAsOf: "2026-08-09T10:04:00Z", movement: { observedAt: "2026-08-09T10:04:00Z" } },
            recommendationDecision: { consensusSplits: { rows: [
              { side: "home", label: "ATL", moneyPct: 59, betsPct: 55, observedAt: "2026-08-09T10:02:00Z" },
              { side: "away", label: "NYM", moneyPct: 41, betsPct: 45, observedAt: "2026-08-09T10:02:00Z" },
            ] } },
          },
          total: {
            pick: "Under 187.5",
            priceAmerican: -110,
            lockedLineAmerican: -110,
            line: 187.5,
            oddsTrail: [
              { american: -110, line: 184.5, observedAt: "2026-08-09T09:00:00Z", sportsbook: "fanduel", source: "line_history", label: "first" },
              { american: -112, line: 187.5, observedAt: "2026-08-09T10:02:00Z", sportsbook: "fanduel", source: "line_history", label: "move" },
              { american: -110, line: 187.5, observedAt: "2026-08-09T10:03:00Z", sportsbook: "fanduel", source: "locked_snapshot", label: "locked" },
            ],
            publicSplits: [],
            marketReadV2: {
              generatedAt: "2026-08-09T10:02:00Z",
              evidenceAsOf: "2026-08-09T10:02:00Z",
              movement: { currentPrice: -112, currentLine: 187.5, observedAt: "2026-08-09T10:02:00Z" },
            },
            recommendationDecision: null,
          },
        },
      }],
    } as any;
    dailyEdgeTest.enforceLockedCardCutoff(cachedLockedBody);
    const sanitized = cachedLockedBody.games[0].markets.moneyline;
    check("cached locked cards discard post-lock in-game odds", sanitized.oddsTrail.every((stop: any) => stop.american !== 460));
    check("cached locked cards also discard post-lock opposite-side odds", sanitized.opposingOddsTrail.stops.length === 2 && sanitized.opposingOddsTrail.stops.every((stop: any) => stop.american !== -550));
    check("cached locked cards retain a coherent opposite-side terminal", sanitized.opposingOddsTrail.stops[0]?.label === "first" && sanitized.opposingOddsTrail.stops[1]?.label === "locked" && sanitized.opposingOddsTrail.stops[1]?.american === 138);
    check("cached locked cards restore persisted pre-lock consensus splits", sanitized.publicSplits[0]?.moneyPct === 59 && sanitized.publicSplits[1]?.moneyPct === 41);
    check("cached locked cards discard post-lock generated market reads", sanitized.marketReadV2 === null);
    const sanitizedTotal = cachedLockedBody.games[0].markets.total;
    check(
      "cached locked market reads use the visible frozen terminal price",
      sanitizedTotal.marketReadV2?.movement?.currentPrice === -110 &&
        sanitizedTotal.marketReadV2?.movement?.currentLine === 187.5 &&
        sanitizedTotal.marketReadV2?.movement?.observedAt === "2026-08-09T10:03:00Z",
    );

    const currentTrail = dailyEdgeTest.buildPersistedOddsTrail({
      candidates: [
        { id: 11, game_id: 2, market_type: "moneyline", sportsbook: "ballybet", side: "home", line_value: null, odds_american: -152, recorded_at: "2026-08-10T08:06:00Z" },
        { id: 12, game_id: 2, market_type: "moneyline", sportsbook: "ballybet", side: "home", line_value: null, odds_american: -141, recorded_at: "2026-08-10T15:43:00Z" },
      ],
      priceRow: { game_id: 2, market_type: "moneyline", sportsbook: "ballybet", side: "home", line_value: null, odds_american: -152, fetched_at: "2026-08-10T17:43:00Z" },
      currentAmerican: -152,
      currentLine: null,
      currentObservedAt: "2026-08-10T17:43:00Z",
      lockedAmerican: null,
      lockedAt: null,
      terminalSportsbook: "ballybet",
    });
    check(
      "unlocked same-book trail ends at the verified current quote, not the last historical move",
      currentTrail.length === 3 && currentTrail[1]?.american === -141 && currentTrail[1]?.label === "move" && currentTrail[2]?.american === -152 && currentTrail[2]?.label === "current" && currentTrail[2]?.sportsbook === "ballybet",
    );
    const terminalMove = dailyEdgeTest.terminalOddsMoveFromTrail(currentTrail);
    check(
      "movement summary uses the same terminal quote shown by the selected-side trail",
      terminalMove.previousAmerican === -141 && terminalMove.currentAmerican === -152 && terminalMove.observedAt === "2026-08-10T17:43:00Z",
    );
    const cachedUnlockedBody = {
      games: [{ lockState: "unlocked", markets: { total: {
        priceAmerican: -152,
        priceObservedAt: "2026-08-10T17:43:00Z",
        oddsTrail: currentTrail,
        lastMovePrevAmerican: -141,
        lastMoveNextAmerican: -140,
        lastMoveAtIso: "2026-08-10T15:43:00Z",
        lastMoveLinePrev: 9,
        lastMoveLineNext: 9,
      } } }],
    } as any;
    dailyEdgeTest.suppressIncomparableLineMovePrices(cachedUnlockedBody);
    check(
      "stored unlocked responses repair movement summary to the visible trail terminal",
      cachedUnlockedBody.games[0].markets.total.lastMovePrevAmerican === -141 &&
        cachedUnlockedBody.games[0].markets.total.lastMoveNextAmerican === -152 &&
        cachedUnlockedBody.games[0].markets.total.lastMoveAtIso === "2026-08-10T17:43:00Z",
    );
    cachedUnlockedBody.games[0].markets.total.priceAmerican = -149;
    dailyEdgeTest.suppressIncomparableLineMovePrices(cachedUnlockedBody);
    check(
      "unknown-source current quote suppresses a false cross-source prior stop",
      cachedUnlockedBody.games[0].markets.total.lastMovePrevAmerican === null &&
        cachedUnlockedBody.games[0].markets.total.lastMoveNextAmerican === -149,
    );

    const noCrossBookTrail = dailyEdgeTest.buildPersistedOddsTrail({
      candidates: [
        { id: 21, game_id: 3, market_type: "total", sportsbook: "fanduel", side: "over", line_value: 9, odds_american: -110, recorded_at: "2026-08-10T10:00:00Z" },
        { id: 22, game_id: 3, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 9, odds_american: -108, recorded_at: "2026-08-10T10:01:00Z" },
        { id: 23, game_id: 3, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 9, odds_american: -105, recorded_at: "2026-08-10T10:02:00Z" },
        { id: 24, game_id: 3, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 9, odds_american: -102, recorded_at: "2026-08-10T10:03:00Z" },
      ],
      priceRow: { game_id: 3, market_type: "total", sportsbook: "fanduel", side: "over", line_value: 9, odds_american: -107, fetched_at: "2026-08-10T10:04:00Z" },
      currentAmerican: -107,
      currentLine: 9,
      currentObservedAt: "2026-08-10T10:04:00Z",
      lockedAmerican: null,
      lockedAt: null,
      terminalSportsbook: "fanduel",
    });
    check(
      "thin selected-book history never borrows a richer trail from another book",
      noCrossBookTrail.length === 2 && noCrossBookTrail.every((stop) => stop.sportsbook === "fanduel"),
    );

    const movementReference = dailyEdgeTest.selectTwoSidedMovementReference({
      selectedSide: "over",
      opposingSide: "under",
      currentLine: 9.5,
      selectedCurrentRows: [
        { game_id: 4, market_type: "total", sportsbook: "hardrock", side: "over", line_value: 9.5, odds_american: 100, fetched_at: "2026-08-27T12:05:00Z" },
        { game_id: 4, market_type: "total", sportsbook: "ballybet", side: "over", line_value: 9.5, odds_american: -105, fetched_at: "2026-08-27T12:05:00Z" },
      ],
      opposingCurrentRows: [
        { game_id: 4, market_type: "total", sportsbook: "hardrock", side: "under", line_value: 9.5, odds_american: -110, fetched_at: "2026-08-27T12:05:00Z" },
        { game_id: 4, market_type: "total", sportsbook: "ballybet", side: "under", line_value: 9.5, odds_american: -115, fetched_at: "2026-08-27T12:05:00Z" },
      ],
      selectedHistory: [
        { id: 31, game_id: 4, market_type: "total", sportsbook: "hardrock", side: "over", line_value: 9.5, odds_american: 100, recorded_at: "2026-08-27T12:05:00Z" },
        { id: 32, game_id: 4, market_type: "total", sportsbook: "ballybet", side: "over", line_value: 9.5, odds_american: -110, recorded_at: "2026-08-27T08:05:00Z" },
        { id: 33, game_id: 4, market_type: "total", sportsbook: "ballybet", side: "over", line_value: 9.5, odds_american: -105, recorded_at: "2026-08-27T12:05:00Z" },
      ],
      opposingHistory: [
        { id: 34, game_id: 4, market_type: "total", sportsbook: "hardrock", side: "under", line_value: 9.5, odds_american: -110, recorded_at: "2026-08-27T12:05:00Z" },
        { id: 35, game_id: 4, market_type: "total", sportsbook: "ballybet", side: "under", line_value: 9.5, odds_american: -110, recorded_at: "2026-08-27T08:05:00Z" },
        { id: 36, game_id: 4, market_type: "total", sportsbook: "ballybet", side: "under", line_value: 9.5, odds_american: -115, recorded_at: "2026-08-27T12:05:00Z" },
      ],
      preferredSportsbook: "hardrock",
    });
    check(
      "movement reference prefers a current two-sided book with real history over a current-only best-price book",
      movementReference?.sportsbook === "ballybet" &&
        movementReference.selectedRow.odds_american === -105 &&
        movementReference.opposingRow.odds_american === -115,
    );
  }

  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All daily-edge tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-lab-daily-edge failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
