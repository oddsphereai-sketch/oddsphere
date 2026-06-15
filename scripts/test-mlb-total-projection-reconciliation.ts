/**
 * MLB totals reconciliation — 2026-06-15 probability-driven model-coherence rule.
 *
 * The displayed O/U side ALWAYS follows the model's more-likely side
 * (P(over) vs P(under)), NOT the mean (projected total) vs the line. The mean
 * stays descriptive. Near-line right-skew (mean > median) is surfaced via
 * `mean_probability_divergence` and capped at Watchlist, never a public
 * Lean/Best Angle. Push-risk (projected total exactly on the line) holds.
 * Empirically MLB diverges far less than soccer (~1/117) — this is mostly a
 * structural guarantee the published side is never the less-likely one.
 */

import {
  reconcileTotalProjection,
  TOTALS_PUBLIC_CONFIDENCE_FLOOR,
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

console.log("\nscripts/test-mlb-total-projection-reconciliation.ts — probability-driven totals");
console.log("─".repeat(70));

// ─── 1 — the core fix ───────────────────────────────────────────────
test("1. mean > line but P(over) < 50% → probability-driven UNDER (not Over)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 3.8, rawProjectedHomeScore: 4.8, rawProjectedTotal: 8.6,
    marketTotal: 8.5,
    rawProbabilityOver: 0.4924, marketImpliedOver: 0.4826,
  }));
  assert(r.raw_probability_side === "under", "raw prob under");
  assert(r.mean_direction_side === "over", "mean over (8.6>8.5)");
  assert(r.reconciled_total_side === "under", `displayed Under (more likely); got ${r.reconciled_total_side}`);
  assert(r.mean_probability_divergence === true, "mean(over) vs prob(under) → divergence");
  assert(Math.abs(r.reconciled_confidence_pct - 50.8) < 0.5, `confidence = P(under) ≈ 50.8; got ${r.reconciled_confidence_pct}`);
  assert(r.grade_cap === "watchlist", `divergence capped at Watchlist; got ${r.grade_cap}`);
  assert(r.reconciled_total === 8.6, "mean preserved as descriptive");
});

// ─── 2 — symmetric ─────────────────────────────────────────────────
test("2. mean < line but P(over) > 50% → probability-driven OVER (not Under)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 4.0, rawProjectedHomeScore: 4.2, rawProjectedTotal: 8.2,
    marketTotal: 8.5,
    rawProbabilityOver: 0.55, marketImpliedOver: 0.5,
  }));
  assert(r.reconciled_total_side === "over", `displayed Over (more likely); got ${r.reconciled_total_side}`);
  assert(r.mean_probability_divergence === true, "mean(under) vs prob(over) → divergence");
});

// ─── 3 — coherent strong Over unchanged ─────────────────────────────
test("3. Coherent strong Over (P 62%, mean over) → Over, no divergence, no cap", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.5, marketTotal: 8.5,
    rawProbabilityOver: 0.62, marketImpliedOver: 0.52,
  }));
  assert(r.reconciled_total_side === "over");
  assert(r.mean_probability_divergence === false, "no divergence");
  assert(r.grade_cap === null, `clear play → no reconciler cap; got ${r.grade_cap}`);
});

// ─── 4 — coherent strong Under unchanged ────────────────────────────
test("4. Coherent strong Under (P(over) 30%, mean under) → Under, no divergence", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 3.5, rawProjectedHomeScore: 4.0, rawProjectedTotal: 7.5,
    marketTotal: 8.5, rawProbabilityOver: 0.30, marketImpliedOver: 0.45,
  }));
  assert(r.reconciled_total_side === "under");
  assert(r.mean_probability_divergence === false, "no divergence");
  assert(r.reconciled_confidence_pct >= TOTALS_PUBLIC_CONFIDENCE_FLOOR, "conviction above public floor");
});

// ─── 5 — coin-flip surfaced but NOT capped for MLB (deferred to #48) ─
test("5. Coin-flip (confidence < public floor) → surfaced via flag, NOT capped (MLB defers to #48)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 8.7, marketTotal: 8.5,
    rawProbabilityOver: 0.515, marketImpliedOver: 0.5,
  }));
  assert(r.reconciled_total_side === "over");
  assert(r.reconciled_confidence_pct < TOTALS_PUBLIC_CONFIDENCE_FLOOR, "below public floor");
  assert(r.side_disagree_flags.includes("below_public_confidence_floor"), "coin-flip surfaced as a flag");
  // No blind confidence floor for MLB — the evidence (poorly-calibrated confidence)
  // says defer the threshold to the #48 calibration diagnostic.
  assert(r.grade_cap === null, `MLB coin flip NOT capped (deferred to #48); got ${r.grade_cap}`);
});

// ─── 6 — public play needs probability support AND market value ─────
test("6. Probability support + market value → no reconciler cap (ladder can reach Lean/BA)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.8, marketTotal: 8.5,
    rawProbabilityOver: 0.62, marketImpliedOver: 0.54, // +8pp value on Over
  }));
  assert(r.reconciled_total_side === "over");
  assert(r.reconciled_confidence_pct >= TOTALS_PUBLIC_CONFIDENCE_FLOOR, "probability support");
  assert(r.reconciled_edge_pp !== null && r.reconciled_edge_pp > 0, "positive value");
  assert(r.grade_cap === null, `leave to ladder; got ${r.grade_cap}`);
});

// ─── 7 — both agree, no value → ladder gives Market-Aligned (no Caution cap) ─
test("7. Both agree on side, no value → no reconciler cap (ladder → Market-Aligned)", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.5, marketTotal: 8.5,
    rawProbabilityOver: 0.62, marketImpliedOver: 0.78, // Over edge -16pp (no value)
  }));
  assert(r.reconciled_total_side === "over", "over (model's more-likely side)");
  assert(r.reconciled_edge_pp !== null && r.reconciled_edge_pp < 0, "negative value vs market");
  assert(r.grade_cap === null, `no Caution cap — ladder grades Market-Aligned; got ${r.grade_cap}`);
});

// ─── 8 — confidence = P(displayed side) ─────────────────────────────
test("8. Confidence is the displayed (probability) side's honest probability", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 3.8, rawProjectedHomeScore: 4.8, rawProjectedTotal: 8.6,
    marketTotal: 8.5, rawProbabilityOver: 0.4924, marketImpliedOver: 0.51,
  }));
  assert(r.reconciled_total_side === "under", "Under more likely (P(over) 49.2%)");
  assert(Math.abs(r.reconciled_confidence_pct - 50.8) < 0.5, `confidence = P(under) ≈ 50.8; got ${r.reconciled_confidence_pct}`);
});

// ─── 9 — push-risk hold (projected exactly on the line) ─────────────
test("9. Projected total exactly on the line → push-risk hold + no_play", () => {
  const r = reconcileTotalProjection(baseInput({
    rawProjectedAwayScore: 4.25, rawProjectedHomeScore: 4.25, rawProjectedTotal: 8.5,
    marketTotal: 8.5, rawProbabilityOver: 0.49,
  }));
  assert(r.mean_direction_side === null, "mean null at the line");
  assert(r.hold === true, "push-risk hold");
  assert(r.grade_cap === "no_play", `expected no_play; got ${r.grade_cap}`);
});

// ─── 10 — natural recompute flip ────────────────────────────────────
test("10. Pre-lock recompute: probability flips Under → Over naturally", () => {
  const r1 = reconcileTotalProjection(baseInput({ rawProjectedTotal: 8.2, marketTotal: 8.5, rawProbabilityOver: 0.42, marketImpliedOver: 0.5 }));
  assert(r1.reconciled_total_side === "under", "P(over) 42% → under");
  const r2 = reconcileTotalProjection(baseInput({ rawProjectedTotal: 8.9, marketTotal: 8.5, rawProbabilityOver: 0.56, marketImpliedOver: 0.5 }));
  assert(r2.reconciled_total_side === "over", "P(over) 56% → over");
});

// ─── 11 — coherence invariant: side IS the more-likely side ─────────
test("11. invariant_side_matches_total = side equals the higher-probability side (incl. divergent)", () => {
  for (const rawTotal of [7.5, 8.0, 8.4, 8.6, 9.0, 9.5]) {
    for (const rawProb of [0.30, 0.45, 0.49, 0.51, 0.55, 0.70]) {
      const r = reconcileTotalProjection(baseInput({
        rawProjectedAwayScore: rawTotal / 2, rawProjectedHomeScore: rawTotal / 2, rawProjectedTotal: rawTotal,
        marketTotal: 8.5, rawProbabilityOver: rawProb, marketImpliedOver: 0.5,
      }));
      assert(r.invariant_side_matches_total === true, `invariant broken at total=${rawTotal} prob=${rawProb}`);
      assert(r.raw_probability_side === r.displayed_total_side, `displayed must equal prob side at total=${rawTotal} prob=${rawProb}`);
    }
  }
});

// ─── 12 — locked snapshot returned verbatim ─────────────────────────
test("12. Locked snapshot returned verbatim — no mutation post-lock", () => {
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
    holistic_side: "under",
    signal_audit: {
      probability: { side: "under", strength: 0.015, weighted_vote: 0.015 },
      value: { side: "over", strength: 0.196, weighted_vote: 0.196 },
      mean: { side: "over", strength: 0.1, weighted_vote: 0.15 },
      market_pressure: { side: null, strength: 0, weighted_vote: 0 },
    },
    over_vote_total: 0.346,
    under_vote_total: 0.015,
    reconciled_total_side: "under",
    reconciled_total: 8.6,
    reconciled_away_score: 3.8,
    reconciled_home_score: 4.8,
    reconciled_confidence_pct: 50.8,
    reconciled_edge_pp: -0.98,
    displayed_total_side: "under",
    mean_probability_divergence: true,
    side_selection_reason: "probability_over_mean",
    projection_reconciliation_reason: "raw_aligned",
    side_disagree_flags: ["mean_probability_divergence"],
    grade_cap: "watchlist",
    hold: false,
    invariant_side_matches_total: true,
    used_locked_snapshot: false,
  };
  const r = reconcileTotalProjection(baseInput({
    rawProjectedTotal: 9.5, marketTotal: 8.5, rawProbabilityOver: 0.7,
    isLocked: true, lockedReconciliation: locked,
  }));
  assert(r.used_locked_snapshot === true, "must flag locked");
  assert(r.reconciled_total_side === "under", "locked side preserved");
  assert(r.reconciled_total === 8.6, "locked total preserved");
});

// ─── 13 — signal_audit retained for the operator trail ──────────────
test("13. signal_audit retains four named weights", () => {
  const r = reconcileTotalProjection(baseInput({ rawProjectedTotal: 9.5, marketTotal: 8.5, rawProbabilityOver: 0.62, marketImpliedOver: 0.52 }));
  assert(typeof r.signal_audit.mean.weighted_vote === "number", "mean vote number");
  assert(typeof r.signal_audit.probability.weighted_vote === "number", "prob vote number");
  assert(typeof r.signal_audit.value.weighted_vote === "number", "value vote number");
  assert(typeof r.signal_audit.market_pressure.weighted_vote === "number", "pressure vote number");
});

console.log("─".repeat(70));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\n✗ reconciliation tests failed"); process.exit(1); }
console.log("\n✅ All MLB total projection / side reconciliation tests passed.");
