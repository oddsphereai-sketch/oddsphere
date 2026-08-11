# MLB sharp portfolio selected-side floor — r32

Date: 2026-08-11

Scope: MLB full-game Moneylines, member-facing `prediction_records` writer only

Decision release: `mlb_daily_edge_decision_2026_08_11_r32`

Rule bundle: `mlb_daily_edge_rule_bundle_v31_2026_08_11`

Grade policy: `mlb_public_grade_policy_v23_sharp_portfolio_selected_side_floor_2026_08_11`

Ranker: `mlb_ml_sharp_portfolio_ranker_v2_selected_side_floor_train_through_2026_07_31`

## Why r31 was held

The predeployment r31 candidate required 55% raw model probability. That value had performed
best in one broad sensitivity table, but exact locked-record review did not show a causal or
stable cliff at 55%. Production deployment was paused rather than representing the boundary as
more certain than the evidence supported.

Across complete, high-quality, historically non-actionable Moneylines under the current
probability head, raw probability bands were non-monotonic:

- 50% to below 52%: 12-9, +10.8% ROI;
- 52% to below 54%: 18-15, -0.8% ROI;
- 54% to below 55%: 6-5, -3.2% ROI;
- 55% to below 56%: 20-12, +21.3% ROI;
- 56% to below 58%: 11-6, +25.2% ROI;
- 58% and above: 63-41, +2.2% ROI.

These are descriptive pools rather than deployable standalone rules. They demonstrate that raw
probability alone does not correctly sort the board and that 54.9% versus 55.0% is not a
defensible actionability distinction.

## Replacement contract

The raw model floor is 50%, the structural boundary at which the binary Moneyline model prefers
the selected side. It is not sufficient for promotion. The candidate must also:

1. remain non-actionable after all existing side, no-bet, and correction logic;
2. have a real selected-side price from -220 through +200;
3. carry complete high-quality, non-stale splits and a valid market baseline;
4. have learned market-read probability at least equal to offered-price break-even;
5. have no captured opener-to-current movement against the pick; and
6. rank first by learned probability across the entire slate.

Only that single top candidate may become a Lean. No side, price, model probability, projection,
Best Angle flag, or stake changes. The learned score combines model probability, price and
implied break-even, model-versus-price edge, tickets, money, signed and absolute money-ticket
gap, favorite/underdog shape, movement, steam, reverse-line movement, and interactions.

## Current-head validation and board impact

Using exact locked record fields and expanding-window fits, the 50% floor policy selected 25
plays across the current probability-head era from July 11 through August 8. It went 20-5,
+10.217 units, and +40.9% ROI. Its approximate combined Brier score was 0.1871 and log loss was
0.5611. Floors from 50% through 55% selected the same 7-1 portfolio on August 1-8, so the recent
holdout does not support a special 55% boundary.

On the August 11 paired dry run, r32 scans 15 games and proposes all 45 expected market records
with zero held or skipped markets. Cincinnati at Chicago White Sox remains the sole added
Moneyline Lean. Lowering the structural floor does not force Detroit or any second Moneyline onto
the board; Detroit becomes eligible for joint ranking but does not outrank Cincinnati. Totals and
first-inning decisions remain unchanged. Net board impact versus the live pre-r31 release is one
Moneyline Lean and zero demotions.

## Ownership and rollback

The sole writer remains `lib/services/predictionRecordService.ts` under the MLB-scoped shared
`prediction_pipeline` lease. Roll back to the pre-r31 production release if r32 promotes more
than one Moneyline, bypasses a no-bet/data/price/movement gate, changes another market, creates
mixed current-slate release stamps, or disagrees with the member-visible snapshot.
