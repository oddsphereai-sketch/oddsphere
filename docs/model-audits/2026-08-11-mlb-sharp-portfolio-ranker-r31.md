# MLB sharp portfolio Moneyline ranker — r31

Status: superseded before production deployment by r32 after exact floor-sensitivity review.

Date: 2026-08-11

Scope: MLB full-game Moneylines, member-facing `prediction_records` writer only

Decision release: `mlb_daily_edge_decision_2026_08_11_r31`

Rule bundle: `mlb_daily_edge_rule_bundle_v30_2026_08_11`

Grade policy: `mlb_public_grade_policy_v22_sharp_portfolio_and_total_resistance_2026_08_11`

Ranker: `mlb_ml_sharp_portfolio_ranker_v1_train_through_2026_07_31`

## Problem and method

The pre-r31 board had no actionable August 11 Moneylines even though several non-actionable
model sides had complete prices, splits, and market history. The audit therefore treated play
selection as a slate-ranking problem instead of relaxing one isolated grade threshold.

The candidate model combines model probability, offered-price implied probability,
model-versus-price edge, picked-side public ticket share, picked-side money share, the signed and
absolute money-minus-ticket gap, favorite/underdog price shape, and captured opener-to-lock
movement, steam, and reverse-line-movement fields plus their interactions. Outcomes and returns
use locked selected-side prices. The existing prediction pipeline continues to determine and
freeze the side before the portfolio layer runs.

## Chronological validation

A daily expanding-window replay refit the ranker only on information available before each test
slate, filtered to model probability at least 55% and learned probability at least the offered
break-even, ranked eligible non-actionable Moneylines, and selected at most one play per slate.
Across 30 test slates it selected on 25 dates and went 20-5, +9.359 units, +37.4% ROI:

- July: 13-4, +34.6% ROI;
- August: 7-1, +43.5% ROI.

The 25 selected rows had Brier score 0.1976 and log loss 0.5858. Their average learned
probability was 60.5% versus an 80.0% hit rate (+19.5-point selected-cohort calibration gap).
That positive gap is not converted into displayed probability or stake; the learned score is
used only for eligibility and within-slate rank ordering.

This is explicitly not a daily play quota: five test slates produced no selection. Expanding to
the top two produced 29-16 and +16.3% overall but fell to 8-7 and -9.9% in August. Expanding to
the top three produced 33-28 and -0.6% overall. Those lower ranks are therefore excluded.

As a second forward check, coefficients frozen using data through July 31 went 6-2 and +35.1%
ROI on untouched August 1-8 rows. Earlier frozen windows were 2-3 through July 20 and 7-1 through
July 31, which is why the production contract remains narrow and Lean-only rather than promoting
to Best Angle.

## Production contract

`ml_sharp_portfolio_top1_lean_v1_train_2026_07_31` runs once across the completed MLB slate after
all per-market decisions are built. A row is eligible only when all conditions are true:

1. the frozen market is Moneyline and the row is still non-actionable;
2. no existing no-bet or Best Angle applies;
3. model probability is at least 55%;
4. selected-side price is -220 through +200;
5. high data quality, non-stale evidence, and a valid market baseline are present;
6. picked-side ticket and money percentages are both present;
7. learned win probability is at least the selected price's implied break-even;
8. captured opener-to-lock movement is not against the pick.

Only the highest learned-probability eligible row can become a Lean. The ranker never flips the
side, replaces the model probability, changes the score projection, substitutes a price, creates
a Best Angle, changes units, bypasses a hold, or makes a provider call. Movement fields were
sparse in the frozen pre-August training history, so movement-against is used as a conservative
hard veto; it is not represented as a separately proven positive coefficient.

## Paired board impact

At the August 11 paired replay timestamp, the old board had zero actionable Moneylines. The new
ranker added Cincinnati at Chicago White Sox, Cincinnati +135, as one Lean. The candidate carried
60% model probability, 17% picked-side tickets, 61% picked-side money, a +44-point money-ticket
gap, neutral movement, 56.0% learned probability, and 42.6% offered break-even. Philadelphia
-177 was rejected because its learned probability did not clear the price break-even. Los Angeles
Angels +132 was rejected because the captured price movement was against the pick. No Total or
first-inning decision changed because of the ranker. The companion r30 Total sleeve had zero
current qualifiers, so the combined r31 board delta is +1 Lean and zero demotions.

Prices and eligibility are intentionally recomputed from each coherent refresh, so the named
August 11 candidate may cease to qualify if its live evidence changes before lock.

## Ownership and rollback

The sole writer remains `lib/services/predictionRecordService.ts` under the MLB-scoped shared
`prediction_pipeline` lease. The ranker operates in memory on the already-built slate and adds no
database or provider load. Roll back to r30/rule-bundle v29/grade-policy v21 if it promotes more
than one Moneyline per slate, promotes a stale/missing-price/against-movement row, alters a frozen
side or price, changes another market, creates mixed current-slate release stamps, or materially
disagrees with the member-visible snapshot.
