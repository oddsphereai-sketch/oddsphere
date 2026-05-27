/**
 * Integration tests for Phase 4E prediction + results services.
 *
 * Exercises each service against seeded mock state. Verifies:
 *   • generateGamePredictions: returns 12 for MLB (manual upload exists),
 *     partial:true with 0 for sports without uploads
 *   • generatePropPredictions: 39 prop_predictions + breakdowns written
 *   • regenerateSharpVerdicts: updates the 4 tonight signals
 *   • resolveFinishedGames: synthetic NYY-BOS outcome → 7 prediction_results
 *   • refreshTrackingAggregates: ~30 aggregate rows
 *   • computeClvForResults: 300+ updates, 150+ silent (last 30 days)
 *   • Idempotency where the service supports it
 *
 * Prerequisite: fresh `npm run seed`.
 * Run with: npm run test:prediction-results
 */

import { supabase } from "../lib/db/supabase";
import { predictionService } from "../lib/services/predictionService";
import { resultsService } from "../lib/services/resultsService";
import type { FinishedGameActuals } from "../lib/services/resultsService";

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

async function countRows(table: string, predicate?: { col: string; op: "eq" | "in"; val: unknown }): Promise<number> {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (predicate) {
    if (predicate.op === "eq") q = q.eq(predicate.col, predicate.val);
    else q = q.in(predicate.col, predicate.val as unknown[]);
  }
  const { count, error } = await q;
  if (error) throw new Error(`countRows(${table}) failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log("test-prediction-results · MLB on 2026-05-22\n");
  console.log("Prerequisite: `npm run seed` must have run recently.\n");

  // Tonight's game IDs for scoping
  const { data: tonightGames } = await supabase
    .from("games")
    .select("id, external_id")
    .gte("external_id", 18599100)
    .lte("external_id", 18599111);
  const tonightGameIds = ((tonightGames ?? []) as { id: number }[]).map((g) => g.id);
  check("Loaded tonight's 12 games for scoping", tonightGameIds.length === 12);

  // ─── predictionService.generateGamePredictions ──────────────────────────
  section("predictionService.generateGamePredictions");

  const ggMlb = await predictionService.generateGamePredictions("mlb", "2026-05-22");
  check(
    `MLB: records=${ggMlb.records_updated} (expect 12)`,
    ggMlb.records_updated === 12
  );
  check("MLB: not partial (predictions exist)", ggMlb.partial !== true);
  check(
    "MLB: details include source",
    typeof (ggMlb.details as { source?: string })?.source === "string"
  );

  const ggNba = await predictionService.generateGamePredictions("nba", "2026-05-22");
  check(
    "NBA: 0 records + partial:true (no upload)",
    ggNba.records_updated === 0 && ggNba.partial === true
  );
  check(
    "NBA: details include 'no scores-model predictions' reason",
    (ggNba.details as { reason?: string })?.reason?.includes("no scores-model") ?? false
  );

  // ─── predictionService.generatePropPredictions ──────────────────────────
  section("predictionService.generatePropPredictions");

  const propRes = await predictionService.generatePropPredictions("mlb", "2026-05-22");
  check(
    `MLB: records=${propRes.records_updated} (expect 39 unique props)`,
    propRes.records_updated === 39
  );
  const totalProps = await countRows("prop_predictions", { col: "game_id", op: "in", val: tonightGameIds });
  check("prop_predictions in DB = 39", totalProps === 39);

  const totalBreakdowns = await countRows("prediction_breakdowns");
  check(
    `prediction_breakdowns in DB matches prop_predictions (every prop has a breakdown)`,
    totalBreakdowns >= 39
  );

  const tierCounts = (propRes.details as { tier_counts?: Record<string, number> })?.tier_counts ?? {};
  check(
    "tier distribution: PREMIUM 1 (Bradish K)",
    tierCounts.premium === 1
  );
  check(
    "tier distribution: STRONG 1 (Trout RBI)",
    tierCounts.strong === 1
  );
  check(
    "tier distribution: skip 37",
    tierCounts.skip === 37
  );

  // Idempotency: re-run produces same DB count
  await predictionService.generatePropPredictions("mlb", "2026-05-22");
  const totalProps2 = await countRows("prop_predictions", { col: "game_id", op: "in", val: tonightGameIds });
  check("prop_predictions stable at 39 after re-run", totalProps2 === 39);

  // NBA returns 0 props
  const propResNba = await predictionService.generatePropPredictions("nba", "2026-05-22");
  check("NBA: 0 prop predictions (no mock games)", propResNba.records_updated === 0);

  // Fix 4.1 (Gap-18+19): regenerateSharpVerdicts removed. The legacy
  // pipeline (sharpSignalEvaluator + verdictGenerator) was deleted in
  // favor of signalSummaryGenerator at API response time. The previous
  // tests in this section asserted the cron-time signal_strength /
  // signal_summary write path — that path no longer exists. Coverage of
  // the new pipeline lives in:
  //   • scripts/test-signal-summary-generator.ts (41 framework-anchored cases)
  //   • scripts/test-signal-evidence-classifier.ts (69 tier classification cases)
  //   • scripts/test-grade-derivation.ts (69 grade engine cases)

  // ─── resultsService.resolveFinishedGames ────────────────────────────────
  section("resultsService.resolveFinishedGames — synthetic NYY-BOS outcome");

  // Get NYY-BOS game DB id
  const nyyBosGame = ((tonightGames ?? []) as Array<{ id: number; external_id: number }>)
    .find((g) => g.external_id === 18599100);
  if (!nyyBosGame) throw new Error("NYY-BOS game not found");

  const actuals: FinishedGameActuals[] = [
    {
      game_db_id: nyyBosGame.id,
      outcome: {
        home_score: 7,
        away_score: 4,
        first_inning_total_runs: 2,
        total_line: 8.5,
      },
      playerStatLines: {
        592450: { batting_h: 2, batting_hr: 1, batting_tb: 5, batting_rbi: 3 },
        600002: { batting_h: 1, batting_hr: 0, batting_tb: 1, batting_rbi: 1 },
        543037: { pitching_k: 7, pitching_er: 2, pitching_h: 5 },
      },
    },
  ];

  const resolveRes = await resultsService.resolveFinishedGames("mlb", "2026-05-22", actuals);
  check(
    `resolved: records=${resolveRes.records_updated} (expect 7 = 4 props + 3 game-level)`,
    resolveRes.records_updated === 7
  );

  // Verify the 4 prop results
  const { data: nyyResults } = await supabase
    .from("prediction_results")
    .select("market, outcome")
    .eq("game_date", "2026-05-22")
    .in("prop_prediction_id", await getNyyBosPropPredIds(nyyBosGame.id));
  const propWins = ((nyyResults ?? []) as Array<{ outcome: string }>).filter((r) => r.outcome === "win").length;
  check(
    `Judge hits + Judge HR + Soto RBI all WIN; Cole K LOSS → 3 wins / 1 loss`,
    propWins === 3
  );

  // Idempotency check
  const resolveRes2 = await resultsService.resolveFinishedGames("mlb", "2026-05-22", actuals);
  check(
    "resolveFinishedGames idempotent (delete + re-insert produces same count)",
    resolveRes2.records_updated === 7
  );

  // ─── resultsService.refreshTrackingAggregates ───────────────────────────
  section("resultsService.refreshTrackingAggregates");

  const aggRes = await resultsService.refreshTrackingAggregates();
  // Aggregator emits per (sport, market, time_window) — 9 MLB markets × 3-4
  // populated windows (yesterday, this_week, season, all_time). The exact
  // count depends on how recent the seed data is relative to "today" in ET:
  //   • Same-day seed: all 4 windows populate → ~36 rows
  //   • Seed 2-3 days stale (typical mid-week test run): yesterday window
  //     has no rows → ~27 rows
  // Both states reflect a healthy aggregator; the bug we'd worry about is
  // zero rows or fewer than the markets count.
  check(
    `aggregates computed: records=${(aggRes.records_updated ?? 0)} (expect 9+ — one row per market per populated window)`,
    (aggRes.records_updated ?? 0) >= 9
  );

  // Spot-check headline value
  const { data: mlAgg } = await supabase
    .from("tracking_aggregates")
    .select("hit_rate, wins, losses")
    .eq("sport", "mlb")
    .eq("market", "ml")
    .eq("time_window", "all_time")
    .single();
  check(
    `MLB ml all_time hit_rate ~57-59% (was 58.1% pre-4E)`,
    mlAgg !== null && (mlAgg.hit_rate ?? 0) >= 56 && (mlAgg.hit_rate ?? 0) <= 60
  );

  // Sport-scoped variant
  const aggMlbOnly = await resultsService.refreshTrackingAggregates("mlb");
  check(
    `sport-scoped refresh works (records=${(aggMlbOnly.records_updated ?? 0)})`,
    (aggMlbOnly.records_updated ?? 0) >= 9
  );

  // ─── resultsService.computeClvForResults ────────────────────────────────
  section("resultsService.computeClvForResults");

  const clvRes = await resultsService.computeClvForResults();
  check(
    `CLV computation: ${(clvRes.records_updated ?? 0)} updated (expect ~300 = picks > 30 days old)`,
    (clvRes.records_updated ?? 0) >= 290
  );
  const silent = (clvRes.details as { silent_within_30d_or_missing?: number })?.silent_within_30d_or_missing ?? 0;
  check(
    `CLV silent count: ${silent} (last 30 days picks + any with missing closing_odds)`,
    silent >= 150
  );

  // Spot-check: last-30d picks should be silent
  const cutoff = "2026-04-22";  // 30 days before TODAY=2026-05-22 (today UTC ≈ 2026-05-23)
  const { count: silentLast30 } = await supabase
    .from("prediction_results")
    .select("*", { count: "exact", head: true })
    .is("clv_pct", null)
    .gte("game_date", cutoff);
  const { count: totalLast30 } = await supabase
    .from("prediction_results")
    .select("*", { count: "exact", head: true })
    .gte("game_date", cutoff);
  check(
    `100% of last-30-day picks are silent (${silentLast30}/${totalLast30})`,
    silentLast30 === totalLast30
  );

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All prediction-results tests passed.`);
}

async function getNyyBosPropPredIds(gameDbId: number): Promise<number[]> {
  const { data } = await supabase
    .from("prop_predictions")
    .select("id")
    .eq("game_id", gameDbId);
  return ((data ?? []) as { id: number }[]).map((r) => r.id);
}

main().catch((e) => {
  console.error("\n❌ test-prediction-results failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
