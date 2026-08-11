# MLB totals rejected-correction original-side validation — r29

Date: 2026-08-11  
Scope: MLB full-game totals, member-facing `prediction_records` writer only  
Decision release: `mlb_daily_edge_decision_2026_08_11_r29`  
Rule bundle: `mlb_daily_edge_rule_bundle_v28_2026_08_11`  
Correction policy: `mlb_prediction_corrections_v11_totals_rejected_candidate_original_side_2026_08_11`

## Problem

The prior policy correctly rejected historically unstable opposite-side totals corrections, but
then automatically marked the original model side `NO_PLAY`. That second action bypassed the
normal price, EV, projection-alignment, probability, and validated-grade evaluation and flattened
otherwise qualified totals.

The current example was NYM at ATL Under 8.5: 58.8% model probability, 50.8% market probability,
8.0 percentage points of edge, -110, and a projected total of 6.86. An opposing split produced an
Over correction candidate. The candidate was correctly rejected, but the blanket stand-down also
removed the qualified original Under.

## Read-only evidence

`npm run audit:mlb-totals-corrections` used 853 stored totals, 821 settled rows, and 816 settled
rows with original-side evidence. It used real stored side-specific prices and lines and did not
write data.

- The prior release removed nine current-window original-side actionables. They went 7-2,
  +4.040 units, +44.9% ROI; Brier 0.2225; log loss 0.6380; mean probability 54.73%; observed win
  rate 77.78%.
- The nine rejected opposite-side candidates went 2-7, -5.093 units, -56.6% ROI.
- The current-window `market_aware_split_signal_fade` cohort reversed sharply: original sides
  went 9-4 (+33.0% ROI), while corrected sides went 4-9 (-40.6% ROI).
- The validated Lean control remained positive overall at 18-15-1 (+8.5% ROI), and its strong
  current-window subset went 7-2 (+44.2% ROI).

These samples remain modest, so r29 does not reactivate any correction candidate and does not add
a new promotion threshold. It removes only the blanket stand-down after rejection and reuses the
already-versioned champion validation gates.

## New decision contract

1. Generate totals correction candidates exactly as before.
2. Reject every candidate exactly as before; never expose its side, price, probability, or grade.
3. Restore the original model side and its exact price/probability tuple.
4. Evaluate that original side through the existing missing-price, explicit no-bet,
   probability/mean divergence, projection conflict, positive-EV, price, probability, edge,
   data-quality, and grade gates.
5. Stamp `total_rejected_correction_original_side_validation_v1_2026_08_11` in the decision audit.

## Paired current-slate impact

The read-only 2026-08-11 replay scanned all 15 MLB games with zero fetch errors.

- Before r29 totals: 1 Best Angle, 0 Leans, 1 provisional, 4 Watchlists, 9 No Plays.
- After r29 totals: 1 Best Angle, 1 Lean, 1 provisional, 9 Watchlists, 3 No Plays.
- Actionable delta: +1 promotion, 0 demotions.
- Newly restored action: NYM at ATL Under 8.5, Lean, -110.
- Existing action retained: TB at ATH Under 10.5, Best Angle, -113.
- Moneyline and first-inning decisions are unchanged by this release.

The weak rejected-correction fixture remains a non-actionable Watchlist. The strong fixture becomes
a Lean only through the calibrated-model Lean path. Tests assert that the rejected opposite side
is never selected or graded.

## Ownership, deployment, and rollback

The sole writer remains `lib/services/predictionRecordService.ts`, invoked under the shared
MLB-scoped `prediction_pipeline` lease. No provider calls, schedules, locks, probabilities,
projections, or stakes change.

Rollback is the previous r28 decision/rule/correction identifiers plus the prior blanket
stand-down behavior. Roll back if production shows mixed current-slate releases, a rejected
candidate as the public side, missing-price rows becoming actionable, unexpected non-total board
changes, or writer/lease overlap.
