# NFL Player Props accuracy-marriage predeclaration

Date: 2026-09-23

## Scope and production boundary

- Base commit: `a1e1b0f6abc69de7f38b84c6832f32533c220d41`.
- Sport and markets: NFL player props; passing attempts, passing completions, passing yards,
  rushing attempts, rushing yards, receptions, receiving yards, and Anytime TD.
- Active model / calibration / decision / runtime / board releases:
  `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs`,
  `nfl_player_props_distribution_calibration_2026_09_16_r9_ranked_predictions`,
  `nfl_player_props_decision_2026_09_16_r12_ranked_predictions`,
  `nfl_player_props_runtime_2026_09_16_r13_current_season_inputs`, and
  `nfl_player_props_board_2026_09_16_r16_ranked_predictions`.
- The sole production writer remains `nfl-forward-evidence` under the existing
  `prediction_pipeline:nfl` lease. No route, cron, provider request, UI label, member copy,
  layout, stake, lock, settlement, or tracking-history rewrite is authorized.

## Known evidence before candidate selection

The production ledger was inspected before this declaration. The current decision release has
51 settled actionables at 26-25: 41 Unders at 20-21 and 10 Overs at 6-4. Best Angle Unders are
4-7. The current unlocked board has 18 actionables, 15 of them Unders. This evidence is no longer
blind and may be used only as a problem statement and final forward-monitoring comparator, not as
the sole threshold-selection sample.

The previously published Week 1 ranked-prediction result is also known and cannot be presented as
new holdout evidence. It showed the ranked forecast policy improving full-board side accuracy from
50.14% to 52.35%, while intentionally changing zero grades. That deliberate separation between
the displayed ranked forecast and the modal-probability actionable-side cap is the structural gap
under review.

## Candidate families and chronology

Candidate evaluation is restricted to the following predeclared families:

1. Forecast/action coherence: an ordinary two-way actionable must agree with the already-versioned
   ranked expected-prevalence forecast for its market, rather than a separate 50% modal cutoff.
2. Target-excluded market arbitration: preserve the evaluated book as price economics only; require
   the existing independent same-line book, exact-price EV, participation, freshness, injury, and
   data-quality gates. Test only bounded combinations of existing target-excluded edge and genuine
   same-book opening/current movement.
3. Market-side reliability: test market-by-side calibration of the existing posterior. Any
   demotion of a weak incumbent lane must be paired with a promotion from the existing eligible
   Watchlist pool and may not create a side quota.

Chronology is frozen as follows:

- model training remains through 2024;
- 2025 opening-price evidence is divided by the already-frozen selection/confirmation boundary in
  the existing actionable-lane artifact;
- immutable Week 1 is diagnostic only because its outcomes informed the ranked-display release;
- immutable Week 2 is a release-separated forward confirmation and must be reported separately;
- Week 3 is untouched prospective evidence and cannot be used to choose this release.

No candidate can ship unless it improves prediction Brier/log loss or side accuracy on the 2025
confirmation cohort without reversing on Week 2, retains positive exact-price economics, and
passes game/player-clustered uncertainty checks. A Week 2 miss is not overridden by a large row
count from correlated props.

## Required board and safety evidence

The paired replay must report exact promotions, demotions, retained actionables, net actionables,
market/side mix, grades, prices, nonpositive-EV actions, projection/side contradictions, and every
affected current-slate row. No previously actionable market may be flattened. Locked rows remain
immutable under the preceding release. Insufficient confirmation keeps the candidate shadow-only.

