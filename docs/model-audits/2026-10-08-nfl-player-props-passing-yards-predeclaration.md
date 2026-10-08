# NFL Player Props independent Passing Yards predeclaration

Date: 2026-10-08
Starting production base: `8d5639ff12bda65f5e50061d102873578c5acb2e`
Status: research and release gates declared before production edits

## Scope

This iteration may change only the unlocked NFL Passing Yards point head, its matching threshold
distribution, and the Passing Yards boundary between the independent model and downstream market
reading. Passing Attempts and Passing Completions remain their independently released heads.
Rushing Attempts, Rushing Yards, Receptions, Receiving Yards, Anytime Touchdown, exact-price
selection, grade thresholds, stakes, copy, labels, and layout are out of scope.

The current production family is the October 8 independent Passing Completions release:

- portable artifact `nfl_player_props_runtime_2026_10_08_r10_independent_passing_completions`;
- model `nfl_player_props_distribution_model_2026_10_08_r19_independent_passing_completions`;
- calibration `nfl_player_props_distribution_calibration_2026_10_08_r21_independent_passing_completions`;
- decision `nfl_player_props_decision_2026_10_08_r24_independent_passing_completions`;
- runtime / board / member `r25` / `r28` / `r36`;
- lifecycle / sole writer / tracking `r19` / `r42` / `r24`; and
- expected-role artifact `nfl_player_props_expected_role_runtime_2026_10_08_r2_passing_completions`.

The authoritative write path remains `nflPlayerPropsProductionWriter` under the shared
`prediction_pipeline:nfl` lease. This work may not add a writer, timer, provider call, database
loop, or per-card request.

## Independent architecture under test

Passing Yards is decomposed into the already released independent pass-volume and completion heads
plus market-free efficiency estimates. Frozen candidate families compare:

1. independent attempts multiplied by a shifted yards-per-attempt model;
2. independent completions multiplied by a shifted yards-per-completion model;
3. a completion decomposition of completed air yards plus yards after catch;
4. regularized combinations of those components and the preceding direct independent head; and
5. coherence bounds derived only from the independent attempts and completions heads.

Candidate features may use only information available before the game: shifted player/team state,
opponent pass-defense identity, sacks/pressure/hits/bad throws, air yards, YAC, explosive-pass rate,
PFR, FTN, public Next Gen Stats, depth, weather/roof, and timestamp-safe availability. Prop lines,
prices, books, consensus, movement, market probability, and target-game outcomes are prohibited
point and probability features. Offered lines are evaluation thresholds only.

The architecture follows nflfastR's separate completion-probability and expected-YAC models, which
identify air yards, down/distance, hit context, location, environment, and catch-point context as
distinct inputs. Public tracking research supports pressure and passer/receiver geometry, while
the production substrate uses only historically reproducible shifted aggregates rather than
inventing assignment-level OL/DL or receiver/defender matchups. Huddle's technical description
supports feeding coherent player projections into a shared simulation/probability layer rather
than independently market-anchoring every prop.

Primary references:

- <https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd>
- <https://github.com/nflverse/nflfastR>
- <https://operations.nfl.com/gameday/technology/nfl-next-gen-stats>
- <https://arxiv.org/abs/2305.10262>
- <https://huddle.tech/wp-content/uploads/2024/02/Technical-Overview-of-Huddles-Player-Props-1.pdf>

## Chronology and gates

- Training: 2016-2023.
- Selection: 2024.
- Confirmation: 2025.
- Opened same-era diagnostic: exact locked 2026 Weeks 1-4 scopes.
- Product impact: frozen current Week 5 production inputs after the candidate is fixed.

A point candidate must improve both MAE and RMSE in 2024 and must not regress either in 2025.
Bias, all four chronological confirmation segments, and a game-clustered uncertainty interval are
reported. A probability candidate must improve aggregate out-of-fold Brier and log loss without
lower directional accuracy, improve Brier in at least three of four expanding-window blocks, and
avoid a block Brier regression greater than `0.005`. The exact 2026 replay must not materially
reverse those findings.

Passing Yards may become independent-first only if the frozen candidate passes those gates.
Target-book-excluded market observations may remain downstream for disagreement, exact-price
economics, edge, and movement support, but they may not continuously blend into or rewrite the
independent Passing Yards point or probability.

Before publication, the same-input current-board comparison must report every Passing Yards
projection, probability, side, grade, promotion, demotion, and actionable-count change; all seven
other prop families must be byte-identical in model fields. An actionable demotion requires a
tested eligible promotion path. Existing locked payloads retain exact stored precedence and are
never recomputed, relabeled, or overwritten.

Publication additionally requires focused tests, `npm run verify:model-change`, a clean latest-main
integration-safety proof, protected PR checks, merge, production writer/lease/release/coverage/reader
verification, and a second live check after the next scheduled wave and lock sweep.
