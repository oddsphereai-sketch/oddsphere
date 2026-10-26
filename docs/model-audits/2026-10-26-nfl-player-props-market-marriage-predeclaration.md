# NFL Player Props market-marriage predeclaration

Date: 2026-10-26

## Owner direction

Daniel Mengel directed Oddsphere to keep improving NFL Player Props rather than stop at a
diagnosis. The required product is a strong independent player forecast followed by a
market-specific, target-book-excluded read that may confirm or correct the forecast, with coherent
projections and sides and a useful actionable board. No member copy, label, layout, navigation,
provider cadence, public tracking page, or locked result may change in this release.

## Frozen boundary

- The existing independent expected-role and portable point heads remain unchanged.
- Ordinary Over/Under markets are evaluated separately; Anytime Touchdown is excluded.
- The target sportsbook may not vote for its own forecast or grade.
- A transported nearby line from another book may inform a passing forecast, but only an exact
  independent confirmation may authorize its exact-price grade.
- Receiver actionability may be recalibrated only from locked exact-price rows with nonnegative
  expected value and probability edge, participation of at least 70%, and non-adverse same-book
  movement. Best Angle thresholds remain unchanged.
- The sole writer remains `runNflPlayerPropsProductionWriter` under the existing
  `prediction_pipeline:nfl` lease. No new writer, cron, request path, or provider call is allowed.
- Every existing locked payload retains byte-for-byte precedence. Changes apply only to future
  unlocked evaluations and locks.

## Champion identifiers

- Portable artifact: `nfl_player_props_runtime_2026_10_15_r15_independent_rushing_yards`
- Model: `nfl_player_props_distribution_model_2026_10_15_r26_independent_rushing_yards`
- Calibration: `nfl_player_props_distribution_calibration_2026_10_15_r28_independent_rushing_yards`
- Decision: `nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards`
- Runtime / board: `nfl_player_props_runtime_2026_10_15_r33_independent_rushing_yards` /
  `nfl_player_props_board_2026_10_15_r36_independent_rushing_yards`
- Member / lifecycle: `nfl_player_props_member_2026_10_15_r45_independent_rushing_yards` /
  `nfl_player_props_member_lifecycle_2026_10_15_r27_independent_rushing_yards`
- Writer / tracking: `nfl_player_props_writer_2026_10_21_r59_exact_t60_close_recovery` /
  `nfl_player_props_tracking_2026_10_21_r33_exact_t60_close_recovery`

## Predeclared gates

The release must report direction, MAE, Brier score, action records, promotions, demotions, and
board counts by market and release. A passing forecast correction must improve the combined exact
current-season replay and may not relax the exact-price grade gate. Every actionable demotion must
have a tested promotion path; a flatter board fails. Missing market evidence must fail closed. The
runtime, production lifecycle, snapshot, lock-precedence, TypeScript, full model-change, fresh-main
integration-safety, pull-request, and post-deploy live gates must all pass before publication.

