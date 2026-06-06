/**
 * Push 3B-6 — orchestrator readiness step order + safety tests.
 *
 * Regression guards for:
 *   • S5.5/S5.6/S5.7 land between S5 (season pitching) and S7 (lines).
 *   • Readiness service is imported from lib/services/* — NOT from
 *     scripts/operator/* (CLI main() side-effect would break the
 *     Next build worker again, just like 3B-5e did).
 *   • Step-name enum carries the three new step keys.
 *   • Per-step gate flag wired through automationOrchestratorGates.
 *   • Orchestrator does not introduce direct supabase writes for
 *     game_predictions / slate_status / locked_at / tracking from
 *     the readiness steps.
 */

import { readFileSync } from "node:fs";

const SERVICE = readFileSync("lib/services/automationOrchestrator.ts", "utf8");
const GATES = readFileSync("lib/services/automationOrchestratorGates.ts", "utf8");
const READINESS_SERVICE = readFileSync("lib/services/modelReadinessService.ts", "utf8");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ orchestrator-readiness order/safety tests ━━━\n`);

// T1 — Step keys exist on the union type.
check("T1 step union contains s5_5_readiness_audit",  SERVICE.includes('"s5_5_readiness_audit"'));
check("T1 step union contains s5_6_readiness_repair", SERVICE.includes('"s5_6_readiness_repair"'));
check("T1 step union contains s5_7_readiness_reaudit", SERVICE.includes('"s5_7_readiness_reaudit"'));

// T2 — Service imports readiness from lib/services/*, NOT from scripts/operator/*.
check(
  "T2 readiness imported from lib/services/modelReadinessService",
  SERVICE.includes('from "./modelReadinessService"'),
);
check(
  "T2 readiness NOT imported from scripts/operator (CLI main() boundary)",
  !SERVICE.match(/scripts\/operator\/.*model-readiness/),
  "orchestrator may not import the audit/repair CLI scripts directly — they have top-level main()",
);

// T3 — Order: s5_season_pitching before s5_5 before s5_6 before s5_7 before s7_lines_v2.
const idxS5  = SERVICE.indexOf('runStep("s5_season_pitching"');
const idxS55 = SERVICE.indexOf('runStep("s5_5_readiness_audit"');
const idxS56 = SERVICE.indexOf('runStep("s5_6_readiness_repair"');
const idxS57 = SERVICE.indexOf('runStep("s5_7_readiness_reaudit"');
const idxS7  = SERVICE.indexOf('runStep("s7_lines_v2_refresh"');
check("T3 order: s5 before s5_5", idxS5 >= 0 && idxS55 > idxS5);
check("T3 order: s5_5 before s5_6", idxS55 >= 0 && idxS56 > idxS55);
check("T3 order: s5_6 before s5_7", idxS56 >= 0 && idxS57 > idxS56);
check("T3 order: s5_7 before s7 lines", idxS57 >= 0 && idxS7 > idxS57);

// T4 — Per-step env var registered.
check(
  "T4 PER_STEP_ENV_VARS.readiness = MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED",
  GATES.includes('readiness: "MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED"'),
);

// T5 — Repair gated by readiness AND automodel (two-key write).
const repairBlock = SERVICE.slice(idxS56, idxS57 > 0 ? idxS57 : SERVICE.length);
check(
  "T5 repair writeMode = readiness && automodel",
  repairBlock.includes("effectiveWriteMode.readiness && effectiveWriteMode.automodel"),
);

// T6 — Readiness steps do not include forbidden writes/calls.
const forbidden = [
  "from(\"game_predictions\"",
  "from('game_predictions'",
  "from(\"slate_status\"",
  "from(\"locked_at\"",
  "from(\"tracking\"",
  "generatePredictionsForSlate",
  "publishSlate",
  "lockGame",
];
for (const f of forbidden) {
  check(
    `T6 readiness service has no '${f}'`,
    !READINESS_SERVICE.includes(f),
    `${f} found in lib/services/modelReadinessService.ts`,
  );
}

// T7 — Audit + reaudit run in read-only mode (writeMode arg = false).
check("T7 s5_5 audit invoked with writeMode=false", /runStep\("s5_5_readiness_audit",\s*false/.test(SERVICE));
check("T7 s5_7 reaudit invoked with writeMode=false", /runStep\("s5_7_readiness_reaudit",\s*false/.test(SERVICE));

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
