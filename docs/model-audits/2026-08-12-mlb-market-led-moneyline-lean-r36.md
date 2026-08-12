# MLB market-led Moneyline Lean — r36

Date: 2026-08-12

Scope: MLB full-game Moneylines, member-facing `prediction_records` writer only

Decision release: `mlb_daily_edge_decision_2026_08_12_r36`

Rule bundle: `mlb_daily_edge_rule_bundle_v35_2026_08_12`

Grade policy: `mlb_public_grade_policy_v27_market_led_moneyline_lean_2026_08_12`

Rule: `ml_market_led_toward_move_playable_price_lean_v1_2026_08_12`

## Decision

Add an independent Lean sleeve after the existing r32 top-one Moneyline ranker. A frozen final
side may be promoted only when it remains non-actionable, was not changed by a flip/calibration/
market-side correction, has no hold or no-bet, has complete high-quality and non-stale evidence,
has a real selected-side price from -120 through +200, moved at least one implied-probability
point toward the pick from opener to current, and has an exact selected-side SharpAPI
money-minus-ticket gap below 20 points. The stored selected-side probability must be at least 50%
because the current-head qualifying history has no movement-toward observations below that range.

The 50% boundary is evidence coverage, not a claim that the head is calibrated at 50.0%, and no
53%, 54%, or 55% grade cutoff applies. Model-versus-price edge does not veto this market-defined
rule. The sleeve never changes a side, probability, projection, price, Best
Angle flag, or stake. Existing safety and data gates retain priority.

## Why there is no 53% or 54% floor

The current-head, high-quality movement-toward pool did not contain a stable probability cliff.
Thresholds at 53%, 54%, and 55% returned 59-40 (+8.0%), 59-39 (+9.1%), and 58-37 (+10.6%). A
prior-data-only rolling threshold replay moved between 50.5% and 57% rather than identifying one
fixed boundary. Those results reject an exact calibrated cutoff above the observed 50%-plus range.

## Locked-record evidence

The final market-led cohort contained 34 historically non-actionable rows across 15 dates and
went 23-11, +13.758 units, +40.5% ROI. Chronological segments were:

- early: 3-2, +31.2% ROI;
- validation: 10-4, +50.9% ROI;
- later: 10-5, +33.8% ROI.

The model probabilities attached to those unchanged sides had Brier score 0.2365, log loss
0.6661, average probability 56.16%, and a 67.65% hit rate (+11.5-point selected-cohort calibration
gap). These diagnostics are not used to replace the public probability. A 10,000-resample
slate-date cluster bootstrap placed locked-price ROI at approximately +5.4% to +69.2%; the wide
interval reflects the short 15-date history.

One row overlapped the existing r32 ranker reconstruction. Excluding that overlap left 33 rows at
22-11, +12.058 units, and +36.5% ROI. Therefore the historical gross board impact is up to 33
incremental Leans, zero demotions, across 15 qualifying dates. Counts ranged from one to six on a
qualifying date; this is an evidence rule, not a daily quota.

Neighboring sensitivity did not identify a single magic boundary. Prices of -130 or better with
at least a 1.5-point move also remained positive, while the selected -120/one-point contract kept
the broader market-led sample and avoided the negative heavier-price cohort. SharpAPI gap caps
from 10 through 20 points remained positive; 20 is the broader stable boundary, while gap 20+
was not admitted. The exact discovery artifact is
`/tmp/oddsphere-audit/mlb-toward-movement-qualifiers-2026-08-12.json`.

## Paired board impact and ownership

The August 12 current-slate paired dry run adds zero Moneyline Leans because no current
non-actionable row clears every gate. Houston has the price, movement, and split shape but only
fallback-quality data; Pittsburgh and Seattle fall outside the observed 50%-plus probability
range; Baltimore is already the r32 Lean.
No Total or first-inning decision changes.

The sole writer remains `lib/services/predictionRecordService.ts` under the shared MLB-scoped
`prediction_pipeline` lease. Roll back to r35 if the sleeve bypasses a no-bet/data/price/
side-change gate, changes a side or stake, creates a Best Angle, produces mixed release stamps,
or materially disagrees with the member-visible snapshot.
