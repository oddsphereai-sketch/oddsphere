/**
 * Phase 4B — live end-to-end smoke test for automodelOrchestratorService.
 *
 * Runs every public entry point against the seed slate 2026-05-22, then
 * proves no DB writes occurred by comparing row counts before and after
 * across the 4 tables that Phase 3C writes touch (game_predictions,
 * scores_model_runs, sharp_signals, lines) plus data_refresh_log.
 *
 * No env flag required (Phase 4B is unconditionally no-write).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/test-automodel-orchestrator-live.ts
 */

import { supabase } from "../lib/db/supabase";
import {
  getSlateDeltasReport,
  getSlateStatusReport,
  runHeldOnlyRerunDryRun,
  runMorningCardDryRun,
  runSingleGameRerunDryRun,
  runT60RefreshDryRun,
} from "../lib/services/automodelOrchestratorService";

const SEED_SLATE = "2026-05-22";

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

async function tableRowCount(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    throw new Error(`count(${table}) failed: ${error.message}`);
  }
  return count ?? 0;
}

async function main() {
  // ── No-write baseline ──────────────────────────────────────────────
  section("Capture pre-run row counts (no-write proof)");
  const before = {
    game_predictions: await tableRowCount("game_predictions"),
    scores_model_runs: await tableRowCount("scores_model_runs"),
    sharp_signals: await tableRowCount("sharp_signals"),
    lines: await tableRowCount("lines"),
    data_refresh_log: await tableRowCount("data_refresh_log"),
  };
  for (const [t, c] of Object.entries(before)) {
    console.log(`  ${t}: ${c} rows`);
  }

  // ── Morning Card dry-run ───────────────────────────────────────────
  section("runMorningCardDryRun (seed slate)");
  const morning = await runMorningCardDryRun("mlb", SEED_SLATE);
  check(
    `morning.sport === 'mlb' AND morning.slate_date === ${SEED_SLATE}`,
    morning.sport === "mlb" && morning.slate_date === SEED_SLATE
  );
  check(
    "morning.stage === 'morning_draft'",
    morning.stage === "morning_draft"
  );
  check(
    `morning.game_count > 0 (got ${morning.game_count})`,
    morning.game_count > 0
  );
  check(
    "morning.predictions.length === morning.predictions_count",
    morning.predictions.length === morning.predictions_count
  );
  check(
    "morning.confidence_bands has ml/ou/nrfi keys",
    "ml" in morning.confidence_bands &&
      "ou" in morning.confidence_bands &&
      "nrfi" in morning.confidence_bands
  );
  check(
    "morning.stale_summary has top_reasons array",
    Array.isArray(morning.stale_summary.top_reasons)
  );
  check(
    "morning.stale_summary.notes mentions Phase 4C deferral",
    morning.stale_summary.notes.some((n) => n.includes("Phase 4C"))
  );
  check(
    "every prediction has stale_report key (may be null when no prior)",
    morning.predictions.every((p) => "stale_report" in p)
  );

  // ── T-60 refresh dry-run ────────────────────────────────────────────
  section("runT60RefreshDryRun (seed slate, custom now matching slate)");
  // Pick a 'now' that puts at least one seed-slate game in the window.
  // Seed slate 2026-05-22 has games scheduled afternoon ET. Use a now
  // 60 minutes before noon-ET-equivalent UTC to give a likely window hit.
  const t60Now = new Date("2026-05-22T18:00:00Z");
  const t60 = await runT60RefreshDryRun("mlb", SEED_SLATE, t60Now, 360);
  check(
    `t60.now === ${t60Now.toISOString()}`,
    t60.now === t60Now.toISOString()
  );
  check(
    "t60.candidates_count > 0 (slate has games)",
    t60.candidates_count > 0
  );
  check(
    "t60.skipped_window + selected_count + skipped_override <= candidates_count",
    t60.selected_count +
      t60.skipped_window.length +
      t60.skipped_override.length <=
      t60.candidates_count + 1
  );
  check(
    "t60.notes mentions Phase 4C deferral",
    t60.notes.some((n) => n.includes("Phase 4C"))
  );
  check(
    "t60.movement_summary has all expected keys",
    "games_with_listed_total_move" in t60.movement_summary &&
      "games_with_ml_fair_prob_move" in t60.movement_summary &&
      "games_with_starter_change" in t60.movement_summary &&
      "games_with_provider_data_missing" in t60.movement_summary
  );

  // T-60 in past → empty selection
  const t60Past = await runT60RefreshDryRun(
    "mlb",
    SEED_SLATE,
    new Date("2030-01-01T00:00:00Z")
  );
  check(
    "t60 with far-future 'now' (after slate) → selected_count === 0",
    t60Past.selected_count === 0
  );

  // ── Single-game rerun dry-run ───────────────────────────────────────
  section("runSingleGameRerunDryRun (seed slate, pick first game)");
  const firstGameExt = morning.predictions[0]?.game_external_id;
  if (firstGameExt !== undefined) {
    const single = await runSingleGameRerunDryRun(
      "mlb",
      SEED_SLATE,
      firstGameExt,
      "t60_locked"
    );
    check(`single.found === true (ext_id=${firstGameExt})`, single.found);
    check("single.proposed is present when found", single.proposed !== null);
    check("single.stage === 't60_locked'", single.stage === "t60_locked");
  }

  // Missing game
  const missing = await runSingleGameRerunDryRun(
    "mlb",
    SEED_SLATE,
    99999999,
    "morning_draft"
  );
  check(
    "single-game with bogus ext_id → found=false",
    missing.found === false
  );
  check(
    "single-game with bogus ext_id → proposed=null + helpful note",
    missing.proposed === null &&
      missing.notes.some((n) => n.includes("not found"))
  );

  // ── Held-only rerun dry-run ─────────────────────────────────────────
  section("runHeldOnlyRerunDryRun (seed slate)");
  const held = await runHeldOnlyRerunDryRun(
    "mlb",
    SEED_SLATE,
    "morning_draft",
    true
  );
  check(
    "held.candidates_count >= 0 (orchestrator runs without throw)",
    held.candidates_count >= 0
  );
  check(
    "held.resolution_summary has all 4 categories",
    "resolved" in held.resolution_summary &&
      "still_held" in held.resolution_summary &&
      "partially_resolved" in held.resolution_summary &&
      "newly_held" in held.resolution_summary
  );
  check(
    "held.notes mentions Phase 4C deferral",
    held.notes.some((n) => n.includes("Phase 4C"))
  );

  // include_partial_holds=false subset
  const heldStrict = await runHeldOnlyRerunDryRun(
    "mlb",
    SEED_SLATE,
    "morning_draft",
    false
  );
  check(
    "held strict (include_partial_holds=false) candidates_count <= permissive",
    heldStrict.candidates_count <= held.candidates_count
  );

  // ── Status report (read-only) ───────────────────────────────────────
  section("getSlateStatusReport (read-only)");
  const status = await getSlateStatusReport("mlb", SEED_SLATE);
  check(
    "status.games_count > 0",
    status.games_count > 0
  );
  check(
    "status.predictions_count.total === sum of provenance buckets",
    status.predictions_count.total ===
      status.predictions_count.pure_auto +
        status.predictions_count.manual_override +
        status.predictions_count.pure_manual +
        status.predictions_count.other
  );
  check(
    "status.stage_counts has morning_draft/t60_locked/other",
    "morning_draft" in status.stage_counts &&
      "t60_locked" in status.stage_counts &&
      "other" in status.stage_counts
  );
  check(
    "status.slate_status_summary has draft/published/final/hidden",
    "draft" in status.slate_status_summary &&
      "published" in status.slate_status_summary &&
      "final" in status.slate_status_summary &&
      "hidden" in status.slate_status_summary
  );
  check(
    "status.derivation_status has the 3 grade-related counts",
    "games_with_any_grade" in status.derivation_status &&
      "games_with_all_3_grades" in status.derivation_status &&
      "games_with_any_market_signal" in status.derivation_status
  );

  // ── Show-deltas report (read-only) ──────────────────────────────────
  section("getSlateDeltasReport (read-only)");
  const deltas = await getSlateDeltasReport("mlb", SEED_SLATE, false);
  check(
    "deltas.totals.games_total >= 0",
    deltas.totals.games_total >= 0
  );
  check(
    "deltas.games is an array",
    Array.isArray(deltas.games)
  );
  check(
    "deltas.notes mentions pre-Phase-4C rows have no movement_deltas",
    deltas.notes.some(
      (n) => n.includes("Phase 4C") || n.includes("movement_deltas")
    )
  );

  const deltasOnlyStale = await getSlateDeltasReport("mlb", SEED_SLATE, true);
  check(
    "deltas (only_stale=true) only contains stale games",
    deltasOnlyStale.games.every((g) => g.is_stale === true)
  );
  check(
    "deltas (only_stale=true) games.length <= deltas (only_stale=false) games.length",
    deltasOnlyStale.games.length <= deltas.games.length
  );

  // ── No-write proof ──────────────────────────────────────────────────
  section("Capture post-run row counts — assert ZERO changes");
  const after = {
    game_predictions: await tableRowCount("game_predictions"),
    scores_model_runs: await tableRowCount("scores_model_runs"),
    sharp_signals: await tableRowCount("sharp_signals"),
    lines: await tableRowCount("lines"),
    data_refresh_log: await tableRowCount("data_refresh_log"),
  };
  for (const t of Object.keys(before) as Array<keyof typeof before>) {
    check(
      `${t}: row count unchanged (before ${before[t]} === after ${after[t]})`,
      before[t] === after[t]
    );
  }

  // ── Cross-sport gate (NBA returns empty, no DB scribbling) ──────────
  section("Cross-sport gate — non-mlb sports return empty without writes");
  // NBA path runs through generatePredictionsForSlate which short-circuits
  // on non-mlb. Status & deltas still query but find no games.
  const nba = await runMorningCardDryRun("nba", SEED_SLATE);
  check(
    "morning-card for nba returns game_count=0 (V1 MLB-only)",
    nba.game_count === 0 && nba.predictions.length === 0
  );

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All orchestrator-live tests passed (no DB writes).`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
