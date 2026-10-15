# NFL Player Props Passing Attempts role-survival mixture result

Date: 2026-10-15
Status: rejected at historical selection; research only

## Decision

Reject the pregame depth-QB1 no-role/partial/full-role hurdle mixture as a Passing Attempts point
head. No candidate cleared the frozen 2024 selection gate, so no challenger was frozen and the 2026
candidate replay was not opened. Production projections, probabilities, grades, stakes, tracking,
and locked records remain unchanged.

## Historical result

| Candidate | 2024 MAE / RMSE | 2025 MAE / RMSE |
| --- | ---: | ---: |
| Released independent incumbent | 6.7247 / 8.9557 | 6.8564 / 8.6838 |
| 25% role-survival blend | 6.7618 / 8.9687 | 6.7685 / 8.5863 |
| 50% role-survival blend | 6.8498 / 9.0648 | 6.7692 / 8.6172 |
| 75% role-survival blend | 6.9706 / 9.2413 | 6.8514 / 8.7750 |
| 100% role-survival challenger | 7.1181 / 9.4938 | 7.0208 / 9.0532 |

The 25% and 50% blends improved 2025, but all four candidates worsened both primary point metrics in
the chronologically prior 2024 selection window. Selecting from the later improvement would reverse
the declared chronology and overfit the result.

## What this resolves

Timestamped depth charts are viable for defining the pregame QB1 denominator: the completed 2026
Weeks 1-5 cohort contains 158 team-games, including 12 no-role, seven partial-role, and 139 full-role
outcomes. The released smooth share model is poor on that deliberately harsh all-QB1 population
(8.5812 MAE / 12.1388 RMSE), confirming that role loss is real. But explicitly classifying those
states does not yield a stable better point mean across seasons. In-game injury and benching remain
largely irreducible from the current pregame features, while multiplying state risk into every QB
systematically depresses ordinary full-game forecasts.

The next materially different Passing Attempts path should preserve the stronger incumbent point
mean and improve the predictive distribution around it: a zero/partial/full mixture or empirical
residual distribution can change threshold probabilities and uncertainty without pretending that
unpredictable in-game role loss has been identified in the point forecast. It must be scored on the
exact offered rows with Brier/log loss and calibration, not promoted from distribution fit alone.

## Reproducibility and safety

The research script is
`scripts/operator/tournament_nfl_player_props_passing_attempts_role_survival.py`. Its ignored JSON
and row artifacts record source checksums, injury coverage, market exclusion, and the unopened gate.
The candidate consumed depth, lagged role, injury/practice, matchup, pressure, team, and environment
features; it consumed no line, price, side, spread, total, split, or movement input.
