/**
 * Phase 3B + 3C — Live end-to-end dry-run test for automodelService.
 *
 * Verifies:
 *   1. generatePredictionsForSlate runs to completion against today's slate
 *   2. NO DB WRITES (row counts unchanged before/after across the 4 target
 *      tables: game_predictions, scores_model_runs, sharp_signals, lines)
 *   3. writeToDb=true WITHOUT AUTOMODEL_DB_WRITES_ENABLED throws the
 *      two-key-gate error BEFORE any DB read/write (Phase 3C)
 *   4. Output shape is well-formed (db_writes=null on dry-runs)
 *   5. Each prediction respects Phase 3A invariants (predicted_total math,
 *      confidence cap/floor, deterministic guards recorded)
 *
 * Defensive: this script forcibly deletes AUTOMODEL_DB_WRITES_ENABLED
 * from process.env at startup so a stale shell variable can never let
 * a write slip through during a dry-run regression sweep.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-automodel-service-dryrun.ts
 */

// MUST run before importing automodelService so the env state is
// deterministic across both the throw test and any subsequent dry-run.
delete process.env.AUTOMODEL_DB_WRITES_ENABLED;

import { generatePredictionsForSlate } from "../lib/services/automodelService";
import type { AutoModelOutput } from "../lib/automodel/types";
import {
  HARD_CONFIDENCE_FLOOR,
  NRFI_CONFIDENCE_CAP,
  STAGE_CONFIDENCE_CAPS,
} from "../lib/automodel/types";
import { supabase } from "../lib/db/supabase";

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
  const today = new Date().toISOString().slice(0, 10);

  // ── writeToDb=true without env flag throws ─────────────────────
  // Phase 3C two-key gate: env flag was DELETED at top of file.
  section(
    "writeToDb=true without AUTOMODEL_DB_WRITES_ENABLED throws two-key-gate error"
  );

  let threw = false;
  let errMsg = "";
  try {
    await generatePredictionsForSlate("mlb", today, "morning_draft", {
      writeToDb: true,
    });
  } catch (e) {
    threw = true;
    errMsg = e instanceof Error ? e.message : String(e);
  }
  check("generatePredictionsForSlate({ writeToDb: true }) throws", threw);
  check(
    'error message mentions "AUTOMODEL_DB_WRITES_ENABLED"',
    errMsg.includes("AUTOMODEL_DB_WRITES_ENABLED")
  );
  check(
    'error message mentions "defense in depth"',
    errMsg.includes("defense in depth")
  );

  // ── DB row counts BEFORE the dry-run run ───────────────────────
  section("No-write proof — capturing row counts before dry run");

  const before = {
    game_predictions: await tableRowCount("game_predictions"),
    scores_model_runs: await tableRowCount("scores_model_runs"),
    sharp_signals: await tableRowCount("sharp_signals"),
    lines: await tableRowCount("lines"),
    data_refresh_log: await tableRowCount("data_refresh_log"),
  };
  for (const [t, c] of Object.entries(before)) {
    console.log(`  ${t}: ${c} rows before`);
  }

  // ── Run dry-run for morning_draft stage ────────────────────────
  section("Dry-run — morning_draft stage");

  const morningResult = await generatePredictionsForSlate(
    "mlb",
    today,
    "morning_draft"
  );

  check(
    "result.sport === 'mlb' AND result.slate_date === today",
    morningResult.sport === "mlb" && morningResult.slate_date === today
  );
  check(
    `result.stage === 'morning_draft' (got '${morningResult.stage}')`,
    morningResult.stage === "morning_draft"
  );
  check(
    `result.game_count >= 0 (got ${morningResult.game_count})`,
    morningResult.game_count >= 0
  );
  check(
    "result.predictions.length === result.game_count",
    morningResult.predictions.length === morningResult.game_count
  );
  check(
    "result.duration_ms is a positive number",
    typeof morningResult.duration_ms === "number" && morningResult.duration_ms > 0
  );
  // Phase 3C: dry-run leaves db_writes=null (no write attempted).
  check(
    "result.db_writes === null (dry-run leaves DB write outcome empty)",
    morningResult.db_writes === null
  );

  // AI sanity counts add up to game_count
  const aiTotal =
    morningResult.ai_sanity_actions.approve +
    morningResult.ai_sanity_actions.warn +
    morningResult.ai_sanity_actions.hold +
    morningResult.ai_sanity_actions.rerun;
  check(
    "ai_sanity_actions tally sums to game_count (when no errors)",
    morningResult.errors.length > 0 ||
      aiTotal === morningResult.game_count
  );
  check(
    "V1 stub: ai_sanity_actions.approve === game_count (with no errors); warn/hold/rerun === 0",
    morningResult.errors.length > 0 ||
      (morningResult.ai_sanity_actions.approve === morningResult.game_count &&
        morningResult.ai_sanity_actions.warn === 0 &&
        morningResult.ai_sanity_actions.hold === 0 &&
        morningResult.ai_sanity_actions.rerun === 0)
  );

  // Per-prediction invariants
  if (morningResult.predictions.length > 0) {
    let predicted_total_math_holds = true;
    let confidence_floor_holds = true;
    let stage_cap_holds = true;
    let pick_orphan_check = true;
    const morningCap = STAGE_CONFIDENCE_CAPS.morning_draft;

    for (const p of morningResult.predictions) {
      // Guard 1 invariant: predicted_total = home + away when both
      // non-null.
      if (p.predicted_home_score !== null && p.predicted_away_score !== null) {
        const recomputed =
          Math.round((p.predicted_home_score + p.predicted_away_score) * 10) /
          10;
        if (
          p.predicted_total === null ||
          Math.abs(p.predicted_total - recomputed) > 0.01
        ) {
          predicted_total_math_holds = false;
        }
      }

      // Confidence floor
      if (
        p.ml_confidence !== null &&
        (p.ml_confidence < HARD_CONFIDENCE_FLOOR ||
          p.ml_confidence > morningCap)
      ) {
        confidence_floor_holds = false;
        stage_cap_holds = false;
      }
      if (
        p.ou_confidence !== null &&
        (p.ou_confidence < HARD_CONFIDENCE_FLOOR ||
          p.ou_confidence > morningCap)
      ) {
        confidence_floor_holds = false;
        stage_cap_holds = false;
      }
      if (
        p.nrfi_confidence !== null &&
        (p.nrfi_confidence < HARD_CONFIDENCE_FLOOR ||
          p.nrfi_confidence > NRFI_CONFIDENCE_CAP)
      ) {
        confidence_floor_holds = false;
      }

      // Pick orphan check — confidence and winner co-null
      if (
        (p.predicted_ml_winner === null) !==
        (p.ml_confidence === null)
      ) {
        pick_orphan_check = false;
      }
      if (
        (p.predicted_ou_side === null) !==
        (p.ou_confidence === null)
      ) {
        pick_orphan_check = false;
      }
      if (
        (p.predicted_nrfi === null) !==
        (p.nrfi_confidence === null)
      ) {
        pick_orphan_check = false;
      }
    }

    check(
      "Guard 1 invariant: predicted_total = home + away on every prediction",
      predicted_total_math_holds
    );
    check(
      "Guard 4 invariant: every populated confidence ≥ HARD_CONFIDENCE_FLOOR (51)",
      confidence_floor_holds
    );
    check(
      `stage cap invariant: ML/OU confidence ≤ ${morningCap}; NRFI ≤ ${NRFI_CONFIDENCE_CAP}`,
      stage_cap_holds
    );
    check(
      "no pick orphans: predicted_X null iff confidence null on every market",
      pick_orphan_check
    );

    // sport_specific.ai_sanity must record deterministic_corrections array
    const everyHasAuditTrail = morningResult.predictions.every(
      (p) =>
        Array.isArray(p.sport_specific.ai_sanity.deterministic_corrections) &&
        p.sport_specific.ai_sanity.action === "approve" &&
        p.sport_specific.model_version === "auto_v1.0_mlb_rules"
    );
    check(
      "every prediction has well-formed sport_specific.ai_sanity audit + model_version",
      everyHasAuditTrail
    );

    // The first prediction sport_specific contains the Phase 3 hint fields
    const first = morningResult.predictions[0]!;
    check(
      "sport_specific.starter_confirmed is present (boolean)",
      typeof first.sport_specific.starter_confirmed === "boolean"
    );
    check(
      "sport_specific.opposing_deterministic_warning is present (boolean)",
      typeof first.sport_specific.opposing_deterministic_warning === "boolean"
    );
    check(
      "sport_specific.market_line_available is present (boolean)",
      typeof first.sport_specific.market_line_available === "boolean"
    );
    check(
      "sport_specific.held + hold_picks + hold_reason are present",
      typeof first.sport_specific.held === "boolean" &&
        Array.isArray(first.sport_specific.hold_picks) &&
        (first.sport_specific.hold_reason === null ||
          typeof first.sport_specific.hold_reason === "string")
    );
    check(
      "every prediction has prediction_source === 'auto_v1_mlb_rules'",
      morningResult.predictions.every(
        (p: AutoModelOutput) => p.prediction_source === "auto_v1_mlb_rules"
      )
    );
  } else {
    console.log(
      `  ! No predictions returned for today's slate (game_count=${morningResult.game_count}). Per-prediction invariants skipped.`
    );
  }

  // ── Also run against the seed slate (2026-05-22) which has rich
  // game data, to exercise per-prediction invariants end-to-end.
  section("Dry-run — seed slate 2026-05-22 (per-prediction invariants)");

  const SEED_SLATE = "2026-05-22";
  const seedResult = await generatePredictionsForSlate(
    "mlb",
    SEED_SLATE,
    "morning_draft"
  );
  check(
    `seed-slate result has game_count > 0 (got ${seedResult.game_count})`,
    seedResult.game_count > 0
  );

  if (seedResult.predictions.length > 0) {
    let seed_predicted_total_math = true;
    let seed_confidence_floor = true;
    let seed_pick_orphan = true;
    let seed_stage_cap = true;
    let seed_audit = true;
    const morningCap = STAGE_CONFIDENCE_CAPS.morning_draft;

    for (const p of seedResult.predictions) {
      // predicted_total math
      if (p.predicted_home_score !== null && p.predicted_away_score !== null) {
        const recomputed =
          Math.round((p.predicted_home_score + p.predicted_away_score) * 10) /
          10;
        if (
          p.predicted_total === null ||
          Math.abs(p.predicted_total - recomputed) > 0.01
        ) {
          seed_predicted_total_math = false;
        }
      }
      // Confidence floor + stage cap
      if (
        p.ml_confidence !== null &&
        (p.ml_confidence < HARD_CONFIDENCE_FLOOR || p.ml_confidence > morningCap)
      ) {
        seed_confidence_floor = false;
        seed_stage_cap = false;
      }
      if (
        p.ou_confidence !== null &&
        (p.ou_confidence < HARD_CONFIDENCE_FLOOR || p.ou_confidence > morningCap)
      ) {
        seed_confidence_floor = false;
        seed_stage_cap = false;
      }
      if (
        p.nrfi_confidence !== null &&
        (p.nrfi_confidence < HARD_CONFIDENCE_FLOOR ||
          p.nrfi_confidence > NRFI_CONFIDENCE_CAP)
      ) {
        seed_confidence_floor = false;
      }
      // Pick orphan
      if (
        (p.predicted_ml_winner === null) !==
        (p.ml_confidence === null)
      ) {
        seed_pick_orphan = false;
      }
      if (
        (p.predicted_ou_side === null) !==
        (p.ou_confidence === null)
      ) {
        seed_pick_orphan = false;
      }
      if (
        (p.predicted_nrfi === null) !==
        (p.nrfi_confidence === null)
      ) {
        seed_pick_orphan = false;
      }
      // Audit trail
      if (
        !Array.isArray(
          p.sport_specific.ai_sanity.deterministic_corrections
        ) ||
        p.sport_specific.ai_sanity.action !== "approve" ||
        p.sport_specific.model_version !== "auto_v1.0_mlb_rules"
      ) {
        seed_audit = false;
      }
    }

    check(
      "[seed] Guard 1: predicted_total = home + away on every prediction",
      seed_predicted_total_math
    );
    check(
      "[seed] Guard 4: every populated confidence ≥ 51",
      seed_confidence_floor
    );
    check(
      `[seed] stage cap: ML/OU ≤ ${morningCap}; NRFI ≤ ${NRFI_CONFIDENCE_CAP}`,
      seed_stage_cap
    );
    check("[seed] no pick orphans on any prediction", seed_pick_orphan);
    check(
      "[seed] every prediction has well-formed audit trail (model_version + ai_sanity.action='approve')",
      seed_audit
    );

    // Confirm Phase 3 hint fields are present on every prediction
    const everyHintPresent = seedResult.predictions.every(
      (p) =>
        typeof p.sport_specific.starter_confirmed === "boolean" &&
        typeof p.sport_specific.opposing_deterministic_warning === "boolean" &&
        typeof p.sport_specific.market_line_available === "boolean"
    );
    check(
      "[seed] every prediction has Phase 3 framework hint fields (starter_confirmed, opposing_deterministic_warning, market_line_available)",
      everyHintPresent
    );

    // Predictions stage tag matches the input stage
    const everyStageMatches = seedResult.predictions.every(
      (p) => p.sport_specific.stage === "morning_draft"
    );
    check(
      "[seed] every prediction has sport_specific.stage='morning_draft'",
      everyStageMatches
    );
  }

  // ── Run dry-run for t60_locked stage ───────────────────────────
  section("Dry-run — t60_locked stage (publish-quality)");

  const t60Result = await generatePredictionsForSlate(
    "mlb",
    today,
    "t60_locked"
  );
  check(
    `t60_locked result.stage === 't60_locked'`,
    t60Result.stage === "t60_locked"
  );
  check(
    "t60_locked produces same game_count as morning_draft",
    t60Result.game_count === morningResult.game_count
  );
  if (t60Result.predictions.length > 0) {
    let t60_stage_cap_holds = true;
    const t60Cap = STAGE_CONFIDENCE_CAPS.t60_locked;
    for (const p of t60Result.predictions) {
      if (p.ml_confidence !== null && p.ml_confidence > t60Cap) {
        t60_stage_cap_holds = false;
      }
      if (p.ou_confidence !== null && p.ou_confidence > t60Cap) {
        t60_stage_cap_holds = false;
      }
    }
    check(
      `t60_locked stage cap: ML/OU confidence ≤ ${t60Cap} on every prediction`,
      t60_stage_cap_holds
    );
  }

  // ── DB row counts AFTER both dry-runs ──────────────────────────
  section("No-write proof — capturing row counts after dry runs");

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

  // ── Cross-sport gate ───────────────────────────────────────────
  section("Cross-sport gate");
  const empty = await generatePredictionsForSlate("nba", today, "morning_draft");
  check(
    "generatePredictionsForSlate('nba', today) returns empty result (V1 MLB-only)",
    empty.game_count === 0 && empty.predictions.length === 0
  );

  // ── Summary ────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  console.log(
    `\nDry-run timing: morning_draft=${morningResult.duration_ms}ms, t60_locked=${t60Result.duration_ms}ms`
  );
  console.log(
    `Held games: morning=${morningResult.held_count}/${morningResult.game_count}, t60=${t60Result.held_count}/${t60Result.game_count}`
  );
  console.log(
    `Pick null counts (morning): ml=${morningResult.pick_null_counts.ml}, ou=${morningResult.pick_null_counts.ou}, nrfi=${morningResult.pick_null_counts.nrfi}`
  );
  console.log(
    `Total deterministic guard corrections applied: morning=${morningResult.total_deterministic_corrections}, t60=${t60Result.total_deterministic_corrections}`
  );
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All automodelService dry-run tests passed.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
