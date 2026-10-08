# NFL Player Props independent Passing Yards result

Date: 2026-10-08
Starting production base: `8d5639ff12bda65f5e50061d102873578c5acb2e`
Decision: point head qualified; probability challenger rejected

## Release decision

Promote the frozen `state__ypc_squared_error_exposure_weighted__blend_100` Passing Yards point
head. The forecast is released independent Passing Completions multiplied by a shifted
yards-per-completion model trained with completion exposure weights. It uses pregame
player/team/opponent state, depth, weather, and verified availability. The model contains no prop
line, price, book, consensus, movement, or market probability. Target-book-excluded market
observations remain downstream for disagreement, edge, exact-price economics, and movement support,
but cannot rewrite the independent Passing Yards point or probability.

No new probability challenger is promoted. The historically strongest challenger improved the
2025 archive but regressed Brier and log loss on the exact 2026 replay, so the release retains the
market-free reference probability head with challenger weight zero. This is a point-model release,
not a claim that the rejected threshold calibration improved.

## Chronological point evidence

| Window | Reference MAE / RMSE | Candidate MAE / RMSE | Candidate bias |
| --- | ---: | ---: | ---: |
| 2024 selection (464 rows) | 66.89048 / 86.61407 | **59.50102 / 76.03725** | -0.62465 |
| 2025 confirmation (490 rows) | 67.22001 / 87.05953 | **58.43378 / 74.90711** | +5.39073 |

The 2025 candidate-minus-reference MAE delta is `-8.78624` yards. A 10,000-draw game-clustered
bootstrap gives a 95% interval of `[-12.32764, -5.44076]`. Every frozen chronological segment
improves: Weeks 1-4 `-9.29380`, Weeks 5-9 `-10.64533`, Weeks 10-13 `-9.88372`, and Weeks 14-18
`-5.96980` yards of MAE.

## Threshold probability evidence

The 2025 opening archive is checksum-pinned at
`ecb29183650dcc5a7814f7057c6cceb0c1249a131284d396608a7fc9be59de33`: 272 games, 2,992 paired
book offers, and 2,234 unique Passing Yards thresholds. Selection used expanding out-of-fold blocks
over 1,386 non-push observations.

| Metric | Reference retained | Best rejected challenger |
| --- | ---: | ---: |
| Brier | 0.26973 | **0.25853** |
| Log loss | 0.75751 | **0.71576** |
| Direction | 54.62% | **55.77%** |

The best historical challenger is `normal__mix_50__identity`. It passes the historical aggregate
and chronological-block requirements but fails the predeclared exact-current-season gate below.
All 38 historically eligible challenger configurations fail that gate, so none is shipped.

## Opened 2026 diagnostic

The exact immutable Weeks 1-4 replay has only 14 Passing Yards scopes and is a release gate rather
than selection evidence. It vetoes the first historical point champion. The promoted point head
improves MAE/RMSE `83.16018/100.62751→67.26141/97.48492` while preserving point-threshold direction
at `64.29%`.

The retained reference probability head remains Brier `0.23314`, log loss `0.66261`, and direction
`64.29%`. The best historical challenger regresses those exact scopes to Brier `0.23898` and log
loss `0.67586` with unchanged direction, so it is rejected. The replay read every lock without
mutation, reconstruction, or reinterpretation.

## Same-input current-board impact

The frozen Week 5 comparison uses 760 matched rows and zero provider calls or writes. All 48 Passing
Yards projections and independent probabilities change, and 40 target-book-excluded market reads
change because line transport now starts from the independent point. All seven other prop families
are byte-identical across projection, raw probability, market probability, final probability, and
grade.

Two Passing Yards grades change. Geno Smith Over 206.5 at DraftKings moves from No Play to Watchlist.
Jordan Love Over 233.5 at FanDuel moves from No Play to Lean: projection `233.9→245.6` and probability
`50.45%→57.14%`. There is one actionable promotion and zero actionable demotions, moving the frozen
board from nine to ten actionables without flattening another family.

## External-research alignment

The decomposition follows nflfastR's public completion-probability and expected-YAC work: pass
volume, completion likelihood, air-yards value, and post-catch yards are distinct processes. Public
NFL tracking research supports pressure and passer/receiver geometry, but the winning reproducible
head is the simpler shifted yards-per-completion model. It does not invent assignment-level OL/DL or
receiver/defender data. The coherent player inputs feed the existing probability/decision path in
the same general architecture described by Huddle's public player-props technical overview.

- <https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd>
- <https://github.com/nflverse/nflfastR>
- <https://operations.nfl.com/gameday/technology/nfl-next-gen-stats>
- <https://arxiv.org/abs/2305.10262>
- <https://huddle.tech/wp-content/uploads/2024/02/Technical-Overview-of-Huddles-Player-Props-1.pdf>

## Production boundary and rollback

The release family is portable/model/calibration/decision/runtime/board/member/lifecycle/writer/
tracking `r11/r20/r22/r25/r26/r29/r37/r20/r43/r25`, named `independent_passing_yards`. The
expected-role artifact is `nfl_player_props_expected_role_runtime_2026_10_08_r3_passing_yards`.

The sole `nflPlayerPropsProductionWriter`, shared `prediction_pipeline:nfl` lease, cadence, provider
calls and ceilings, exact-price selection, grade thresholds, stakes, settlement, copy, labels, and
layout are unchanged. Ordinary unlocked rows are freshly recomputed. Every previously locked row
retains its exact stored release and payload. Roll back the complete Passing Yards family to the
October 8 independent Passing Completions release without rewriting locks if coherence, coverage,
writer, reader, or live-release verification fails.
