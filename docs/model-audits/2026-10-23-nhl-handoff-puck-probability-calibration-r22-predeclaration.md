# NHL handoff puck-line probability calibration r22 predeclaration

Date: 2026-10-23

Status: predeclared, read-only research. No live authority.

## Diagnosis being tested

The fixed seven-game score-head handoff materially improves Moneyline accuracy,
Brier score, and margin MAE, but its exact-price puck-line grades lose separation.
A two-point verdict-floor relaxation changed zero grades because the affected
quotes are below break-even under the raw Poisson cover probability. The next
valid test is therefore probability calibration, not another verdict cutoff.

## Fixed candidate

For games in the seven-through-nine maximum-team-game handoff window only:

1. preserve the roster-head home score, away score, projected margin, puck-line
   side, line, Moneyline probability, Total probability, and both readers;
2. fit a two-parameter Platt calibration from the raw selected-side puck-line
   cover probability to realized cover probability;
3. fit on 2023 opening-window rows, choose the ridge penalty only from
   `[0, 2, 10, 40]` on 2024 Brier score (tie-break: log loss, then larger
   penalty), and freeze the coefficients;
4. test the frozen transform on 2025 and the already-opened 2026 replay; and
5. use the calibrated probability for puck-line confidence, model-market edge,
   exact-price value, and grade. It may not change the selected side or score.

This is a monotone probability calibration, not a score blend, market anchor,
team override, outcome-conditioned rule, or quota.

## Data and chronology

- Official MoneyPuck game-level team and skater inputs are strictly lagged.
- BALLDONTLIE regular-season final scores settle outcomes.
- Provider-native BALLDONTLIE opening puck lines and prices supply the
  historical exact-price surface for 2023-2025.
- The 2026 locked replay retains its exact stored prices and immutable payloads.

## Advancement gates

The candidate may advance only if all are true:

- 2024 selection Brier improves versus the raw roster-head puck probability.
- Untouched 2025 puck-line Brier and log loss do not worsen, direction is
  unchanged, and exact-price actionables retain at least 25% of eligible rows.
- On combined r18/r20 2026 confirmation, puck-line actionable accuracy does not
  decline versus the uncalibrated seven-game handoff and exact-price units
  improve by at least 1.0 unit.
- Across the full 2026 replay, puck-line actionable Brier does not exceed the
  current fast-head baseline by more than 0.005.
- The complete all-market candidate retains the seven-game handoff's Moneyline
  gains, contains at least one actionable promotion and one demotion versus
  r20, does not exceed r20's actionable count, and has zero missing prices.
- Every locked row remains byte-for-byte unchanged.

Failure rejects the candidate. No alternative calibration family, feature,
threshold, or ridge grid may be introduced after opening 2025 results.

