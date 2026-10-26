# NBA player props rebound/threes architecture r10 predeclaration

## Scope

This release may change only future unlocked NBA player-prop decisions for Rebounds and Threes.
All locked projections, sides, probabilities, grades, prices, evidence and tracking rows remain byte-authoritative.
Points, Assists, PRA, Points + Rebounds, Points + Assists and Rebounds + Assists retain the active r9/r10 behavior.
The member copy, labels, layout, provider cadence, private writer, store, lease, lock boundary and settlement path are unchanged.

## Failure being addressed

The active r9 artifact routes Rebounds through the robust count model, with a generic-minute exception for fewer than three current-team appearances. In the exact October 22-25 production replay, Rebounds settled 188-179 (51.23%) with 2.850 MAE. The frozen artifact already contains a separately trained ridge rate model and minute regression that produced better rebound projection error and direction in the chronological research blocks. The active Threes head similarly leaves a small, repeatable direction gain in the already-frozen structural direct count model.

## Candidate

- Rebounds: use the frozen `ridge_r2_minutes_regression` independent head and the already-defined FanDuel-plus-reference-book two-point disagreement reader. Keep the target book excluded from its own confirmation and retain the existing exact-price arbitration and grade policy.
- Threes: use the frozen `structural_direct_counts` independent head. Keep the existing exact-price arbitration and grade policy.
- Do not refit any coefficient, residual distribution, reliability model or grade policy.
- Do not alter any other market.

The complete production-path replay must improve all-board direction and MAE, preserve finite positive projections and side/projection coherence, and pair every actionable demotion with an actionable promotion. Current-board market coverage and grade counts may not fall.

## Evidence boundaries

The October 22-25 production replay is opened retrospective evidence, not a future holdout and not a guarantee. It is used because it is the only exact release-pure block containing the stored target-excluded market history, lock timestamps and official outcomes needed to replay the complete product. The historical early-season block remains a separate chronological architecture check. No result, box score or post-lock quote may enter a feature or current decision.

## Rollback

Roll back the r10 artifact and r11 decision release together to `nba_player_props_frozen_runtime_artifact_2026_10_26_r9_low_tenure_minutes` / `nba_player_props_forward_decision_2026_10_26_r10_low_tenure_minutes`. Never recompute or relabel an existing lock.
