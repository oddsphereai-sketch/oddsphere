# NFL Spread pre-week reliability controller predeclaration

Date: 2026-09-21

Status: frozen after 2019-2023 walk-forward development and before 2024-2025
confirmation is opened

## Objective

Make every NFL Spread prediction while adapting when the same frozen base
signal is demonstrably operating in the wrong direction during the current
season. This is not a per-game post-hoc flip, side quota, or board suppression.
The controller can use only settled games from weeks completed before the week
being predicted.

## Base forecast

Input, feature family, checksum verification, classifier, and 90% market / 10%
model logit blend are the frozen Spread definitions in
`2026-09-21-nfl-nonlinear-market-ensemble-predeclaration.md`.

Each season is genuinely walk-forward:

- fit the base classifier using only earlier seasons;
- predict all games in the current season;
- snapshot every game in one week before adding any result from that week;
- exclude pushes from the reliability record.

## Frozen controller

- Until 16 resolved current-season Spread predictions exist, publish the base
  side and probability.
- Thereafter, compute the base signal's cumulative current-season accuracy
  using only prior completed weeks.
- If that accuracy is below 47.5%, publish `1 - base probability` for the next
  week; otherwise publish the base probability.
- Re-evaluate before every week, so the controller can recover rather than
  locking an entire season into an inversion.
- Exact-price action threshold: 3.2 percentage points versus the two-sided
  no-vig market probability.
- Projected-margin correction is mapped from the final controlled probability
  through the prior-fit residual distribution and capped at four points.

Frozen walk-forward development results across 2019-2023:

- pooled full-board accuracy: 52.44%;
- 2019: 54.07%; 2020: 51.95%; 2021: 50.75%; 2022: 51.72%;
  2023: 53.88%;
- both home and away cover directions represented;
- 3.2pp lane: 84 resolved, 43-41, +2.687 units, 3.20% ROI, both
  directions.

## Frozen confirmation gates

On walk-forward 2024 and 2025, the candidate qualifies only if all hold:

1. Full-board side accuracy is above 50% pooled and at least 50% in each year.
2. Pooled Brier is no more than 0.001 worse than market no-vig and neither year
   is worse by more than 0.0025.
3. Both cover directions occur in each year.
4. Margin MAE is no more than 0.10 points worse than the market anchor pooled.
5. The fixed 3.2pp lane has at least 30 resolved actions, at least 50% accuracy,
   positive units, neither year below -5% ROI, and both directions.
6. Live replay keeps all Spread predictions, reconstructs coherent scores, and
   includes at least one tested promotion plus one demotion or neutral hold.
7. The existing authoritative writer and shared `prediction_pipeline:nfl`
   lease remain the only write path.

Historical success alone does not authorize deployment. Release/registry
bumps, focused tests, `npm run verify:model-change`, fresh-base integration
verification, pull request checks, and post-deploy verification remain
mandatory.
