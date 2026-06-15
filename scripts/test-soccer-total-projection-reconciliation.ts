/**
 * WC totals reconciliation — 2026-06-15 probability-driven model-coherence rule.
 *
 * The displayed O/U side ALWAYS follows the model's more-likely side
 * (P(over) vs P(under)), NOT the mean (expected goals) vs the line. The mean
 * stays a descriptive statistic. Near-line right-skew (mean > median) is
 * surfaced via `mean_probability_divergence` and capped at Watchlist, never a
 * public Lean/Best Angle. Public plays require probability support
 * (confidence ≥ floor) AND market value (positive edge).
 */

import {
  reconcileSoccerTotal,
  TOTALS_PUBLIC_CONFIDENCE_FLOOR,
  type SoccerTotalReconciliation,
} from "../lib/services/soccer/soccerTotalProjectionReconciliation";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-total-projection-reconciliation.ts — probability-driven totals");
console.log("─".repeat(70));

// ─── 1 — the core fix ───────────────────────────────────────────────
// mean > line but P(over) < 50% → publish the MORE-LIKELY side (Under), NOT
// the mean side. Right-skew lifts the average above the line; the bet follows
// probability. (JPN@NED-style: E=2.56, P(over)=47.2%.)
test("1. mean > line but P(over) < 50% → probability-driven UNDER (not Over)", () => {
  const out: SoccerTotalReconciliation = reconcileSoccerTotal({
    rawProjectedAwayGoals: 0.98,
    rawProjectedHomeGoals: 1.59,
    rawProjectedTotal: 2.56,
    marketTotal: 2.5,
    rawProbabilityOver: 0.472,
    marketImpliedOver: 0.46,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.displayed_total_side === "under", `expected Under (more likely), got ${out.displayed_total_side}`);
  assert(out.mean_probability_divergence === true, "mean(over) vs prob(under) → divergence flag set");
  assert(Math.abs(out.reconciled_confidence_pct - 52.8) < 0.5, `confidence = P(under) ≈ 52.8, got ${out.reconciled_confidence_pct}`);
  assert(out.grade_cap === "watchlist", `divergence capped at Watchlist, got ${out.grade_cap}`);
  assert(out.reconciled_total === 2.56, "mean preserved as descriptive");
});

// ─── 2 — symmetric: mean < line but P(over) > 50% → Over ────────────
test("2. mean < line but P(over) > 50% → probability-driven OVER (not Under)", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.1,
    rawProjectedHomeGoals: 1.3,
    rawProjectedTotal: 2.40,
    marketTotal: 2.5,
    rawProbabilityOver: 0.55,
    marketImpliedOver: 0.50,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.displayed_total_side === "over", `expected Over (more likely), got ${out.displayed_total_side}`);
  assert(out.mean_probability_divergence === true, "mean(under) vs prob(over) → divergence flag set");
});

// ─── 3 — coherent strong Over unchanged ─────────────────────────────
test("3. Coherent strong Over (mean over + P(over) 72%) → Over, no divergence", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 0.42,
    rawProjectedHomeGoals: 3.04,
    rawProjectedTotal: 3.46,
    marketTotal: 2.5,
    rawProbabilityOver: 0.72,
    marketImpliedOver: 0.60,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.displayed_total_side === "over", "displayed over");
  assert(out.mean_probability_divergence === false, "no divergence");
  assert(out.grade_cap === null, `clear play → no reconciler cap, got ${out.grade_cap}`);
});

// ─── 4 — coherent strong Under unchanged ────────────────────────────
test("4. Coherent strong Under (every signal under) → Under, no divergence", () => {
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
  assert(out.displayed_total_side === "under", "displayed under");
  assert(out.mean_probability_divergence === false, "no divergence");
  assert(out.reconciled_confidence_pct >= TOTALS_PUBLIC_CONFIDENCE_FLOOR, "strong conviction above public floor");
});

// ─── 5 — coin-flip capped below public Lean/Best Angle ──────────────
test("5. Coin-flip total (confidence < public floor) → Watchlist cap, no hold", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.25,
    rawProjectedHomeGoals: 1.27,
    rawProjectedTotal: 2.52,
    marketTotal: 2.5,
    rawProbabilityOver: 0.515, // P(over) 51.5% → confidence 51.5 < 53 floor
    marketImpliedOver: 0.50,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.reconciled_confidence_pct < TOTALS_PUBLIC_CONFIDENCE_FLOOR, "below public floor");
  assert(out.grade_cap === "watchlist", `coin flip capped at Watchlist, got ${out.grade_cap}`);
  assert(out.hold === false, "never a hard hold");
});

// ─── 6 — public play needs probability support AND market value ─────
test("6. Public play allowed only with probability support + market value (no reconciler cap)", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 1.7,
    rawProjectedHomeGoals: 1.8,
    rawProjectedTotal: 3.5,
    marketTotal: 2.5,
    rawProbabilityOver: 0.62, // strong probability support (≥ floor)
    marketImpliedOver: 0.54, // model > market → +8pp value on Over
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.displayed_total_side === "over", "over");
  assert(out.reconciled_confidence_pct >= TOTALS_PUBLIC_CONFIDENCE_FLOOR, "probability support present");
  assert(out.reconciled_edge_pp !== null && out.reconciled_edge_pp > 0, "positive market value on Over");
  assert(out.grade_cap === null, `reconciler leaves it to the ladder (can reach Lean/BA), got ${out.grade_cap}`);
});

// ─── 7 — model+market agree, no value → ladder gives Market-Aligned (not Caution) ─
test("7. Both agree on side, no value → reconciler leaves it to the ladder (no Caution cap)", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 0.40,
    rawProjectedHomeGoals: 3.04,
    rawProjectedTotal: 3.44,
    marketTotal: 2.5,
    rawProbabilityOver: 0.67, // model Over 67%
    marketImpliedOver: 0.82, // market Over 82% → Over edge = -15pp (no value, model less extreme)
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.displayed_total_side === "over", "over (model's more-likely side)");
  assert(out.reconciled_edge_pp !== null && out.reconciled_edge_pp < 0, "negative value vs market on Over");
  // The "Germany ML" principle: model + market AGREE on Over (both > 50%), so a
  // negative edge is just "no betting value" → the ladder lands it at
  // Market-Aligned, NOT a scary Caution. The reconciler must NOT cap here.
  assert(out.grade_cap === null, `no reconciler cap — ladder grades it Market-Aligned, got ${out.grade_cap}`);
});

// ─── 8 — honest confidence = P(displayed side) ──────────────────────
test("8. Confidence is the displayed (probability) side's honest probability", () => {
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
  assert(out.displayed_total_side === "under", "Under is more likely (P(over) 48.9%)");
  assert(Math.abs(out.reconciled_confidence_pct - 51.1) < 0.5, `confidence = P(under) ≈ 51.1, got ${out.reconciled_confidence_pct}`);
});

// ─── 9 — descriptive median / most-likely passed through ────────────
test("9. median / most-likely total surfaced as descriptive (not driving side)", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 0.98,
    rawProjectedHomeGoals: 1.59,
    rawProjectedTotal: 2.56,
    marketTotal: 2.5,
    rawProbabilityOver: 0.472,
    marketImpliedOver: 0.46,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
    medianTotal: 2,
    mostLikelyTotal: 2,
  });
  assert(out.median_total === 2, "median passed through");
  assert(out.most_likely_total === 2, "most-likely passed through");
  assert(out.displayed_total_side === "under", "side still from probability, not the median");
});

// ─── 10 — coherence invariant: side IS the more-likely side ─────────
test("10. invariant_side_matches_total = side equals the higher-probability side", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 0.98,
    rawProjectedHomeGoals: 1.59,
    rawProjectedTotal: 2.56,
    marketTotal: 2.5,
    rawProbabilityOver: 0.472,
    marketImpliedOver: 0.46,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(out.invariant_side_matches_total === true, "displayed side is the probability side");
  assert(out.raw_probability_side === out.displayed_total_side, "raw prob side == displayed");
});

// ─── 11 — locked snapshot returned verbatim ─────────────────────────
test("11. Locked snapshot returned verbatim (side never re-derived post-lock)", () => {
  const locked: SoccerTotalReconciliation = {
    raw_projected_away_goals: 1.3,
    raw_projected_home_goals: 1.31,
    raw_projected_total: 2.61,
    raw_probability_side: "under",
    raw_probability_pct: 51,
    raw_value_side: "under",
    raw_over_edge_pp: -0.5,
    raw_under_edge_pp: 0.5,
    mean_direction_side: "over",
    market_pressure_side: null,
    holistic_side: "under",
    signal_audit: {
      mean: { side: "over", strength: 0.1, weighted_vote: 0.15 },
      probability: { side: "under", strength: 0.05, weighted_vote: 0.05 },
      value: { side: "under", strength: 0.005, weighted_vote: 0.005 },
      market_pressure: { side: null, strength: 0, weighted_vote: 0 },
    },
    over_vote_total: 0.15,
    under_vote_total: 0.055,
    reconciled_total_side: "under",
    reconciled_total: 2.61,
    reconciled_away_goals: 1.3,
    reconciled_home_goals: 1.31,
    reconciled_confidence_pct: 51,
    reconciled_edge_pp: 0.5,
    displayed_total_side: "under",
    median_total: 2,
    most_likely_total: 2,
    mean_probability_divergence: true,
    side_selection_reason: "probability_over_mean",
    projection_reconciliation_reason: "raw_aligned",
    side_disagree_flags: ["mean_probability_divergence"],
    grade_cap: "watchlist",
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
  assert(out.displayed_total_side === "under", "locked side preserved");
  assert(out.reconciled_total === 2.61, "locked total preserved");
});

// ─── 12 — signal_audit still reports four named weights (audit kept) ─
test("12. signal_audit retains four named weights for the operator trail", () => {
  const out = reconcileSoccerTotal({
    rawProjectedAwayGoals: 0.42,
    rawProjectedHomeGoals: 3.04,
    rawProjectedTotal: 3.46,
    marketTotal: 2.5,
    rawProbabilityOver: 0.72,
    marketImpliedOver: 0.60,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
  });
  assert(typeof out.signal_audit.mean.weighted_vote === "number", "mean vote number");
  assert(typeof out.signal_audit.probability.weighted_vote === "number", "prob vote number");
  assert(typeof out.signal_audit.value.weighted_vote === "number", "value vote number");
  assert(typeof out.signal_audit.market_pressure.weighted_vote === "number", "pressure vote number");
});

console.log("─".repeat(70));
console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
