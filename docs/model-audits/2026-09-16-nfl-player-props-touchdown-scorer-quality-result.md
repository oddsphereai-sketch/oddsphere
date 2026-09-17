# NFL player props touchdown-scorer quality result

Date: 2026-09-16

## Decision

No production promotion. The bounded challenger improved the complete 2025 historical holdout,
but failed the frozen Week 1 2026 external confirmation. Shipping it would make the live scorer
forecast worse on the only forward season evidence, so the active touchdown probability model and
team-scoped scorer-selection policy remain unchanged.

## Rebuilt evidence

The audit rebuilt the checksum-pinned 2016-2025 nflverse substrate from 40 source files:
138,860 player-game rows, 2,639 games, 3,104 player identities, 109 base model features, and
99.217% outcome-player roster identity coverage. Model training ended in 2022, model selection
used 2023, calibration and policy selection used a chronological split inside 2024, and the
complete 2025 season was the historical holdout. Week 1 2026 was evaluated only after the
challenger was frozen.

The selected challenger blended the incumbent HGB scorer with a regularized HGB using each
player's within-team shares of recent goal-line, red-zone, rushing, target, snap, and touchdown
opportunity. The 75% role-aware / 25% incumbent blend and Platt calibration were selected without
using 2025 or 2026 outcomes.

## Historical holdout

On 11,327 eligible 2025 player-game rows:

| Metric | Incumbent | Challenger |
| --- | ---: | ---: |
| Brier score | 0.072967 | 0.072879 |
| Log loss | 0.243321 | 0.243172 |
| ROC AUC | 0.848413 | 0.848650 |
| Calibration gap | 0.004087 | 0.003938 |
| Selected scorers | 1,140 | 1,130 |
| True positives | 430 | 455 |
| False positives | 710 | 675 |
| Missed scorers | 675 | 650 |
| Precision | 37.72% | 40.27% |
| Recall | 38.91% | 41.18% |
| F1 | 38.31% | 40.72% |

The historical result clears every probability and scorer-discrimination gate.

## Week 1 2026 external confirmation

The production-shaped external cohort contains 338 offered players with final stat rows and 70
observed scorers. The active release selected 76 players and found 37 scorers: 48.68% precision,
52.86% recall, and 50.68% F1. The frozen challenger selected 73 and found only 34: 46.58%
precision, 48.57% recall, and 47.55% F1. Keeping the existing team policy with challenger
probabilities still found only 35 of 70 and produced 49.30% F1.

The scorer-count variants also fail promotion. Independent team rounding slightly inflates the
count, but the historically cleaner slate-level and largest-remainder variants did not beat the
active policy on Week 1. Changing the residual market weight away from the active 0.20 likewise
did not improve the frozen external result.

## Operational result

No model, probability, prediction, grade, action, stake, lock, tracking row, writer, cron, lease,
or member copy changed. No failed challenger was published. The existing `TD scorer` member
filter remains available and continues to reflect the active scorer forecast.

The next challenger must be chosen without reusing Week 1 as a tuning set and must pass new
forward evidence before activation. The result does not authorize a Week 1-fitted threshold,
manual Yes-count quota, or confidence label presented as a model improvement.
