/**
 * WC 2026-06-14 — Tests for soccerMatchResultProjectionReconciliation.
 *
 * The score↔pick coherence contract for the 3-way market (sibling of the
 * totals reconciliation test). Verifies:
 *   • the displayed pick always follows the projected scoreline (the
 *     coherence invariant Daniel kept flagging);
 *   • an even GROUP-stage projection resolves to DRAW (the model can
 *     finally call a draw);
 *   • an even KNOCKOUT projection resolves to the favorite, never a bare
 *     draw;
 *   • conviction is governed by edge, NOT an absolute-probability floor
 *     (33% is the 3-way baseline, not 50%).
 */

import {
  reconcileSoccerMatchResult,
  type SoccerMatchResultReconciliation,
} from "../lib/services/soccer/soccerMatchResultProjectionReconciliation";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

const base = { isLocked: false, lockedReconciliation: null as SoccerMatchResultReconciliation | null };

console.log("\nscripts/test-soccer-match-result-reconciliation.ts — WC match_result reconciliation");
console.log("─".repeat(70));

// ─── 1 ── Group stage, even projection → DRAW ───────────────────────────
test("1. GROUP even projection (gap 0.1) → displays DRAW, watchlist cap", () => {
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 1.05, lambdaAway: 0.95,
    modelHome: 0.356, modelDraw: 0.340, modelAway: 0.304,
    marketHome: 0.40, marketDraw: 0.30, marketAway: 0.30,
    drawPickable: true,
  });
  assert(out.displayed_outcome === "draw", `expected draw, got ${out.displayed_outcome}`);
  assert(out.selection_reason === "draw_projection_even", out.selection_reason);
  assert(out.grade_cap === "watchlist", `expected watchlist, got ${out.grade_cap}`);
  assert(out.invariant_pick_matches_projection, "invariant must hold");
});

// ─── 2 ── Group stage, clear favorite + value agrees → team, no cap ─────
test("2. GROUP home favored (gap 0.4), value agrees → HOME, no cap (Lean allowed)", () => {
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 1.3, lambdaAway: 0.9,
    modelHome: 0.413, modelDraw: 0.327, modelAway: 0.260,
    marketHome: 0.36, marketDraw: 0.31, marketAway: 0.33,
    drawPickable: true,
  });
  assert(out.displayed_outcome === "home", `expected home, got ${out.displayed_outcome}`);
  assert(out.selection_reason === "team_projection_value_agrees", out.selection_reason);
  assert(out.grade_cap === null, `expected no cap (41% conf is real 3-way conviction), got ${out.grade_cap}`);
});

// ─── 3 ── Favorite the model+market agree on, longshot value → Market-Aligned ─
test("3. GROUP home favored = market favorite, longshot value on away → Market-Aligned (not caution)", () => {
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 1.3, lambdaAway: 0.9,
    modelHome: 0.413, modelDraw: 0.327, modelAway: 0.260,
    marketHome: 0.50, marketDraw: 0.31, marketAway: 0.19, // market favorite = home; away has marginal value
    drawPickable: true,
  });
  assert(out.displayed_outcome === "home", `pick follows projection, got ${out.displayed_outcome}`);
  assert(out.value_outcome === "away", `value should be the longshot away, got ${out.value_outcome}`);
  assert(out.selection_reason === "team_projection_market_aligned", out.selection_reason);
  assert(out.grade_cap === null, `model+market agree on home → Market-Aligned, got ${out.grade_cap}`);
});

// ─── 3b ── Heavy favorite the model+market agree on → Market-Aligned ────
test("3b. Market favorite the model also backs (neg edge, longshot draw has value) → Market-Aligned, NOT caution", () => {
  // Germany vs Curaçao: model home 84% / draw 13% / away 3%; market home 92%.
  // Home edge -8.6 (no value), but the draw carries +7.6pp → value_outcome=draw.
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 2.62, lambdaAway: 0.42,
    modelHome: 0.837, modelDraw: 0.130, modelAway: 0.034,
    marketHome: 0.923, marketDraw: 0.054, marketAway: 0.023,
    drawPickable: true,
  });
  assert(out.displayed_outcome === "home", `expected home, got ${out.displayed_outcome}`);
  assert(out.value_outcome === "draw", `value should be the longshot draw, got ${out.value_outcome}`);
  assert(out.selection_reason === "team_projection_market_aligned", out.selection_reason);
  assert(out.grade_cap === null, `must NOT caution a favorite the model+market agree on; got ${out.grade_cap}`);
});

// ─── 3c ── Model projects a winner that's neither market-favorite nor value → caution ─
test("3c. Projection ≠ market favorite AND value on a third side → caution (real divergence)", () => {
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 1.3, lambdaAway: 0.9, // model projects home (margin 0.4)
    modelHome: 0.35, modelDraw: 0.35, modelAway: 0.30,
    marketHome: 0.30, marketDraw: 0.25, marketAway: 0.45, // market favorite = away
    drawPickable: true,
  });
  // home edge +5, draw edge +10 (value), away edge -15 → value=draw; projection=home; market fav=away.
  assert(out.displayed_outcome === "home", `pick follows projection, got ${out.displayed_outcome}`);
  assert(out.value_outcome === "draw", `value should be draw, got ${out.value_outcome}`);
  assert(out.selection_reason === "team_projection_value_disagrees", out.selection_reason);
  assert(out.grade_cap === "caution", `projection is neither market-favorite nor value → caution, got ${out.grade_cap}`);
});

// ─── 4 ── Knockout, even projection → favorite, NEVER draw ──────────────
test("4. KNOCKOUT even projection (gap 0.1) → favorite (home), caution — never draw", () => {
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 1.05, lambdaAway: 0.95,
    modelHome: 0.356, modelDraw: 0.340, modelAway: 0.304,
    marketHome: 0.40, marketDraw: 0.30, marketAway: 0.30,
    drawPickable: false,
  });
  assert(out.displayed_outcome === "home", `knockout even → favorite, got ${out.displayed_outcome}`);
  assert(out.displayed_outcome !== "draw", "must never display draw in knockout");
  assert(out.selection_reason === "knockout_even_favorite", out.selection_reason);
  assert(out.grade_cap === "caution", `expected caution, got ${out.grade_cap}`);
});

// ─── 5 ── Knockout, away favored → away ─────────────────────────────────
test("5. KNOCKOUT away favored (gap -0.5) → AWAY", () => {
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 0.8, lambdaAway: 1.3,
    modelHome: 0.26, modelDraw: 0.31, modelAway: 0.43,
    marketHome: 0.30, marketDraw: 0.31, marketAway: 0.39,
    drawPickable: false,
  });
  assert(out.displayed_outcome === "away", `expected away, got ${out.displayed_outcome}`);
});

// ─── 6 ── No market odds → watchlist, edge null ─────────────────────────
test("6. GROUP team favored, no market → WATCHLIST, edge null", () => {
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 1.4, lambdaAway: 0.8,
    modelHome: 0.45, modelDraw: 0.31, modelAway: 0.24,
    marketHome: null, marketDraw: null, marketAway: null,
    drawPickable: true,
  });
  assert(out.displayed_outcome === "home", `expected home, got ${out.displayed_outcome}`);
  assert(out.selection_reason === "team_projection_no_market", out.selection_reason);
  assert(out.grade_cap === "watchlist", `expected watchlist, got ${out.grade_cap}`);
  assert(out.reconciled_edge_pp === null, "edge must be null without market");
});

// ─── 7 ── Coherence invariant holds across the band boundary ────────────
test("7. Invariant: pick always matches projection across margins", () => {
  for (const m of [-2, -0.5, -0.26, -0.25, -0.1, 0, 0.1, 0.25, 0.26, 0.5, 2]) {
    const out = reconcileSoccerMatchResult({
      ...base,
      lambdaHome: 1.0 + m / 2, lambdaAway: 1.0 - m / 2,
      modelHome: 0.34, modelDraw: 0.33, modelAway: 0.33,
      marketHome: 0.34, marketDraw: 0.33, marketAway: 0.33,
      drawPickable: true,
    });
    assert(out.invariant_pick_matches_projection, `invariant broke at margin ${m}`);
    if (Math.abs(m) <= 0.25) assert(out.displayed_outcome === "draw", `margin ${m} should be draw, got ${out.displayed_outcome}`);
    else assert(out.displayed_outcome === (m > 0 ? "home" : "away"), `margin ${m} wrong side`);
  }
});

// ─── 8 ── Locked snapshot returned verbatim ─────────────────────────────
test("8. Locked row returns the locked snapshot verbatim", () => {
  const locked = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 1.05, lambdaAway: 0.95,
    modelHome: 0.356, modelDraw: 0.340, modelAway: 0.304,
    marketHome: 0.40, marketDraw: 0.30, marketAway: 0.30,
    drawPickable: true,
  });
  const out = reconcileSoccerMatchResult({
    ...base,
    lambdaHome: 9, lambdaAway: 0, // wildly different inputs
    modelHome: 0.99, modelDraw: 0.005, modelAway: 0.005,
    marketHome: 0.99, marketDraw: 0.005, marketAway: 0.005,
    drawPickable: true,
    isLocked: true,
    lockedReconciliation: locked,
  });
  assert(out.displayed_outcome === "draw", "locked snapshot must be returned verbatim");
  assert(out.used_locked_snapshot === true, "used_locked_snapshot must be true");
});

console.log("─".repeat(70));
console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
