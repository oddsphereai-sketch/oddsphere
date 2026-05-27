/**
 * Tests for SHARP_SIGNAL_THRESHOLDS conformance (Fix 1.2 — Gap-1 + Gap-2 +
 * Gap-6).
 *
 * Framework reference: planning-docs/SHARP_SIGNAL_FRAMEWORK.md
 * §"Threshold constants" — the authoritative table that every constant
 * below must match verbatim.
 *
 * PURPOSE
 *   Pin each constant to the value the framework specifies. If a future
 *   change drifts the code away from the framework, this test fires the
 *   error message you read first — pointing you at the conflict and
 *   making clear which side (framework or code) needs updating.
 *
 *   "When framework and code conflict, the framework is correct and the
 *    code must be updated." — SHARP_SIGNAL_FRAMEWORK.md §Purpose.
 *
 * SCOPE
 *   Constants only. This file does NOT test that the constants are
 *   correctly *used* by the derivation services — that's covered by
 *   test-market-signal-derivation.ts and test-grade-derivation.ts. This
 *   file is the source-of-truth contract: it answers "do the constants
 *   match the framework table?".
 *
 *   Some constants live in code with names that match the framework
 *   exactly (MIN_EV_FOR_PLUS_EV_SIGNAL, MIN_STEAM_BOOKS, etc.). Others
 *   were renamed during Fix 1.2 to match framework intent
 *   (PUBLIC_SMOKE_TICKET_THRESHOLD, PUBLIC_SMOKE_FLAT_GAP_MAX).
 *
 *   Newly added in Fix 1.2 — EV tier constants are recorded here even
 *   though they're not yet consumed by the grade engine (Session 2 work,
 *   Gap-9 cascade). Pinning them now means the wiring work in Session 2
 *   can rely on them being present and correct.
 *
 * Run with: npm run test:threshold-constants
 */

import { SHARP_SIGNAL_THRESHOLDS } from "../lib/config/constants";

let pass = 0;
let fail = 0;
const failures: string[] = [];

/**
 * Each assertion message references the framework section so future drift
 * produces an actionable error pointing at the conflict and naming the two
 * sides that must agree.
 */
function expectConstant(
  name: keyof typeof SHARP_SIGNAL_THRESHOLDS,
  expected: number,
  frameworkRef: string
) {
  const actual = SHARP_SIGNAL_THRESHOLDS[name];
  const label = `${String(name)} = ${expected} (framework ${frameworkRef})`;
  if (actual === expected) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg =
      `  ✗ ${String(name)} = ${actual} but framework ${frameworkRef} specifies ${expected}. ` +
      `Update either code or framework — they must agree.`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

function main() {
  // ─── Signal 1 — Pinnacle EV tier table ────────────────────────────────────
  section("Signal 1 — Pinnacle EV tiers (framework §'The Five Sharp-Signal Inputs')");

  expectConstant(
    "MIN_EV_FOR_PLUS_EV_SIGNAL",
    1.5,
    "§'Threshold constants' (moderate tier floor)"
  );
  expectConstant(
    "EV_STRONG_THRESHOLD",
    3.0,
    "§'Threshold constants' (strong tier — Signal 1)"
  );
  expectConstant(
    "EV_VERY_STRONG_THRESHOLD",
    5.0,
    "§'Threshold constants' (very-strong tier — Signal 1)"
  );

  // ─── Signal 2 — Steam books ───────────────────────────────────────────────
  section("Signal 2 — Steam movement");

  expectConstant(
    "MIN_STEAM_BOOKS",
    3,
    "§'Threshold constants' (strong tier — Signal 2)"
  );
  expectConstant(
    "STEAM_VERY_STRONG_BOOKS",
    5,
    "§'Threshold constants' (very-strong tier — Signal 2 — Fix 2.1 Gap-3)"
  );

  // ─── Signal 3 — Reverse line movement ─────────────────────────────────────
  section("Signal 3 — Reverse line movement (Fix 2.1 Gap-4)");

  expectConstant(
    "RLM_PUBLIC_THRESHOLD",
    60,
    "§'Threshold constants' RLM_PUBLIC_THRESHOLD (weak-tier floor)"
  );
  expectConstant(
    "RLM_STRONG_PUBLIC_THRESHOLD",
    65,
    "§'Threshold constants' RLM_STRONG_PUBLIC_THRESHOLD (strong tier)"
  );

  // ─── Signal 4 — Sharp money divergence ────────────────────────────────────
  section("Signal 4 — Sharp money divergence (Fix 2.1 Gap-5 completes tier coverage)");

  expectConstant(
    "MIN_SHARP_MONEY_DIVERGENCE_PP",
    10,
    "§'Threshold constants' SHARP_DIVERGENCE_MODERATE"
  );
  expectConstant(
    "SHARP_DIVERGENCE_STRONG",
    15,
    "§'Threshold constants' SHARP_DIVERGENCE_STRONG (strong tier — Fix 2.1 Gap-5)"
  );
  expectConstant(
    "SHARP_DIVERGENCE_VERY_STRONG",
    25,
    "§'Threshold constants' SHARP_DIVERGENCE_VERY_STRONG (very-strong tier — Fix 2.1 Gap-5)"
  );

  // ─── Signal 5 — Public smoke detection ────────────────────────────────────
  section("Signal 5 — Public smoke detection (framework Signal 5)");

  expectConstant(
    "PUBLIC_SMOKE_TICKET_THRESHOLD",
    65,
    "§'Threshold constants' PUBLIC_SMOKE_TICKET_THRESHOLD"
  );
  expectConstant(
    "PUBLIC_SMOKE_FLAT_GAP_MAX",
    8,
    "§'Threshold constants' PUBLIC_SMOKE_FLAT_GAP_MAX"
  );

  // ─── Renamed-constant fail-fast ───────────────────────────────────────────
  // Defensive: if anything in code still references the pre-rename names
  // the type checker would catch it, but in case someone bypasses the type
  // system via dynamic property access, surface it loudly.
  section("Renamed constants — defensive (pre-Fix-1.2 names should not exist)");

  // SHARP_SIGNAL_THRESHOLDS is a const object — direct property reads on
  // unknown keys return undefined at runtime. Cast through unknown so the
  // type checker doesn't reject the check.
  const t = SHARP_SIGNAL_THRESHOLDS as unknown as Record<string, number>;
  if (typeof t.MIN_PUBLIC_HEAVY_PCT === "undefined") {
    pass++;
    console.log(
      "  ✓ MIN_PUBLIC_HEAVY_PCT removed (renamed to PUBLIC_SMOKE_TICKET_THRESHOLD per framework)"
    );
  } else {
    fail++;
    failures.push(
      "  ✗ MIN_PUBLIC_HEAVY_PCT still defined — Fix 1.2 rename incomplete"
    );
  }
  if (typeof t.PUBLIC_MONEY_FLATNESS_PP === "undefined") {
    pass++;
    console.log(
      "  ✓ PUBLIC_MONEY_FLATNESS_PP removed (renamed to PUBLIC_SMOKE_FLAT_GAP_MAX per framework)"
    );
  } else {
    fail++;
    failures.push(
      "  ✗ PUBLIC_MONEY_FLATNESS_PP still defined — Fix 1.2 rename incomplete"
    );
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All threshold constants conform to SHARP_SIGNAL_FRAMEWORK.md.`);
}

main();
