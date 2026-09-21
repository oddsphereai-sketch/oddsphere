# NFL direct side-classifier predeclaration

Date: 2026-09-21

Status: predeclared before this candidate's confirmation results are inspected

## Hypothesis

Regression candidates can slightly improve score MAE while producing no useful
side separation.  This candidate instead estimates home-cover and over
probability directly, then maps the probability displacement back to a bounded
point correction so score, side, and probability remain coherent.  It also
allows selection to learn that a fitted football signal should be shrunk toward
the market; it does not hard-code or retrospectively flip 2026 sides.

## Chronology and inputs

- Feature release:
  `nfl_real_pregame_features_2016_2025_2026_08_19_r1`
- Training: 2018-2021.
- Selection: 2022-2023.
- Confirmation: 2024-2025, opened once after this declaration and script are
  committed.
- 2026 outcomes are excluded from fitting and selection.
- Inputs are the existing leakage-safe football features plus pregame line,
  total, and two-sided no-vig price probabilities.  Pushes are excluded from
  classifier fitting and probability scoring.

## Fixed candidate family

Separate Spread and Total classifiers use:

- standardized logistic regression with C 0.001, 0.01, or 0.1;
- histogram gradient boosting with minimum leaf size 30 or 60, maximum 15
  leaves, learning rate 0.03, 240 iterations, and L2 20 or 30.

The raw classifier logit is blended toward the no-vig market logit with weights
0.10, 0.20, 0.33, 0.50, or 1.00.  The applied logit displacement is capped at
0.25, 0.50, or 0.75 in either direction.  Selection ranks pooled 2022-2023
Brier, then log loss, point MAE, smaller weight, smaller cap, and simpler model.
A recipe qualifies only if Brier improves, point MAE is no more than 0.02 worse
than market, and neither selection season is worse on both Brier and MAE.

The coherent point correction is
`training residual sigma * (normalQuantile(candidate probability) -
normalQuantile(market probability))`, capped at four points.  This is applied
to market margin or total before score construction.

## Confirmation gates

Each market independently requires pooled Brier and MAE improvement, no season
worse on both, at least 50% correction-direction accuracy, both forecast
directions, and a fixed two percentage-point edge lane with at least 30
resolved actions, positive pooled ROI, neither season below -5% ROI, and both
bet directions.  A current-board promotion/demotion replay and every release,
test, integration, PR, and live-verification requirement remain mandatory.
Failure leaves production unchanged.

