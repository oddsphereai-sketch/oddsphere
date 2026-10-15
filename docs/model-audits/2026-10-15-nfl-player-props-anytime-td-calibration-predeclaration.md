# NFL player props Anytime TD independent calibration predeclaration

Date: 2026-10-15
Status: frozen before fitting or scoring any calibration challenger; research only

## Scope and authority

This tournament changes no football feature, component model, team-touchdown budget, player-share
allocation, ensemble weight, sportsbook input, market reader, exact price, grade, stake, writer,
lease, or locked record. The candidate being calibrated is the already frozen 50/50 arithmetic
mean of the independent direct-share and scorer-hurdle probabilities. It remains independent of
prop lines, player prices, books, consensus, movement, main-game spread/total, and market-implied
team totals.

The released market-anchored Anytime TD probability and the unrecalibrated fixed independent
ensemble remain the two controls. Week 5 of 2026 is already opened external evidence and may be
used only once, after a winner is frozen from 2024 development and passes 2025 confirmation. It
cannot fit a calibrator or select a method.

## External research translated into the test

Niculescu-Mizil and Caruana require calibration predictions to be out of sample from the forecast
model and show that isotonic regression needs more data than parametric sigmoid calibration.
Kull, Silva Filho, and Flach show that beta calibration contains the identity map and can correct
skewed probability distortions that a single-logit sigmoid cannot. Those findings motivate the
finite method set and the stricter support gate for isotonic regression; they do not select the
winner.

- https://icml.cc/Conferences/2005/proceedings/papers/079_GoodProbabilities_NiculescuMizilCaruana.pdf
- https://proceedings.mlr.press/v54/kull17a.html

## Frozen calibration identities

The tournament evaluates exactly six challengers plus the identity control:

1. global Platt scaling on `logit(p)` with L2-regularized logistic `C=1`;
2. global beta calibration on `log(p)` and `-log(1-p)` with the same logistic regularization;
3. global isotonic regression;
4. position-aware Platt scaling with the global Platt map as fallback;
5. position-aware beta calibration with the global beta map as fallback;
6. position-aware isotonic regression with the global isotonic map as fallback; and
7. the unmodified fixed ensemble identity.

Every map clips only at `1e-5` and `1 - 1e-5`. Isotonic output is clipped to the calibration
sample's fitted range and uses monotone interpolation outside the observed score range. No method
may use a current-game outcome, market value, threshold chosen from evaluation results, or an
after-the-fact position grouping.

Position-specific Platt or beta calibration is eligible only with at least 1,000 calibration rows,
75 scorers, and 75 non-scorers in that position. Position-specific isotonic additionally requires
at least 2,000 rows, 150 scorers, and 150 non-scorers. An unsupported position uses the same
method's global map; it is not pooled after results are known. The observed pre-fit support is:

| Calibration season | QB rows/scorers | RB rows/scorers | TE rows/scorers | WR rows/scorers |
| --- | ---: | ---: | ---: | ---: |
| 2023 | 1,573 / 97 | 2,846 / 345 | 2,363 / 155 | 4,407 / 448 |
| 2024 | 1,527 / 90 | 2,649 / 383 | 2,377 / 168 | 4,567 / 471 |
| 2025 | 1,630 / 89 | 2,881 / 378 | 2,348 / 210 | 4,468 / 428 |

Thus QB is eligible for position Platt/beta but not position isotonic; RB/TE/WR are eligible for
all three. FB has no eligible preceding-season sample and always uses the global map.

## Chronology

- Predict 2023 from football training through 2022 with the existing component calibration fitted
  only on 2022, and fit each second-stage map only on those 2023 probabilities/outcomes. Apply it to the
  already out-of-sample 2024 fixed-ensemble probabilities for development selection.
- Refit the same frozen identity on 2024 probabilities/outcomes and apply it to 2025 for untouched
  chronological confirmation.
- Only a confirmed identity is refit on 2025 and applied to the complete immutable Week 5 2026
  board. No 2026 outcome participates in fitting or method choice.

The football component chronology and complete-roster normalization remain identical to the fixed
ensemble audit. Multiple player rows are clustered by game for uncertainty.

## Frozen selection and release gates

On 2024, a selectable challenger must, relative to the unrecalibrated fixed ensemble:

- lower Brier score and log loss;
- not worsen AUC by more than `0.0005` (isotonic ties can change ranking);
- not worsen calibration gap; and
- retain lower Brier/log loss and non-worse AUC than the released control.

Among selectable methods, choose the lowest Brier score, then lowest log loss, then lowest
calibration gap, then the order listed above. No substitution is allowed after 2025 is opened.

On 2025, the frozen winner must retain lower Brier/log loss and non-worse AUC than the released
control; must not worsen Brier, log loss, AUC by more than `0.0005`, or calibration gap relative to
the fixed ensemble; must have a below-zero game-clustered Brier interval versus the released
control; and must have no adverse fixed chronological segment versus the released control.
Position Brier/log loss and calibration gap are reported for all four supported positions. A
position regression larger than `0.002` Brier versus the fixed ensemble fails stability.

Only then may the complete Week 5 board be scored. It must improve Brier and log loss versus the
released locked probability, not worsen AUC by more than `0.0005`, and reduce calibration gap to no
more than the released control's `0.125268`. Passing opens exact-price and board-impact review; it
does not authorize production.

The board review must report side/pick changes, promotions, demotions, unchanged actionables, total
actionable count, market mix, exact-price return, and scorer/non-scorer calibration. A demotion-only
or more-than-20% actionable contraction fails unless a separately predeclared balanced rule supplies
validated promotions. Existing locked rows remain byte-for-byte authoritative. Failure leaves live
releases and the member board unchanged.
