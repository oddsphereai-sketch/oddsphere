# CFB exact-price grade-side guard r16 predeclaration

Date: 2026-08-27

Status: predeclared candidate; no production authorization

## Objective

Keep the qualified independent CFB joint PMF and the existing frozen grade
policy, while removing the implementation path that lets grading select the
opposite side from the PMF. Expected points, representative score, winner and
all three market probabilities remain unchanged. The exact-price layer may
only evaluate the higher-probability PMF side at the target line.

This is not the rejected r13 market-anchor replacement and does not copy the
bookmaker margin/total into the forecast. The existing calibrated probability
may still shrink the exact-price evaluation, but it cannot change the side.

## Frozen policy and chronology

The current `cfb_v1_composite_grade_policy_2026_08_25_r1` families, blend
weights, abstentions, edge thresholds, EV thresholds and Best Angle thresholds
are frozen. The existing deterministic simulation seed `20260825` is also
frozen. No parameter search or Week 0 tuning is permitted.

- 2022 and earlier: expanding calibration fit.
- 2023: original frozen policy selection; this pass reports it but does not
  reselect.
- 2024 and 2025: repeated confirmation.
- Immutable 2026 Opening/unlocked/T-60 rows: true forward evidence.

For every historical game/market, select the raw independent-PMF side before
applying the existing calibrator and grade thresholds. Report the removed
opposite-side actions, retained actions, units/ROI, largest-win sensitivity,
weekly-cluster bootstrap, Brier and log loss. Historical price limitations
remain unchanged and no CLV claim is allowed.

## Frozen gates

An existing Lean lane survives only if the coherent-side replay retains at
least five confirmation actions in each season, positive units in each season,
positive units after each season's largest win, positive pooled units and at
least 80% positive-unit weekly bootstrap resamples. Best Angle additionally
requires five actions and positive largest-win-removed units in each season.

The current exact-board replay must have zero actionable demotions or pair any
demotion with a separately qualified promotion. Every retained action must
match the PMF side, projected-score direction and evaluated target line. A
complete nonqualifier remains Watchlist or No Play under the frozen thresholds;
an actual evidence failure remains an internal exception and reasoned public
No Play.

The single CFB writer, `prediction_pipeline:cfb` lease, capture cadence,
provider budgets, T-60 boundary, market-scoped tracking and settlement remain
unchanged.
