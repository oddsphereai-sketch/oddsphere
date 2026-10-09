# NFL player props independent Receiving Yards result

Date: 2026-10-09  
Status: release candidate passed the frozen point, probability, and same-input current-board gates

## Released point architecture

The selected Receiving Yards change is intentionally narrower than the first broad candidate. For
wide receivers only, the independent center is now 50% of the immediately preceding center plus 50%
of:

`team target budget × roster-normalized target share × direct yards per target`.

The team target budget and target-share allocator are the same independently fitted, complete-roster
system already released for Receptions. The yards-per-target head is trained through 2023 from
strictly shifted player, team, opponent, quarterback, pressure, availability, depth, air-yard, catch
quality, separation/cushion, YAC, weather, and position context. The rate is bounded to 0-30 yards per
target. Lines, prices, books, consensus, movement, market probabilities, and current-game outcomes
are absent from the point model.

The original all-role hypothesis did not pass. It improved exact-2026 numeric error but reduced
offered-line direction from 48.61% to 47.22%; the frozen diagnostic localized the regression to RB
and TE usage. The second predeclaration therefore kept RB, FB, and TE Receiving Yards exactly on the
preceding center and tested only three frozen WR 50% candidates. Because that role diagnosis had
already inspected 2026, the 2026 sample is disclosed as diagnostic-led rather than a pristine
holdout.

## Point-model evidence

The historically first-ranked candidate was `wr_direct_blend_50`.

| Gate | Preceding MAE / RMSE | Candidate MAE / RMSE | Candidate bias | Result |
| --- | ---: | ---: | ---: | --- |
| 2024 selection, 3,538 rows | 19.95555 / 27.71746 | 19.79645 / 27.29791 | -2.51774 | pass |
| 2025 confirmation, 3,492 rows | 19.51859 / 27.00557 | 19.32055 / 26.58654 | -1.38555 | pass |
| exact 2026 Weeks 1-4, 72 scopes | 34.33198 / 52.42191 | 33.64446 / 51.69424 | -21.10004 | pass |

The 2025 game-clustered candidate-minus-reference MAE interval is
`[-0.28946, -0.11193]`. All four frozen chronological segments improve: Weeks 1-4 `-0.10665`,
Weeks 5-9 `-0.24985`, Weeks 10-13 `-0.15223`, and Weeks 14-18 `-0.26436`. Exact-2026 offered-line
direction improves from 48.61% to 50.00%. The already published market-influenced projection is
reported only as a benchmark and remains better on this small sample at MAE/RMSE
32.46086/46.92620 and direction 51.39%; it is not a model input.

## Probability decision

The historically selected `scaled_role__mix_100__logistic` probability challenger improves robust
historical Brier/log loss from 0.26551/0.73455 to 0.25002/0.69319. On the exact 72-scope 2026 gate it
also improves Brier/log loss from 0.28761/0.77904 to 0.25180/0.69675, but direction falls from 51.39%
to 45.83%. It therefore fails the frozen gate and ships with `challengerWeight: 0`, no calibration
authority, and `incumbentRetained: true`. The existing independent Receiving Yards residual
distribution remains authoritative and is merely centered on the qualified new WR point estimate.

## Same-input current-board result

The read-only Week 5 comparison used the snapshot evaluated at `2026-10-09T08:36:09.406Z`, retained
the exact captured book evidence, made zero provider calls and zero writes, and built the preceding
control and candidate from identical features and offers.

- 615 matched decisions; zero missing or added candidate rows.
- Only Receiving Yards changes: 38 projections, 38 probabilities, four forecast sides, and two
  grades across 72 Receiving Yards decisions.
- The other seven prop families have zero projection, probability, side, or grade changes.
- Actionables increase 19→20. Romeo Doubs Under 51.5 moves No Play→Lean; there are zero actionable
  demotions. Malik Nabers Under 54.5 moves Watchlist→No Play and is the only other grade change.
- Receiving Yards actionables move 0→1 and forecast directions move 17 Over / 55 Under to
  21 Over / 51 Under. Exact-price selection and all grade thresholds are unchanged.

## Production boundary and releases

The release family is:

- portable artifact `nfl_player_props_runtime_2026_10_09_r14_independent_receiving_yards`;
- model `nfl_player_props_distribution_model_2026_10_09_r23_independent_receiving_yards`;
- calibration `nfl_player_props_distribution_calibration_2026_10_09_r25_independent_receiving_yards`;
- decision `nfl_player_props_decision_2026_10_09_r28_independent_receiving_yards`;
- runtime / board `nfl_player_props_runtime_2026_10_09_r29_independent_receiving_yards` /
  `nfl_player_props_board_2026_10_09_r32_independent_receiving_yards`;
- member / lifecycle `nfl_player_props_member_2026_10_09_r40_independent_receiving_yards` /
  `nfl_player_props_member_lifecycle_2026_10_09_r23_independent_receiving_yards`;
- writer / tracking `nfl_player_props_writer_2026_10_09_r46_independent_receiving_yards` /
  `nfl_player_props_tracking_2026_10_09_r28_independent_receiving_yards`; and
- expected-role artifact `nfl_player_props_expected_role_runtime_2026_10_09_r6_receiving_yards`.

There is no new writer, lease, refresh loop, provider call, grade rule, stake, copy, label, or layout.
The sole writer and shared `prediction_pipeline:nfl` lease remain authoritative. Ordinary unlocked
rows are freshly recomputed; locked member snapshots retain their exact stored projections,
probabilities, prices, grades, stakes, evidence, and legacy release tuple.

Rollback the complete Receiving Yards release family to the October 8 independent Receptions family
without modifying any locked snapshot.
