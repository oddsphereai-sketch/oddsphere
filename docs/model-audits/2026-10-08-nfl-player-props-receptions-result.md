# NFL player props independent Receptions result

Date: 2026-10-08  
Decision: release the independent point head; retain the independent reference probability head

## Result

Receptions now has a production-qualified independent football center built as team target
opportunity multiplied by a roster-normalized player target share and a position-group conditional
catch rate. It uses shifted offensive volume and pass tendency, player role and target history,
depth and availability, opponent and pressure state, weather, PFR/FTN charting, and Next Gen Stats
context. It uses no prop line, price, book, consensus, movement, market probability, or current-game
outcome.

This implements the research-backed separation between target opportunity and catch conversion
recorded in `2026-10-08-nfl-player-props-external-methods.md`. Public position groups are used
honestly: `RB/FB`, `WR`, and `TE` are not presented as route- or assignment-level coverage data.
Market reading remains the existing target-book-excluded downstream observer.

## Point accuracy

The frozen candidate is `team_target_blend_50`: 50% of the preceding independent point and 50% of
the team-target-budget × roster-normalized target-share × catch-rate component. It ranks first on
the frozen historical stability criterion because its clustered interval has the stronger upper
bound. The secondary 75% candidate has slightly lower historical point error but regresses
exact-2026 offered-line direction.

| Window | Reference MAE / RMSE | Candidate MAE / RMSE |
| --- | ---: | ---: |
| 2024 selection, 3,538 rows | 1.53348 / 2.04388 | **1.50218 / 1.99196** |
| 2025 confirmation, 3,492 rows | 1.45991 / 1.92822 | **1.43812 / 1.89277** |
| exact 2026 Weeks 1–4, 58 offered scopes | 2.09893 / 2.95017 | **1.99787 / 2.80472** |

The 2025 candidate-minus-reference MAE delta is `-0.02179`; its game-clustered 95% interval is
`[-0.03066, -0.01317]`. All four chronological segments improve by `-0.01863`, `-0.02429`,
`-0.01904`, and `-0.02432` MAE. Exact-2026 offered-line direction remains 48.28%, while bias
improves from `-1.15560` to `-0.94176` receptions.

The market-influenced published center remains better on those 58 scopes at 1.83633 MAE and
2.60801 RMSE, with the same 48.28% direction. That benchmark is disclosed, not used as a feature.
This is an incremental improvement to the independent model rather than a claim that it has already
surpassed the market.

## Probability decision

The threshold tournament evaluated 90 distribution/mixture/calibration candidates against 2,360
non-push 2025 opening thresholds. The historically first-ranked negative-binomial challenger
improved Brier / log loss / direction from `0.25068 / 0.70066 / 55.89%` to
`0.24269 / 0.67846 / 57.37%`. It also improved exact-2026 Brier and log loss from
`0.30454 / 0.82265` to `0.25737 / 0.70768` while preserving 48.28% direction.

It nevertheless fails the mandatory current-board gate: with the point head held fixed, it moved
all eight preceding Receptions actionables to zero. Therefore it does not ship. The independently
fitted empirical reference distribution remains authoritative with challenger weight zero. The
point model is not blended with sportsbook consensus; existing same-line and movement evidence
remains separately labeled and downstream.

## Frozen current-board impact

The final SELECT-only Week 5 replay used one capture with 1,369 matched member rows. Only
Receptions changed: 219 of 267 Receptions rows changed projection and seven changed forecast side.
The symmetric point-head change produced one actionable promotion and three demotions, moving
Receptions actionables from eight to six and the complete board from 32 to 30. All 1,102 rows in
Passing Attempts, Passing Completions, Passing Yards, Rushing Attempts, Rushing Yards, Receiving
Yards, and Anytime Touchdown retained identical projections and grades. Exact quoted prices were
not changed. The replay made zero writes and zero current-season state calls.

This two-actionable reduction is disclosed model output, not a hidden suppression rule. No grade
threshold, one-way demotion, stake rule, or market filter changed; the same independent projection
path can and did promote a row. The separately tested probability challenger was rejected precisely
because it flattened the Receptions board.

## Production contract

Active releases are:

- expected-role artifact `nfl_player_props_expected_role_runtime_2026_10_08_r5_receptions`;
- portable / model / calibration / decision `nfl_player_props_runtime_2026_10_08_r13_independent_receptions` /
  `nfl_player_props_distribution_model_2026_10_08_r22_independent_receptions` /
  `nfl_player_props_distribution_calibration_2026_10_08_r24_independent_receptions` /
  `nfl_player_props_decision_2026_10_08_r27_independent_receptions`;
- runtime / board / member / lifecycle `nfl_player_props_runtime_2026_10_08_r28_independent_receptions` /
  `nfl_player_props_board_2026_10_08_r31_independent_receptions` /
  `nfl_player_props_member_2026_10_08_r39_independent_receptions` /
  `nfl_player_props_member_lifecycle_2026_10_08_r22_independent_receptions`; and
- writer / tracking `nfl_player_props_writer_2026_10_08_r45_independent_receptions` /
  `nfl_player_props_tracking_2026_10_08_r27_independent_receptions`.

The one existing batch scorer and sole writer remain authoritative under `prediction_pipeline:nfl`.
There is no new provider request, refresh loop, schedule, lease, stake, grade threshold, copy, label,
or layout. Ordinary unlocked rows are freshly recomputed; every stored locked projection,
probability, grade, price, stake, and evidence field keeps exact legacy precedence.

Rollback the complete Receptions release family and expected-role artifact to the independent
Rushing Yards family without rewriting locks if portable parity, release coherence, coverage,
current-board breadth, or post-deploy writer verification fails.
