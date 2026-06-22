/**
 * Read-path smoke for the pre-lock totals divergence stand-down gate
 * (app/api/lab/daily-edge/route.ts → standDownTotalsOnDivergence).
 *
 * Confirms a divergent TOTAL resolves to "No Play" at display time, and that
 * the gate is a strict no-op for coherent totals and for ML/FI.
 *
 * Run: npx tsx scripts/test-totals-divergence-standdown.ts
 */
import { standDownTotalsOnDivergence } from "../app/api/lab/daily-edge/route";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}

const lean = { key: "lean" as const, label: "Lean", warning: "w" };
const divergent = { total_projection_reconciliation: { mean_probability_divergence: true } };
const coherent = { total_projection_reconciliation: { mean_probability_divergence: false } };

console.log("━━━ Totals divergence stand-down (read path) ━━━");

const r1 = standDownTotalsOnDivergence(lean, "total", divergent);
check("divergent TOTAL → No Play", r1.key === "no_play" && r1.label === "No Play");
check("divergent TOTAL preserves warning", r1.warning === "w");

const r2 = standDownTotalsOnDivergence(lean, "total", coherent);
check("coherent TOTAL → unchanged (Lean)", r2.key === "lean");

const r3 = standDownTotalsOnDivergence(lean, "total", null);
check("TOTAL with no reconciliation blob → unchanged", r3.key === "lean");

const r4 = standDownTotalsOnDivergence(lean, "total", {});
check("TOTAL with empty sportSpecific → unchanged", r4.key === "lean");

const r5 = standDownTotalsOnDivergence(lean, "moneyline", divergent);
check("ML with divergence blob → unaffected", r5.key === "lean");

const r6 = standDownTotalsOnDivergence(lean, "first_inning", divergent);
check("FI with divergence blob → unaffected", r6.key === "lean");

// A best_angle divergent total is the worst case (would otherwise be promoted)
const ba = { key: "best_angle" as const, label: "Best Angle", warning: null };
const r7 = standDownTotalsOnDivergence(ba, "total", divergent);
check("divergent Best-Angle TOTAL → No Play (de-promoted)", r7.key === "no_play");

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ Totals divergence stand-down read-path smoke passed.");
