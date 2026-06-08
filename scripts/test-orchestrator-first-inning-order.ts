/**
 * Phase 6B.31b — orchestrator S6 (first-inning refresh) order + safety
 * regression tests.
 *
 * Static-source checks (no DB, no provider I/O). Guards the invariants
 * that matter when wiring a new write step into the slate cycle:
 *
 *   T1  step union carries s6_first_inning_refresh
 *   T2  helper imported from scripts/operator/backfill-first-inning-stats
 *   T3  S6 lands AFTER S5 (season-pitching) and BEFORE S5.5 (readiness
 *       audit), S7 (lines), and M2 (automodel) — i.e., paired with its
 *       sibling player_season_stats writer and ahead of every consumer
 *   T4  PER_STEP_ENV_VARS.first_inning maps to FIRST_INNING_DB_WRITES_ENABLED
 *       (same flag the standalone operator CLI already consumes)
 *   T5  S6 runStep uses effectiveWriteMode.first_inning + per-step key
 *       "first_inning" — verifies gate routing
 *   T6  Writer scope invariants: the FI writer payload mentions only
 *       first_inning_* + the natural-key + updated_at; never pitching_*,
 *       never batting_*, never game_predictions / tracking / lines /
 *       slate_status / locked_at
 *   T7  Helper exports a callable runFirstInningCycle (signature shape)
 *   T8  Helper result type is structured (no process.exit, returns
 *       status/counters)
 */

import { readFileSync } from "node:fs";

const ORCH = readFileSync("lib/services/automationOrchestrator.ts", "utf8");
const GATES = readFileSync("lib/services/automationOrchestratorGates.ts", "utf8");
const WRITER = readFileSync("lib/services/firstInningStatsWriter.ts", "utf8");
const OPERATOR = readFileSync(
  "scripts/operator/backfill-first-inning-stats.ts",
  "utf8"
);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`);
    fail++;
  }
}

console.log(`\n━━━ orchestrator S6 (first-inning) order/safety tests ━━━\n`);

// T1 — step name on the union
check(
  "T1 step union contains s6_first_inning_refresh",
  ORCH.includes('"s6_first_inning_refresh"')
);

// T2 — orchestrator imports the helper from the operator script
check(
  "T2 orchestrator imports runFirstInningCycle from operator script",
  ORCH.includes(
    'from "../../scripts/operator/backfill-first-inning-stats"'
  ) && ORCH.includes("runFirstInningCycle")
);

// T3 — ordering checks. S6 must be strictly between S5 and S5.5, and
// before S7 / M2.
const idxS5 = ORCH.indexOf('runStep("s5_season_pitching"');
const idxS6 = ORCH.indexOf('runStep("s6_first_inning_refresh"');
const idxS55 = ORCH.indexOf('runStep("s5_5_readiness_audit"');
const idxS7 = ORCH.indexOf('runStep("s7_lines_v2_refresh"');
// M2 is invoked with the step name on its own line (`runStep(\n  "m2_automodel"`),
// so a substring match for `runStep("m2_automodel"` misses it. Locate by
// the bare step-name literal in the union/invocation.
const idxM2 = ORCH.indexOf('"m2_automodel",');
check("T3 order: s5 before s6", idxS5 >= 0 && idxS6 > idxS5);
check("T3 order: s6 before s5_5", idxS6 >= 0 && idxS55 > idxS6);
check("T3 order: s6 before s7_lines", idxS7 > 0 && idxS6 < idxS7);
check("T3 order: s6 before m2 automodel", idxM2 > 0 && idxS6 < idxM2);

// T4 — per-step env var registered
check(
  "T4 PER_STEP_ENV_VARS.first_inning = FIRST_INNING_DB_WRITES_ENABLED",
  GATES.includes('first_inning: "FIRST_INNING_DB_WRITES_ENABLED"')
);

// T5 — S6 wiring uses the first_inning gate key
const s6Block = ORCH.slice(idxS6, idxS55 > 0 ? idxS55 : ORCH.length);
check(
  "T5 S6 runStep uses effectiveWriteMode.first_inning",
  s6Block.includes("effectiveWriteMode.first_inning")
);
check(
  'T5 S6 runStep uses per-step key "first_inning"',
  /runStep\("s6_first_inning_refresh",\s*effectiveWriteMode\.first_inning,\s*"first_inning"/.test(
    s6Block
  )
);

// T6 — writer scope invariants. The FI writer's payload must contain
// ONLY first_inning_* columns + natural key + updated_at. The writer
// must not import/reference any prediction/tracking surfaces.
check(
  "T6 writer references no game_predictions",
  !WRITER.includes('from("game_predictions"') &&
    !WRITER.includes("from('game_predictions'")
);
check(
  "T6 writer references no prediction_records",
  !WRITER.includes('from("prediction_records"') &&
    !WRITER.includes("from('prediction_records'")
);
check(
  "T6 writer references no tracking_records",
  !WRITER.includes('from("tracking_records"') &&
    !WRITER.includes("from('tracking_records'")
);
check(
  "T6 writer references no slate_status",
  !WRITER.includes('from("slate_status"') &&
    !WRITER.includes("from('slate_status'")
);
check(
  "T6 writer references no locked_at",
  !WRITER.includes('from("locked_at"') &&
    !WRITER.includes("from('locked_at'")
);
check(
  "T6 writer references no lines table",
  !WRITER.includes('from("lines"') && !WRITER.includes("from('lines'")
);
// Payload structure: the only data columns the writer assigns are the
// six FI columns. Strip comments first so doc-block mentions of
// pitching_/batting_ (which document the invariant) don't false-trip.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "")
    .replace(/\/\/[^\n]*/g, "");
}
const WRITER_CODE = stripComments(WRITER);
// Forbid bare `pitching_<word>:` / `batting_<word>:` property
// assignments AND forbid `set: { ... pitching_... }` patterns.
check(
  "T6 writer code does not assign pitching_* properties",
  !/\bpitching_[a-z_]+\s*:/.test(WRITER_CODE)
);
check(
  "T6 writer code does not assign batting_* properties",
  !/\bbatting_[a-z_]+\s*:/.test(WRITER_CODE)
);

// Sanity — the writer DOES reference all six FI columns it owns.
for (const col of [
  "first_inning_era",
  "first_inning_starts",
  "first_inning_runs_allowed",
  "first_inning_earned_runs",
  "first_inning_innings_pitched",
  "first_inning_whip",
]) {
  check(`T6 writer payload includes ${col}`, WRITER.includes(col));
}

// T7 — helper export shape
check(
  "T7 operator exports runFirstInningCycle",
  /export\s+async\s+function\s+runFirstInningCycle\s*\(/.test(OPERATOR)
);
check(
  "T7 operator exports RunFirstInningArgs type",
  /export\s+type\s+RunFirstInningArgs\b/.test(OPERATOR)
);
check(
  "T7 operator exports RunFirstInningResult type",
  /export\s+type\s+RunFirstInningResult\b/.test(OPERATOR)
);

// T8 — helper returns a structured status, never process.exit-s from
// inside the helper body. (Top-level CLI shim still exits — that lives
// outside the helper.)
const helperStart = OPERATOR.indexOf(
  "export async function runFirstInningCycle"
);
const cliShimStart = OPERATOR.indexOf("async function main(");
check(
  "T8 helper body found before CLI shim",
  helperStart > 0 && cliShimStart > helperStart
);
const helperBody = OPERATOR.slice(helperStart, cliShimStart);
check(
  "T8 helper body does not call process.exit",
  !helperBody.includes("process.exit")
);
// Status values can appear either as object-literal properties
// (`status: "failed"`) or as discriminant-narrowing assignments
// (`status = "wrote"`). Accept both forms.
check(
  "T8 helper emits each documented status value",
  ['"failed"', '"empty_slate"', '"cancelled"', '"wrote"', '"dry_run"', '"no_changes"']
    .every((s) =>
      helperBody.includes(`status: ${s}`) || helperBody.includes(`status = ${s}`)
    )
);
// And the type literal itself must enumerate the same six values so a
// future refactor can't silently drop a variant.
check(
  "T8 RunFirstInningStatus union enumerates all six variants",
  ['"failed"', '"empty_slate"', '"cancelled"', '"wrote"', '"dry_run"', '"no_changes"']
    .every((s) => OPERATOR.includes(`| ${s}`))
);

// T9 — CLI shim is guarded by require.main === module so importing the
// module does not trigger argv parsing or process.exit.
check(
  "T9 CLI invocation guarded by require.main === module",
  /if\s*\(\s*require\.main\s*===\s*module\s*\)/.test(OPERATOR)
);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
