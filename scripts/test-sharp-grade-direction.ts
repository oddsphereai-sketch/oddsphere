/**
 * Phase 4B — pure unit tests for sharp-grade direction helpers.
 *
 * No DB, no env. Runs via:
 *   npx tsx scripts/test-sharp-grade-direction.ts
 */

import {
  deriveRowSharpGradeDirection,
  deriveSharpGradeDirection,
} from "../lib/automodel/sharpGradeDirection";

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

// ─── deriveSharpGradeDirection — every Grade value ────────────────────
section("deriveSharpGradeDirection — full Grade enumeration");

check(
  "best_signal → support",
  deriveSharpGradeDirection("best_signal") === "support"
);
check(
  "sharp_confirmed → support",
  deriveSharpGradeDirection("sharp_confirmed") === "support"
);
check(
  "market_led → support",
  deriveSharpGradeDirection("market_led") === "support"
);

check(
  "sharp_conflict → conflict",
  deriveSharpGradeDirection("sharp_conflict") === "conflict"
);

check(
  "model_only → neutral",
  deriveSharpGradeDirection("model_only") === "neutral"
);
check(
  "market_watch → neutral",
  deriveSharpGradeDirection("market_watch") === "neutral"
);
check(
  "public_smoke → neutral",
  deriveSharpGradeDirection("public_smoke") === "neutral"
);

// ─── deriveSharpGradeDirection — null/undefined/unknown ──────────────
section("deriveSharpGradeDirection — null / undefined / unknown defensive");

check("null → null", deriveSharpGradeDirection(null) === null);
check("undefined → null", deriveSharpGradeDirection(undefined) === null);
check(
  "unknown string → null (defensive)",
  deriveSharpGradeDirection("foo_bar_baz") === null
);
check(
  "empty string → null",
  deriveSharpGradeDirection("") === null
);
check(
  'market_resistance (MarketSignal, not Grade) → null',
  deriveSharpGradeDirection("market_resistance") === null
);
check(
  'market_neutral (MarketSignal, not Grade) → null',
  deriveSharpGradeDirection("market_neutral") === null
);

// ─── deriveRowSharpGradeDirection — priority aggregation ──────────────
section("deriveRowSharpGradeDirection — support > conflict > neutral priority");

check(
  "all three null → null",
  deriveRowSharpGradeDirection({
    ml_grade: null,
    ou_grade: null,
    nrfi_grade: null,
  }) === null
);

check(
  "one support, two neutral → support",
  deriveRowSharpGradeDirection({
    ml_grade: "best_signal",
    ou_grade: "market_watch",
    nrfi_grade: "model_only",
  }) === "support"
);

check(
  "one conflict, two neutral → conflict",
  deriveRowSharpGradeDirection({
    ml_grade: "sharp_conflict",
    ou_grade: "model_only",
    nrfi_grade: null,
  }) === "conflict"
);

check(
  "support AND conflict together → support wins (priority order)",
  deriveRowSharpGradeDirection({
    ml_grade: "best_signal",
    ou_grade: "sharp_conflict",
    nrfi_grade: "market_watch",
  }) === "support"
);

check(
  "all three neutral → neutral",
  deriveRowSharpGradeDirection({
    ml_grade: "model_only",
    ou_grade: "market_watch",
    nrfi_grade: "public_smoke",
  }) === "neutral"
);

check(
  "missing fields (partial row) → defensive null-handling",
  deriveRowSharpGradeDirection({}) === null
);

check(
  "single conflict pick, others undefined → conflict",
  deriveRowSharpGradeDirection({ nrfi_grade: "sharp_conflict" }) === "conflict"
);

// ─── Summary ──────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All sharp-grade-direction tests passed.`);
