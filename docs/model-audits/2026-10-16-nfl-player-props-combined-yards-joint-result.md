# NFL player props Rushing + Receiving Yards component/joint result

Date: 2026-10-16

Release: `nfl_player_props_combined_yards_joint_2026_10_16_r1`

Production changes: none

## Result

The component architecture repaired the failure that rejected the direct combined-yard log model. Selection on 2025 chose `opportunity_efficiency_hgb`: separate carry and target opportunity models multiplied by separate yards-per-carry and yards-per-target models. Threshold probabilities used position-conditioned paired rushing/receiving residuals, preserving their observed covariance and nonnegative component bounds.

On the 982-row 2026 Weeks 2-5 repeated diagnostic:

| Metric | Independent foundation | Opportunity × efficiency | Change |
|---|---:|---:|---:|
| Mean projection (actual 40.232) | 40.343 | 39.887 | -0.346-yard candidate bias |
| MAE | 24.5370 | **23.7269** | **-0.8101** |
| RMSE | 32.4960 | **31.0596** | **-1.4364** |
| Average threshold Brier | 0.15097 | **0.14218** | **-0.00879** |
| Threshold Brier wins | — | **5 of 5** | pass |

The 63-game paired bootstrap supported all three improvements:

- MAE delta: -0.811 yards, 95% interval -1.371 to -0.226;
- RMSE delta: -1.442 yards, 95% interval -2.157 to -0.702; and
- average Brier delta: -0.00884, 95% interval -0.01342 to -0.00396.

The candidate passed every frozen accuracy gate, including the mean-bias and RMSE-interval requirements. Its projected mean stayed close to the realized mean rather than collapsing the upper tail to the prior direct log model's 27-yard average.

## Interpretation

This is a better independent research foundation for Rushing + Receiving Yards. The improvement came from football structure—opportunity and conditional efficiency by component—not market anchoring. The paired residual layer explicitly kept rushing/receiving dependence; on the 2025 residual period, candidate residual covariance was 16.01 yards squared and correlation was 0.037.

It is not production-authorized. Weeks 2-5 have already been inspected repeatedly, so this is confirmation rather than an untouched holdout. The exact-price archive also had no usable Week 7 offers at the 2026-10-16 06:55 ET audit, so prospective calibration, economics, promotion/demotion, and board-count gates remain unavailable. The next clean evidence is prospective exact offers plus results after providers post a board.
