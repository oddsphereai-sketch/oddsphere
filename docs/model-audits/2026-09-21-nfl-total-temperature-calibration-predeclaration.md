# NFL Total direction-preserving calibration predeclaration

Date: 2026-09-21

Status: frozen before calibrated confirmation probabilities and economics are
opened

## Scope and evidence

The nonlinear Total classifier's raw side selection exceeded 50% in both
2024 and 2025, but its probability magnitude was overconfident and its
exact-price lane failed. This follow-up retains that model's side for every
game and calibrates only distance from 50%. It does not inspect or tune against
the confirmation probabilities, prices, or returns.

Input, features, chronology, estimator, leakage boundaries, limitations, and
coherent score reconstruction remain those frozen in
`2026-09-21-nfl-nonlinear-market-ensemble-predeclaration.md`.

## Frozen calibration

- Raw estimator: the already-frozen 500-tree Total random forest.
- Calibrated probability: `logistic(0.25 * logit(raw probability))`.
- The positive temperature preserves every Over/Under direction exactly.
- Exact-price action threshold: one percentage point versus the two-sided
  market no-vig probability.
- Projected-total correction: calibrated probability mapped through the
  fit-period residual scale, capped at four points.

These constants were selected only on 2022-2023. Frozen selection evidence:

- full-board accuracy: 51.30%, with both seasons above 50%;
- Brier score: 0.249629 versus 0.250140 market baseline;
- action lane: 264 resolved, 144-120, +16.230 units, 6.15% ROI;
- both Over and Under predictions and actions represented.

## Confirmation gates

The candidate qualifies only if all of these hold on 2024-2025:

1. Full-board accuracy is above 50% pooled and at least 50% in each season.
2. Pooled Brier improves on the market baseline and neither season is worse by
   more than 0.001.
3. Both Over and Under predictions occur in each season.
4. Total-point MAE is no more than 0.10 points worse than the market anchor.
5. The one-point exact-price lane has at least 30 resolved actions, at least
   50% accuracy, positive units, neither season below -5% ROI, and both action
   directions.
6. Live replay keeps one Total prediction per game, preserves coherent team
   scores, and demonstrates at least one promotion plus one demotion or neutral
   hold without a quota.
7. The existing authoritative writer and shared `prediction_pipeline:nfl`
   lease remain the only production write path.

Historical success alone is not deployment authority. The model safety
protocol, release/registry bumps, tests, clean integration proof, pull request,
required checks, and post-deploy verification remain required.
