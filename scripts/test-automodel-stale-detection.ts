/**
 * Phase 4A — pure unit tests for stale detection.
 *
 * Covers all 12 detection rules from planning §4.1, both firing-in-
 * isolation and not-firing-on-unchanged-inputs paths, plus the
 * starter-change helper, null/missing-input behavior, and movement
 * delta math.
 *
 * No DB, no env. Runs via:
 *   npx tsx scripts/test-automodel-stale-detection.ts
 */

import {
  buildStaleReport,
  detectStarterChange,
} from "../lib/automodel/staleDetection";
import { MOVEMENT_THRESHOLDS } from "../lib/automodel/movementThresholds";
import type {
  CurrentDerivedForStale,
  CurrentSnapshotForStale,
  PriorPredictionForStale,
} from "../lib/automodel/types";

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

/**
 * "Baseline" prior + current with all fields populated AND identical —
 * starting from this and tweaking one field at a time isolates each
 * rule. Any test based on baseline should produce is_stale=false.
 */
const baselinePrior: PriorPredictionForStale = {
  starter_confirmed: true,
  lineup_confirmed: true,
  home_starter_id: 12345,
  away_starter_id: 67890,
  home_starter_was_scratched: false,
  away_starter_was_scratched: false,
  listed_total: 8.5,
  pinnacle_ml_fair_prob_home: 55.0,
  pinnacle_ml_ev_pct: 2.5,
  public_betting_pct_home: 60.0,
  public_money_pct_home: 58.0,
  public_betting_pct_over: 55.0,
  public_money_pct_over: 52.0,
  home_top3_hitters_injured_count: 0,
  away_top3_hitters_injured_count: 0,
  sharp_grade_direction: "support",
};

const baselineCurrent: CurrentSnapshotForStale = {
  home_starter_external_id: 12345,
  away_starter_external_id: 67890,
  home_starter_is_scratched: false,
  away_starter_is_scratched: false,
  starter_confirmed: true,
  lineup_confirmed: true,
  listed_total: 8.5,
  pinnacle_ml_fair_prob_home: 55.0,
  pinnacle_ml_ev_pct: 2.5,
  public_betting_pct_home: 60.0,
  public_money_pct_home: 58.0,
  public_betting_pct_over: 55.0,
  public_money_pct_over: 52.0,
  home_top3_hitters_injured_count: 0,
  away_top3_hitters_injured_count: 0,
  provider_data_present: true,
};

const baselineDerived: CurrentDerivedForStale = {
  sharp_grade_direction: "support",
};

function reasonsInclude(reasons: string[], substr: string): boolean {
  return reasons.some((r) => r.includes(substr));
}

// ─── No drift → not stale ─────────────────────────────────────────────
section("Baseline: identical prior + current → is_stale=false");

const baseReport = buildStaleReport(
  baselinePrior,
  baselineCurrent,
  baselineDerived
);
check(
  "baseline: is_stale === false",
  baseReport.is_stale === false
);
check(
  "baseline: reasons === [] (empty)",
  baseReport.reasons.length === 0
);
check(
  "baseline: starter_changed === false",
  baseReport.movement_deltas.starter_changed === false
);
check(
  "baseline: lineup_status_changed === false",
  baseReport.movement_deltas.lineup_status_changed === false
);
check(
  "baseline: sharp_grade_changed === false",
  baseReport.movement_deltas.sharp_grade_changed === false
);
check(
  "baseline: provider_data_missing === false",
  baseReport.movement_deltas.provider_data_missing === false
);

// ─── Rule 1: starter changed ──────────────────────────────────────────
section("Rule 1: starter changed");

const homeStarterChanged = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, home_starter_external_id: 99999 },
  baselineDerived
);
check(
  "home starter id mismatch → is_stale=true",
  homeStarterChanged.is_stale === true
);
check(
  'reasons mention "home starter changed"',
  reasonsInclude(homeStarterChanged.reasons, "home starter changed")
);
check(
  "movement_deltas.starter_changed === true",
  homeStarterChanged.movement_deltas.starter_changed === true
);
check(
  "starter_change.home_changed === true",
  homeStarterChanged.starter_change.home_changed === true
);
check(
  "starter_change.away_changed === false (only home changed)",
  homeStarterChanged.starter_change.away_changed === false
);

const awayStarterChanged = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, away_starter_external_id: 11111 },
  baselineDerived
);
check(
  "away starter changed → is_stale=true with 'away starter changed'",
  awayStarterChanged.is_stale === true &&
    reasonsInclude(awayStarterChanged.reasons, "away starter changed")
);

// Null on either side → not a change (handled by hold logic / provider-missing)
const priorMissingStarter: PriorPredictionForStale = {
  ...baselinePrior,
  home_starter_id: null,
};
const noStarterChangeWhenNull = buildStaleReport(
  priorMissingStarter,
  baselineCurrent,
  baselineDerived
);
check(
  "null prior starter id does NOT trigger 'starter changed' (handled by hold/provider)",
  noStarterChangeWhenNull.starter_change.home_changed === false
);

const currentMissingStarter = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, home_starter_external_id: null },
  baselineDerived
);
check(
  "null current starter id does NOT trigger 'starter changed'",
  currentMissingStarter.starter_change.home_changed === false
);

// ─── Rule 2: starter confirmation regressed ───────────────────────────
section("Rule 2: starter confirmation regressed");

const starterUnconfirmed = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, starter_confirmed: false },
  baselineDerived
);
check(
  "starter confirmed → unconfirmed → is_stale=true",
  starterUnconfirmed.is_stale === true
);
check(
  'reason mentions "starter confirmation regressed"',
  reasonsInclude(starterUnconfirmed.reasons, "starter confirmation regressed")
);

// Prior was already unconfirmed → no regression
const stillUnconfirmed = buildStaleReport(
  { ...baselinePrior, starter_confirmed: false },
  { ...baselineCurrent, starter_confirmed: false },
  baselineDerived
);
check(
  "both unconfirmed → no 'starter confirmation regressed' reason",
  !reasonsInclude(stillUnconfirmed.reasons, "starter confirmation regressed")
);

// ─── Rule 3: starter became scratched (transition only) ───────────────
section("Rule 3: starter became scratched (false → true transition only)");

const homeScratchedNow = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, home_starter_is_scratched: true },
  baselineDerived
);
check(
  "home starter healthy → scratched → is_stale=true",
  homeScratchedNow.is_stale === true
);
check(
  'reason mentions "home starter became scratched"',
  reasonsInclude(homeScratchedNow.reasons, "home starter became scratched")
);

// Already scratched at prior run → no transition, no reason
const alreadyScratched = buildStaleReport(
  { ...baselinePrior, home_starter_was_scratched: true },
  { ...baselineCurrent, home_starter_is_scratched: true },
  baselineDerived
);
check(
  "already scratched at prior → no 'became scratched' reason",
  !reasonsInclude(alreadyScratched.reasons, "became scratched")
);

// Away side independently
const awayScratchedNow = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, away_starter_is_scratched: true },
  baselineDerived
);
check(
  "away starter became scratched → reason mentions 'away starter became scratched'",
  reasonsInclude(awayScratchedNow.reasons, "away starter became scratched")
);

// ─── Rule 4: new top-3 hitter scratched ───────────────────────────────
section("Rule 4: new top-3 hitter scratched (count strictly increased)");

const topHitterInjured = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, home_top3_hitters_injured_count: 1 },
  baselineDerived
);
check(
  "home top-3 injury count 0 → 1 → is_stale=true",
  topHitterInjured.is_stale === true
);
check(
  'reason mentions "home top-3 injuries increased"',
  reasonsInclude(topHitterInjured.reasons, "home top-3 injuries increased")
);

// Count unchanged → no reason
const sameInjuries = buildStaleReport(
  { ...baselinePrior, home_top3_hitters_injured_count: 1 },
  { ...baselineCurrent, home_top3_hitters_injured_count: 1 },
  baselineDerived
);
check(
  "top-3 injury count unchanged → no reason",
  !reasonsInclude(sameInjuries.reasons, "top-3 injuries increased")
);

// Count DECREASED (e.g. player cleared) → no reason (only "increased" triggers stale)
const fewerInjuries = buildStaleReport(
  { ...baselinePrior, home_top3_hitters_injured_count: 2 },
  { ...baselineCurrent, home_top3_hitters_injured_count: 1 },
  baselineDerived
);
check(
  "top-3 injuries decreased (player cleared) → no reason",
  !reasonsInclude(fewerInjuries.reasons, "top-3 injuries increased")
);

// ─── Rule 5: listed total appeared / disappeared / moved ──────────────
section("Rule 5: listed total movements");

// Appeared
const totalAppeared = buildStaleReport(
  { ...baselinePrior, listed_total: null },
  { ...baselineCurrent, listed_total: 8.5 },
  baselineDerived
);
check(
  "listed total null → 8.5 (appeared) → is_stale=true",
  totalAppeared.is_stale === true
);
check(
  'reason mentions "listed total appeared"',
  reasonsInclude(totalAppeared.reasons, "listed total appeared")
);

// Disappeared
const totalDisappeared = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, listed_total: null },
  baselineDerived
);
check(
  "listed total 8.5 → null (disappeared) → is_stale=true",
  totalDisappeared.is_stale === true
);
check(
  'reason mentions "listed total disappeared"',
  reasonsInclude(totalDisappeared.reasons, "listed total disappeared")
);

// Significant move (≥ 0.5)
const totalMoved = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, listed_total: 9.0 },
  baselineDerived
);
check(
  "listed total 8.5 → 9.0 (0.5 swing) → is_stale=true",
  totalMoved.is_stale === true
);
check(
  'reason mentions "listed total moved"',
  reasonsInclude(totalMoved.reasons, "listed total moved")
);
check(
  "movement_deltas.total_line_delta === 0.5",
  totalMoved.movement_deltas.total_line_delta === 0.5
);

// Sub-threshold move (< 0.5)
const totalTinyMove = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, listed_total: 8.7 },
  baselineDerived
);
check(
  "listed total 8.5 → 8.7 (0.2 swing) → no 'moved' reason (sub-threshold)",
  !reasonsInclude(totalTinyMove.reasons, "listed total moved")
);
check(
  "sub-threshold move still records delta in movement_deltas",
  Math.abs((totalTinyMove.movement_deltas.total_line_delta ?? 0) - 0.2) < 1e-9
);

// ─── Rule 6: Pinnacle ML fair-prob move ───────────────────────────────
section("Rule 6: Pinnacle ML fair-prob move");

const mlProbMoved = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, pinnacle_ml_fair_prob_home: 61.0 },
  baselineDerived
);
check(
  "ML fair prob 55 → 61 (6pp move) → is_stale=true",
  mlProbMoved.is_stale === true
);
check(
  'reason mentions "Pinnacle ML fair prob moved"',
  reasonsInclude(mlProbMoved.reasons, "Pinnacle ML fair prob moved")
);

const mlProbTinyMove = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, pinnacle_ml_fair_prob_home: 57.0 },
  baselineDerived
);
check(
  "ML fair prob 55 → 57 (2pp) → no reason (sub-threshold)",
  !reasonsInclude(mlProbTinyMove.reasons, "Pinnacle ML fair prob moved")
);

// ─── Rule 7: ML EV flip / magnitude ───────────────────────────────────
section("Rule 7: Pinnacle ML EV flip / magnitude");

const evFlipped = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, pinnacle_ml_ev_pct: -2.5 },
  baselineDerived
);
check(
  "ML EV +2.5 → -2.5 (sign flip) → is_stale=true",
  evFlipped.is_stale === true
);
check(
  'reason mentions "Pinnacle ML EV moved meaningfully"',
  reasonsInclude(evFlipped.reasons, "Pinnacle ML EV moved meaningfully")
);

const evTinyMove = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, pinnacle_ml_ev_pct: 2.8 },
  baselineDerived
);
check(
  "ML EV +2.5 → +2.8 (same sign, 0.3 magnitude < 1.0 threshold) → no reason",
  !reasonsInclude(evTinyMove.reasons, "Pinnacle ML EV")
);

// ─── Rule 8 + 9: public betting / money moves ─────────────────────────
section("Rules 8 + 9: public betting + money moves");

const publicBettingMoved = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, public_betting_pct_home: 72.0 },
  baselineDerived
);
check(
  "public ML betting 60 → 72 (12pp) → is_stale=true",
  publicBettingMoved.is_stale === true
);
check(
  'reason mentions "public ML betting moved"',
  reasonsInclude(publicBettingMoved.reasons, "public ML betting moved")
);

const publicTotalBettingMoved = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, public_betting_pct_over: 70.0 },
  baselineDerived
);
check(
  "public total betting 55 → 70 (15pp) → reason mentions 'public total betting moved'",
  reasonsInclude(publicTotalBettingMoved.reasons, "public total betting moved")
);

const publicMoneyMoved = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, public_money_pct_home: 70.0 },
  baselineDerived
);
check(
  "public ML money 58 → 70 (12pp) → reason mentions 'public ML money moved'",
  reasonsInclude(publicMoneyMoved.reasons, "public ML money moved")
);

const publicBettingSubThreshold = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, public_betting_pct_home: 65.0 },
  baselineDerived
);
check(
  "public betting 60 → 65 (5pp < 10) → no 'moved' reason",
  !reasonsInclude(publicBettingSubThreshold.reasons, "public ML betting moved")
);

// ─── Rule 10: sharp grade direction flipped ───────────────────────────
section("Rule 10: sharp grade direction flipped (support ↔ conflict only)");

const sharpFlipToConflict = buildStaleReport(
  baselinePrior,
  baselineCurrent,
  { sharp_grade_direction: "conflict" }
);
check(
  "sharp direction support → conflict → is_stale=true",
  sharpFlipToConflict.is_stale === true
);
check(
  'reason mentions "sharp grade direction changed"',
  reasonsInclude(sharpFlipToConflict.reasons, "sharp grade direction changed")
);
check(
  "movement_deltas.sharp_grade_changed === true",
  sharpFlipToConflict.movement_deltas.sharp_grade_changed === true
);

const sharpFlipToSupport = buildStaleReport(
  { ...baselinePrior, sharp_grade_direction: "conflict" },
  baselineCurrent,
  baselineDerived  // sharp direction is "support"
);
check(
  "sharp direction conflict → support → is_stale=true",
  sharpFlipToSupport.is_stale === true
);

const sharpSupportToNeutral = buildStaleReport(
  baselinePrior,
  baselineCurrent,
  { sharp_grade_direction: "neutral" }
);
check(
  "sharp direction support → neutral → no reason (not a material flip per planning §4.1)",
  !reasonsInclude(sharpSupportToNeutral.reasons, "sharp grade direction changed")
);
check(
  "support → neutral: movement_deltas.sharp_grade_changed === false",
  sharpSupportToNeutral.movement_deltas.sharp_grade_changed === false
);

const sharpNullPrior = buildStaleReport(
  { ...baselinePrior, sharp_grade_direction: null },
  baselineCurrent,
  { sharp_grade_direction: "conflict" }
);
check(
  "sharp direction null → conflict → no reason (no prior baseline)",
  !reasonsInclude(sharpNullPrior.reasons, "sharp grade direction changed")
);

// ─── Rule 11: lineup confirmation regressed ───────────────────────────
section("Rule 11: lineup confirmation regressed");

const lineupRegressed = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, lineup_confirmed: false },
  baselineDerived
);
check(
  "lineup confirmed → unconfirmed → is_stale=true",
  lineupRegressed.is_stale === true
);
check(
  'reason mentions "lineup confirmation regressed"',
  reasonsInclude(lineupRegressed.reasons, "lineup confirmation regressed")
);
check(
  "movement_deltas.lineup_status_changed === true",
  lineupRegressed.movement_deltas.lineup_status_changed === true
);

// ─── Rule 12: provider data missing ───────────────────────────────────
section("Rule 12: provider data missing on current snapshot");

const providerMissing = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, provider_data_present: false },
  baselineDerived
);
check(
  "provider_data_present=false → is_stale=true",
  providerMissing.is_stale === true
);
check(
  'reason mentions "provider data missing"',
  reasonsInclude(providerMissing.reasons, "provider data missing")
);
check(
  "movement_deltas.provider_data_missing === true",
  providerMissing.movement_deltas.provider_data_missing === true
);

// ─── Multiple rules firing simultaneously ─────────────────────────────
section("Compound: multiple rules fire → all reasons collected");

const multipleChanges = buildStaleReport(
  baselinePrior,
  {
    ...baselineCurrent,
    home_starter_external_id: 99999, // rule 1
    listed_total: 9.5, // rule 5 (1.0 swing)
    pinnacle_ml_ev_pct: -1.0, // rule 7 (sign flip)
  },
  baselineDerived
);
check(
  "compound: is_stale=true",
  multipleChanges.is_stale === true
);
check(
  `compound: 3 reasons collected (got ${multipleChanges.reasons.length})`,
  multipleChanges.reasons.length === 3
);
check(
  "compound: home starter reason present",
  reasonsInclude(multipleChanges.reasons, "home starter changed")
);
check(
  "compound: listed total reason present",
  reasonsInclude(multipleChanges.reasons, "listed total moved")
);
check(
  "compound: EV reason present",
  reasonsInclude(multipleChanges.reasons, "Pinnacle ML EV")
);

// ─── Movement deltas math ─────────────────────────────────────────────
section("Movement deltas — math + null propagation");

const deltaMath = buildStaleReport(
  baselinePrior,
  {
    ...baselineCurrent,
    listed_total: 9.0,                  // +0.5
    pinnacle_ml_fair_prob_home: 60.0,   // +5.0
    pinnacle_ml_ev_pct: 4.0,            // +1.5
    public_betting_pct_home: 75.0,      // +15.0
    public_money_pct_home: 70.0,        // +12.0
  },
  baselineDerived
);
check(
  "total_line_delta === 0.5",
  Math.abs((deltaMath.movement_deltas.total_line_delta ?? 0) - 0.5) < 1e-9
);
check(
  "ml_fair_prob_delta === 5.0",
  Math.abs((deltaMath.movement_deltas.ml_fair_prob_delta ?? 0) - 5.0) < 1e-9
);
check(
  "ev_delta === 1.5",
  Math.abs((deltaMath.movement_deltas.ev_delta ?? 0) - 1.5) < 1e-9
);
check(
  "public_betting_delta is the home-side delta (larger magnitude)",
  Math.abs((deltaMath.movement_deltas.public_betting_delta ?? 0) - 15.0) < 1e-9
);
check(
  "public_money_delta is the home-side delta (larger magnitude)",
  Math.abs((deltaMath.movement_deltas.public_money_delta ?? 0) - 12.0) < 1e-9
);

// Null prior listed_total → delta is null (can't compute)
const deltaNullPrior = buildStaleReport(
  { ...baselinePrior, listed_total: null },
  baselineCurrent,
  baselineDerived
);
check(
  "null prior listed_total → total_line_delta === null",
  deltaNullPrior.movement_deltas.total_line_delta === null
);

// ─── Larger over-side move beats home-side ────────────────────────────
section("Movement deltas — picks the larger-magnitude side");

const overSideBigger = buildStaleReport(
  baselinePrior,
  {
    ...baselineCurrent,
    public_betting_pct_home: 63.0,    // +3.0
    public_betting_pct_over: 75.0,    // +20.0  ← bigger magnitude
  },
  baselineDerived
);
check(
  "over-side public betting 20pp > home-side 3pp → public_betting_delta === 20",
  Math.abs((overSideBigger.movement_deltas.public_betting_delta ?? 0) - 20.0) < 1e-9
);

// ─── detectStarterChange isolation ────────────────────────────────────
section("detectStarterChange — pure helper isolated tests");

const sc1 = detectStarterChange(
  { home_starter_id: 100, away_starter_id: 200 },
  { home_starter_external_id: 100, away_starter_external_id: 200 }
);
check(
  "identical ids → no change",
  sc1.home_changed === false && sc1.away_changed === false
);

const sc2 = detectStarterChange(
  { home_starter_id: 100, away_starter_id: 200 },
  { home_starter_external_id: 101, away_starter_external_id: 201 }
);
check(
  "both ids changed → both flags true + previous/current populated",
  sc2.home_changed === true &&
    sc2.away_changed === true &&
    sc2.home_previous === 100 &&
    sc2.home_current === 101 &&
    sc2.away_previous === 200 &&
    sc2.away_current === 201
);

const sc3 = detectStarterChange(
  { home_starter_id: null, away_starter_id: 200 },
  { home_starter_external_id: 101, away_starter_external_id: 200 }
);
check(
  "null prior home id → home_changed=false (unknown not a change)",
  sc3.home_changed === false && sc3.home_previous === null && sc3.home_current === 101
);

const sc4 = detectStarterChange(
  { home_starter_id: 100, away_starter_id: 200 },
  { home_starter_external_id: null, away_starter_external_id: 200 }
);
check(
  "null current home id → home_changed=false (unknown not a change)",
  sc4.home_changed === false
);

// ─── Custom thresholds override defaults ──────────────────────────────
section("Custom thresholds override defaults");

const tightThresholds = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, listed_total: 8.6 }, // 0.1 swing
  baselineDerived,
  { ...MOVEMENT_THRESHOLDS, TOTAL_RUNS: 0.05 }
);
check(
  "tight 0.05-run threshold catches 0.1 move → is_stale=true",
  tightThresholds.is_stale === true
);
check(
  'reason mentions "listed total moved"',
  reasonsInclude(tightThresholds.reasons, "listed total moved")
);

const looseThresholds = buildStaleReport(
  baselinePrior,
  { ...baselineCurrent, listed_total: 9.0 }, // 0.5 swing
  baselineDerived,
  { ...MOVEMENT_THRESHOLDS, TOTAL_RUNS: 2.0 }
);
check(
  "loose 2.0-run threshold ignores 0.5 swing → is_stale=false (assuming nothing else changed)",
  looseThresholds.is_stale === false
);

// ─── Sparse prior + sparse current → no false positives ─────────────
section("Sparse prior + sparse current → safe degradation (no false reasons)");

// When BOTH sides lack audit data, no rules fire. "Appeared/disappeared"
// asymmetry tests live separately in Rule 5 — this test pins the
// degraded-data symmetric case.
const sparsePrior: PriorPredictionForStale = {
  starter_confirmed: false,
  lineup_confirmed: false,
};
const sparseCurrent: CurrentSnapshotForStale = {
  home_starter_external_id: null,
  away_starter_external_id: null,
  home_starter_is_scratched: false,
  away_starter_is_scratched: false,
  starter_confirmed: false,
  lineup_confirmed: false,
  listed_total: null,
  pinnacle_ml_fair_prob_home: null,
  pinnacle_ml_ev_pct: null,
  public_betting_pct_home: null,
  public_money_pct_home: null,
  public_betting_pct_over: null,
  public_money_pct_over: null,
  home_top3_hitters_injured_count: 0,
  away_top3_hitters_injured_count: 0,
  provider_data_present: true,
};
const sparseReport = buildStaleReport(
  sparsePrior,
  sparseCurrent,
  { sharp_grade_direction: null }
);
check(
  "sparse prior + sparse current → is_stale=false (no false positives)",
  sparseReport.is_stale === false,
  `reasons: ${JSON.stringify(sparseReport.reasons)}`
);
check(
  "sparse case: all numeric deltas are null",
  sparseReport.movement_deltas.total_line_delta === null &&
    sparseReport.movement_deltas.ml_fair_prob_delta === null &&
    sparseReport.movement_deltas.ev_delta === null &&
    sparseReport.movement_deltas.public_betting_delta === null &&
    sparseReport.movement_deltas.public_money_delta === null
);

// And verify the asymmetric case explicitly: a prior that didn't know
// listed_total + a current that does → "listed total appeared" fires
// (NOT a false positive — operationally meaningful).
const asymmetricPrior = buildStaleReport(
  { ...baselinePrior, listed_total: undefined },
  baselineCurrent,
  baselineDerived
);
check(
  "asymmetric: prior undefined listed_total + current populated → 'appeared' reason fires (correct)",
  asymmetricPrior.is_stale === true &&
    reasonsInclude(asymmetricPrior.reasons, "listed total appeared")
);

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All stale-detection tests passed.`);
