/**
 * WC-MODEL-2/3 — side-policy tests for soccer hold + side selection.
 *
 * Covers the 10 expert-required scenarios from the 2026-06-12 WC-MODEL
 * verdict:
 *
 *   1. model_side == value_side, +edge          → publish, no side cap
 *   2. model_side == value_side, −edge < 5pp    → soft cap "model_side_negative_edge"
 *   3. model_side == value_side, −edge ≥ 5pp    → existing hard hold
 *   4. model_side != value_side, both positive  → soft cap "model_value_side_disagree"
 *   5. model_side != value_side, model_side<0   → both side caps fire
 *   6. Totals: mean_dir == model_side           → no totals direction soft cap
 *   7. Totals: mean_dir != model_side, edge≥2pp → soft cap "total_mean_probability_split"
 *   8. Totals: mean_dir != model_side, edge<2pp, model_side!=value_side → hard hold
 *      TOTAL_DIRECTION_CONFLICT
 *   9. Totals: mean_dir != model_side but model_side==value_side       → soft cap only,
 *      not a hard hold (one signal is not enough to block)
 *  10. Backward compat — old call sites that don't pass model_side/
 *      value_side/mean_direction_side still behave like the pre-WC-MODEL-2
 *      hold logic (no new soft caps and no TOTAL_DIRECTION_CONFLICT).
 */

import { deriveHold, type HoldInputContext, type SoftCap } from "../lib/services/soccer/soccerHoldLogic";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

function holdInput(over: Partial<HoldInputContext>): HoldInputContext {
  return {
    market: "match_result",
    market_odds_missing: false,
    reconciliation: "MATCHED",
    has_unresolved_placeholder: false,
    both_providers_stale: false,
    total_lines_diverge: false,
    splits_falsely_claimed: false,
    splits_status: "empty_as_of_probe",
    edge_pp: 4,
    is_far_from_market_hard: false,
    predicted_total: 3.0,
    listed_total_line: 2.5,
    lambda_home: 1.3,
    lambda_away: 1.3,
    joint: null,
    calibration_evidence_level: "external_priors_only",
    pre_calibration_publish_whitelist: ["total", "btts"],
    ...over,
  };
}

function softCapCodes(d: ReturnType<typeof deriveHold>): string[] {
  if (d.hold === true) return [];
  return (d.soft_caps ?? []).map((c: SoftCap) => c.code);
}

console.log("\nscripts/test-soccer-side-policy.ts — WC-MODEL-2/3 side policy + totals direction guard");
console.log("─".repeat(70));

// ─── 1 ──────────────────────────────────────────────────────────────
test("1. model_side == value_side, +edge → publish with no side caps", () => {
  const d = deriveHold(holdInput({
    market: "match_result",
    edge_pp: 4,
    model_side: "home",
    value_side: "home",
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(!codes.includes("model_value_side_disagree"), "no disagree cap expected");
  assert(!codes.includes("model_side_negative_edge"), "no negative-edge cap expected");
});

// ─── 2 ──────────────────────────────────────────────────────────────
test("2. model_side == value_side, small negative edge → soft cap negative_edge", () => {
  const d = deriveHold(holdInput({
    market: "match_result",
    edge_pp: -2,                 // above the -5 hold floor; below 0
    model_side: "home",
    value_side: "home",
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(codes.includes("model_side_negative_edge"), `expected negative-edge cap, got ${codes.join(",")}`);
});

// ─── 3 ──────────────────────────────────────────────────────────────
test("3. model_side == value_side, large negative edge → existing MODEL_WRONG_SIDE_OF_MARKET hard hold", () => {
  const d = deriveHold(holdInput({
    market: "match_result",
    edge_pp: -7,                 // past the -5 floor
    model_side: "home",
    value_side: "home",
  }));
  assert(d.hold === true, `expected hard hold, got ${JSON.stringify(d)}`);
  if (d.hold === true) {
    assert(d.code === "MODEL_WRONG_SIDE_OF_MARKET", `expected MODEL_WRONG_SIDE_OF_MARKET, got ${d.code}`);
  }
});

// ─── 4 ──────────────────────────────────────────────────────────────
test("4. model_side != value_side, model_side has positive edge → soft cap disagree", () => {
  const d = deriveHold(holdInput({
    market: "match_result",
    edge_pp: 3,                  // model side has +3pp edge
    model_side: "home",
    value_side: "away",
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(codes.includes("model_value_side_disagree"), `expected disagree cap, got ${codes.join(",")}`);
  assert(!codes.includes("model_side_negative_edge"), "no negative-edge cap when edge_pp >= 0");
});

// ─── 5 ──────────────────────────────────────────────────────────────
test("5. model_side != value_side, model_side has negative edge → both side caps", () => {
  const d = deriveHold(holdInput({
    market: "match_result",
    edge_pp: -2,
    model_side: "home",
    value_side: "away",
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(codes.includes("model_value_side_disagree"), `disagree cap expected, got ${codes.join(",")}`);
  assert(codes.includes("model_side_negative_edge"), `negative-edge cap expected, got ${codes.join(",")}`);
});

// ─── 6 ──────────────────────────────────────────────────────────────
// NOTE: tests 6-9 use predicted_total >= 0.4 from listed_total_line so
// TOTAL_PUSH_RISK does not pre-empt the direction-related rules.
test("6. Totals: mean direction matches model side → no totals direction soft cap", () => {
  const d = deriveHold(holdInput({
    market: "total",
    edge_pp: 3,
    model_side: "over",
    value_side: "over",
    mean_direction_side: "over",
    predicted_total: 3.0,        // > 2.5 line by 0.5, matches "over"
    listed_total_line: 2.5,
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(!codes.includes("total_mean_probability_split"), "no mean-vs-prob cap when directions align");
});

// ─── 7 ──────────────────────────────────────────────────────────────
// Skew-split test: E[total] above line but probability median says under.
// We simulate this purely via the input fields (the hold-logic doesn't
// recompute E[total] from λ, it consumes predicted_total + mean_dir).
test("7. Totals: mean_dir != model_side, edge >= 2pp, agreement → soft cap, no hold", () => {
  const d = deriveHold(holdInput({
    market: "total",
    edge_pp: 3,                  // not the small-edge band
    model_side: "under",         // probability median says under
    value_side: "under",         // value also under → no disagree cap
    mean_direction_side: "over", // E[total] above line — skew split
    predicted_total: 3.0,        // 0.5 above line — outside push-risk band
    listed_total_line: 2.5,
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(codes.includes("total_mean_probability_split"), `expected mean-vs-prob cap, got ${codes.join(",")}`);
});

// ─── 8 ──────────────────────────────────────────────────────────────
test("8. Totals: mean_dir != model_side AND value_side != model_side AND small edge → hard hold TOTAL_DIRECTION_CONFLICT", () => {
  const d = deriveHold(holdInput({
    market: "total",
    edge_pp: 1,                  // small edge band (< 2pp)
    model_side: "under",
    value_side: "over",          // value disagrees with model
    mean_direction_side: "over", // mean disagrees with model
    predicted_total: 3.0,        // outside push-risk band
    listed_total_line: 2.5,
  }));
  assert(d.hold === true, `expected hard hold, got ${JSON.stringify(d)}`);
  if (d.hold === true) {
    assert(d.code === "TOTAL_DIRECTION_CONFLICT", `expected TOTAL_DIRECTION_CONFLICT, got ${d.code}`);
  }
});

// ─── 9 ──────────────────────────────────────────────────────────────
test("9. Totals: mean_dir != model_side but value_side == model_side → soft cap only", () => {
  const d = deriveHold(holdInput({
    market: "total",
    edge_pp: 1,                  // small edge
    model_side: "under",
    value_side: "under",         // value agrees with model
    mean_direction_side: "over", // only the mean disagrees
    predicted_total: 3.0,        // outside push-risk band
    listed_total_line: 2.5,
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(codes.includes("total_mean_probability_split"), `expected mean-vs-prob cap, got ${codes.join(",")}`);
});

// ─── 10 ─────────────────────────────────────────────────────────────
test("10. Backward compat — no model_side/value_side/mean_direction_side → no new caps", () => {
  const d = deriveHold(holdInput({
    market: "match_result",
    edge_pp: 4,
    // model_side / value_side / mean_direction_side intentionally omitted
  }));
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(!codes.includes("model_value_side_disagree"), "disagree cap must not fire without side fields");
  assert(!codes.includes("model_side_negative_edge"), "negative-edge cap must not fire without side fields");
  assert(!codes.includes("total_mean_probability_split"), "totals cap must not fire without side fields");
});

// Bonus — totals: same as 8 but mean_direction_side missing → no TOTAL_DIRECTION_CONFLICT.
test("11 (bonus). mean_direction_side omitted → no TOTAL_DIRECTION_CONFLICT even when value side disagrees", () => {
  const d = deriveHold(holdInput({
    market: "total",
    edge_pp: 1,
    model_side: "under",
    value_side: "over",
    // mean_direction_side undefined
    predicted_total: 3.0,        // outside push-risk band
    listed_total_line: 2.5,
  }));
  // Disagree cap should still fire; the direction-conflict block requires
  // the mean direction to be known.
  assert(d.hold === false, `expected publish, got ${JSON.stringify(d)}`);
  const codes = softCapCodes(d);
  assert(codes.includes("model_value_side_disagree"), `expected disagree cap, got ${codes.join(",")}`);
});

console.log("─".repeat(70));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\n✗ side-policy tests failed");
  process.exit(1);
}
console.log("\n✅ All side-policy tests passed.");
