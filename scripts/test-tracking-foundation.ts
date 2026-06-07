/**
 * Push 6B.2 — tracking foundation tests.
 *
 * Pure grep tests against the two new read-only operators:
 *   • scripts/operator/audit-tracking-readiness.ts
 *   • scripts/operator/audit-model-calibration-performance.ts
 *
 * Asserts:
 *   • Both are read-only (refuse --apply).
 *   • Neither writes to game_predictions / slate_status / locked_at /
 *     tracking / prediction_grades.
 *   • Both have require.main===module guards (no Next build-time
 *     side effects).
 *   • Calibration operator surfaces Toss-Up/Held as state counts but
 *     EXCLUDES them from win/loss buckets.
 *   • Calibration operator emits buckets for Edge / Model Prob /
 *     play grade / tier / Best Angle vs Lean.
 *   • Readiness operator surfaces FI V2 audit presence per game.
 */

import { readFileSync } from "node:fs";

const TR = readFileSync("scripts/operator/audit-tracking-readiness.ts", "utf8");
const CAL = readFileSync("scripts/operator/audit-model-calibration-performance.ts", "utf8");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ tracking foundation tests ━━━\n`);

// T1 — Both operators are read-only.
check("T1 tracking-readiness refuses --apply", TR.includes("--apply not supported"));
check("T1 calibration refuses --apply", CAL.includes("--apply not supported"));

// T2 — Neither writes via supabase.from(...).insert/update/upsert/delete.
for (const file of [TR, CAL]) {
  check(
    "T2 no .insert() write call",
    !/supabase\.from\([^)]+\)\s*\.insert\(/.test(file),
  );
  check(
    "T2 no .update() write call",
    !/supabase\.from\([^)]+\)\s*\.update\(/.test(file),
  );
  check(
    "T2 no .upsert() write call",
    !/supabase\.from\([^)]+\)\s*\.upsert\(/.test(file),
  );
  check(
    "T2 no .delete() write call",
    !/supabase\.from\([^)]+\)\s*\.delete\(/.test(file),
  );
}

// T3 — Both have require.main===module guards.
check("T3 tracking-readiness has main-guard", TR.includes("require.main === module"));
check("T3 calibration has main-guard", CAL.includes("require.main === module"));

// T4 — Forbidden table mentions absent in write contexts.
const forbiddenWrites = [
  /\.from\("game_predictions"\)\s*\.(insert|update|upsert|delete)/,
  /\.from\("slate_status"\)\s*\.(insert|update|upsert|delete)/,
  /\.from\("tracking[^"]*"\)\s*\.(insert|update|upsert|delete)/,
  /\.from\("prediction_grades"\)\s*\.(insert|update|upsert|delete)/,
];
for (const re of forbiddenWrites) {
  check(`T4 no forbidden write pattern ${re.source.slice(0, 40)}…`, !re.test(TR));
  check(`T4 no forbidden write pattern ${re.source.slice(0, 40)}…`, !re.test(CAL));
}

// T5 — Calibration excludes Toss-Up / Held from win-rate buckets.
check(
  "T5 calibration filters held=true from gradable",
  /gradableRows[\s\S]{0,200}?r\.held === true/.test(CAL),
);
check(
  "T5 calibration filters play_grade=toss_up from gradable",
  /gradableRows[\s\S]{0,400}?"toss_up"/.test(CAL),
);

// T6 — Calibration emits each required bucket dimension.
for (const label of [
  "By market",
  "By model_used / model_version",
  "By play grade",
  "By Model Probability",
  "By Edge (percentage points)",
  "By data quality tier",
  "Best Angle vs Lean",
]) {
  check(`T6 calibration emits '${label}' bucket`, CAL.includes(label));
}

// T7 — Calibration surfaces Toss-Up / Held counts in top-line summary.
check("T7 top-line surfaces 'Toss-Up rows' count", CAL.includes("Toss-Up rows:"));
check("T7 top-line surfaces 'Held rows' count", CAL.includes("Held rows:"));

// T8 — Readiness surfaces FI V2 audit presence per game.
check("T8 readiness reports FI V2 audit per game", TR.includes("fiV2Ok"));
check(
  "T8 readiness flags missing FI V2 audit when fi_model_used=fi_v2",
  TR.includes("fi_model_used_fi_v2_but_audit_missing"),
);
check("T8 readiness surfaces duplicate-row detection", TR.includes("Duplicate prediction rows"));

// T9 — Readiness flags Toss-Up + Held distinctly.
check("T9 readiness counts Toss-Up (incl legacy)", TR.includes("FI V2 Toss-Up"));
check("T9 readiness counts Held distinctly", TR.includes("FI Held"));

// T10 — Calibration recommendation is purely advisory.
check(
  "T10 calibration disclaims auto-changes",
  CAL.includes("Recommendations are surfacing only") &&
    CAL.includes("No model thresholds changed"),
);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
