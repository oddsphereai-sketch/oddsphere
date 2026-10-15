# NFL player props Rushing Yards supported-position predeclaration

Date: 2026-10-15
Status: frozen before executing the support-gated replay; research only

## Why this follow-up

The QB-preserving point hybrid passed, but its pooled non-QB residual calibration failed because
the confirmation sample contained 1,233 RB rows and only 33 WR rows. RB CRPS improved by `0.387`
and RB PIT calibration error improved; WR proper scoring improved on 33 rows but calibration and
coverage were too unstable to grant authority. That opened diagnostic may define a new finite
support boundary, but it is not a fresh holdout.

## Frozen candidate

A position requires at least 100 rows in both the calibration and confirmation seasons to receive
the factorized point head or its residual distribution. Under that rule:

- RB uses the already frozen 75% attempt-weighted team-carry × complete-roster share × YPC blend;
- RB probability uses 1,001 pooled RB empirical residual quantiles fitted on the immediately
  preceding season; and
- QB, WR, FB, TE, and every unsupported position retain the exact released independent projection
  and probability path.

No position grouping, weight, cutoff, line rule, or probability threshold remains selectable. The
candidate uses no line, price, book, consensus, movement, or market-implied team value in its point
forecast or calibration.

## Gates

On 2024 and 2025, aggregate and RB MAE/RMSE must improve, every fallback position must remain exact,
aggregate bias must remain within one yard of release, and the 2025 game-clustered MAE interval plus
all fixed segments must be below zero.

For 2025 RB probability confirmation, candidate CRPS and PIT calibration error must improve, the
game-clustered CRPS interval must be below zero, and average 50%/80%/90% interval-coverage error may
not worsen by more than `0.01`.

Only then may the nine exact 2026 RB offers be opened. Candidate selected-side Brier, log loss,
calibration gap, direction, and exact-price units must not worsen the stored locked raw probability.
Passing opens same-input current-board rehearsal, not production authority. The rehearsal must
report every projection/probability/side/grade change, promotions, demotions, actionables, and
market mix; demotion-only or more-than-20% actionable contraction fails. Existing locks remain
immutable and all audit scripts are zero-write.
