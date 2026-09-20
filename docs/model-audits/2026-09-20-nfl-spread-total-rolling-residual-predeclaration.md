# NFL spread/total rolling-residual audit predeclaration

Date: 2026-09-20

This is an audit-only tournament. It does not authorize a production model,
calibration, grade, stake, writer, or member-release change.

## Scope and incumbent

- Markets: NFL full-game spread and full-game total only.
- Incumbent production family:
  - `nfl_v1_spread_event_contained_2026_09_03_r5_target_excluded_forecast`
  - `nfl_v1_total_market_evidence_2026_09_03_r4_target_excluded_forecast`
  - `nfl_v1_daily_edge_calibration_2026_09_16_r13_injury_pagination`
  - `nfl_v1_daily_edge_decision_2026_09_16_r19_injury_pagination`
- Sole writer remains `nfl_forward_evidence_writer_2026_09_16_r30_injury_pagination`
  under the shared sport-scoped `prediction_pipeline` lease.
- No new writer, refresh path, UI copy, label, quota, side inversion, or
  flat-board rule is in scope.

## Data and chronology

- Source: checksum-pinned nflverse games file already used by the prior NFL
  total audit. Only completed regular-season games with a posted spread and
  total are eligible.
- State/training: 2016-2021.
- Frozen selection: 2022-2023.
- Untouched confirmation: 2024-2025.
- Team features use only games completed before the predicted week. Games in
  the same week are updated as a batch after every prediction for that week.
- Closing lines are used only as a common historical benchmark. They are not
  represented as equivalent to the production locked quote.

## Candidate family

For both markets, construct a prior-only team forecast from shrinkage-weighted
points scored and allowed, previous-season carryover, and a fixed home-field
term. Blend its residual relative to the posted market anchor back into that
anchor. Convert the residual to a probability with a scale fit on the
state/training seasons only.

Frozen grid before confirmation is opened:

- shrinkage games: 4, 8, 12, 16
- prior-season carryover: 0.25, 0.50, 0.75
- market residual weight: 0.10, 0.20, 0.25, 0.33, 0.50
- home-field points: 1.5, 2.0, 2.5

Spread and total configurations are selected independently on 2022-2023 by
lowest Brier score, then MAE, then the more conservative residual weight.

## Frozen gates

A candidate may be considered for a later production implementation only if,
on pooled 2024-2025 confirmation:

1. Brier score and MAE both improve versus the market-anchor baseline.
2. Neither confirmation season is worse on both Brier and MAE.
3. Absolute calibration gap improves.
4. Selected-side accuracy is at least 50% pooled.
5. The actionable lane is positive in units and ROI, with at least 30 resolved
   opportunities pooled and neither season below -5% ROI.
6. Both directions are present in the full forecast and in the actionable
   lane; a one-sided inversion is an automatic rejection.
7. A production-board replay must show both tested promotion and demotion
   behavior and report the exact net board-count impact. No quota may satisfy
   this gate.

Failing any gate keeps the family in shadow/audit status. It must not alter the
live release.
