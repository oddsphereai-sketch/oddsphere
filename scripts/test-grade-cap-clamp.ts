/**
 * Focused tests for clampGradeWithCap (gradeDerivationService.ts).
 *
 * Covers the corrected 2026-06-12 cap semantics:
 *   • cap="caution" forces sharp_conflict, even from market_watch
 *   • cap="no_play" forces sharp_conflict
 *   • cap="watchlist" can downgrade best_signal → market_watch
 *   • cap="watchlist" must NOT soften an existing sharp_conflict
 *   • cap=null leaves grade unchanged
 *   • The OU-only application is enforced upstream by callers — the
 *     clamp itself is grade-axis-agnostic; ML/FI callers simply don't
 *     pass totalGradeCap, so the cap never fires for them.
 *
 * The clamp is private to gradeDerivationService; we exercise it
 * through the public `deriveGrade(input)` API by passing
 * `totalGradeCap` alongside a minimal GradeInput that produces a
 * known raw grade. This keeps the test honest to the public contract.
 */

import { deriveGrade } from "../lib/services/gradeDerivationService";
import type { GradeInput } from "../lib/services/gradeDerivationService";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

/**
 * Build a GradeInput that — without a cap — produces a chosen raw
 * grade. The grade engine reads marketSignal + evidence + modelEdgePct
 * + Phase 2 EV-axis fields to decide. The configurations below are
 * the minimal inputs that drive each target raw grade.
 */
function inputProducing(rawGrade: "best_signal" | "market_watch" | "sharp_conflict", cap: GradeInput["totalGradeCap"] = null): GradeInput {
  if (rawGrade === "best_signal") {
    // High edge + steam_alert + evidence=null (props bypass) → best_signal
    return {
      kind: "prop",
      modelEdgePct: 20,
      marketSignal: "steam_alert",
      evidence: null,
      totalGradeCap: cap,
    };
  }
  if (rawGrade === "sharp_conflict") {
    // market_resistance + evidence=null → sharp_conflict (Flag D1 bypass)
    return {
      kind: "prop",
      modelEdgePct: 5,
      marketSignal: "market_resistance",
      evidence: null,
      totalGradeCap: cap,
    };
  }
  // market_watch — defensive null marketSignal path
  return {
    kind: "game",
    modelEdgePct: null,
    marketSignal: null,
    evidence: null,
    totalGradeCap: cap,
  };
}

console.log("\nscripts/test-grade-cap-clamp.ts — corrected clampGradeWithCap semantics");
console.log("─".repeat(70));

// Baseline — verify each raw-grade generator works as expected when no cap is set.
test("baseline: deriveGrade(cap=null, market_watch input) → market_watch", () => {
  const out = deriveGrade(inputProducing("market_watch", null));
  assert(out.grade === "market_watch", `expected market_watch, got ${out.grade}`);
});

test("baseline: deriveGrade(cap=null, best_signal input) → best_signal", () => {
  const out = deriveGrade(inputProducing("best_signal", null));
  assert(out.grade === "best_signal", `expected best_signal, got ${out.grade}`);
});

test("baseline: deriveGrade(cap=null, sharp_conflict input) → sharp_conflict", () => {
  const out = deriveGrade(inputProducing("sharp_conflict", null));
  assert(out.grade === "sharp_conflict", `expected sharp_conflict, got ${out.grade}`);
});

// THE MIA/PIT FIX — required behavior #1.
test("MIA/PIT pattern: cap='caution' + framework=market_watch → sharp_conflict (escalate)", () => {
  const out = deriveGrade(inputProducing("market_watch", "caution"));
  assert(out.grade === "sharp_conflict", `expected sharp_conflict (Caution), got ${out.grade}`);
});

// Required behavior #2 — cap=caution downgrades strong positive too.
test("cap='caution' + framework=best_signal → sharp_conflict (downgrade)", () => {
  const out = deriveGrade(inputProducing("best_signal", "caution"));
  assert(out.grade === "sharp_conflict", `expected sharp_conflict, got ${out.grade}`);
});

// Required behavior #3 — cap=no_play also drives sharp_conflict.
test("cap='no_play' + framework=market_watch → sharp_conflict (escalate to warning)", () => {
  const out = deriveGrade(inputProducing("market_watch", "no_play"));
  assert(out.grade === "sharp_conflict", `expected sharp_conflict, got ${out.grade}`);
});

// Required behavior #4 — cap=watchlist downgrades strong positive.
test("cap='watchlist' + framework=best_signal → market_watch (downgrade)", () => {
  const out = deriveGrade(inputProducing("best_signal", "watchlist"));
  assert(out.grade === "market_watch", `expected market_watch, got ${out.grade}`);
});

// Required behavior #5 — cap=watchlist must NOT soften sharp_conflict.
test("cap='watchlist' + framework=sharp_conflict → sharp_conflict (don't soften)", () => {
  const out = deriveGrade(inputProducing("sharp_conflict", "watchlist"));
  assert(out.grade === "sharp_conflict", `expected sharp_conflict (stronger warning kept), got ${out.grade}`);
});

// Required behavior #6 — cap=null leaves grade unchanged across cases.
test("cap=null preserves market_watch", () => {
  const out = deriveGrade(inputProducing("market_watch", null));
  assert(out.grade === "market_watch", `expected market_watch, got ${out.grade}`);
});

test("cap=null preserves best_signal", () => {
  const out = deriveGrade(inputProducing("best_signal", null));
  assert(out.grade === "best_signal", `expected best_signal, got ${out.grade}`);
});

test("cap=null preserves sharp_conflict", () => {
  const out = deriveGrade(inputProducing("sharp_conflict", null));
  assert(out.grade === "sharp_conflict", `expected sharp_conflict, got ${out.grade}`);
});

// Defense in depth — cap=caution preserves signal_type from the raw output.
test("cap='caution' preserves signal_type from raw deriveGrade output", () => {
  const out = deriveGrade(inputProducing("market_watch", "caution"));
  // signal_type for market_watch is "balanced" by default → preserved through the clamp
  assert(out.signal_type === "balanced", `expected signal_type=balanced, got ${out.signal_type}`);
});

console.log("─".repeat(70));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\n✗ grade-cap clamp tests failed");
  process.exit(1);
}
console.log("\n✅ All clampGradeWithCap tests passed.");
