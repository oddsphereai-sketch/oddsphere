# NFL market-context residual forecast predeclaration

Date: 2026-09-21

Status: predeclared before candidate confirmation results were inspected

## Problem statement

The settled 2026 Week 2 NFL board was 5-8-1 against the spread and 5-9 on
totals.  The locked score forecast was also almost identical to the evaluated
market: its mean absolute displacement was 0.29 points on margin and 0.75
points on total.  All 14 games reported that the independent prior was
unavailable.  The production fallback therefore did not supply enough
independent football information to justify the score forecast.

This audit tests whether a conservative model of the error around the market
can add real predictive information.  It does not use the 2026 Week 2 results
for fitting or selection, and it cannot write predictions, grades, tracking,
or production state.

## Immutable inputs and chronology

- Feature release:
  `nfl_real_pregame_features_2016_2025_2026_08_19_r1`
- Source data: checksum-pinned nflverse schedules, play by play, injuries,
  weekly rosters, and snap counts already recorded by that feature release.
- Training seasons: 2018-2021.
- Selection seasons: 2022-2023.
- Confirmation seasons: 2024-2025, opened once after this declaration and the
  audit implementation are committed to the task worktree.
- Regular season only.  Same-week games cannot update one another's features.
- The nflverse lines are terminal market observations.  This limitation must
  remain explicit; passing this audit alone does not prove performance at an
  earlier live publication timestamp.

## Targets and baseline

- Margin residual: final home margin minus market-implied home margin.
- Total residual: final total points minus market total.
- Point baseline: the market line itself.
- Probability baseline: the two-sided no-vig probability derived from the
  recorded American prices for home/away spread or over/under total.

Margin and total are selected and evaluated independently.  Moneyline is out
of scope and must not change.

## Fixed candidate family

The residual models receive the existing leakage-safe football features plus
only these pregame market-context fields:

- market home margin and absolute margin;
- market total and total centered on 44;
- no-vig home spread, over, and home moneyline probabilities;
- early-week indicator and fixed interactions between margin magnitude, total
  level, indoor roof, and wind.

The fixed estimator set is:

- standardized ridge regression with alpha 100, 300, or 1000;
- conservative histogram gradient boosting with 20 or 40 minimum leaf rows,
  maximum 15 leaves, learning rate 0.03, 240 iterations, and L2 penalties of
  12 or 20.

No estimator, feature, target, season boundary, or hyperparameter may be added
after confirmation results are read.  Any orthogonal follow-up requires a new
predeclaration.

For each estimator, the applied point correction is chosen on 2022-2023 from:

- residual weights: 0.10, 0.20, 0.33, or 0.50;
- symmetric correction caps: 2, 3, or 4 points.

The point candidate is selected by lowest pooled selection MAE, then lowest
pooled RMSE, then the smaller weight, smaller cap, and simpler estimator.  To
qualify for probability selection it must improve pooled MAE over the market
and may not worsen either selection season's MAE by more than 0.15 points.

Candidate probabilities are the market no-vig logit plus the applied point
correction multiplied by one fixed scale selected from 0.04, 0.08, 0.12, or
0.16 logit units per point.  The scale is selected by pooled 2022-2023 Brier
score, then log loss, then the smaller scale.  Pushes are excluded from
probability scoring.

After selection, the chosen recipe is fit once on 2018-2023 and evaluated on
the untouched pooled 2024-2025 confirmation set.  The 2024 outcomes are not
used to refit the model used on 2025.

## Confirmation gates

A market may be considered for a production implementation only if all of the
following hold on 2024-2025 confirmation data:

1. Pooled point MAE improves over the market baseline.
2. Pooled Brier score improves over the no-vig market baseline.
3. Neither 2024 nor 2025 is worse than baseline on both MAE and Brier.
4. The sign of non-zero forecast corrections is correct at least 50% of the
   time, excluding pushes, with both opposing directions represented.
5. At a fixed 2 percentage-point edge threshold, there are at least 30
   resolved actions, pooled ROI is positive, neither season is below -5% ROI,
   and both opposing bet directions are represented.
6. A current-board replay separately demonstrates at least one tested
   promotion and at least one tested demotion or neutral hold.  The actionable
   board may not be flattened to manufacture better historical results.
7. The production implementation can consume the same authoritative writer
   and sport-scoped `prediction_pipeline` lease without adding a second writer.

Passing historical gates does not authorize launch by itself.  A release bump,
focused tests, `npm run verify:model-change`, current-board impact report,
fresh-base integration verification, pull request, required green checks, and
post-deploy live verification remain mandatory.  If any gate fails, the
candidate remains research/shadow only and production behavior is unchanged.

