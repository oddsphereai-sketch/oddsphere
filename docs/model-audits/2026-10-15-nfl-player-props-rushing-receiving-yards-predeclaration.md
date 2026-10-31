# NFL player props: rushing plus receiving yards predeclaration

Date: 2026-10-15

Mode: read-only independent-model research; zero production writes

## Hypothesis and chronology

A joint yards model can outperform a naive sum of lagged rushing and receiving averages by learning the player's pregame carry/target mix, role share, team volume budgets, opponent position allowances, rushing efficiency, air-yard/YAC skill, line/box/pressure context, and weather. Sportsbook inputs are excluded.

Fit 2017-2024, select on 2025, refit through 2025, and test once on 2026 Weeks 2-5. Eligible RB/WR/TE/FB/QB players require a pregame carry-plus-target role proxy and official participation only for settlement.

## Frozen candidates and gates

- Foundation: sum of partially pooled lagged rushing- and receiving-yard expectations.
- Candidate A: ridge regression on `log(1 + combined yards)`.
- Candidate B: shallow regularized histogram gradient boosting on the same target.
- Select by 2025 MAE, then RMSE and average threshold Brier.
- Advance only if the selected candidate improves 2026 MAE, RMSE, average Brier, and at least four of five thresholds: 39.5, 49.5, 59.5, 69.5, and 79.5 yards.

No production promotion is allowed without release-pure exact offers/prices and a board-impact replay.

