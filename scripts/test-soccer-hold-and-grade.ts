/**
 * Pass 2 tests for soccer hold-logic + confidence-grade interaction.
 *
 * Covers Daniel's 10 required tests for the WC hold-logic relaxation:
 *   • ML/DC under external_priors_only no longer auto-hold (rules 10
 *     removed, rule 8 → soft cap).
 *   • Far-from-market is a soft cap, not a hard hold.
 *   • Soft caps clamp but never elevate.
 *   • Best Angle structurally locked pre-calibration.
 *   • Missing public splits does not hold alone.
 *   • True blockers still hold.
 *   • Total provider divergence behavior unchanged.
 *   • Negative-edge ML still holds.
 */

import { deriveHold, type HoldInputContext } from "../lib/services/soccer/soccerHoldLogic";
import { deriveSoccerGrade, type GradeInputContext } from "../lib/services/soccer/soccerConfidenceGrade";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-hold-and-grade.ts (Pass 2 — WC launch hold-logic relaxation)");
console.log("─".repeat(70));

// ─── Hold-input fixture builder ────────────────────────────────────

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
    // Default predicted_total deliberately ≥ 0.4 from line so default
    // fixture doesn't trip TOTAL_PUSH_RISK for total-market tests.
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

function gradeInput(over: Partial<GradeInputContext>): GradeInputContext {
  return {
    calibration_evidence_level: "external_priors_only",
    market_supports_pick: false,
    is_stale_market: false,
    is_single_source: false,
    is_far_from_market: false,
    is_short_price_dc: false,
    short_price_dc_market_implied_p: null,
    splits_provider_error: false,
    is_draw_pick: false,
    lambda_total: 2.6,
    is_btts_yes_pick: false,
    lambda_min: 1.2,
    is_match_favorite: false,
    ...over,
  };
}

// ─── Test 1 — ML with +4pp edge under external_priors_only is NOT held ──
test("1. ML with valid data, +4pp aligned edge, external_priors_only → not held", () => {
  const h = deriveHold(holdInput({ market: "match_result", edge_pp: 4 }));
  assert(h.hold === false, `ML +4pp should not be held; got ${JSON.stringify(h)}`);
});

test("1b. WC-MODEL-5: MR FAVORITE +3.9pp + agreement → Lean (favorite ladder lean 3.0)", () => {
  const fav = deriveSoccerGrade({
    market: "match_result",
    selection: "home",
    model_p: 0.50,
    edge_pp: 3.9,
    model_market_agreement: true,
    ctx: gradeInput({ is_match_favorite: true }),
  });
  assert(fav.grade === "Lean", `favorite 3.9pp expected Lean, got ${fav.grade}`);
  assert(fav.best_angle === false, "Best Angle must stay locked");

  // Same edge on a NON-favorite (draw/longshot) side uses the higher bar
  // (lean 5.0) → only Watchlist. Research: longshot/draw edges are noisier.
  const other = deriveSoccerGrade({
    market: "match_result",
    selection: "away",
    model_p: 0.30,
    edge_pp: 3.9,
    model_market_agreement: true,
    ctx: gradeInput({ is_match_favorite: false }),
  });
  assert(other.grade === "Watchlist", `non-favorite 3.9pp expected Watchlist, got ${other.grade}`);
});

// ─── Test 2 — DC with +4pp edge under external_priors_only is NOT held ──
test("2. DC with valid data, +4pp edge, external_priors_only → not held", () => {
  const h = deriveHold(holdInput({ market: "double_chance", edge_pp: 4 }));
  assert(h.hold === false, `DC +4pp should not be held; got ${JSON.stringify(h)}`);
});

test("2b. WC-MODEL-5: DC is stricter — 3.5pp → Caution (below DC watchlist 4.0), 6.5pp → Lean", () => {
  // DC carries stacked margin + short price → highest edge bar. 3.5pp is
  // below even DC's Watchlist floor (4.0) → Caution, not Lean.
  const low = deriveSoccerGrade({
    market: "double_chance",
    selection: "home_or_draw",
    model_p: 0.70,
    edge_pp: 3.5,
    model_market_agreement: true,
    ctx: gradeInput({}),
  });
  assert(low.grade === "Caution", `DC 3.5pp expected Caution, got ${low.grade}`);

  // DC reaches Lean only at its higher floor (6.0).
  const high = deriveSoccerGrade({
    market: "double_chance",
    selection: "home_or_draw",
    model_p: 0.70,
    edge_pp: 6.5,
    model_market_agreement: true,
    ctx: gradeInput({}),
  });
  assert(high.grade === "Lean", `DC 6.5pp expected Lean, got ${high.grade}`);
  // DC can NEVER be Best Angle (excluded) even if calibration were upgraded.
  assert(high.grade !== "Best Angle" && high.best_angle === false, "DC must never be Best Angle");
});

// ─── Test 3 — Negative-edge ML still holds ──────────────────────────
test("3. ML with edge=-7pp still HOLDS (MODEL_WRONG_SIDE preserved)", () => {
  const h = deriveHold(holdInput({ market: "match_result", edge_pp: -7 }));
  assert(h.hold === true, "should hold");
  if (h.hold === true) assert(h.code === "MODEL_WRONG_SIDE_OF_MARKET", `got code ${h.code}`);
});

// ─── Test 4 — Far-from-market under external_priors_only is NOT held ──
test("4. Far-from-market (+20pp) under external_priors_only → not hard-held", () => {
  const h = deriveHold(holdInput({
    market: "btts",
    edge_pp: 20,
    is_far_from_market_hard: true,
  }));
  assert(h.hold === false, `expected not held, got ${JSON.stringify(h)}`);
});

// ─── Test 5 — Far-from-market emits a soft cap with metadata ────────
test("5. Far-from-market under external_priors_only emits soft cap with caution metadata", () => {
  const h = deriveHold(holdInput({
    market: "btts",
    edge_pp: 20,
    is_far_from_market_hard: true,
  }));
  assert(h.hold === false, "must be non-hold variant");
  if (h.hold === false) {
    assert(h.soft_caps !== undefined && h.soft_caps.length === 1, `expected 1 soft cap, got ${h.soft_caps?.length ?? 0}`);
    assert(h.soft_caps![0].cap_at === "Lean", `cap_at should be Lean, got ${h.soft_caps![0].cap_at}`);
    assert(h.soft_caps![0].code === "model_far_from_market_uncalibrated", `code should be model_far_from_market_uncalibrated, got ${h.soft_caps![0].code}`);
    assert(h.soft_caps![0].reason.length > 0, "soft cap reason must be non-empty");
  }
});

// ─── Test 6 — Far-from-market soft cap does NOT elevate ─────────────
test("6. Far-from-market soft cap does NOT elevate Watchlist to Lean", () => {
  // BTTS edge 3.5 (≥ BTTS watchlist 3.0, < lean 5.0) + no agreement → Watchlist.
  // Apply soft cap of Lean — should STAY at Watchlist (cap can only lower).
  const g = deriveSoccerGrade({
    market: "btts",
    selection: "yes",
    model_p: 0.55,
    edge_pp: 3.5,
    model_market_agreement: false,
    ctx: gradeInput({ is_far_from_market: false }),
    soft_caps: [{ code: "model_far_from_market_uncalibrated", cap_at: "Lean", reason: "test" }],
  });
  assert(g.grade === "Watchlist", `expected Watchlist (cap can't elevate), got ${g.grade}`);
});

test("6b. Far-from-market soft cap DOES clamp Best Angle → Lean (consistent with structural lock)", () => {
  // Even if ladder would produce Best Angle, structural lock already → Lean.
  // Soft cap then enforces Lean ceiling again (no-op here).
  const g = deriveSoccerGrade({
    market: "btts",
    selection: "yes",
    model_p: 0.90,
    edge_pp: 8.0,
    model_market_agreement: true,
    ctx: gradeInput({}),
    soft_caps: [{ code: "model_far_from_market_uncalibrated", cap_at: "Lean", reason: "test" }],
  });
  assert(g.grade === "Lean", `expected Lean, got ${g.grade}`);
  assert(g.best_angle === false, "Best Angle stays locked pre-calibration");
});

// ─── Test 7 — Best Angle structurally locked pre-calibration ────────
test("7. Best Angle remains false under external_priors_only even with edge=+25pp", () => {
  const g = deriveSoccerGrade({
    market: "btts",
    selection: "yes",
    model_p: 0.80,
    edge_pp: 25,
    model_market_agreement: true,
    ctx: gradeInput({}), // calibration_evidence_level = external_priors_only
  });
  assert(g.best_angle === false, "Best Angle must be false pre-calibration");
});

// ─── Test 8 — Missing public splits alone does NOT hold ─────────────
test("8. splits_status=empty_as_of_probe alone does NOT hold any market", () => {
  for (const market of ["match_result", "double_chance", "total", "btts"] as const) {
    const h = deriveHold(holdInput({ market, splits_status: "empty_as_of_probe", edge_pp: 4 }));
    assert(h.hold === false, `splits empty should not hold market ${market}; got ${JSON.stringify(h)}`);
  }
});

// ─── Test 9 — True blockers still hold ──────────────────────────────
test("9a. SHARP_ONLY reconciliation still HOLDS", () => {
  const h = deriveHold(holdInput({ reconciliation: "SHARP_ONLY" }));
  assert(h.hold === true && h.code === "SHARP_ONLY_RECONCILIATION", `got ${JSON.stringify(h)}`);
});
test("9b. UNRESOLVED_PLACEHOLDER still HOLDS", () => {
  const h = deriveHold(holdInput({ has_unresolved_placeholder: true }));
  assert(h.hold === true && h.code === "UNRESOLVED_PLACEHOLDER");
});
test("9c. MARKET_ODDS_MISSING still HOLDS", () => {
  const h = deriveHold(holdInput({ market_odds_missing: true }));
  assert(h.hold === true && h.code === "MARKET_ODDS_MISSING");
});
test("9d. BOTH_PROVIDERS_STALE still HOLDS", () => {
  const h = deriveHold(holdInput({ both_providers_stale: true }));
  assert(h.hold === true && h.code === "BOTH_PROVIDERS_STALE");
});
test("9e. SPLITS_FALSE_CLAIM still HOLDS", () => {
  const h = deriveHold(holdInput({ splits_falsely_claimed: true, splits_status: "empty_as_of_probe" }));
  assert(h.hold === true && h.code === "SPLITS_FALSE_CLAIM");
});
test("9f. TOTAL_PUSH_RISK still HOLDS for total when |predicted_total − line| < 0.4", () => {
  const h = deriveHold(holdInput({ market: "total", predicted_total: 2.5, listed_total_line: 2.5, edge_pp: 0 }));
  assert(h.hold === true && h.code === "TOTAL_PUSH_RISK", `got ${JSON.stringify(h)}`);
});

// ─── Test 10 — Total provider divergence unchanged tonight ──────────
test("10. TOTAL_LINES_DIVERGE is a SOFT Caution cap (WC-MODEL-4), not a hard hold", () => {
  // predicted_total far from line (2.5 vs 1.8 → gap 0.7) so TOTAL_PUSH_RISK
  // does not fire and we isolate the divergence path.
  const h = deriveHold(holdInput({ market: "total", total_lines_diverge: true, predicted_total: 2.5, listed_total_line: 1.8 }));
  assert(h.hold === false, `divergence must no longer hard-hold; got ${JSON.stringify(h)}`);
  const cap = h.hold === false ? (h.soft_caps ?? []).find((c) => c.code === "total_lines_diverge") : undefined;
  assert(cap !== undefined && cap.cap_at === "Caution", `divergence must soft-cap at Caution; got ${JSON.stringify(h)}`);
});

// ─── Anti-regression — old rule 10 whitelist is GONE ─────────────────
test("Anti-regression — old rule 10 whitelist for ML is removed (no AWAITING_IN_TOURNAMENT_CALIBRATION code)", () => {
  // Pre-Pass-2: ML under external_priors_only with an empty whitelist for ML would hold with code "AWAITING_IN_TOURNAMENT_CALIBRATION".
  // Post-Pass-2: that hold is gone; should return non-hold (no other rule fires).
  const h = deriveHold(holdInput({
    market: "match_result",
    edge_pp: 4,
    pre_calibration_publish_whitelist: ["total", "btts"], // ML deliberately NOT in whitelist
  }));
  assert(h.hold === false, `ML should not be held just because it's not in the whitelist; got ${JSON.stringify(h)}`);
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ Pass 2 hold-and-grade tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
