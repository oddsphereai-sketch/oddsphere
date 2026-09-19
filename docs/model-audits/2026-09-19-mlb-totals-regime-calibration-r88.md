# MLB totals regime calibration r88

Date: 2026-09-19

## Scope and predeclaration

This release addresses forecast-side accuracy, not presentation. It changes
only the MLB full-game Total probability head. Moneyline, first inning,
projected scores, providers, copy, labels, stakes, locks, settlement, cron
cadence, writer ownership, and every non-MLB model are out of scope.

Incumbent identifiers were public calibration
`mlb_public_calibration_v33_current_line_pagination_2026_09_08`, decision
`mlb_daily_edge_decision_2026_09_08_r87_current_line_pagination`, rule bundle
`mlb_daily_edge_rule_bundle_v72_current_line_pagination_2026_09_08`, and Total
head `mlb_total_structural_coherence_probability_v3_2026_09_02`. Candidate
identifiers are calibration `mlb_public_calibration_v34_totals_regime_2026_09_19`,
decision `mlb_daily_edge_decision_2026_09_19_r88_totals_regime_calibration`,
rule bundle `mlb_daily_edge_rule_bundle_v73_totals_regime_calibration_2026_09_19`,
and Total head
`mlb_total_regime_calibrated_probability_v4_trailing90_2026_09_19`.

The existing automodel service remains the only prediction path, and all
scheduled callers retain the sport-scoped `prediction_pipeline:mlb` lease.

## Failure isolated

Release-separated locked results through September 18 did not show a broad
MLB winner-model failure: r87 Moneyline was 86-58 (59.7%). The active r87 Total
head was 63-81, with Unders 18-43. Two older Under-only action sleeves that had
looked strong historically were 2-11 and 0-5 in the current forward sample.
First-inning results were also weak, but no first-inning probability candidate
improved side accuracy consistently across train, calibration, and holdout, so
no first-inning behavior is changed in this release.

The Total failure was a changing run environment that the static distribution
head did not absorb quickly enough. The candidate estimates the latest actual
Over rate from the previous 90 settled locked predictions strictly before each
slate date, applies five pseudo-wins to each side, and blends that smoothed
prior with the existing target-excluded regularized probability:

`P(over) = 0.65 * incumbent_P(over) + 0.35 * ((over_wins + 5) / 100)`

The prior cannot read the current slate or a future result. It is loaded once
per slate from at most 240 database rows, never once per card or member request.
Fewer than 90 eligible results, a query error, or malformed evidence preserves
the incumbent probability and records the fallback in the model audit.

## Chronological selection and untouched holdout

The source cohort contains 1,315 settled Total rows from June 7 through
September 18. Candidate evaluation begins only after the rolling window is
available. Train ends July 31, calibration is August 1–31, and the untouched
holdout is September 1–18. Among 60-, 90-, and 120-game windows and 20%–40%
weights, 90 games / 35% was the smallest candidate that improved both combined
train-plus-calibration side accuracy and Brier. The holdout was inspected only
after that choice was fixed.

| Partition | Rows | Production accuracy | Candidate accuracy | Production Brier | Candidate Brier | Production log loss | Candidate log loss |
|---|---:|---:|---:|---:|---:|---:|---:|
| Train | 572 | 51.22% | 52.62% | 0.250664 | 0.249772 | 0.695054 | 0.692812 |
| Calibration | 411 | 51.82% | 51.58% | 0.251005 | 0.250839 | 0.695248 | 0.694873 |
| Holdout | 233 | 48.07% | 54.94% | 0.252973 | 0.247758 | 0.699253 | 0.688790 |

The single-game calibration accuracy decline is disclosed; calibration Brier,
log loss, and calibration gap all improve. On rows with both selected-side
prices, the flat one-unit all-forecast sensitivity was -12.227u to +13.619u in
train, -3.927u to -7.695u in calibration, and -18.419u to +15.317u in the
untouched holdout. Those units are a probability-head diagnostic, not a betting
recommendation and not a claim that every forecast clears the grade gates.

## Exact current-board impact

The SELECT-only September 19 replay ran the incumbent and candidate through the
same feature inputs and the complete authoritative prediction-record builder.
All 15 games produced Moneyline and Total predictions, no game was fully held,
and neither run had a model error. The candidate prior was 55 Over outcomes and
35 Under outcomes through September 18, smoothed to 60% Over.

Total board counts moved from **2 Best Angles / 0 Leans / 7 Watchlists / 6 No
Plays** to **0 / 4 / 9 / 2**. Four nonactionables became Leans (KC@PIT,
CHC@CIN, SEA@COL, and PHI@NYM); TOR@TEX and ATL@HOU Best Angles demoted after
their Under probabilities fell. That is four promotions, two demotions, net
+2 actionables, six side changes, and no forced quota.

The new probability is already downstream of the existing target-excluded
market regularizer. The record writer therefore does not price-calibrate it a
second time and does not route it through the older rejected mean-side,
market-opposed, mid-edge, or raw-projection side-candidate stack. Exact-price,
negative-EV, projection-alignment action gates, data quality, freshness,
provisional status, and all no-bet safeguards still apply normally.

## Cross-sport accuracy status

The same release-separated audit covered every Daily Edge sport and market.
It found CFB Spread losses concentrated in old-release away selections and
very large away underdogs, while the active r19 release has too few settled
rows to infer a safe live rule from 2026 outcomes alone. NFL r19, WNBA v1.4,
EPL r18, and UCL r6 also have small current-release samples. This does not close
those investigations: football Spread and Total candidates must use their
multi-season chronological datasets and receive independent release IDs,
holdouts, and current-board replays. No non-MLB behavior is silently changed by
r88.

## Verification, monitoring, and rollback

Required pre-merge checks are the focused totals calibration, automodel V2.2,
prediction-record writer, release-safety, loss-audit tests, TypeScript, lint,
`npm run verify:model-change`, production build, and integration safety against
the latest remote main. Publication must use a protected, up-to-date pull
request.

Live acceptance requires the r88 decision/calibration/Total-head tuple on one
coherent current slate, a successful natural writer under the sole MLB lease,
90 eligible prior results through a date before the slate, complete odds/stat
coverage, no mixed unlocked release, the expected nonempty Total board, intact
locks, a coherent member reader, and normal site responsiveness. Recheck after
the next writer and lock sweep.

Rollback the complete r88 family to r87 if the prior includes the current date,
the query becomes unbounded, the probability is calibrated twice, old side
candidates override the r88 side, the live board unexpectedly collapses,
release identifiers mix, a writer/lease fails, or reader and stored tuples
disagree. Locked rows remain immutable.
