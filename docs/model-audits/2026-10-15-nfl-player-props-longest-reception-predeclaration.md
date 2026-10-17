# NFL player props: longest reception predeclaration

Date: 2026-10-15

Mode: read-only independent-model research; zero production writes

## Hypothesis and chronology

A receiver-level extreme-value model using only lagged target opportunity, prior explosive receptions, air-yard/YAC skill, offense/pass environment, opponent receiving allowance, role, and weather can improve Longest Reception accuracy without sportsbook inputs or unavailable route participation.

Fit 2017-2024, select once on 2025, refit through 2025, and test once on 2026 Weeks 2-5. The two archived Week 5 games are a separately reported slice. Eligible players are WR/TE/RB/FB players with a pregame target-role proxy and official participation for settlement; same-game targets cannot establish eligibility.

## Frozen candidates and gates

- Foundation: lagged longest-reception history adjusted by expected target opportunity.
- Candidate A: ridge regression on `log(1 + longest reception)`.
- Candidate B: shallow regularized histogram gradient boosting on the same target.
- Select by 2025 MAE, then RMSE and average threshold Brier.
- Advance only if the selected candidate improves 2026 MAE and RMSE, improves average Brier, and wins at least four of five fixed thresholds: 14.5, 19.5, 24.5, 29.5, and 34.5 yards.

The known missing route-participation/alignment data is recorded as a limitation. It is not permission to leak market consensus into the model. No production promotion is allowed without release-pure offers and exact prices.

