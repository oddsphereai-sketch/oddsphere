/**
 * WC 2026-06-12 — Tests for soccerTotalProjectionReconciliation.
 *
 * Mirrors the MLB-side totalProjectionReconciliation test contract.
 * Covers the BIH@CAN incident scenario (mean direction Over, raw
 * probability split, no public splits) and the V1 coherence guard
 * that locks displayed_side to mean direction when the holistic vote
 * disagrees with mean direction.
 */

import {
  reconcileSoccerTotal,
  type SoccerTotalReconciliation,
} from "../lib/services/soccer/soccerTotalProjectionReconciliation";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-total-projection-reconciliation.ts — WC totals reconciliation");
console.log("─".repeat(70));

// ─── 1 ──────────────────────────────────────────────────────────────
// 2026-06-13: projection within a quarter-goal of the line is a coin flip, so
// the displayed side follows the model's MORE-LIKELY (probability) side, not
// "mean barely over the line". Here E=2.629 but P(over)=0.489 < 0.5 → UNDER is
// more likely → displayed Under (coherent, not the old contradictory Over).
test("1. Near-line total resolves to the probability side (E>line but P(over)<0.5 → Under)", () => {
  const out: SoccerTotalReconciliation = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.31,
    rawProjectedHomeGoals: 1.32,
    rawProjectedTotal: 2.629,
    marketTotal: 2.5,
    rawProbabilityOver: 0.489,
    marketImpliedOver: 0.51,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.mean_direction_side === null, `near-line → mean null, got ${out.mean_direction_side}`);
  assert(out.displayed_total_side === "under", `expected displayed Under (probability side), got ${out.displayed_total_side}`);
  assert(out.reconciled_total === 2.629, `expected projected preserved, got ${out.reconciled_total}`);
});

// ─── 2 ──────────────────────────────────────────────────────────────
test("2. Strong over: mean over + raw prob over + value edge over → over wins", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.6,
    rawProjectedHomeGoals: 1.8,
    rawProjectedTotal: 3.4,
    marketTotal: 2.5,
    rawProbabilityOver: 0.72,
    marketImpliedOver: 0.6,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.mean_direction_side === "over", "mean over");
  assert(out.raw_probability_side === "over", "raw prob over");
  assert(out.holistic_side === "over", "holistic over");
  assert(out.displayed_total_side === "over", "displayed over");
});

// ─── 3 ──────────────────────────────────────────────────────────────
test("3. Strong under: every signal points under → under wins", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 0.7,
    rawProjectedHomeGoals: 0.6,
    rawProjectedTotal: 1.3,
    marketTotal: 2.5,
    rawProbabilityOver: 0.18,
    marketImpliedOver: 0.45,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.mean_direction_side === "under", "mean under");
  assert(out.holistic_side === "under", "holistic under");
  assert(out.displayed_total_side === "under", "displayed under");
});

// ─── 4 ──────────────────────────────────────────────────────────────
test("4. Near-line total with strong under probability → displayed Under, neutral cap, no hold", () => {
  // E=2.62 is within a quarter-goal of the line (coin-flip zone). The model
  // strongly favors under (P(over)=0.20) → displayed Under (probability side),
  // capped at Watchlist as a neutral read — NOT forced to "over" by mean-vs-line,
  // and never a hard hold.
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.3,
    rawProjectedHomeGoals: 1.32,
    rawProjectedTotal: 2.62,
    marketTotal: 2.5,
    rawProbabilityOver: 0.20,
    marketImpliedOver: 0.55,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.mean_direction_side === null, `near-line → mean null, got ${out.mean_direction_side}`);
  assert(out.displayed_total_side === "under", `expected Under (probability side), got ${out.displayed_total_side}`);
  assert(out.hold === false, "near-line is a read, never a hard hold");
  assert(out.grade_cap === "watchlist", `expected Watchlist cap, got ${out.grade_cap}`);
});

// ─── 5 ──────────────────────────────────────────────────────────────
test("5. Invariant: displayed_total preserved from raw projection", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.31,
    rawProjectedHomeGoals: 1.32,
    rawProjectedTotal: 2.629,
    marketTotal: 2.5,
    rawProbabilityOver: 0.489,
    marketImpliedOver: 0.51,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.reconciled_total === 2.629, "raw projected total preserved");
  assert(out.raw_projected_total === 2.629, "audit total preserved");
});

// ─── 6 ──────────────────────────────────────────────────────────────
test("6. Locked snapshot returned verbatim", () => {
  const locked: SoccerTotalReconciliation = {
    raw_projected_away_goals: 1.3,
    raw_projected_home_goals: 1.31,
    raw_projected_total: 2.61,
    raw_probability_side: "over",
    raw_probability_pct: 49,
    raw_value_side: "over",
    raw_over_edge_pp: 0.5,
    raw_under_edge_pp: -0.5,
    mean_direction_side: "over",
    market_pressure_side: null,
    holistic_side: "over",
    signal_audit: {
      mean: { side: "over", strength: 0.1, weighted_vote: 0.15 },
      probability: { side: "over", strength: 0.05, weighted_vote: 0.05 },
      value: { side: "over", strength: 0.005, weighted_vote: 0.005 },
      market_pressure: { side: null, strength: 0, weighted_vote: 0 },
    },
    over_vote_total: 0.205,
    under_vote_total: 0,
    reconciled_total_side: "over",
    reconciled_total: 2.61,
    reconciled_away_goals: 1.3,
    reconciled_home_goals: 1.31,
    reconciled_confidence_pct: 49,
    reconciled_edge_pp: 0.5,
    displayed_total_side: "over",
    side_selection_reason: "holistic_aligned_with_mean",
    projection_reconciliation_reason: "raw_aligned",
    side_disagree_flags: [],
    grade_cap: null,
    hold: false,
    invariant_side_matches_total: true,
    used_locked_snapshot: false,
  };
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 99,
    rawProjectedHomeGoals: 99,
    rawProjectedTotal: 99,
    marketTotal: 99,
    rawProbabilityOver: 0.99,
    marketImpliedOver: 0.01,
    marketPressureSide: "over",
    isLocked: true,
    lockedReconciliation: locked,
  });
  assert(out.used_locked_snapshot === true, "must flag locked");
  assert(out.displayed_total_side === "over", "locked side preserved");
  assert(out.reconciled_total === 2.61, "locked total preserved");
});

// ─── 7 ──────────────────────────────────────────────────────────────
test("7. market_pressure_side null (WC V1) does not error and produces 0 pressure vote", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.4,
    rawProjectedHomeGoals: 1.4,
    rawProjectedTotal: 2.8,
    marketTotal: 2.5,
    rawProbabilityOver: 0.55,
    marketImpliedOver: 0.52,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.market_pressure_side === null, "pressure null for WC V1");
  assert(out.signal_audit.market_pressure.weighted_vote === 0, "pressure contribution = 0");
  assert(out.displayed_total_side === "over", "still publishes over");
});

// ─── 8 ──────────────────────────────────────────────────────────────
test("8. Honest confidence: raw P(over) ≈ 48.9% preserved (no inflation)", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.31,
    rawProjectedHomeGoals: 1.32,
    rawProjectedTotal: 2.629,
    marketTotal: 2.5,
    rawProbabilityOver: 0.489,
    marketImpliedOver: 0.51,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  // Near-line → displayed Under (probability side); confidence is the displayed
  // side's honest probability = (1 − 0.489) × 100 ≈ 51.1%.
  assert(out.displayed_total_side === "under", `expected Under, got ${out.displayed_total_side}`);
  assert(Math.abs(out.reconciled_confidence_pct - 51.1) < 0.5,
    `expected ≈51.1, got ${out.reconciled_confidence_pct}`);
});

// ─── 9 ──────────────────────────────────────────────────────────────
test("9. Tiny edge band: small negative edge does not auto-force no_play", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.31,
    rawProjectedHomeGoals: 1.32,
    rawProjectedTotal: 2.629,
    marketTotal: 2.5,
    rawProbabilityOver: 0.489,
    marketImpliedOver: 0.498,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.displayed_total_side === "under", "near-line publishes the probability side (Under)");
  assert(out.hold === false, "small band must not hold");
});

// ─── 10 ─────────────────────────────────────────────────────────────
test("10. signal_audit reports four named weights", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.6,
    rawProjectedHomeGoals: 1.8,
    rawProjectedTotal: 3.4,
    marketTotal: 2.5,
    rawProbabilityOver: 0.72,
    marketImpliedOver: 0.6,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(typeof out.signal_audit.mean.weighted_vote === "number", "mean vote number");
  assert(typeof out.signal_audit.probability.weighted_vote === "number", "prob vote number");
  assert(typeof out.signal_audit.value.weighted_vote === "number", "value vote number");
  assert(typeof out.signal_audit.market_pressure.weighted_vote === "number", "pressure vote number");
});

// ─── 11 ─────────────────────────────────────────────────────────────
test("11. invariant_side_matches_total holds when displayed side reflects projection vs line", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.31,
    rawProjectedHomeGoals: 1.32,
    rawProjectedTotal: 2.629,
    marketTotal: 2.5,
    rawProbabilityOver: 0.489,
    marketImpliedOver: 0.51,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  // projection 2.629 > 2.5 → over; displayed must be over for invariant
  assert(out.invariant_side_matches_total === true, "invariant must hold");
});

// ─── 12 ─────────────────────────────────────────────────────────────
test("12. Side selection reason is set", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.31,
    rawProjectedHomeGoals: 1.32,
    rawProjectedTotal: 2.629,
    marketTotal: 2.5,
    rawProbabilityOver: 0.489,
    marketImpliedOver: 0.51,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(typeof out.side_selection_reason === "string" && out.side_selection_reason.length > 0,
    "side_selection_reason populated");
});

console.log("─".repeat(70));
console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
