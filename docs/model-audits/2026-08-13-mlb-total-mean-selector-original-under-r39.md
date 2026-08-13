# MLB Daily Edge r39 — rejected mean-selector original Under

Date: 2026-08-13

## Change

The generic `total_validated_lean_v1_2026_07_11` sleeve is stood down after its
exact post-launch cohort went 5-8 (-23.5% locked-price ROI). It is paired with
`total_mean_selector_original_under_lean_v1_2026_08_13`, which promotes only an
unchanged original Under after the mean-side correction candidate is rejected.

The replacement requires the exact SharpAPI two-sided split pair, high data
quality, a real selected-side price from -145 through +145, and all missing-
market, divergence, and explicit no-bet safeguards to clear. It changes no
side, probability, projection, price, Best Angle status, or stake.

## Chronological evidence

- All rejected correction originals: 20-13-1 (+13.1% ROI).
- Under branch: 19-6-1 (+41.1% ROI).
- Over branch: 1-7; rejected.
- Under chronological weeks: 3-1, 3-2, 11-2-1, 2-1.
- Under by exact SharpAPI relationship: money at least 10 below tickets 11-3;
  money at least 10 above tickets 4-2-1; within 10 points 4-1. No fitted split
  threshold was added.
- Date-block bootstrap across 13 dates: P(profitable)=0.9952 and
  P(hit rate above 50%)=0.9966.
- Observed selected-side prices ranged from -145 through plus money.

## Paired board impact

- Historical forward rows: 26 promotions and 13 generic-sleeve demotions,
  net +13 actionables.
- August 13 pregame board at audit time: four original Under promotions and no
  current generic-sleeve demotion.

## Ownership and rollback

The authoritative writer remains `predictionRecordService` under the existing
sport-scoped `prediction_pipeline` lease. Rollback is the exact r38 decision
release, v37 rule bundle, v28 grade policy, and v11 correction policy.
