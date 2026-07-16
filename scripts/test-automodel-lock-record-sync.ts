/**
 * Regression for the T-60 lock boundary.
 *
 * The final automodel pass must upsert its newly computed pick/grade into
 * prediction_records before pregame-sweep stamps both rows locked. Passing
 * preserveExistingUnlocked here freezes the previous member row while locking
 * a different game_predictions result, which is how PHI Best Angle/No Play and
 * NYM away/PHI home became inconsistent on 2026-07-16.
 */

import { readFileSync } from "node:fs";

const source = readFileSync("lib/services/automodelService.ts", "utf8");
const syncStart = source.indexOf("const syncRes = await createPredictionRecords({");
const syncEnd = source.indexOf("});", syncStart);

if (syncStart < 0 || syncEnd < 0) {
  throw new Error("FAIL: immediate prediction-record sync call not found");
}

const syncCall = source.slice(syncStart, syncEnd);
if (syncCall.includes("preserveExistingUnlocked")) {
  throw new Error("FAIL: T-60 sync still preserves the stale unlocked member row");
}

if (!source.includes('stage === "t60_locked"')) {
  throw new Error("FAIL: T-60 immediate-sync stage gate is missing");
}

console.log("  ✓ T-60 recompute replaces the unlocked member row before lock");
console.log("  ✓ T-60 remains an immediate prediction-record sync stage");
