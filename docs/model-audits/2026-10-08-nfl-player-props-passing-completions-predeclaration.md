# NFL Player Props independent Passing Completions predeclaration

Date: 2026-10-08  
Starting production base: `1240e7ee3d1fd2544f227ee4c5a4d365b333af3e`  
Status: research and release gates declared before production edits

## Scope

This iteration may change only the unlocked NFL Passing Completions point head and its matching
threshold distribution. Passing Attempts remains the independently released expected-role head.
Passing Yards, Rushing Attempts, Rushing Yards, Receptions, Receiving Yards, Anytime Touchdown,
market arbitration, exact-price selection, grade thresholds, stakes, copy, labels, and layout are
out of scope.

The current production family is the October 8 independent Passing Attempts release:

- portable artifact `nfl_player_props_runtime_2026_10_08_r9_independent_passing_attempts`;
- model `nfl_player_props_distribution_model_2026_10_08_r18_independent_passing_attempts`;
- calibration `nfl_player_props_distribution_calibration_2026_10_08_r20_independent_passing_attempts`;
- decision `nfl_player_props_decision_2026_10_08_r23_independent_passing_attempts`;
- runtime / board / member `r24` / `r27` / `r35`;
- lifecycle / sole writer / tracking `r18` / `r41` / `r23`.

The authoritative write path remains `nflPlayerPropsProductionWriter` under the shared
`prediction_pipeline:nfl` lease. This work may not add a writer, timer, provider call, database
loop, or per-card request.

## Independent architecture under test

Passing Completions is decomposed into:

1. the released market-free expected Passing Attempts head;
2. a pregame completion-rate model trained only on earlier player/team games;
3. the coherence constraint `completions <= attempts`; and
4. a separately selected threshold distribution fit to out-of-fold residuals.

Candidate completion-rate feature families are frozen before the 2026 replay: shifted player and
team state; pressure/hit/bad-throw/drop context; NGS expected completion, CPOE, target-depth, and
time-to-throw history; FTN catchability/play-design context; actual-opponent pass-defense history;
weather/roof; depth; and timestamp-safe availability. Prop lines, prices, books, consensus,
movement, and market probability are prohibited point and probability features. Offered lines are
evaluation thresholds only.

The decomposition follows the public nflfastR completion-probability model's separation of pass
volume from completion likelihood and its use of air yards, down/distance, hit, location, and
environment; NFL tracking research additionally supports receiver separation and passer/receiver
geometry as completion inputs. Public weekly NGS/PFR/FTN histories are used only when shifted
before the target game. Full route/coverage assignments are not inferred from position labels.

Primary references:

- <https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd>
- <https://github.com/nflverse/nflfastR>
- <https://arxiv.org/abs/2109.08051>
- <https://operations.nfl.com/gameday/technology/nfl-next-gen-stats>

## Chronology and gates

- Training: 2016-2023.
- Selection: 2024.
- Confirmation: 2025.
- Opened same-era diagnostic: exact locked 2026 Weeks 1-4 scopes.
- Product impact: frozen current Week 5 production inputs after the candidate is fixed.

A point candidate must improve both MAE and RMSE in 2024 and must not regress either in 2025.
Bias, chronological segments, and game-clustered uncertainty are reported. A distribution candidate
must improve aggregate out-of-fold Brier and log loss without lower directional accuracy, improve
Brier in at least three of four expanding-window blocks, and avoid a block Brier regression greater
than 0.005. The exact 2026 replay must not materially reverse those findings.

Before publication, the same-input current-board comparison must report every Passing Completions
projection, probability, side, grade, promotion, demotion, and actionable-count change; all other
markets must be byte-identical in model fields. An actionable demotion requires a tested eligible
promotion path. Existing locked payloads retain exact stored precedence and are never recomputed,
relabeled, or overwritten.

Publication additionally requires focused tests, `npm run verify:model-change`, a clean latest-main
integration-safety proof, protected PR checks, merge, production writer/lease/release/coverage/reader
verification, and a second live check after the next scheduled wave and lock sweep.

