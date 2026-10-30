# NBA Four Factors matchup add-one r2 predeclaration

Date: 2026-10-29

Status: offline audit only. This experiment has no production, member,
writer, database, grade, stake, lock, tracking, or persisted-shadow authority.

## Question

Does one basketball-specific Four Factors matchup layer improve the released
NBA independent-score recipe without degrading winner calibration, margin,
Total, tails, or any sufficiently large frozen margin cohort?

This is a single-family add-one refit. It is not a new feature tournament and
does not test the market reader.

## Frozen baseline and evidence

- base commit: `62d6764d925fdd0ef94bac2e00dc9ec9960f3b05`;
- independent artifact:
  `nba_professional_deployment_candidate_2026_10_15_r15_comparable_benchmark_gates`;
- point-in-time features:
  `nba_point_in_time_features_2026_10_15_r13_season_regime_state`;
- feature ledger SHA-256:
  `1d5b8f861950c83acfc7b4442e221cceb15c31754f41da12721f9a6f03b3449c`;
- baseline recipe: the artifact's exact `ratings_schedule` feature list,
  missing-indicator list, standardized ridge heads, and alpha `1000`, refit
  separately inside every chronological fold;
- selection seasons: 2023 and 2024 only;
- opened replication season: 2025, scored only if a candidate passes every
  selection gate;
- market inputs: none;
- injury/rotation inputs: none.

The checked-in bootstrap contains only two team aggregate box rows per game,
not a valid player rotation history. Rotation results from the r1 sensitivity
audit are therefore invalid and are excluded from this experiment.

## Frozen candidate family

The candidate adds exactly eight point-in-time matchup features: a home-minus-
away advantage and home-plus-away environment for each of effective field-goal
percentage, turnover rate, offensive-rebound rate, and free-throw rate.

Each team's matchup edge is already defined by the point-in-time builder as
offense versus the opponent defense allowed/forced. The current 15-game and
prior-season edge are blended deterministically:

`current_weight = min(min(home_current_games, away_current_games) / 15, 1)`.

When both windows exist, use that blend. When only one exists, use the
available point-in-time value. Otherwise the derived feature is missing and is
imputed from the training fold only. No five-game window, market line, outcome,
spline, interaction search, or candidate-defined cohort is permitted.

Two candidates are frozen before results: the full baseline-plus-eight-feature
model with ridge alpha `1000` and `10000`. These are direct base-model refits,
not residual heads and not feature-zeroing approximations.

## Chronology and calibration

For test season Y, every transform and coefficient is fit only on seasons
before Y. Probability and interval scale for both baseline and candidate are
estimated from rolling-origin out-of-fold residuals within that training set;
the same rows are never used both to fit a prediction and to estimate its
residual scale.

## Metrics and frozen cohorts

Report team-score, margin, and Total MAE/RMSE/bias; winner accuracy, Brier and
log loss; actual-on-predicted margin slope; predicted and realized margin
dispersion; 20-point tail Brier/rate; and 80/90/95% margin interval coverage.

Margin cohorts are fixed from the incumbent prediction before inspecting a
candidate: 0-2, 2-5, 5-10, and 10+ absolute points. A cohort gate is applied
only when the pooled selection sample contains at least 150 games.

Use a deterministic 2,000-sample paired game-block bootstrap, seed 20261029,
for candidate-minus-baseline team-score, margin, and Total MAE deltas. Report
the 2.5% and 97.5% percentiles.

## Selection gate

A candidate is eligible only if all conditions hold on pooled 2023-24:

1. team-score MAE delta is at most `-0.10` and its upper 95% paired interval is
   below zero;
2. margin and Total MAE point estimates are no worse and each upper 95% delta
   interval is below `+0.10`;
3. winner Brier and log loss are no worse, and winner accuracy declines by no
   more than 0.5 percentage points;
4. actual-on-predicted margin slope is closer to 1;
5. tail Brier is no worse and 80/90/95% interval coverage does not move farther
   from nominal by more than two percentage points;
6. no frozen cohort with at least 150 games regresses by more than 0.5 margin
   MAE points or two winner-direction percentage points;
7. each selection season individually has a negative team-score MAE delta and
   margin and Total MAE deltas below `+0.10`.

If both candidates pass, select the lower pooled team-score MAE, breaking ties
by margin MAE, Total MAE, winner Brier, then stronger regularization.

## Replication and production boundary

If no candidate passes, candidate scoring stops and 2025 is not consulted. If
one passes, its frozen identity is evaluated once on 2025. The opened 2025
season is replication evidence, not pristine confirmation and not sufficient
for production.

A favorable result still requires exact current-release forward locked
confirmation, model-release and calibration-release bumps, same-input board
impact, promotion and demotion tests, locked-record immutability tests, focused
tests, `npm run verify:model-change`, latest-main integration safety, a
protected pull request, and post-deploy verification. A failed candidate
remains an offline report only.
