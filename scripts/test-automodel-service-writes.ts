/**
 * Phase 3C — Controlled DB-write smoke test for automodelService.
 *
 * Operator-triggered only. Refuses to run unless BOTH safety preconditions
 * are met:
 *   1. process.env.AUTOMODEL_DB_WRITES_ENABLED === "true"
 *      (the same env flag the service itself requires; operator must
 *      consciously opt in)
 *   2. TEST_SLATE !== today's UTC date
 *      (defense against accidentally writing into the slate Daily Edge
 *      members are actively reading)
 *
 * What this test PROVES end-to-end against the seed slate 2026-05-22:
 *   • Two-key gate: writeToDb=true WITHOUT env flag throws BEFORE any
 *     DB read/write.
 *   • Two-key gate: writeToDb=false WITH env flag set runs dry-run (no
 *     writes).
 *   • Happy path: writeToDb=true WITH env flag set ingests via
 *     ingestScoresModel, runs downstream market_signals + grades,
 *     leaves slate_status='draft', returns structured db_writes outcome.
 *   • Idempotency: re-running with same args UPSERTs (no duplicate
 *     game_predictions, no duplicate scores_model_runs row).
 *   • source_type/prediction_source: auto rows land as
 *     prediction_source='auto_v1_mlb_rules' → source_type='real_api'.
 *   • Cleanup invariant: post-test snapshot of game_predictions +
 *     scores_model_runs for the test slate is bit-for-bit identical to
 *     the pre-test snapshot. If ANY row drifts, the test fails LOUD even
 *     if the assertions above all passed.
 *
 * Run:
 *   AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *     scripts/test-automodel-service-writes.ts
 *
 * REMINDER for the operator: unset AUTOMODEL_DB_WRITES_ENABLED after
 * the test completes. The dry-run test (test-automodel-service-dryrun.ts)
 * defensively deletes the env var at startup so a stale shell variable
 * cannot let writes slip into a regression sweep, but downstream code
 * paths invoked outside the test harness will respect whatever the env
 * has at call time.
 */

import { generatePredictionsForSlate } from "../lib/services/automodelService";
import { supabase } from "../lib/db/supabase";

// ─── Safety preconditions ────────────────────────────────────────────────

const TEST_SLATE = "2026-05-22";
const TEST_SPORT = "mlb" as const;
const TEST_SOURCE = "auto_v1_mlb_rules" as const;

const today = new Date().toISOString().slice(0, 10);

if (process.env.AUTOMODEL_DB_WRITES_ENABLED !== "true") {
  console.error(
    "\n✗ REFUSING TO RUN: AUTOMODEL_DB_WRITES_ENABLED is not 'true'.\n" +
      "  This test performs real DB writes against the test slate. To opt\n" +
      "  in, prefix the command with:\n\n" +
      "    AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\\n" +
      "      scripts/test-automodel-service-writes.ts\n"
  );
  process.exit(1);
}

if (TEST_SLATE === today) {
  console.error(
    `\n✗ REFUSING TO RUN: TEST_SLATE (${TEST_SLATE}) === today (${today}).\n` +
      "  This test mutates and restores game_predictions for the test slate.\n" +
      "  Running against today's date risks corrupting the live slate.\n"
  );
  process.exit(1);
}

// ─── Test harness ────────────────────────────────────────────────────────

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

// ─── DB helpers ──────────────────────────────────────────────────────────

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
  if (error) {
    throw new Error(`snapshot game_predictions failed: ${error.message}`);
  }
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
  if (error) {
    throw new Error(`snapshot scores_model_runs failed: ${error.message}`);
  }
  return (data ?? []) as ScoresRunRow[];
}

async function listGameIdsForSlate(
  sport: string,
  slate_date: string
): Promise<number[]> {
  const { data, error } = await supabase
    .from("games")
    .select("id")
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  if (error) {
    throw new Error(`listGameIdsForSlate failed: ${error.message}`);
  }
  return ((data ?? []) as { id: number }[]).map((r) => r.id);
}

async function getSlateStatuses(
  sport: string,
  slate_date: string
): Promise<Map<number, string | null>> {
  const { data, error } = await supabase
    .from("games")
    .select("id, slate_status")
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  if (error) {
    throw new Error(`getSlateStatuses failed: ${error.message}`);
  }
  const map = new Map<number, string | null>();
  for (const row of (data ?? []) as Array<{
    id: number;
    slate_status: string | null;
  }>) {
    map.set(row.id, row.slate_status);
  }
  return map;
}

// ─── Restore — used by the finally block ─────────────────────────────────

/**
 * Restore the slate's game_predictions to its pre-test state.
 *
 * For each game_id in the test slate:
 *   • If the row existed pre-test: UPSERT the original payload back
 *     (overwrites the auto row, restoring prediction_source, source_type,
 *     all pick fields, sport_specific, grade columns, signal columns).
 *   • If no row existed pre-test (auto write was the first insert):
 *     DELETE the auto row.
 *
 * Also deletes the auto scores_model_runs audit row created by the test
 * if it wasn't there before.
 */
async function restore(
  slateGameIds: number[],
  preGamePreds: Map<number, GamePredRow>,
  preScoresRuns: ScoresRunRow[]
): Promise<void> {
  // Restore game_predictions row by row. The natural key is game_id
  // (UNIQUE in V13).
  const preGameIds = new Set(preGamePreds.keys());
  const idsToDelete: number[] = [];
  const rowsToRestore: GamePredRow[] = [];

  for (const gid of slateGameIds) {
    if (preGameIds.has(gid)) {
      rowsToRestore.push(preGamePreds.get(gid)!);
    } else {
      idsToDelete.push(gid);
    }
  }

  if (idsToDelete.length > 0) {
    const { error } = await supabase
      .from("game_predictions")
      .delete()
      .in("game_id", idsToDelete);
    if (error) {
      console.error(`  ⚠ restore: delete of new auto rows failed: ${error.message}`);
    }
  }

  if (rowsToRestore.length > 0) {
    // UPSERT on game_id — replaces whatever the auto write put there
    // with the snapshot row. The snapshot includes every column including
    // computed_at, prediction_source, source_type, sport_specific, etc.
    // so this is bit-for-bit.
    const { error } = await supabase
      .from("game_predictions")
      .upsert(rowsToRestore, { onConflict: "game_id" });
    if (error) {
      console.error(`  ⚠ restore: UPSERT of original rows failed: ${error.message}`);
    }
  }

  // Restore scores_model_runs. The audit row is keyed on
  // (sport, source, run_date). If the test wrote a row for the auto
  // source that wasn't there pre-test, DELETE it. If it was there
  // pre-test, UPSERT the original payload back.
  const preAutoRun = preScoresRuns.find(
    (r) => r.source === TEST_SOURCE && r.run_date === TEST_SLATE
  );
  if (preAutoRun) {
    const { error } = await supabase
      .from("scores_model_runs")
      .upsert(preAutoRun, { onConflict: "sport,source,run_date" });
    if (error) {
      console.error(`  ⚠ restore: UPSERT of original audit row failed: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from("scores_model_runs")
      .delete()
      .eq("sport", TEST_SPORT)
      .eq("source", TEST_SOURCE)
      .eq("run_date", TEST_SLATE);
    if (error) {
      console.error(`  ⚠ restore: delete of test audit row failed: ${error.message}`);
    }
  }
}

// ─── Drift detection — bit-for-bit post-cleanup comparison ──────────────

function rowsEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  // The DB returns timestamps as ISO strings and JSONB as parsed objects.
  // JSON.stringify with sorted keys is the simplest deterministic compare.
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

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  section("Safety preconditions — confirmed at startup");
  console.log(`  ✓ AUTOMODEL_DB_WRITES_ENABLED === "true"`);
  console.log(`  ✓ TEST_SLATE (${TEST_SLATE}) !== today (${today})`);

  // ── Snapshot pre-test state ────────────────────────────────────
  section(`Snapshot — pre-test state of slate ${TEST_SLATE}`);
  const slateGameIds = await listGameIdsForSlate(TEST_SPORT, TEST_SLATE);
  console.log(`  slate has ${slateGameIds.length} games`);
  if (slateGameIds.length === 0) {
    console.error(
      `\n✗ FATAL: test slate ${TEST_SLATE} has no games — cannot run smoke test.`
    );
    process.exit(1);
  }

  const preGamePreds = await snapshotGamePredictions(slateGameIds);
  const preScoresRuns = await snapshotScoresModelRuns(TEST_SPORT, TEST_SLATE);
  const preSlateStatuses = await getSlateStatuses(TEST_SPORT, TEST_SLATE);
  console.log(
    `  pre-test game_predictions rows for slate: ${preGamePreds.size} / ${slateGameIds.length} games`
  );
  console.log(
    `  pre-test scores_model_runs rows (mlb, ${TEST_SLATE}): ${preScoresRuns.length}`
  );

  let restoreNeeded = true;

  try {
    // ── Test 1: writeToDb=true with env flag set → succeeds ───────────
    section("Test 1 — Happy path: writeToDb=true + env flag set");

    const writeResult = await generatePredictionsForSlate(
      TEST_SPORT,
      TEST_SLATE,
      "morning_draft",
      { writeToDb: true }
    );

    check(
      "result.db_writes is non-null (write was attempted)",
      writeResult.db_writes !== null
    );
    check(
      "result.db_writes.attempted === true",
      writeResult.db_writes?.attempted === true
    );

    const ingest = writeResult.db_writes!.ingest;
    check(
      `ingest produced rows (inserted ${ingest.inserted}, updated ${ingest.updated})`,
      ingest.inserted + ingest.updated > 0
    );
    check(
      "ingest.run_id is non-null (audit row written)",
      ingest.run_id !== null
    );
    if (ingest.failed > 0) {
      console.log(`  ⚠ ingest reported ${ingest.failed} row-level failures:`);
      for (const f of ingest.errors) {
        console.log(
          `    ext_id=${f.game_external_id}: ${f.errors.join(", ")}`
        );
      }
    }

    const ms = writeResult.db_writes!.market_signals;
    check(
      "market_signals step ran (non-null)",
      ms !== null
    );
    check(
      "market_signals.error === null (downstream OK)",
      ms !== null && "error" in ms && ms.error === null
    );

    const gr = writeResult.db_writes!.grades;
    check("grades step ran (non-null)", gr !== null);
    check(
      "grades.error === null (downstream OK)",
      gr !== null && "error" in gr && gr.error === null
    );

    // ── Verify what landed in the DB ───────────────────────────────────
    section("Verify — DB row state matches the write outcome");

    const { data: postPredsRaw, error: postErr } = await supabase
      .from("game_predictions")
      .select(
        "id, game_id, prediction_source, source_type, model_version, sport_specific, predicted_ml_winner, ml_grade, ml_signal_type, predicted_ou_side, ou_grade, ou_signal_type, predicted_nrfi, nrfi_grade, nrfi_signal_type"
      )
      .in("game_id", slateGameIds);
    if (postErr) {
      throw new Error(`post-write read failed: ${postErr.message}`);
    }
    type PostRow = {
      id: number;
      game_id: number;
      prediction_source: string;
      source_type: string;
      model_version: string;
      sport_specific: { model_version?: string; stage?: string };
      predicted_ml_winner: string | null;
      ml_grade: string | null;
      ml_signal_type: string | null;
      predicted_ou_side: string | null;
      ou_grade: string | null;
      ou_signal_type: string | null;
      predicted_nrfi: boolean | null;
      nrfi_grade: string | null;
      nrfi_signal_type: string | null;
    };
    const postPreds = (postPredsRaw ?? []) as PostRow[];

    const autoRows = postPreds.filter(
      (r) => r.prediction_source === TEST_SOURCE
    );
    check(
      `at least 1 row has prediction_source='${TEST_SOURCE}' (got ${autoRows.length})`,
      autoRows.length > 0
    );
    check(
      "every auto row has source_type='real_api' (production-filter visible)",
      autoRows.every((r) => r.source_type === "real_api")
    );
    check(
      "every auto row has model_version='auto_v1.0_mlb_rules' (top-level)",
      autoRows.every((r) => r.model_version === "auto_v1.0_mlb_rules")
    );
    check(
      "every auto row has sport_specific.model_version='auto_v1.0_mlb_rules'",
      autoRows.every(
        (r) => r.sport_specific?.model_version === "auto_v1.0_mlb_rules"
      )
    );
    check(
      "every auto row has sport_specific.stage='morning_draft'",
      autoRows.every((r) => r.sport_specific?.stage === "morning_draft")
    );

    // Per-pick grade verification — every populated pick should have a
    // grade and signal_type written by updateGradesForSlate. Held picks
    // (null pick) should leave grade null.
    let gradeAlignment = true;
    let nullPicksHaveNullGrades = true;
    for (const r of autoRows) {
      if (r.predicted_ml_winner !== null && r.ml_grade === null) {
        gradeAlignment = false;
      }
      if (r.predicted_ml_winner === null && r.ml_grade !== null) {
        nullPicksHaveNullGrades = false;
      }
      if (r.predicted_ou_side !== null && r.ou_grade === null) {
        gradeAlignment = false;
      }
      if (r.predicted_ou_side === null && r.ou_grade !== null) {
        nullPicksHaveNullGrades = false;
      }
      if (r.predicted_nrfi !== null && r.nrfi_grade === null) {
        gradeAlignment = false;
      }
      if (r.predicted_nrfi === null && r.nrfi_grade !== null) {
        nullPicksHaveNullGrades = false;
      }
    }
    check(
      "populated picks have non-null grades (downstream grade derivation ran)",
      gradeAlignment
    );
    check(
      "held picks (null) have null grades (no orphan grades)",
      nullPicksHaveNullGrades
    );

    // scores_model_runs audit row check
    const { data: postRunsRaw } = await supabase
      .from("scores_model_runs")
      .select("*")
      .eq("sport", TEST_SPORT)
      .eq("source", TEST_SOURCE)
      .eq("run_date", TEST_SLATE);
    const postAutoRuns = (postRunsRaw ?? []) as Array<{
      successful_count: number;
    }>;
    check(
      `exactly 1 scores_model_runs row for (mlb, ${TEST_SOURCE}, ${TEST_SLATE}) — got ${postAutoRuns.length}`,
      postAutoRuns.length === 1
    );
    if (postAutoRuns.length === 1) {
      check(
        `audit row successful_count > 0 (got ${postAutoRuns[0]!.successful_count})`,
        (postAutoRuns[0]!.successful_count ?? 0) > 0
      );
    }

    // slate_status unchanged — Phase 3C does NOT auto-publish.
    const postSlateStatuses = await getSlateStatuses(TEST_SPORT, TEST_SLATE);
    let slateStatusUnchanged = true;
    for (const gid of slateGameIds) {
      if (preSlateStatuses.get(gid) !== postSlateStatuses.get(gid)) {
        slateStatusUnchanged = false;
      }
    }
    check(
      "slate_status unchanged across the slate (no auto-publish)",
      slateStatusUnchanged
    );

    // ── Test 2: idempotency — re-run with same args ─────────────────
    section("Test 2 — Idempotency: re-running with same args");
    const rerun = await generatePredictionsForSlate(
      TEST_SPORT,
      TEST_SLATE,
      "morning_draft",
      { writeToDb: true }
    );
    check(
      "second run completed (no exception)",
      rerun.db_writes?.attempted === true
    );

    const { data: rerunRunsRaw } = await supabase
      .from("scores_model_runs")
      .select("id")
      .eq("sport", TEST_SPORT)
      .eq("source", TEST_SOURCE)
      .eq("run_date", TEST_SLATE);
    check(
      `still exactly 1 scores_model_runs row after second run (UPSERT — got ${(rerunRunsRaw ?? []).length})`,
      (rerunRunsRaw ?? []).length === 1
    );

    const { data: rerunPredsRaw } = await supabase
      .from("game_predictions")
      .select("id, game_id, prediction_source")
      .in("game_id", slateGameIds)
      .eq("prediction_source", TEST_SOURCE);
    const rerunAutoRows = (rerunPredsRaw ?? []) as Array<{
      game_id: number;
    }>;
    const distinctGameIds = new Set(rerunAutoRows.map((r) => r.game_id));
    check(
      `no duplicate auto rows: ${rerunAutoRows.length} rows across ${distinctGameIds.size} distinct games`,
      rerunAutoRows.length === distinctGameIds.size
    );

    // ── Test 3: writeToDb=false with env flag set → no writes ──────
    section("Test 3 — writeToDb=false WITH env flag set → dry-run");
    const dryWithEnv = await generatePredictionsForSlate(
      TEST_SPORT,
      TEST_SLATE,
      "morning_draft",
      { writeToDb: false }
    );
    check(
      "dry-run with env flag returns db_writes=null",
      dryWithEnv.db_writes === null
    );

    // ── Test 4: writeToDb=true with env flag temporarily unset → throws
    section("Test 4 — writeToDb=true without env flag throws (two-key gate)");
    const stashedFlag = process.env.AUTOMODEL_DB_WRITES_ENABLED;
    delete process.env.AUTOMODEL_DB_WRITES_ENABLED;
    let threw = false;
    let errMsg = "";
    try {
      await generatePredictionsForSlate(
        TEST_SPORT,
        TEST_SLATE,
        "morning_draft",
        { writeToDb: true }
      );
    } catch (e) {
      threw = true;
      errMsg = e instanceof Error ? e.message : String(e);
    } finally {
      if (stashedFlag !== undefined) {
        process.env.AUTOMODEL_DB_WRITES_ENABLED = stashedFlag;
      }
    }
    check("writeToDb=true without env flag throws", threw);
    check(
      "error message mentions AUTOMODEL_DB_WRITES_ENABLED",
      errMsg.includes("AUTOMODEL_DB_WRITES_ENABLED")
    );
  } finally {
    // ── ALWAYS run cleanup, even on test failure ────────────────
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

  // ── Post-cleanup drift detection ────────────────────────────────
  section("Post-cleanup drift detection — bit-for-bit comparison");

  const postCleanupPreds = await snapshotGamePredictions(slateGameIds);
  const postCleanupRuns = await snapshotScoresModelRuns(TEST_SPORT, TEST_SLATE);

  // game_predictions: every pre-test game_id should now have an identical
  // row to before; no extra rows should exist for the test slate.
  let allRestored = true;
  let driftedGameIds: number[] = [];
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

  // scores_model_runs: same set of rows as before.
  const preRunsCanon = new Set(
    preScoresRuns.map((r) => canonical(r as Record<string, unknown>))
  );
  const postRunsCanon = new Set(
    postCleanupRuns.map((r) => canonical(r as Record<string, unknown>))
  );
  check(
    `scores_model_runs restored: same row count (pre=${preScoresRuns.length}, post=${postCleanupRuns.length})`,
    preScoresRuns.length === postCleanupRuns.length
  );
  // Set equality
  let runsMatch = preRunsCanon.size === postRunsCanon.size;
  for (const c of preRunsCanon) {
    if (!postRunsCanon.has(c)) runsMatch = false;
  }
  check("scores_model_runs canonical-set match (no drift)", runsMatch);

  // ── Summary ────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    console.error(
      `\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell\n` +
        `   after reviewing the failure to prevent further writes.`
    );
    process.exit(1);
  }
  console.log(
    `\n✅ All Phase 3C write-path smoke tests passed AND slate restored.`
  );
  console.log(
    `\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell now\n` +
      `   that the smoke test is complete.`
  );
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  console.error(
    `\n⚠ REMINDER: unset AUTOMODEL_DB_WRITES_ENABLED in your shell.\n` +
      `   The slate may NOT have been fully restored — inspect manually:\n` +
      `     SELECT * FROM game_predictions JOIN games ON game_predictions.game_id = games.id\n` +
      `       WHERE games.sport='mlb' AND games.slate_date='${TEST_SLATE}'\n` +
      `       AND prediction_source='${TEST_SOURCE}';\n` +
      `     SELECT * FROM scores_model_runs WHERE sport='mlb' AND source='${TEST_SOURCE}' AND run_date='${TEST_SLATE}';\n`
  );
  process.exit(1);
});
