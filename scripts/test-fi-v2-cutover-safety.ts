/**
 * Push 3B-7 — FI V2 cutover safety/grep tests.
 *
 * Regression guards on the cutover script. These assertions all run
 * by inspecting the script's source code (not by executing the
 * cutover) so they are safe in CI and on local machines without a DB
 * connection.
 *
 * Guarantees verified here:
 *   1. Hard-coded date matches the intended slate (2026-06-06).
 *   2. Three-key apply gate is wired (--apply + 2 env vars).
 *   3. Both pre-dry-run AND apply-time per-game start-time guard.
 *   4. Status guard set (terminal status excluded).
 *   5. UPDATE-only path on game_predictions (no INSERT, no upsert).
 *   6. UPDATE payload field whitelist — only the FI columns +
 *      sport_specific + updated_at touched. Specifically: ML/OU,
 *      score, locked_at, is_override, computed_at, model_version,
 *      tracking_* are NOT in the update payload.
 *   7. Audit trail written to sport_specific.prev_fi_v1_snapshot.
 *   8. FI V2 audit written to sport_specific.fi_v2_audit.
 *   9. Toss-Up writes nrfi_decision_kind="toss_up" (display contract).
 *  10. Held writes predicted_nrfi=null and "nrfi" in hold_picks.
 *  11. No writes to slate_status, locks, tracking, or model_version.
 *  12. require.main===module guard present (Push 3B-6 lesson).
 */

import { readFileSync } from "node:fs";

const SCRIPT = readFileSync("scripts/operator/cutover-fi-v2-unstarted-2026-06-06.ts", "utf8");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ FI V2 cutover safety/grep tests ━━━\n`);

// 1. Hard-coded date
check(
  "T1 hard-coded date 2026-06-06",
  /HARDCODED_DATE\s*=\s*"2026-06-06"/.test(SCRIPT),
);

// 2. Three-key apply gate
check(
  "T2 --apply gate present",
  SCRIPT.includes('opts.apply && envWritesEnabled && automodelEnvEnabled'),
);
check(
  "T2 FI_V2_CUTOVER_DB_WRITES_ENABLED required for apply",
  /opts\.apply && !envWritesEnabled[\s\S]*?process\.exit\(1\)/.test(SCRIPT),
);
check(
  "T2 AUTOMODEL_DB_WRITES_ENABLED required for apply",
  /opts\.apply && !automodelEnvEnabled[\s\S]*?process\.exit\(1\)/.test(SCRIPT),
);

// 3. Start-time guard at apply, not just dry-run
check(
  "T3 apply-time start-time re-check (startMs <= applyNow.getTime())",
  SCRIPT.includes("startMs <= applyNow.getTime()"),
);
check(
  "T3 start-time crossed reason recorded",
  SCRIPT.includes("start-time crossed since dry-run"),
);

// 4. Terminal status guard
check(
  "T4 TERMINAL_STATUSES set includes STATUS_FINAL/IN_PROGRESS",
  SCRIPT.includes('"STATUS_FINAL"') && SCRIPT.includes('"STATUS_IN_PROGRESS"'),
);
check(
  "T4 terminal status guard at apply",
  SCRIPT.includes("TERMINAL_STATUSES.has(newStatus)"),
);

// 5. UPDATE-only on game_predictions
check(
  "T5 uses .update() on game_predictions",
  /\.from\("game_predictions"\)\s*\.update/.test(SCRIPT) ||
  /\.from\("game_predictions"\)[\s\S]{0,200}?\.update/.test(SCRIPT),
);
check(
  "T5 no .insert() on game_predictions",
  !/\.from\("game_predictions"\)[\s\S]{0,200}?\.insert/.test(SCRIPT),
);
check(
  "T5 no .upsert() on game_predictions",
  !/\.from\("game_predictions"\)[\s\S]{0,200}?\.upsert/.test(SCRIPT),
);

// 6. UPDATE payload field whitelist — pull the update() block and inspect.
const updateMatch = SCRIPT.match(/\.from\("game_predictions"\)\s*\.update\(\s*\{([\s\S]*?)\}\s*\)\s*\.eq/);
const updatePayload = updateMatch ? updateMatch[1] : "";
check("T6 update payload found in source", updatePayload !== "");
const allowedKeys = ["predicted_nrfi", "nrfi_confidence", "sport_specific"];
const forbiddenInUpdate = [
  "predicted_ml_winner", "ml_confidence", "predicted_ou_side", "ou_confidence",
  "predicted_home_score", "predicted_away_score", "predicted_total",
  "locked_at", "is_override", "computed_at", "model_version",
  "tracking_grade", "tracking_outcome", "ml_grade", "ou_grade", "nrfi_grade",
];
for (const k of allowedKeys) {
  check(`T6 update payload includes allowed key '${k}'`, updatePayload.includes(k));
}
for (const k of forbiddenInUpdate) {
  // Match `<key>:` only — comments that mention the key by name (e.g.
  // "computed_at is left untouched") are allowed; an actual assignment
  // (`computed_at: ...`) is not.
  const keyAssignmentRe = new RegExp(`(^|\\s|,)\\s*${k.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:`);
  check(`T6 update payload excludes forbidden key '${k}'`, !keyAssignmentRe.test(updatePayload));
}

// 7. prev_fi_v1_snapshot audit trail
check(
  "T7 prev_fi_v1_snapshot written to sport_specific",
  SCRIPT.includes("prev_fi_v1_snapshot"),
);
check(
  "T7 snapshot captures predicted_nrfi + nrfi_confidence + computed_at",
  /prevFiSnapshot[\s\S]*?predicted_nrfi[\s\S]*?nrfi_confidence[\s\S]*?computed_at/.test(SCRIPT),
);

// 8. fi_v2_audit recorded
check(
  "T8 fi_v2_audit written to sport_specific",
  SCRIPT.includes("fi_v2_audit"),
);
check(
  "T8 fi_v2_audit carries model_version + cutover_reason",
  SCRIPT.includes('model_version: "fi_v2"') &&
  SCRIPT.includes("cutover_reason: CUTOVER_REASON"),
);

// 9. Toss-Up display contract
check(
  "T9 Toss-Up writes nrfi_decision_kind='toss_up'",
  /fiPick === "Toss-Up"[\s\S]*?newDecisionKind\s*=\s*"toss_up"/.test(SCRIPT),
);
check(
  "T9 Toss-Up sets nrfi_confidence=52 (sentinel)",
  /fiPick === "Toss-Up"[\s\S]*?newNrfiConfidence\s*=\s*52/.test(SCRIPT),
);

// 10. Held: null pick + hold_picks merge
check(
  "T10 Held writes predicted_nrfi=null (no fake NRFI)",
  /fi_pick.*else.*newPredictedNrfi\s*=\s*null/.test(SCRIPT) ||
  SCRIPT.includes('newPredictedNrfi = null;'),
);
check(
  "T10 Held merges 'nrfi' into hold_picks",
  /newHoldPicks\s*=\s*Array\.from\(new Set\(\[\.\.\.newHoldPicks,\s*"nrfi"\]\)\)/.test(SCRIPT),
);

// 11. No writes to forbidden tables
const forbiddenTables = [
  /\.from\("slate_status"\)\s*\.(insert|update|upsert|delete)/,
  /\.from\("game_locks"\)\s*\.(insert|update|upsert|delete)/,
  /\.from\("tracking[^"]*"\)\s*\.(insert|update|upsert|delete)/,
  /\.from\("prediction_grades"\)\s*\.(insert|update|upsert|delete)/,
];
for (let i = 0; i < forbiddenTables.length; i++) {
  check(`T11 no write to forbidden table pattern #${i+1}`, !forbiddenTables[i].test(SCRIPT));
}
check(
  "T11 no slate publish/unpublish call",
  !SCRIPT.includes("publishSlate") && !SCRIPT.includes("unpublishSlate"),
);
check(
  "T11 no lock/unlock call",
  !SCRIPT.includes("lockGame") && !SCRIPT.includes("unlockGame"),
);

// 12. Module guard (Push 3B-6 lesson — operators must guard main())
check(
  "T12 main() guarded by require.main === module",
  SCRIPT.includes("require.main === module"),
);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
