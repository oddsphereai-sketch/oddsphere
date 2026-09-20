# NFL spread/total rolling-residual audit result — 2026-09-20

## Decision

Reject the candidate family and leave the active NFL Spread and Total prediction, calibration,
decision, grade, stake, and board-count releases unchanged. This is not an abstention/flat-board
release: the candidate failed accuracy and economics gates before any production-board mutation was
authorized, so promotions and demotions are both zero and the live board is byte-unchanged.

## Chronological result

The audit used the predeclared 2016–2021 state/training window, 2022–2023 frozen selection window,
and 2024–2025 untouched confirmation window. Configurations were selected without reading
confirmation outcomes.

### Spread

Selected configuration: 16-game shrinkage, 0.25 previous-season carry, 0.20 market-residual weight,
and 1.5 points home field.

- Confirmation Brier: 0.251347 versus 0.250000 market anchor (worse).
- Confirmation MAE: 9.7203 versus 9.6664 market anchor (worse).
- Selected-side accuracy: 48.79%.
- Actionable lane: 249 resolved, 119–130, -18.182 units, -7.30% ROI.

Spread fails forecast accuracy, direction accuracy, and actionable economics.

### Total

Selected configuration: 16-game shrinkage, 0.75 previous-season carry, and 0.10 market-residual
weight.

- Confirmation Brier: 0.249814 versus 0.250000 market anchor (nominal improvement).
- Confirmation MAE: 10.0541 versus 10.0616 market anchor (nominal improvement).
- Selected-side accuracy: 51.57%.
- Actionable lane: one resolved opportunity and one loss.

The Total forecast improvements are too small to overcome the predeclared minimum 30-action sample,
positive-economics, both-directions, and board-impact gates. It is not eligible for live use.

## Current production interpretation

The active Week 2 board therefore remains the target-excluded NFL r13/r19 family. The published
snapshot has all 16 games and 48 game markets. Philadelphia–Tennessee is now correctly represented as
Philadelphia -7; the exact-price grade is No Play because the current model probability is effectively
50%, not because the side was silently switched to Tennessee.

The current Spread/Total family has only one completed game in the active release, so it is not valid
to claim a new release-level accuracy conclusion yet. Continue immutable T-60 forward tracking and
evaluate it by release identifier. A later challenger still must be a genuinely independent,
target-excluded residual model and must pass both accuracy and paired promotion/demotion board gates;
an Under-to-Over inversion or a broad demotion is not an acceptable substitute.
