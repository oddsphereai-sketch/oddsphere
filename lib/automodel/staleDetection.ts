/**
 * Phase 4A — pure stale detection.
 *
 * Composes diffs between a prior auto prediction snapshot (whatever
 * audit data the orchestrator recorded on the prior run) and a
 * freshly-rebuilt CURRENT snapshot. Returns a structured StaleReport
 * the orchestrator will eventually persist into:
 *
 *   sport_specific.stale            ← report.is_stale
 *   sport_specific.stale_reason     ← report.reasons.join("; ")
 *   sport_specific.movement_deltas  ← report.movement_deltas
 *
 * V1 policy (planning §4.3): `is_stale` is AUDIT-ONLY. T-60 always
 * reruns eligible games; the stale flag does NOT gate the rerun
 * decision. It just labels the SUPERSEDED morning row for operator
 * visibility.
 *
 * Pure module. No DB imports. No env reads. No service imports.
 * Inputs and outputs are plain data.
 */

import type {
  CurrentDerivedForStale,
  CurrentSnapshotForStale,
  MovementDeltas,
  PriorPredictionForStale,
  StaleReport,
  StarterChangeReport,
} from "./types";
import {
  MOVEMENT_THRESHOLDS,
  didEvFlipMeaningfully,
  isSignificantMove,
  safeDelta,
  type MovementThresholdConfig,
} from "./movementThresholds";

/**
 * Pure starter-change diff.
 *
 * A null on either side counts as "unknown", not as a change — so a
 * missing prior or current starter does NOT trigger
 * home_changed/away_changed=true on its own. The missing-starter case
 * is covered by a separate stale reason ("provider data missing") and
 * by the model's own hold logic (hold_picks contains "ml" when starter
 * absent).
 */
export function detectStarterChange(
  prior: Pick<PriorPredictionForStale, "home_starter_id" | "away_starter_id">,
  current: Pick<
    CurrentSnapshotForStale,
    "home_starter_external_id" | "away_starter_external_id"
  >
): StarterChangeReport {
  const home_previous = prior.home_starter_id ?? null;
  const away_previous = prior.away_starter_id ?? null;
  const home_current = current.home_starter_external_id;
  const away_current = current.away_starter_external_id;

  const home_changed =
    home_previous !== null &&
    home_current !== null &&
    home_previous !== home_current;
  const away_changed =
    away_previous !== null &&
    away_current !== null &&
    away_previous !== away_current;

  return {
    home_changed,
    away_changed,
    home_previous,
    home_current,
    away_previous,
    away_current,
  };
}

/**
 * Build the full stale report.
 *
 * Inputs are pure data — no DB reads, no env access. `thresholds`
 * defaults to MOVEMENT_THRESHOLDS so production callers don't need to
 * import them; tests pass custom thresholds via the third argument.
 *
 * Detection rules (mirrors planning §4.1 and Daniel's approved list):
 *
 *   1. Home / away starter player_external_id changed
 *   2. Starter confirmation regressed (confirmed → unconfirmed)
 *   3. Starter became scratched (false → true; transition only)
 *   4. New top-3 hitter scratched (current count > prior count)
 *   5. Listed total appeared / disappeared / moved >= TOTAL_RUNS
 *   6. Pinnacle ML fair-prob moved >= ML_FAIR_PROB_PCT
 *   7. Pinnacle ML EV flipped sign OR moved >= ML_EV_PCT
 *   8. Public betting % moved >= PUBLIC_BETTING_PCT (home OR over)
 *   9. Public money % moved >= PUBLIC_MONEY_PCT (home OR over)
 *  10. Sharp grade direction flipped (support ↔ conflict)
 *  11. Lineup confirmation regressed (confirmed → unconfirmed)
 *  12. Provider data missing on current snapshot
 *
 * `is_stale` is true when ANY reason fires. `reasons` is a list of
 * human-readable strings the orchestrator will join with "; " for the
 * sport_specific.stale_reason column.
 */
export function buildStaleReport(
  prior: PriorPredictionForStale,
  current: CurrentSnapshotForStale,
  currentDerived: CurrentDerivedForStale,
  thresholds: MovementThresholdConfig = MOVEMENT_THRESHOLDS
): StaleReport {
  const reasons: string[] = [];
  const starter_change = detectStarterChange(prior, current);

  // 1. Starter changed
  if (starter_change.home_changed) {
    reasons.push(
      `home starter changed: ${starter_change.home_previous} → ${starter_change.home_current}`
    );
  }
  if (starter_change.away_changed) {
    reasons.push(
      `away starter changed: ${starter_change.away_previous} → ${starter_change.away_current}`
    );
  }

  // 2. Starter confirmation regressed
  if (
    prior.starter_confirmed === true &&
    current.starter_confirmed === false
  ) {
    reasons.push(
      "starter confirmation regressed (was confirmed; now unconfirmed)"
    );
  }

  // 3. Starter became scratched (transition only — false → true)
  if (
    prior.home_starter_was_scratched === false &&
    current.home_starter_is_scratched === true
  ) {
    reasons.push("home starter became scratched");
  }
  if (
    prior.away_starter_was_scratched === false &&
    current.away_starter_is_scratched === true
  ) {
    reasons.push("away starter became scratched");
  }

  // 4. New top-3 hitter scratched (current count strictly greater)
  if (
    typeof prior.home_top3_hitters_injured_count === "number" &&
    current.home_top3_hitters_injured_count >
      prior.home_top3_hitters_injured_count
  ) {
    reasons.push(
      `home top-3 injuries increased: ${prior.home_top3_hitters_injured_count} → ${current.home_top3_hitters_injured_count}`
    );
  }
  if (
    typeof prior.away_top3_hitters_injured_count === "number" &&
    current.away_top3_hitters_injured_count >
      prior.away_top3_hitters_injured_count
  ) {
    reasons.push(
      `away top-3 injuries increased: ${prior.away_top3_hitters_injured_count} → ${current.away_top3_hitters_injured_count}`
    );
  }

  // 5. Listed total — appeared / disappeared / moved by threshold
  const total_line_delta = safeDelta(
    prior.listed_total,
    current.listed_total
  );
  const priorTotalKnown =
    prior.listed_total !== null && prior.listed_total !== undefined;
  const currentTotalKnown =
    current.listed_total !== null && current.listed_total !== undefined;
  if (!priorTotalKnown && currentTotalKnown) {
    reasons.push(`listed total appeared: → ${current.listed_total}`);
  }
  if (priorTotalKnown && !currentTotalKnown) {
    reasons.push(`listed total disappeared (was ${prior.listed_total})`);
  }
  if (
    isSignificantMove(
      prior.listed_total,
      current.listed_total,
      thresholds.TOTAL_RUNS
    )
  ) {
    reasons.push(
      `listed total moved ${(total_line_delta ?? 0).toFixed(1)} runs (threshold ${thresholds.TOTAL_RUNS})`
    );
  }

  // 6. Pinnacle ML fair-prob move
  const ml_fair_prob_delta = safeDelta(
    prior.pinnacle_ml_fair_prob_home,
    current.pinnacle_ml_fair_prob_home
  );
  if (
    isSignificantMove(
      prior.pinnacle_ml_fair_prob_home,
      current.pinnacle_ml_fair_prob_home,
      thresholds.ML_FAIR_PROB_PCT
    )
  ) {
    reasons.push(
      `Pinnacle ML fair prob moved ${(ml_fair_prob_delta ?? 0).toFixed(1)}pp (threshold ${thresholds.ML_FAIR_PROB_PCT}pp)`
    );
  }

  // 7. Pinnacle ML EV — sign flip OR magnitude swing
  const ev_delta = safeDelta(
    prior.pinnacle_ml_ev_pct,
    current.pinnacle_ml_ev_pct
  );
  if (
    didEvFlipMeaningfully(
      prior.pinnacle_ml_ev_pct,
      current.pinnacle_ml_ev_pct,
      thresholds.ML_EV_PCT
    )
  ) {
    const beforeStr =
      typeof prior.pinnacle_ml_ev_pct === "number"
        ? prior.pinnacle_ml_ev_pct.toFixed(2)
        : "null";
    const afterStr =
      typeof current.pinnacle_ml_ev_pct === "number"
        ? current.pinnacle_ml_ev_pct.toFixed(2)
        : "null";
    reasons.push(
      `Pinnacle ML EV moved meaningfully: ${beforeStr}% → ${afterStr}%`
    );
  }

  // 8. Public BETTING move (home OR over — pick the larger magnitude
  //    for the consolidated delta, but emit a reason for each that
  //    crossed the threshold)
  const public_betting_delta_home = safeDelta(
    prior.public_betting_pct_home,
    current.public_betting_pct_home
  );
  const public_betting_delta_over = safeDelta(
    prior.public_betting_pct_over,
    current.public_betting_pct_over
  );
  const public_betting_delta =
    Math.abs(public_betting_delta_home ?? 0) >=
    Math.abs(public_betting_delta_over ?? 0)
      ? public_betting_delta_home
      : public_betting_delta_over;
  if (
    isSignificantMove(
      prior.public_betting_pct_home,
      current.public_betting_pct_home,
      thresholds.PUBLIC_BETTING_PCT
    )
  ) {
    reasons.push(
      `public ML betting moved ${(public_betting_delta_home ?? 0).toFixed(1)}pp (threshold ${thresholds.PUBLIC_BETTING_PCT}pp)`
    );
  }
  if (
    isSignificantMove(
      prior.public_betting_pct_over,
      current.public_betting_pct_over,
      thresholds.PUBLIC_BETTING_PCT
    )
  ) {
    reasons.push(
      `public total betting moved ${(public_betting_delta_over ?? 0).toFixed(1)}pp (threshold ${thresholds.PUBLIC_BETTING_PCT}pp)`
    );
  }

  // 9. Public MONEY move (same pattern)
  const public_money_delta_home = safeDelta(
    prior.public_money_pct_home,
    current.public_money_pct_home
  );
  const public_money_delta_over = safeDelta(
    prior.public_money_pct_over,
    current.public_money_pct_over
  );
  const public_money_delta =
    Math.abs(public_money_delta_home ?? 0) >=
    Math.abs(public_money_delta_over ?? 0)
      ? public_money_delta_home
      : public_money_delta_over;
  if (
    isSignificantMove(
      prior.public_money_pct_home,
      current.public_money_pct_home,
      thresholds.PUBLIC_MONEY_PCT
    )
  ) {
    reasons.push(
      `public ML money moved ${(public_money_delta_home ?? 0).toFixed(1)}pp (threshold ${thresholds.PUBLIC_MONEY_PCT}pp)`
    );
  }
  if (
    isSignificantMove(
      prior.public_money_pct_over,
      current.public_money_pct_over,
      thresholds.PUBLIC_MONEY_PCT
    )
  ) {
    reasons.push(
      `public total money moved ${(public_money_delta_over ?? 0).toFixed(1)}pp (threshold ${thresholds.PUBLIC_MONEY_PCT}pp)`
    );
  }

  // 10. Sharp grade direction flipped (support ↔ conflict only — neutral
  //     transitions are NOT material per planning §4.1 row 10)
  const priorDir = prior.sharp_grade_direction ?? null;
  const currentDir = currentDerived.sharp_grade_direction;
  let sharp_grade_changed = false;
  if (
    (priorDir === "support" && currentDir === "conflict") ||
    (priorDir === "conflict" && currentDir === "support")
  ) {
    sharp_grade_changed = true;
    reasons.push(
      `sharp grade direction changed: ${priorDir} → ${currentDir}`
    );
  }

  // 11. Lineup confirmation regressed
  let lineup_status_changed = false;
  if (
    prior.lineup_confirmed === true &&
    current.lineup_confirmed === false
  ) {
    lineup_status_changed = true;
    reasons.push(
      "lineup confirmation regressed (was confirmed; now unconfirmed)"
    );
  }

  // 12. Provider data missing on current snapshot
  const provider_data_missing = current.provider_data_present === false;
  if (provider_data_missing) {
    reasons.push("provider data missing or delayed");
  }

  const movement_deltas: MovementDeltas = {
    total_line_delta,
    ml_fair_prob_delta,
    ev_delta,
    public_betting_delta,
    public_money_delta,
    starter_changed:
      starter_change.home_changed || starter_change.away_changed,
    lineup_status_changed,
    sharp_grade_changed,
    provider_data_missing,
  };

  return {
    is_stale: reasons.length > 0,
    reasons,
    movement_deltas,
    starter_change,
  };
}
