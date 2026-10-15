# NFL player props Rushing Yards RB / non-QB residual predeclaration

Date: 2026-10-15
Status: frozen before executing the hierarchical residual audit; research only

## Candidate

The RB factorized center improves point accuracy, but both an RB-only residual refit and incumbent
residual transport fail the frozen PIT calibration gate. The failure is dispersion support: WR has
only 33 confirmation rows—too few for forecast authority—but it is valid non-QB rushing-error
evidence. This candidate separates forecast authority from calibration pooling:

- only RB receives the validated factorized point center and candidate probability;
- the candidate empirical residual distribution is fitted once on all preceding-season RB+WR
  factorized forecast errors, with 1,001 quantiles and no position weight;
- the continuous-distribution control is the analogous preceding-season RB+WR released-error pool;
  both are evaluated only on RB confirmation rows; and
- QB, WR, FB, TE, and unsupported positions remain exact incumbent forecasts and probabilities.

No market input, calibration blend, scale, threshold, or selectable pooling weight exists.

## Chronology and gates

Fit both residual pools on 2024 RB+WR errors and evaluate only untouched 2025 RB outcomes. Candidate
CRPS and PIT calibration error must improve, the game-clustered CRPS interval must be below zero,
and mean 50%/80%/90% interval-coverage error may not worsen by more than `0.01`.

Only after confirmation may the same frozen identity refit on 2025 RB+WR errors and score the nine
exact 2026 RB offers. Candidate selected-side Brier, log loss, calibration gap, direction, and
exact-price units must not worsen their stored locked raw values. Those opened outcomes cannot tune
the pool or thresholds.

Passing opens a same-input current-board rehearsal, not live authority. The balanced
promotion/demotion, actionable-count, immutable-lock, sole-writer, and shared-lease requirements
remain unchanged.
