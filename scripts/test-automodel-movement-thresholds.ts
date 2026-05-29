/**
 * Phase 4A — pure unit tests for MOVEMENT_THRESHOLDS + helpers.
 *
 * No DB, no env, no provider calls. Runs via:
 *   npx tsx scripts/test-automodel-movement-thresholds.ts
 */

import {
  MOVEMENT_THRESHOLDS,
  didEvFlipMeaningfully,
  isSignificantMove,
  safeDelta,
} from "../lib/automodel/movementThresholds";

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

// ─── MOVEMENT_THRESHOLDS constants ─────────────────────────────────────
section("MOVEMENT_THRESHOLDS — Phase 4 planning §4.2 defaults");

check(
  "TOTAL_RUNS === 0.5 (half-run swing flips most O/U math)",
  MOVEMENT_THRESHOLDS.TOTAL_RUNS === 0.5
);
check(
  "ML_FAIR_PROB_PCT === 5.0 (≈ 50 cents in American odds)",
  MOVEMENT_THRESHOLDS.ML_FAIR_PROB_PCT === 5.0
);
check(
  "ML_EV_PCT === 1.0",
  MOVEMENT_THRESHOLDS.ML_EV_PCT === 1.0
);
check(
  "PUBLIC_BETTING_PCT === 10.0",
  MOVEMENT_THRESHOLDS.PUBLIC_BETTING_PCT === 10.0
);
check(
  "PUBLIC_MONEY_PCT === 10.0",
  MOVEMENT_THRESHOLDS.PUBLIC_MONEY_PCT === 10.0
);

// ─── isSignificantMove — null/undefined/NaN handling ───────────────────
section("isSignificantMove — missing/invalid inputs are 'not significant'");

check(
  "both null → false (no signal)",
  isSignificantMove(null, null, 0.5) === false
);
check(
  "before null, after defined → false",
  isSignificantMove(null, 8.5, 0.5) === false
);
check(
  "before defined, after null → false",
  isSignificantMove(8.5, null, 0.5) === false
);
check(
  "both undefined → false",
  isSignificantMove(undefined, undefined, 0.5) === false
);
check(
  "NaN inputs → false",
  isSignificantMove(NaN, 1.0, 0.5) === false
);
check(
  "Infinity inputs → false",
  isSignificantMove(Infinity, 1.0, 0.5) === false
);

// ─── isSignificantMove — symmetry + threshold boundary ────────────────
section("isSignificantMove — symmetric, threshold inclusive");

check(
  "exact threshold move (0.5 with threshold 0.5) → true (inclusive)",
  isSignificantMove(8.0, 8.5, 0.5) === true
);
check(
  "exact threshold move negative direction → true",
  isSignificantMove(8.5, 8.0, 0.5) === true
);
check(
  "below threshold (0.4) → false",
  isSignificantMove(8.0, 8.4, 0.5) === false
);
check(
  "well above threshold (1.5) → true",
  isSignificantMove(8.0, 9.5, 0.5) === true
);
check(
  "no change (8.5 → 8.5) → false",
  isSignificantMove(8.5, 8.5, 0.5) === false
);

// ─── didEvFlipMeaningfully — sign change ───────────────────────────────
section("didEvFlipMeaningfully — sign change is meaningful regardless of magnitude");

check(
  "+0.1 → -0.1 with threshold 5.0 → TRUE (sign flipped — EV side switched)",
  didEvFlipMeaningfully(0.1, -0.1, 5.0) === true
);
check(
  "-3.0 → +3.0 with threshold 5.0 → TRUE (sign flipped)",
  didEvFlipMeaningfully(-3.0, 3.0, 5.0) === true
);
check(
  "+2.0 → +2.5 with threshold 5.0 → false (same sign, sub-threshold)",
  didEvFlipMeaningfully(2.0, 2.5, 5.0) === false
);
check(
  "+2.0 → +8.0 with threshold 5.0 → true (same sign, magnitude swing)",
  didEvFlipMeaningfully(2.0, 8.0, 5.0) === true
);
check(
  "+2.0 → -2.0 with threshold 1.0 → true (sign flip)",
  didEvFlipMeaningfully(2.0, -2.0, 1.0) === true
);
check(
  "0 → 0 → false (no change at all)",
  didEvFlipMeaningfully(0, 0, 1.0) === false
);
check(
  "0 → +0.5 with threshold 1.0 → true (sign emerged from neutral)",
  didEvFlipMeaningfully(0, 0.5, 1.0) === true
);

// ─── didEvFlipMeaningfully — null/invalid handling ─────────────────────
section("didEvFlipMeaningfully — null/invalid → false");

check(
  "null inputs → false",
  didEvFlipMeaningfully(null, null, 1.0) === false
);
check(
  "before null → false",
  didEvFlipMeaningfully(null, 2.0, 1.0) === false
);
check(
  "after null → false",
  didEvFlipMeaningfully(2.0, null, 1.0) === false
);
check(
  "NaN → false",
  didEvFlipMeaningfully(NaN, 2.0, 1.0) === false
);

// ─── safeDelta ─────────────────────────────────────────────────────────
section("safeDelta — returns null on any missing/invalid input");

check(
  "safeDelta(8.0, 8.5) === 0.5",
  safeDelta(8.0, 8.5) === 0.5
);
check(
  "safeDelta(8.5, 8.0) === -0.5 (sign preserved)",
  safeDelta(8.5, 8.0) === -0.5
);
check(
  "safeDelta(null, 8.5) === null",
  safeDelta(null, 8.5) === null
);
check(
  "safeDelta(8.5, null) === null",
  safeDelta(8.5, null) === null
);
check(
  "safeDelta(undefined, undefined) === null",
  safeDelta(undefined, undefined) === null
);
check(
  "safeDelta(NaN, 1.0) === null",
  safeDelta(NaN, 1.0) === null
);
check(
  "safeDelta(0, 0) === 0 (no change is still a valid delta)",
  safeDelta(0, 0) === 0
);

// ─── Cross-check: threshold defaults used by stale detector ────────────
section("Cross-check — threshold values match Phase 4 planning §4.2 verbatim");

check(
  "MOVEMENT_THRESHOLDS keys exactly match planning doc (no rogue tunables)",
  Object.keys(MOVEMENT_THRESHOLDS).sort().join(",") ===
    "ML_EV_PCT,ML_FAIR_PROB_PCT,PUBLIC_BETTING_PCT,PUBLIC_MONEY_PCT,TOTAL_RUNS"
);

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All movement-thresholds tests passed.`);
