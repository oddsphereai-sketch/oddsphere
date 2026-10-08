# NFL player props independent Rushing Yards result

Date: 2026-10-08  
Decision: release the independent point head; retain the independent reference probability head

## Result

Rushing Yards now has a production-qualified independent football center built as expected rushing
opportunity multiplied by conditional yards per carry. It uses team and role-group rushing budgets,
roster-normalized player carry shares, position-group efficiency, shifted offense/opponent-front
state, depth, weather, point-in-time availability, PFR/FTN charting, and Next Gen Stats context. It
uses no prop line, price, book, consensus, movement, market probability, or current-game outcome.

The architecture implements the research-backed separation between opportunity and efficiency
recorded in `2026-10-08-nfl-player-props-external-methods.md`, and keeps public position buckets
honest: `QB`, `RB/FB`, and `WR` are not presented as assignment-level box-count or OL/DL tracking.
Market reading remains the existing target-book-excluded downstream observer.

## Point accuracy

The frozen candidate is `expected_role_blend_75`: 25% of the preceding independent point and 75%
of the roster-constrained opportunity × yards-per-carry component.

| Window | Reference MAE / RMSE | Candidate MAE / RMSE |
| --- | ---: | ---: |
| 2024 selection, 1,862 rows | 19.03715 / 27.39057 | **18.58703 / 26.48103** |
| 2025 confirmation, 1,809 rows | 18.55798 / 27.46852 | **18.06505 / 26.91924** |
| exact 2026 Weeks 1–4, 28 offered scopes | 17.56553 / 24.94806 | **16.85919 / 23.44402** |

The 2025 candidate-minus-reference MAE delta is `-0.49293`; its game-clustered 95% interval is
`[-0.74858, -0.23051]`. All four chronological segments improve by `-0.36723`, `-0.61342`,
`-0.22254`, and `-0.68394` MAE. Exact-2026 offered-line direction remains 46.43%. The candidate
also reduces exact-2026 underprojection bias from `-9.22039` to `-7.18411` yards.

The market-influenced published center remains slightly better on those 28 scopes at 16.30374 MAE
and 22.44248 RMSE. That benchmark is disclosed, not used as a feature. This release is an incremental
independent-model improvement rather than a claim that the market has already been surpassed.

## Probability decision

The threshold tournament evaluated 110 distribution/mixture/calibration candidates against 2,676
non-push 2025 opening thresholds. Twenty qualified historically, but none also cleared the exact
2026 fail-closed Brier/log-loss/direction gate. Therefore no challenger probability ships.

The market-free reference probability head remains authoritative with challenger weight zero:

- historical validation Brier `0.26191`, log loss `0.72686`, direction `53.40%`;
- exact 2026 Brier `0.29863`, log loss `0.80999`, direction `53.57%`.

The point model is not blended with sportsbook consensus. Existing same-line and movement evidence
remains separately labeled and downstream for probability comparison, exact-price economics, and
resistance; missing sharp evidence remains neutral.

The compact production artifact reproduces all 25 unique exact-2026 opportunity × efficiency
components with maximum and mean absolute difference `0.0` from the research implementation.

## Frozen current-board impact

The final SELECT-only Week 5 replay used one capture with 1,366 matched member rows. Only 22 of 160
Rushing Yards rows changed projection. There were zero forecast-side changes, zero grade changes,
zero promotions, and zero demotions; Rushing Yards retained five actionables and the complete board
retained 40 actionables. Passing Attempts, Passing Completions, Passing Yards, Rushing Attempts,
Receptions, Receiving Yards, and Anytime Touchdown were byte-identical for projection and grade.
The replay made zero writes and zero current-season state calls.

## Production contract

Active releases are:

- expected-role artifact `nfl_player_props_expected_role_runtime_2026_10_08_r4_rushing_yards`;
- portable / model / calibration / decision `nfl_player_props_runtime_2026_10_08_r12_independent_rushing_yards` /
  `nfl_player_props_distribution_model_2026_10_08_r21_independent_rushing_yards` /
  `nfl_player_props_distribution_calibration_2026_10_08_r23_independent_rushing_yards` /
  `nfl_player_props_decision_2026_10_08_r26_independent_rushing_yards`;
- runtime / board / member / lifecycle `nfl_player_props_runtime_2026_10_08_r27_independent_rushing_yards` /
  `nfl_player_props_board_2026_10_08_r30_independent_rushing_yards` /
  `nfl_player_props_member_2026_10_08_r38_independent_rushing_yards` /
  `nfl_player_props_member_lifecycle_2026_10_08_r21_independent_rushing_yards`; and
- writer / tracking `nfl_player_props_writer_2026_10_08_r44_independent_rushing_yards` /
  `nfl_player_props_tracking_2026_10_08_r26_independent_rushing_yards`.

The one existing batch scorer and sole writer remain authoritative under `prediction_pipeline:nfl`.
There is no new provider request, refresh loop, schedule, lease, stake, grade threshold, copy, label,
or layout. Ordinary unlocked rows are freshly recomputed; every stored locked projection,
probability, grade, price, stake, and evidence field keeps exact legacy precedence.

Rollback the complete Rushing Yards release family and expected-role artifact to the independent
Passing Yards family without rewriting locks if portable parity, release coherence, coverage,
current-board breadth, or post-deploy writer verification fails.
