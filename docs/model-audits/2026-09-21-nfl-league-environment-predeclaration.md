# NFL pre-week league-environment correction predeclaration

Date: 2026-09-21

Status: predeclared before this candidate's confirmation results are inspected

## Hypothesis

Static preseason team state can miss an early-season league-wide scoring or
home-field environment change.  This candidate uses only completed prior weeks
to estimate the residual around the market, then applies a bounded correction
to the next week's spreads or totals.  Same-week outcomes can never enter a
forecast.

## Data and chronology

- Source: checksum-pinned nflverse regular-season games for 2016-2025.
- State warm-up: 2016-2021.
- Selection: 2022-2023.
- Confirmation: 2024-2025, opened once after this declaration and script are
  committed.
- 2026 results are excluded from configuration selection and confirmation.
- Point baseline is the posted market line; probability baseline is the
  two-sided no-vig recorded price.

## Fixed candidate family

Spread and total are selected independently.  Before each week, the residual
mean is computed from completed earlier weeks in that season, shrunk toward the
previous season's residual mean.  The fixed grid is:

- prior equivalent games: 16, 32, or 64;
- previous-season carry: 0, 0.50, or 1.00;
- applied residual weight: 0.25, 0.50, 0.75, or 1.00;
- probability scale: 0.04, 0.08, 0.12, or 0.16 logit units per correction point;
- symmetric point cap: 3 points.

Selection ranks pooled 2022-2023 Brier, then MAE, log loss, smaller residual
weight, larger prior sample, and smaller probability scale.  A recipe qualifies
only if pooled Brier and MAE improve and neither selection season is worse on
both metrics.

## Confirmation gates

Each market must improve pooled MAE and Brier, have neither season worse on
both, reach at least 50% correction-direction accuracy with both directions,
and produce at least 30 resolved two-percentage-point-edge actions with positive
pooled ROI, neither season below -5%, and both bet directions.  A current-board
promotion/demotion replay and all model release, verification, PR, and live
health requirements remain mandatory.  Failure leaves production unchanged.

