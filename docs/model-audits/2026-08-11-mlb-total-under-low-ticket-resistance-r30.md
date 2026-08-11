# MLB Total Under low-ticket resistance Lean — r30

Date: 2026-08-11

Scope: MLB full-game totals, member-facing `prediction_records` writer only

Decision release: `mlb_daily_edge_decision_2026_08_11_r30`

Rule bundle: `mlb_daily_edge_rule_bundle_v29_2026_08_11`

Grade policy: `mlb_public_grade_policy_v21_total_under_low_ticket_resistance_2026_08_11`

## Problem and search design

The board had repeatedly produced few actionable moneylines and totals. Rather than relaxing one
threshold, the audit searched 9,021 interactions across price, side, picked-side money-minus-ticket
gap, ticket concentration, opening-to-lock movement, steam, and reverse-line movement. It then
replayed the discovery process itself: at each historical cutoff, rules were selected using only
earlier outcomes and scored on the next unseen weekly block.

The single-rule walk-forward policy produced 55 incremental decisions at 34-21, +9.794 units and
+17.8% ROI. Its totals selections were 15-5, +7.881 units and +39.4% ROI. The recurring totals
family was a moderate-price Under with low ticket share and picked-side money below tickets.

## Static rule evidence

The market-only family (Under, -145 through -105, tickets <=35%, money-minus-tickets <=-5 points)
contained 36 incremental rows across 25 dates and went 28-6-2, +18.467 units, +51.3% ROI:

- train: 15-5-2, +38.8% ROI;
- validation: 8-1, +64.0% ROI;
- holdout: 5-0, +83.6% ROI.

All 36 rows used the same SharpAPI split source. The guarded production subset additionally
requires model probability >=55%, nonnegative offered-price EV, same-side projection alignment,
and high data quality. That incremental subset was 15-3 across 15 dates: 6-2 train, 6-1
validation, and 3-0 holdout. On the exact current total probability head, the corresponding
thin-edge rows remained positive. The neighborhood audit stayed positive at adjacent 54%-56%
probability, 45%-55% ticket, and -3 to -10 point split thresholds.

For the 18-row incremental guarded cohort, model-probability Brier score was 0.2036, log loss was
0.5996, and the average model probability was 57.0% versus an 83.3% selected-cohort hit rate
(+26.3-point calibration gap). The gap describes this deliberately selected tail and its small
sample; it is not used to rewrite the underlying probability head or size stakes.

A 50,000-iteration game-day cluster bootstrap on the 36-row market family produced a 95% ROI
interval of +29.0% to +73.4%, with 100% of resamples positive. A separate 50,000-iteration
outcome-permutation placebo within the 202-row eligible moderate-price Under pool produced
`p=0.00144`. These checks reduce the chance that repeated games on one slate or ordinary Under
base rates explain the result.

## Production contract

`total_under_low_ticket_resistance_lean_v1_2026_08_11` promotes only to Lean when all conditions
are true:

1. final side is Under and no existing no-bet, hold, or Best Angle applies;
2. high data quality and same-side projection gap >=0;
3. model probability >=55%;
4. offered-price edge is >=0 and <5 percentage points;
5. selected price is -145 through -105;
6. picked-side tickets are <=35%;
7. picked-side money minus tickets is <=-5 percentage points.

The sub-5-point edge limit makes the sleeve additive to the existing validated-total Lean rule,
which already handles edge >=5 points. It does not flip a side or override missing price,
projection conflict, probability/mean divergence, freshness, or data-quality failures.

## Paired board impact and rollback

The August 11 live-slate replay has zero qualifiers. Before and after r30 therefore remain two
Total actionables: NYM at ATL Under Lean and TB at ATH Under Best Angle. Moneyline and first-inning
decisions are unchanged. Historically, the guarded rule adds 18 incremental Total Leans and
demotes zero rows.

The sole writer remains `lib/services/predictionRecordService.ts` under the MLB-scoped shared
`prediction_pipeline` lease. Roll back to r29/rule-bundle v28/grade-policy v20 if a non-Under,
missing-price, negative-EV, projection-opposed, non-high-quality, or out-of-band split row becomes
actionable, or if any current-slate market outside full-game totals changes.
