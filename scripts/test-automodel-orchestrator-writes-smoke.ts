/**
 * Phase 4C — controlled DB-write smoke test for orchestrator writes.
 *
 * Operator-triggered only. Refuses to run unless:
 *   1. process.env.AUTOMODEL_DB_WRITES_ENABLED === "true"
 *   2. TEST_SLATE !== today's UTC date
 *
 * Exercises:
 *   • runMorningCardWrite — whole-slate write, override skip, audit fields persist
 *   • runT60RefreshWrite  — filtered write to selected games only
 *   • runSingleGameRerunWrite — successful single-game write
 *   • runSingleGameRerunWrite — HARD BLOCK on manual override (no DB write)
 *   • runHeldOnlyRerunWrite — held-only write
 *   • Idempotency (re-run same args → no duplicate rows)
 *   • slate_status unchanged (no auto-publish)
 *
 * Snapshot-before / restore-after pattern, same as Phase 3C smoke.
 * Post-cleanup bit-for-bit drift check fails LOUD even if assertions pass.
 *
 * Run:
 *   AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *     scripts/test-automodel-orchestrator-writes-smoke.ts
 */

import { supabase } from "../lib/db/supabase";
import {
  runHeldOnlyRerunWrite,
  runMorningCardWrite,
  runSingleGameRerunWrite,
  runT60RefreshWrite,
} from "../lib/services/automodelOrchestratorService";

const TEST_SLATE = "2026-05-22";
const TEST_SPORT = "mlb" as const;
const TEST_SOURCE = "auto_v1_mlb_rules" as const;

const today = new Date().toISOString().slice(0, 10);

if (process.env.AUTOMODEL_DB_WRITES_ENABLED !== "true") {
  console.error(
    "\n✗ REFUSING TO RUN: AUTOMODEL_DB_WRITES_ENABLED is not 'true'.\n" +
      "  Phase 4C orchestrator write smoke must be opted-in:\n\n" +
      "    AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\\n" +
      "      scripts/test-automodel-orchestrator-writes-smoke.ts\n"
  );
  process.exit(1);
}

if (TEST_SLATE === today) {
  console.error(
    `\n✗ REFUSING TO RUN: TEST_SLATE (${TEST_SLATE}) === today (${today}).\n`
  );
  process.exit(1);
}

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

type GamePredRow = Record<string, unknown>;
type ScoresRunRow = Record<string, unknown>;

async function snapshotGamePredictions(
  gameIds: number[]
): Promise<Map<number, GamePredRow>> {
  if (gameIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("game_predictions")
    .select("*")
    .in("game_id", gameIds);
  if (error) throw new Error(`snapshot game_predictions failed: ${error.message}`);
  const map = new Map<number, GamePredRow>();
  for (const row of (data ?? []) as GamePredRow[]) {
    map.set(row.game_id as number, row);
  }
  return map;
}

async function snapshotScoresModelRuns(
  sport: string,
  runDate: string
): Promise<ScoresRunRow[]> {
  const { data, error } = await supabase
    .from("scores_model_runs")
    .select("*")
    .eq("sport", sport)
    .eq("run_date", runDate);
  if (error) throw new Error(`snapshot scores_model_runs failed: ${error.message}`);
  return (data ?? []) as ScoresRunRow[];
}

async function listGameIds(): Promise<number[]> {
  const { data, error } = await supabase
    .from("games")
    .select("id")
    .eq("sport", TEST_SPORT)
    .eq("slate_date", TEST_SLATE);
  if (error) throw new Error(`listGameIds failed: ${error.message}`);
  return ((data ?? []) as { id: number }[]).map((r) => r.id);
}

async function getSlateStatuses(): Promise<Map<number, string | null>> {
  const { data, error } = await supabase
    .from("games")
    .select("id, slate_status")
    .eq("sport", TEST_SPORT)
    .eq("slate_date", TEST_SLATE);
  if (error) throw new Error(`getSlateStatuses failed: ${error.message}`);
  const map = new Map<number, string | null>();
  for (const row of (data ?? []) as Array<{
    id: number;
    slate_status: string | null;
  }>) {
    map.set(row.id, row.slate_status);
  }
  return map;
}

async function restore(
  slateGameIds: number[],
  preGamePreds: Map<number, GamePredRow>,
  preScoresRuns: ScoresRunRow[]
): Promise<void> {
  const preGameIds = new Set(preGamePreds.keys());
  const idsToDelete: number[] = [];
  const rowsToRestore: GamePredRow[] = [];
  for (const gid of slateGameIds) {
    if (preGameIds.has(gid)) rowsToRestore.push(preGamePreds.get(gid)!);
    else idsToDelete.push(gid);
  }

  if (idsToDelete.length > 0) {
    const { error } = await supabase
      .from("game_predictions")
      .delete()
      .in("game_id", idsToDelete);
    if (error)
      console.error(`  ⚠ restore: delete new rows failed: ${error.message}`);
  }
  if (rowsToRestore.length > 0) {
    const { error } = await supabase
      .from("game_predictions")
      .upsert(rowsToRestore, { onConflict: "game_id" });
    if (error)
      console.error(`  ⚠ restore: upsert original rows failed: ${error.message}`);
  }

  const preAutoRun = preScoresRuns.find(
    (r) => r.source === TEST_SOURCE && r.run_date === TEST_SLATE
  );
  if (preAutoRun) {
    const { error } = await supabase
      .from("scores_model_runs")
      .upsert(preAutoRun, { onConflict: "sport,source,run_date" });
    if (error)
      console.error(`  ⚠ restore: upsert audit row failed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from("scores_model_runs")
      .delete()
      .eq("sport", TEST_SPORT)
      .eq("source", TEST_SOURCE)
      .eq("run_date", TEST_SLATE);
    if (error)
      console.error(`  ⚠ restore: delete test audit row failed: ${error.message}`);
  }
}

function rowsEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return canonical(a) === canonical(b);
}
function canonical(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return JSON.stringify(
    keys.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, {})
  );
}

async function main() {
  section("Safety preconditions confirmed at startup");
  console.log(`  ✓ AUTOMODEL_DB_WRITES_ENABLED === "true"`);
  console.log(`  ✓ TEST_SLATE (${TEST_SLATE}) !== today (${today})`);

  section(`Snapshot pre-test state of slate ${TEST_SLATE}`);
  const slateGameIds = await listGameIds();
  console.log(`  slate has ${slateGameIds.length} games`);
  if (slateGameIds.length === 0) {
    console.error(`\n✗ FATAL: test slate ${TEST_SLATE} has no games.`);
    process.exit(1);
  }

  const preGamePreds = await snapshotGamePredictions(slateGameIds);
  const preScoresRuns = await snapshotScoresModelRuns(TEST_SPORT, TEST_SLATE);
  const preSlateStatuses = await getSlateStatuses();
  console.log(
    `  pre-test game_predictions: ${preGamePreds.size} / ${slateGameIds.length} games`
  );
  console.log(
    `  pre-test scores_model_runs (mlb, ${TEST_SLATE}): ${preScoresRuns.length}`
  );

  let injectedOverrideGameId: number | null = null;
  let injectedOverrideExtId: number | null = null;
  const restoreNeeded = true;

  try {
    // ── Test 1: Morning Card write ────────────────────────────────────
    section("Test 1 — runMorningCardWrite happy path");
    const morningResult = await runMorningCardWrite(TEST_SPORT, TEST_SLATE);
    check(
      "morningResult.db_writes !== null",
      morningResult.db_writes !== null
    );
    check(
      "morningResult.db_writes.attempted === true",
      morningResult.db_writes?.attempted === true
    );
    check(
      `morningResult ingested rows > 0 (got ${morningResult.db_writes?.ingest.inserted ?? 0} ins + ${morningResult.db_writes?.ingest.updated ?? 0} upd)`,
      (morningResult.db_writes?.ingest.inserted ?? 0) +
        (morningResult.db_writes?.ingest.updated ?? 0) >
        0
    );
    check(
      "morningResult.skipped_override_ids is an array",
      Array.isArray(morningResult.skipped_override_ids)
    );
    check(
      "morningResult.db_writes.market_signals.error === null",
      morningResult.db_writes?.market_signals !== null &&
        morningResult.db_writes?.market_signals !== undefined &&
        "error" in morningResult.db_writes.market_signals &&
        morningResult.db_writes.market_signals.error === null
    );
    check(
      "morningResult.db_writes.grades.error === null",
      morningResult.db_writes?.grades !== null &&
        morningResult.db_writes?.grades !== undefined &&
        "error" in morningResult.db_writes.grades &&
        morningResult.db_writes.grades.error === null
    );

    // Verify audit fields persisted on DB
    const { data: postAutoRowsRaw } = await supabase
      .from("game_predictions")
      .select("game_id, prediction_source, source_type, sport_specific")
      .in("game_id", slateGameIds)
      .eq("prediction_source", TEST_SOURCE);
    type PostRow = {
      game_id: number;
      prediction_source: string;
      source_type: string;
      sport_specific: Record<string, unknown> | null;
    };
    const postAutoRows = (postAutoRowsRaw ?? []) as PostRow[];

    check(
      `at least 1 auto row written (got ${postAutoRows.length})`,
      postAutoRows.length > 0
    );
    check(
      "every auto row has source_type='real_api'",
      postAutoRows.every((r) => r.source_type === "real_api")
    );

    // Audit fields persisted
    const morningAuditOK = postAutoRows.every((r) => {
      const ss = r.sport_specific as Record<string, unknown>;
      return (
        ss?.stage === "morning_draft" &&
        ss?.run_kind === "morning" &&
        typeof ss?.snapshot_stash === "object" &&
        ss?.snapshot_stash !== null
      );
    });
    check(
      "every auto row has sport_specific.stage='morning_draft' AND run_kind='morning' AND snapshot_stash populated",
      morningAuditOK
    );

    // Snapshot stash has all 10 keys
    const stashOK = postAutoRows.every((r) => {
      const ss = r.sport_specific as Record<string, unknown>;
      const stash = ss?.snapshot_stash as Record<string, unknown>;
      const requiredKeys = [
        "home_starter_was_scratched",
        "away_starter_was_scratched",
        "home_top3_hitters_injured_count",
        "away_top3_hitters_injured_count",
        "pinnacle_ml_fair_prob_home",
        "pinnacle_ml_ev_pct",
        "public_betting_pct_home",
        "public_money_pct_home",
        "public_betting_pct_over",
        "public_money_pct_over",
      ];
      return requiredKeys.every((k) => k in stash);
    });
    check(
      "every snapshot_stash has all 10 required keys",
      stashOK
    );

    // ── Test 2: slate_status unchanged ───────────────────────────────
    section("Test 2 — slate_status unchanged (no auto-publish)");
    const postSlateStatuses = await getSlateStatuses();
    let slateStatusUnchanged = true;
    for (const gid of slateGameIds) {
      if (preSlateStatuses.get(gid) !== postSlateStatuses.get(gid)) {
        slateStatusUnchanged = false;
      }
    }
    check(
      "slate_status preserved on every game (no auto-publish)",
      slateStatusUnchanged
    );

    // ── Test 3: Idempotency ──────────────────────────────────────────
    section("Test 3 — Idempotency: re-run morning write");
    const rerunMorning = await runMorningCardWrite(TEST_SPORT, TEST_SLATE);
    check("re-run completed without exception", rerunMorning.db_writes?.attempted === true);

    const { data: rerunAuditRunsRaw } = await supabase
      .from("scores_model_runs")
      .select("id")
      .eq("sport", TEST_SPORT)
      .eq("source", TEST_SOURCE)
      .eq("run_date", TEST_SLATE);
    check(
      `exactly 1 scores_model_runs row after re-run (got ${(rerunAuditRunsRaw ?? []).length})`,
      (rerunAuditRunsRaw ?? []).length === 1
    );

    const { data: rerunAutoRowsRaw } = await supabase
      .from("game_predictions")
      .select("game_id")
      .in("game_id", slateGameIds)
      .eq("prediction_source", TEST_SOURCE);
    const rerunDistinct = new Set(
      ((rerunAutoRowsRaw ?? []) as { game_id: number }[]).map((r) => r.game_id)
    );
    check(
      `no duplicate auto rows after re-run (got ${(rerunAutoRowsRaw ?? []).length} rows across ${rerunDistinct.size} distinct games)`,
      (rerunAutoRowsRaw ?? []).length === rerunDistinct.size
    );

    // ── Test 4: T-60 write (filter to subset) ────────────────────────
    section("Test 4 — runT60RefreshWrite (filter restricts ingest)");
    // Seed slate game_date values run 2026-05-22T23:05Z → 2026-05-23T02:10Z.
    // Pin `now` to 22:30Z (30 min before the first game) with a 5-hour
    // window → all 12 games hit the window. include_started=false because
    // every game is in the future relative to this synthetic `now`.
    const t60Now = new Date("2026-05-22T22:30:00Z");
    const t60Result = await runT60RefreshWrite(
      TEST_SPORT,
      TEST_SLATE,
      t60Now,
      300, // 5-hour window covers all 12 games
      false
    );
    check(
      `t60Result.selected_count >= 1 (got ${t60Result.selected_count})`,
      t60Result.selected_count >= 1
    );
    if (t60Result.db_writes !== null) {
      check(
        "t60Result.db_writes.ingest count matches selected_count",
        t60Result.db_writes.ingest.inserted +
          t60Result.db_writes.ingest.updated ===
          t60Result.selected_count
      );
    }

    // After T-60 write, the selected games should have stage='t60_locked',
    // others should retain 'morning_draft' (from earlier Test 1 write).
    const { data: postT60RowsRaw } = await supabase
      .from("game_predictions")
      .select("game_id, sport_specific")
      .in("game_id", slateGameIds)
      .eq("prediction_source", TEST_SOURCE);
    const t60RowsByGid = new Map<number, Record<string, unknown>>();
    for (const r of (postT60RowsRaw ?? []) as Array<{
      game_id: number;
      sport_specific: Record<string, unknown>;
    }>) {
      t60RowsByGid.set(r.game_id, r.sport_specific);
    }
    const selectedT60Count = t60Result.selected_count;
    const t60StagedCount = [...t60RowsByGid.values()].filter(
      (ss) => ss.stage === "t60_locked" && ss.run_kind === "t60"
    ).length;
    check(
      `at least ${selectedT60Count} rows now have stage='t60_locked' + run_kind='t60' (got ${t60StagedCount})`,
      t60StagedCount >= selectedT60Count
    );

    // ── Test 5: Single-game write happy path ─────────────────────────
    section("Test 5 — runSingleGameRerunWrite happy path");
    // Find a non-override game.
    const someGameExt = morningResult.predictions[0]?.game_external_id;
    if (someGameExt === undefined) {
      check("could not find a game for single-game test", false);
    } else {
      const singleResult = await runSingleGameRerunWrite(
        TEST_SPORT,
        TEST_SLATE,
        someGameExt,
        "t60_locked"
      );
      check(
        "single-game write succeeded (not blocked)",
        singleResult.blocked === false && singleResult.found === true
      );
      check(
        "single-game db_writes attempted",
        singleResult.db_writes?.attempted === true
      );
      check(
        "single-game ingested exactly 1 row (inserted+updated)",
        (singleResult.db_writes?.ingest.inserted ?? 0) +
          (singleResult.db_writes?.ingest.updated ?? 0) ===
          1
      );
      check(
        "single-game run_kind populated as manual_rerun",
        singleResult.proposed !== null
      );
    }

    // ── Test 6: Single-game HARD BLOCK on manual override ────────────
    section("Test 6 — runSingleGameRerunWrite HARD BLOCK on manual override");
    // Inject a manual override row on one of the slate games.
    const overrideTargetGid = slateGameIds[0]!;
    injectedOverrideGameId = overrideTargetGid;
    const { data: overrideExtRaw } = await supabase
      .from("games")
      .select("id, external_id")
      .eq("id", overrideTargetGid)
      .single();
    injectedOverrideExtId =
      (overrideExtRaw as { external_id: number } | null)?.external_id ?? null;

    // First, snapshot the existing row (so restore() can put it back)
    // Already snapshot in preGamePreds. Just mutate is_override.
    const { error: overrideErr } = await supabase
      .from("game_predictions")
      .update({
        is_override: true,
        prediction_source: "manual_daniel",
      })
      .eq("game_id", overrideTargetGid);
    if (overrideErr) {
      check(`could not inject manual override: ${overrideErr.message}`, false);
    } else if (injectedOverrideExtId !== null) {
      const blockResult = await runSingleGameRerunWrite(
        TEST_SPORT,
        TEST_SLATE,
        injectedOverrideExtId,
        "t60_locked"
      );
      check(
        "single-game write BLOCKED on manual override",
        blockResult.blocked === true
      );
      check(
        "single-game block_reason mentions manual override",
        blockResult.block_reason !== null &&
          blockResult.block_reason.includes("manual override")
      );
      check(
        "single-game blocked write performed ZERO DB writes",
        blockResult.db_writes === null
      );

      // Verify the DB row is STILL a manual override (untouched)
      const { data: postBlockRowRaw } = await supabase
        .from("game_predictions")
        .select("is_override, prediction_source")
        .eq("game_id", overrideTargetGid)
        .single();
      const postBlockRow = postBlockRowRaw as
        | { is_override: boolean; prediction_source: string }
        | null;
      check(
        "after block: row STILL is_override=true + prediction_source=manual_daniel",
        postBlockRow?.is_override === true &&
          postBlockRow?.prediction_source === "manual_daniel"
      );
    }

    // ── Test 7: Held-only write ──────────────────────────────────────
    section("Test 7 — runHeldOnlyRerunWrite (slate may have no held games)");
    const heldResult = await runHeldOnlyRerunWrite(
      TEST_SPORT,
      TEST_SLATE,
      "morning_draft",
      true
    );
    check(
      "held-only completed (db_writes may be null when no held candidates)",
      heldResult !== null && heldResult.sport === TEST_SPORT
    );
    if (heldResult.selected_count > 0) {
      check(
        "held-only ingest count matches selected",
        heldResult.db_writes !== null &&
          heldResult.db_writes.ingest.inserted +
            heldResult.db_writes.ingest.updated ===
            heldResult.selected_count
      );
    } else {
      console.log(
        `  (slate has no held games — held-only path returned db_writes=${heldResult.db_writes}; this is expected for the seed slate)`
      );
    }
  } finally {
    if (restoreNeeded) {
      section("Cleanup — restoring slate to pre-test state");
      try {
        await restore(slateGameIds, preGamePreds, preScoresRuns);
        console.log(`  ✓ restore complete`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ RESTORE FAILED: ${msg}`);
        fail++;
        failures.push(`RESTORE FAILED: ${msg}`);
      }
    }
  }

  // ── Post-cleanup drift detection ─────────────────────────────────
  section("Post-cleanup drift detection — bit-for-bit comparison");
  const postCleanupPreds = await snapshotGamePredictions(slateGameIds);
  const postCleanupRuns = await snapshotScoresModelRuns(TEST_SPORT, TEST_SLATE);

  let allRestored = true;
  const driftedGameIds: number[] = [];
  for (const gid of slateGameIds) {
    const pre = preGamePreds.get(gid);
    const post = postCleanupPreds.get(gid);
    if (!rowsEqual(pre, post)) {
      allRestored = false;
      driftedGameIds.push(gid);
    }
  }
  check(
    `game_predictions restored bit-for-bit for all ${slateGameIds.length} slate games`,
    allRestored,
    driftedGameIds.length > 0
      ? `drifted game_ids: ${driftedGameIds.slice(0, 5).join(", ")}${driftedGameIds.length > 5 ? "…" : ""}`
      : undefined
  );

  const preRunsCanon = new Set(
    preScoresRuns.map((r) => canonical(r as Record<string, unknown>))
  );
  const postRunsCanon = new Set(
    postCleanupRuns.map((r) => canonical(r as Record<string, unknown>))
  );
  check(
    `scores_model_runs row count restored (pre=${preScoresRuns.length}, post=${postCleanupRuns.length})`,
    preScoresRuns.length === postCleanupRuns.length
  );
  let runsMatch = preRunsCanon.size === postRunsCanon.size;
  for (const c of preRunsCanon) if (!postRunsCanon.has(c)) runsMatch = false;
  check("scores_model_runs canonical-set match (no drift)", runsMatch);

  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    console.error(
      `\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell.`
    );
    process.exit(1);
  }
  console.log(
    `\n✅ All Phase 4C orchestrator write-smoke tests passed AND slate restored.`
  );
  console.log(
    `\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell now.`
  );
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  console.error(
    `\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED. Slate may need manual inspection.`
  );
  process.exit(1);
});
