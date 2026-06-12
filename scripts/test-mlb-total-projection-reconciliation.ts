/**
 * Pure tests for MLB totals projection / side reconciliation —
 * holistic weighted-vote edition.
 *
 * Covers Daniel's 2026-06-12 revised contract: final side comes from
 * a weighted vote across probability / value / mean / market_pressure.
 * Mean direction is HEAVILY weighted (coherence guard) but does NOT
 * automatically win. When holistic disagrees with mean (V1 has no
 * documented adjustment input), the side reverts to mean and the cap
 * goes to no_play.
 */

import {
  reconcileTotalProjection,
  MEAN_WEIGHT,
  PROBABILITY_WEIGHT,
  VALUE_WEIGHT,
  PRESSURE_WEIGHT,
  MEAN_STRENGTH_NORM_RUNS,
  VALUE_STRENGTH_NORM_PP,
  LOW_CONVICTION_CONFIDENCE_PCT,
  NEGATIVE_EDGE_NO_PLAY_PP,
  type TotalProjectionReconciliation,
  type TotalProjectionReconciliationInput,
} from "../lib/automodel/totalProjectionReconciliation";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

function baseInput(over: Partial<TotalProjectionReconciliationInput> = {}): TotalProjectionReconciliationInput {
  return {
    rawProjectedAwayScore: 4.0,
    rawProjectedHomeScore: 4.5,
    rawProjectedTotal: 8.5,
    marketTotal: 8.5,
    rawProbabilityOver: 0.5,
    marketImpliedOver: 0.5,
    marketPressureSide: null,
    isLocked: false,
    lockedReconciliation: null,
    ...over,
  };
}

function checkInvariant(r: TotalProjectionReconciliation, line: number | null): void {
  if (r.mean_direction_side === null) return;
  if (line === null) return;
  if (r.displayed_total_side === "over") assert(r.reconciled_total > line, `over but total ${r.reconciled_total} <= ${line}`);
  else assert(r.reconciled_total < line, `under but total ${r.reconciled_total} >= ${line}`);
  assert(r.invariant_side_matches_total === true, "invariant flag must be true");
}

console.log("\nscripts/test-mlb-total-projection-reconciliation.ts");
console.log("─".repeat(70));

// ─── 1. MIA/PIT skew-split exact pattern ────────────────────────────
test("1. MIA/PIT — holistic vote favors Over (mean + value outvote weak probability)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 3.8,
    rawProjectedHomeScore: 4.8,
    rawProjectedTotal: 8.6,
    marketTotal: 8.5,
    rawProbabilityOver: 0.4924,
    marketImpliedOver: 0.4826,
  }));
  // Raw signals
  assert(r.raw_probability_side === "under", `raw prob = under (P(Over)=0.4924); got ${r.raw_probability_side}`);
  assert(r.mean_direction_side === "over", `mean = over (8.6>8.5); got ${r.mean_direction_side}`);
  assert(r.raw_value_side === "over", `value = over (over edge +0.98); got ${r.raw_value_side}`);
  // Vote breakdown
  // mean strength ≈ 0.1 × MEAN_WEIGHT(1.5) = 0.15 for Over
  // value strength ≈ 0.196 × VALUE_WEIGHT(1.0) = 0.196 for Over
  // prob strength ≈ 0.0152 × PROB_WEIGHT(1.0) = 0.0152 for Under
  assert(r.over_vote_total > r.under_vote_total, `over should win vote; got over=${r.over_vote_total} under=${r.under_vote_total}`);
  assert(r.holistic_side === "over", "holistic vote = over");
  // Final
  assert(r.reconciled_total_side === "over", `displayed = over; got ${r.reconciled_total_side}`);
  assert(r.displayed_total_side === "over");
  assert(r.reconciled_total === 8.6, "scores preserved at raw 8.6");
  assert(r.reconciled_away_score === 3.8 && r.reconciled_home_score === 4.8);
  assert(Math.abs(r.reconciled_confidence_pct - 49.2) < 0.5, `honest confidence ~49% (got ${r.reconciled_confidence_pct})`);
  assert(r.reconciled_confidence_pct < 50, "confidence below 50 — honest");
  assert(r.side_selection_reason === "holistic_aligned_with_mean",
    `expected holistic_aligned_with_mean; got ${r.side_selection_reason}`);
  assert(r.grade_cap === "caution", `expected caution; got ${r.grade_cap}`);
  assert(r.side_disagree_flags.includes("probability_side_disagrees_with_reconciled"));
  assert(r.side_disagree_flags.includes("reconciled_confidence_below_conviction"));
  checkInvariant(r, 8.5);
});

// ─── 2. Confidence not inflated ─────────────────────────────────────
test("2. Confidence stays honest even with market pressure on reconciled side", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 8.6,
    marketTotal: 8.5,
    rawProbabilityOver: 0.4924,
    marketImpliedOver: 0.4826,
    marketPressureSide: "over",
  }));
  assert(Math.abs(r.reconciled_confidence_pct - 49.2) < 0.5);
  assert(r.grade_cap === "caution", "low-conviction cap still fires");
});

// ─── 3. Raw values preserved ────────────────────────────────────────
test("3. Raw audit fields preserved", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 3.8, rawProjectedHomeScore: 4.8, rawProjectedTotal: 8.6,
    marketTotal: 8.5,
    rawProbabilityOver: 0.4924, marketImpliedOver: 0.4826,
  }));
  assert(r.raw_projected_away_score === 3.8);
  assert(r.raw_projected_home_score === 4.8);
  assert(r.raw_projected_total === 8.6);
  assert(r.raw_probability_side === "under");
  assert(r.raw_value_side === "over");
  assert(r.raw_over_edge_pp !== null && Math.abs(r.raw_over_edge_pp - 0.98) < 0.1);
  // Signal audit captures the holistic reasoning
  assert(r.signal_audit.mean.side === "over");
  assert(r.signal_audit.value.side === "over");
  assert(r.signal_audit.probability.side === "under");
});

// ─── 4. Coherence invariant ─────────────────────────────────────────
test("4. Final displayed side and final projected total always agree", () => {
  const overCase = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.2, marketTotal: 8.5, rawProbabilityOver: 0.55,
  }));
  assert(overCase.displayed_total_side === "over");
  assert(overCase.reconciled_total > 8.5);

  const underCase = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 3.5, rawProjectedHomeScore: 4.2, rawProjectedTotal: 7.7,
    marketTotal: 8.5, rawProbabilityOver: 0.45,
  }));
  assert(underCase.displayed_total_side === "under");
  assert(underCase.reconciled_total < 8.5);
});

// ─── 5. Raw scores preserved (no fabrication) ───────────────────────
test("5. Raw scores never scaled in V1 even when probability disagrees", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 3.8, rawProjectedHomeScore: 4.8, rawProjectedTotal: 8.6,
    marketTotal: 8.5,
    rawProbabilityOver: 0.4924, marketImpliedOver: 0.4826,
  }));
  assert(r.reconciled_away_score === r.raw_projected_away_score);
  assert(r.reconciled_home_score === r.raw_projected_home_score);
  assert(r.reconciled_total === r.raw_projected_total);
  assert(r.projection_reconciliation_reason === "raw_aligned");
});

// ─── 6. All-agree path is clean ─────────────────────────────────────
test("6. All signals agree → no cap, side_selection_reason=all_agree", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.5, marketTotal: 8.5,
    rawProbabilityOver: 0.62, marketImpliedOver: 0.52,
    marketPressureSide: "over",
  }));
  assert(r.reconciled_total_side === "over");
  assert(r.side_selection_reason === "all_agree", `got ${r.side_selection_reason}`);
  assert(r.grade_cap === null);
  assert(r.side_disagree_flags.length === 0);
});

// ─── 7. Mean weight is heavier but not automatic — vote arithmetic ──
test("7. Heavy mean weight wins over single weak opposing signal (vote-based)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.0, marketTotal: 8.5,
    rawProbabilityOver: 0.55, marketImpliedOver: 0.58,
    // over edge -3, under edge +3 → value = under (strength 0.6)
  }));
  // mean str 0.5 × 1.5 = 0.75 (over); value 0.6 × 1.0 = 0.6 (under); prob 0.10 × 1.0 = 0.10 (over)
  // over total 0.85, under total 0.6 → over wins
  assert(r.holistic_side === "over");
  assert(r.reconciled_total_side === "over");
  assert(r.raw_value_side === "under");
  // Negative edge on reconciled over + value disagree → cap caution at least
  assert(r.grade_cap === "caution" || r.grade_cap === "no_play",
    `expected caution/no_play; got ${r.grade_cap}`);
});

// ─── 8. Market pressure alone cannot flip side ──────────────────────
test("8. Market pressure alone never moves displayed side away from holistic majority", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.0, marketTotal: 8.5,
    rawProbabilityOver: 0.55, marketImpliedOver: 0.5,
    marketPressureSide: "under",
  }));
  // mean 0.5×1.5=0.75 over, prob 0.10 over, value 1.0×1.0=1.0 over, pressure 0.5×0.5=0.25 under
  // over=1.85, under=0.25 → over wins decisively
  assert(r.reconciled_total_side === "over");
  assert(r.side_disagree_flags.includes("market_pressure_disagrees_with_reconciled"));
});

// ─── 9. Locked snapshot ─────────────────────────────────────────────
test("9. Locked snapshot returned verbatim — no mutation post-lock", () => {
  const locked: TotalProjectionReconciliation = {
    raw_projected_away_score: 3.8,
    raw_projected_home_score: 4.8,
    raw_projected_total: 8.6,
    raw_probability_side: "under",
    raw_probability_pct: 50.8,
    raw_value_side: "over",
    raw_over_edge_pp: 0.98,
    raw_under_edge_pp: -0.98,
    mean_direction_side: "over",
    market_pressure_side: null,
    holistic_side: "over",
    signal_audit: {
      probability: { side: "under", strength: 0.015, weighted_vote: 0.015 },
      value: { side: "over", strength: 0.196, weighted_vote: 0.196 },
      mean: { side: "over", strength: 0.1, weighted_vote: 0.15 },
      market_pressure: { side: null, strength: 0, weighted_vote: 0 },
    },
    over_vote_total: 0.346,
    under_vote_total: 0.015,
    reconciled_total_side: "over",
    reconciled_total: 8.6,
    reconciled_away_score: 3.8,
    reconciled_home_score: 4.8,
    reconciled_confidence_pct: 49.2,
    reconciled_edge_pp: 0.98,
    displayed_total_side: "over",
    side_selection_reason: "holistic_aligned_with_mean",
    projection_reconciliation_reason: "raw_aligned",
    side_disagree_flags: ["probability_side_disagrees_with_reconciled"],
    grade_cap: "caution",
    hold: false,
    invariant_side_matches_total: true,
    used_locked_snapshot: false,
  };
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.5, marketTotal: 8.5,
    rawProbabilityOver: 0.7,
    isLocked: true,
    lockedReconciliation: locked,
  }));
  assert(r.used_locked_snapshot === true);
  assert(r.reconciled_total_side === "over");
  assert(r.reconciled_total === 8.6);
  assert(r.reconciled_confidence_pct === 49.2);
  assert(r.grade_cap === "caution");
});

// ─── 10. Normal pre-lock model recompute flip ───────────────────────
test("10. Pre-lock recompute: lambdas change → side flips naturally Under → Over", () => {
  const r1 = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 8.2, marketTotal: 8.5,
    rawProbabilityOver: 0.42, marketImpliedOver: 0.5,
  }));
  assert(r1.reconciled_total_side === "under");
  const r2 = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 8.9, marketTotal: 8.5,
    rawProbabilityOver: 0.56, marketImpliedOver: 0.5,
  }));
  assert(r2.reconciled_total_side === "over", "natural recompute flip preserved");
});

// ─── 11. Push-risk hold ─────────────────────────────────────────────
test("11. Posterior exactly on line → push-risk hold + no_play", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 4.25, rawProjectedHomeScore: 4.25, rawProjectedTotal: 8.5,
    marketTotal: 8.5, rawProbabilityOver: 0.49,
  }));
  assert(r.mean_direction_side === null);
  assert(r.hold === true);
  assert(r.grade_cap === "no_play");
  assert(r.side_selection_reason === "push_risk_default_to_probability");
});

// ─── 12. NEW — holistic vote disagrees with mean → side reverts ────
test("12. Holistic Under outvotes mean Over → V1 reverts to mean, cap no_play", () => {
  // Construct: tiny mean Over (8.55 vs 8.5) but strong probability + value + market on Under
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 4.25, rawProjectedHomeScore: 4.30, rawProjectedTotal: 8.55,
    marketTotal: 8.5,
    rawProbabilityOver: 0.20,           // strong Under conviction
    marketImpliedOver: 0.50,            // over edge -30, under edge +30 → value = under (strong)
    marketPressureSide: "under",
  }));
  assert(r.mean_direction_side === "over");
  assert(r.raw_probability_side === "under");
  assert(r.raw_value_side === "under");
  assert(r.market_pressure_side === "under");
  // mean str 0.05 × 1.5 = 0.075 over
  // prob str 0.6 × 1.0 = 0.6 under
  // value str 1.0 × 1.0 = 1.0 under
  // pressure str 0.5 × 0.5 = 0.25 under
  // over=0.075, under=1.85 → holistic = under
  assert(r.holistic_side === "under", `holistic should be under given strong signals; got ${r.holistic_side}`);
  // Coherence check: holistic Under disagrees with mean Over → revert to mean
  assert(r.reconciled_total_side === "over", `coherence revert → over; got ${r.reconciled_total_side}`);
  assert(r.side_selection_reason === "holistic_overruled_by_mean_coherence");
  // Hard cap because holistic disagreed with mean
  assert(r.grade_cap === "no_play", `expected no_play; got ${r.grade_cap}`);
  assert(r.side_disagree_flags.includes("holistic_vote_overruled_by_coherence"));
});

// ─── 13. Holistic agrees with mean → side_selection_reason ─────────
test("13. Probability disagrees but value+mean agree → side_selection_reason=holistic_aligned_with_mean (not all_agree)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.0, marketTotal: 8.5,
    rawProbabilityOver: 0.48,            // raw prob barely Under
    marketImpliedOver: 0.45,             // over edge +3, under edge -3 → value = over
  }));
  assert(r.raw_probability_side === "under");
  assert(r.mean_direction_side === "over");
  assert(r.raw_value_side === "over");
  assert(r.holistic_side === "over");
  assert(r.reconciled_total_side === "over");
  assert(r.side_selection_reason === "holistic_aligned_with_mean");
});

// ─── 14. Invariant sweep ───────────────────────────────────────────
test("14. Reconciled invariant holds across a parameter sweep", () => {
  for (const rawTotal of [7.5, 7.9, 8.0, 8.4, 8.6, 9.0, 9.5, 10.0]) {
    for (const rawProb of [0.30, 0.45, 0.49, 0.51, 0.55, 0.70]) {
      const away = rawTotal / 2;
      const home = rawTotal / 2;
      const r = reconcileTotalProjection(baseInput({
        rawProjectedAwayScore: away, rawProjectedHomeScore: home, rawProjectedTotal: rawTotal,
        marketTotal: 8.5,
        rawProbabilityOver: rawProb, marketImpliedOver: 0.5,
      }));
      assert(r.invariant_side_matches_total === true,
        `invariant broken at rawTotal=${rawTotal}, rawProb=${rawProb}, displayed=${r.displayed_total_side}, reconciled=${r.reconciled_total}`);
      checkInvariant(r, 8.5);
    }
  }
});

console.log("─".repeat(70));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
console.log(`  weights: mean=${MEAN_WEIGHT} prob=${PROBABILITY_WEIGHT} value=${VALUE_WEIGHT} pressure=${PRESSURE_WEIGHT}`);
console.log(`  norms: mean=${MEAN_STRENGTH_NORM_RUNS}runs value=${VALUE_STRENGTH_NORM_PP}pp · low_conv=${LOW_CONVICTION_CONFIDENCE_PCT}% · neg_nopl=${NEGATIVE_EDGE_NO_PLAY_PP}pp`);
if (fail > 0) {
  console.log("\n✗ reconciliation tests failed");
  process.exit(1);
}
console.log("\n✅ All MLB total projection / side reconciliation tests passed.");
