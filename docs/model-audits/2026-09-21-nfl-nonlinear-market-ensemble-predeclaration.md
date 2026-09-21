# NFL nonlinear market/football ensemble predeclaration

Date: 2026-09-21

Status: frozen after 2022-2023 selection and before this candidate's
2024-2025 confirmation results are opened

## Objective

Produce a Spread and Total side for every eligible NFL game with greater than
50% full-board out-of-sample accuracy, coherent projected scores, both
directions represented, and a separately profitable exact-price actionable
lane. Moneyline, UI copy, labels, quotas, and prediction suppression are out of
scope.

## Immutable input and chronology

- Feature release:
  `nfl_real_pregame_features_2016_2025_2026_08_19_r1`.
- Runtime verifies the artifact checksum from its manifest.
- Training: 2016-2021.
- Selection: 2022-2023.
- Reuse-aware confirmation: 2024-2025, predicted by one model fit only through
  2023.
- Regular season only; pushes are excluded from side probability metrics.
- nflverse lines are terminal market observations, not claimed to be the same
  as an OddSphere T-60 quote.

The feature family is the fixed leakage-safe football feature set already
declared by the market-context residual audit: pregame rolling offense,
defense, matchup, QB, injury, roster, coaching, rest, weather, Elo, market
margin/total, no-vig two-sided prices, and fixed market/weather interactions.

## Frozen candidates

Both markets use training-only median imputation.

Spread:

- histogram gradient boosting classifier;
- learning rate 0.025, 300 iterations, 15 maximum leaves, 40 minimum leaf
  rows, L2 regularization 20, random seed 21;
- final logit = 90% two-sided market no-vig logit + 10% model logit;
- actionable edge threshold = 1.3 percentage points.

Total:

- random forest classifier;
- 500 trees, 10 minimum leaf rows, 35% features per split, balanced-subsample
  class weights, random seed 21;
- final probability = the fitted ensemble probability;
- actionable edge threshold = 2.5 percentage points versus the two-sided
  market no-vig probability.

These recipes were selected before confirmation. Fixed 2022-2023 results:

- Spread full-board accuracy: 51.64% pooled, 50.57% in 2022, 52.71% in 2023.
- Spread 1.3pp lane: 138 actions, 74-64, +4.781 units, both directions.
- Total full-board accuracy: 51.30% pooled, 52.24% in 2022, 50.37% in 2023.
- Total 2.5pp lane: 340 actions, 182-158, +11.387 units, both directions.

Projected margin and total corrections are reconstructed from the candidate
probability with a normal residual law whose scale is estimated only on the
fit period, capped at four points. Projected team scores are then solved from
the corrected margin and total so side, total, winner, and score identities
cannot disagree.

## Frozen confirmation gates

Spread and Total qualify independently only if every item passes on 2024-2025:

1. Full-board resolved side accuracy is above 50% pooled and at least 50% in
   each season.
2. Candidate Brier score is no more than 0.001 worse than the no-vig market
   baseline pooled and no more than 0.0025 worse in either season.
3. Both opposing prediction directions occur in each season.
4. Point MAE is no more than 0.10 points worse than the market anchor pooled.
5. The frozen actionable lane has at least 30 resolved actions, positive pooled
   units, at least 50% accuracy pooled, neither season below -5% ROI, and both
   action directions.
6. A live-board replay retains a prediction for every game, proves coherent
   score identity, and tests at least one promotion plus one demotion or
   neutral hold. No quota may satisfy the gate.
7. Production uses the existing NFL writer and shared sport-scoped
   `prediction_pipeline` lease.

Passing historical confirmation is not authorization to deploy. Release and
registry bumps, focused tests, `npm run verify:model-change`, fresh-base
integration verification, a pull request with green checks, and post-deploy
live verification remain mandatory.
