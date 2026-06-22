/**
 * Tests for applyOpposingMoneyCaution (daily-edge/route.ts) — flipped/corrected
 * markets are exempt from the opposing-sharp-money Caution downgrade ONLY.
 * Run: npx tsx --env-file=.env.local scripts/test-opposing-money-caution.ts
 */
import { applyOpposingMoneyCaution } from "../app/api/lab/daily-edge/route";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}

const lean = { key: "lean" as const, label: "Lean", warning: "w" };
const ba = { key: "best_angle" as const, label: "Best Angle", warning: null };
// CLE@CWS: pick = CWS (home). CWS split: money 4%, bets 32% → opposing (CLE) money
// 96%, gap 28pp → strong opposing sharp money.
const mlFlip = { ml_flip: { flipped: true }, total_projection_reconciliation: null };
const ouFlip = { ou_flip: { flipped: true } };
const noFlip = {};

console.log("━━━ applyOpposingMoneyCaution ━━━");

// Point 8 — CLE@CWS: flipped (ml_flip) + heavy opposing money → NOT Caution.
const r1 = applyOpposingMoneyCaution(lean, 4, 32, mlFlip, "moneyline");
check("FLIPPED ML + heavy opposing money → stays Lean (NOT Caution)", r1.key === "lean");

// Point 9 — negative control: same opposing money, NOT flipped → Caution.
const r2 = applyOpposingMoneyCaution(lean, 4, 32, noFlip, "moneyline");
check("non-flipped ML + heavy opposing money → Caution", r2.key === "caution");

// Best Angle base, non-flipped, opposing money → Caution (downgrade still works).
const r3 = applyOpposingMoneyCaution(ba, 4, 32, noFlip, "moneyline");
check("non-flipped Best-Angle + opposing money → Caution", r3.key === "caution");

// Totals flip exempt too.
const r4 = applyOpposingMoneyCaution(lean, 4, 32, ouFlip, "total");
check("FLIPPED total + opposing money → stays Lean", r4.key === "lean");

// Cross-market: ml_flip must NOT exempt a TOTAL market (only ou_flip does).
const r5 = applyOpposingMoneyCaution(lean, 4, 32, mlFlip, "total");
check("ml_flip does NOT exempt the TOTAL market → Caution", r5.key === "caution");

// Not-strong opposing money → no downgrade regardless of flip.
const r6 = applyOpposingMoneyCaution(lean, 55, 52, noFlip, "moneyline");
check("weak/no opposing money → stays Lean (no downgrade)", r6.key === "lean");

// Null split → no downgrade.
const r7 = applyOpposingMoneyCaution(lean, null, null, noFlip, "moneyline");
check("null split → stays Lean (no downgrade)", r7.key === "lean");

// Non-positive base verdict is never touched.
const noPlay = { key: "no_play" as const, label: "No Play", warning: null };
const r8 = applyOpposingMoneyCaution(noPlay, 4, 32, noFlip, "moneyline");
check("No-Play base + opposing money → unchanged (downgrade only hits BA/Lean)", r8.key === "no_play");

// Flipped exemption preserves the base verdict's own key (e.g. already-no_play stays).
const r9 = applyOpposingMoneyCaution(noPlay, 4, 32, mlFlip, "moneyline");
check("flipped + No-Play base → unchanged", r9.key === "no_play");

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ Opposing-money Caution exemption tests passed.");
