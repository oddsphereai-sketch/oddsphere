# NFL player props combined-yards strict chronology predeclaration

Date: 2026-10-16

Release: `nfl_player_props_combined_yards_chronological_2026_10_16_r2`

Production changes authorized: none

## Epistemic status

The retained data support a strict calendar split, but 2025 is **not epistemically untouched**: the prior r1 work used 2025 for candidate selection and inspected all three component architectures. This audit may establish a correctly ordered retrospective confirmation; it may not relabel 2025 as a clean holdout or authorize production. The next genuinely untouched evidence begins with future prospective games after this declaration and requires the exact-price offer ledger.

## Frozen chronology

- Training: 2017-2023.
- Architecture selection: 2024 only.
- Retrospective temporal confirmation: 2025 only, scored once by the architecture selected on 2024 after refitting through 2024.
- External confirmation: 2026 Weeks 2-5, reported separately and already known to be repeatedly inspected.

The candidate set, features, eligibility, thresholds, and paired-residual method remain exactly the r1 declaration:

1. separate raw rushing- and receiving-yard HGBs;
2. separate log HGBs with component smearing; and
3. separate carry/target opportunity HGBs multiplied by conditional yards-per-carry/yards-per-target HGBs.

No market line, price, consensus, movement, or post-lock input may enter any point model. Threshold probabilities use position-conditioned empirical paired component residuals from the immediately preceding selection/confirmation season, with nonnegative component bounds.

## Frozen 2025 gates

Overall:

1. MAE, RMSE, and average Brier must all improve;
2. at least four of five fixed threshold Brier scores must improve;
3. absolute mean projection bias must be below 5 yards; and
4. game-clustered 95% intervals for MAE, RMSE, and average Brier deltas must all exclude zero in the improving direction.

Position segments (`QB`, `RB`, `TE`, `WR`, each with at least 100 rows):

1. no segment may worsen MAE, RMSE, or average Brier by more than 2%; and
2. at least three of four segments must improve each of MAE, RMSE, and average Brier.

Pregame opportunity segments:

- Form a market-free workload score from lagged carries plus lagged targets.
- Freeze low/medium/high cut points at the 2024 33rd and 67th percentiles.
- On 2025, no segment may worsen MAE, RMSE, or average Brier by more than 2%, and at least two of three segments must improve each metric.

Passing these retrospective gates would retain the architecture as a research foundation only. Production still requires genuinely prospective outcomes, release-pure exact offers/prices, calibration, economics, and promotion/demotion plus board-count evidence.
