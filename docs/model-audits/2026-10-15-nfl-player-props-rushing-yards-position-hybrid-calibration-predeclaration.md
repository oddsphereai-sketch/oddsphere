# NFL player props Rushing Yards position-hybrid calibration predeclaration

Date: 2026-10-15
Status: frozen before fitting the hybrid residual distribution; research only

## Scope

The QB-preserving Rushing Yards point hybrid has passed its frozen MAE/RMSE, chronology, position,
and exact offered-line direction gates. Production currently retains the incumbent Rushing Yards
probability distribution, so a point-only cutover would leave the new projection without a
validated probability surface. This follow-up tests one probability identity before any runtime,
grade, or release edit.

- QB projections and probabilities remain exactly incumbent.
- RB/FB/WR use the frozen position-hybrid projection and one pooled non-QB empirical residual
  distribution. TE and unsupported positions remain incumbent.
- The residual distribution uses exactly 1,001 equally spaced empirical quantiles and no fitted
  market, line, price, book, consensus, movement, or outcome-specific parameter.

## Chronology

- Fit the reference and hybrid residual distributions only on 2024 forecast errors; evaluate the
  untouched 2025 rows.
- If 2025 passes, refit the hybrid residual distribution only on 2025 errors and evaluate the nine
  exact non-QB Rushing Yards offers from 2026 Weeks 1–5.
- The 2026 outcomes are already opened diagnostic evidence. They may reject this calibration but
  cannot alter its quantiles, position boundary, or thresholds.

Multiple player rows remain clustered by game for uncertainty. The continuous-distribution audit
reports empirical CRPS, PIT calibration error (the mean absolute difference between each empirical
PIT-decile frequency and `0.10`), 50%/80%/90% interval coverage and width, plus position metrics.
The exact offered audit reports selected-side Brier score, log loss, calibration gap (absolute mean
probability minus observed win rate because there are only nine rows), direction, and exact-price
units.

## Frozen gates

On 2025 non-QBs, the hybrid distribution must lower CRPS, have a below-zero game-clustered CRPS
interval, not worsen PIT calibration error, and not increase the average absolute interval-coverage
error across 50%/80%/90% bands by more than `0.01`. RB and WR CRPS may not worsen by more than
`0.25`; FB is reported but not independently gated when fewer than 100 rows exist.

Only then may the nine exact 2026 non-QB offers be opened. Relative to each row's stored locked raw
selected-side probability, the candidate must not worsen Brier score, log loss, calibration gap,
direction, or exact-price units. This small opened cohort cannot authorize production by itself; it
opens a same-input current-board rehearsal.

That rehearsal must report every projection, probability, side, grade, promotion, demotion,
actionable-count, and market-mix change. A demotion-only or more-than-20% actionable contraction
fails. No production write or locked-row mutation is permitted by this audit.
