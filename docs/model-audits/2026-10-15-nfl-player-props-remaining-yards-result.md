# NFL player props: remaining yards markets result

Date: 2026-10-15

Release: `nfl_player_props_remaining_yards_tournament_2026_10_15_r1`

Production changes: none

## Longest Reception — retain independent candidate

The 2025 selection chose the HGB log model. On 797 eligible 2026 Weeks 2-5 player-games, it cleared every frozen accuracy gate.

| Metric | Foundation | HGB log |
|---|---:|---:|
| MAE | 11.3447 | **7.5232** |
| RMSE | 14.3089 | **11.8940** |
| Average threshold Brier | 0.18852 | **0.13888** |
| Threshold Brier wins | — | **5 of 5** |

The 63-game paired bootstrap favored the candidate for MAE by -3.841 yards (95% CI -4.459 to -3.215), RMSE by -2.443 (-3.125 to -1.815), and average Brier by -0.04997 (-0.05836 to -0.04166). All 2,000 draws improved all three metrics.

The two archived Week 5 games contained 27 eligible receivers. The candidate also improved that slice's MAE (13.89 to 11.65), RMSE (17.78 to 17.40), and average Brier (0.20873 to 0.20649), although only two of five threshold Brier scores improved. The full current-season replay remains the primary evidence.

Decision: retain this model as the Longest Reception independent research foundation. Missing complete route participation remains a matchup-detail limitation, but it did not prevent a large out-of-time improvement with the available target, air-yard, YAC, role, defense, and environment features.

## Rushing + Receiving Yards — reject candidate

The 2025 selection chose the HGB log model. On 982 current-season player-games it reduced MAE and improved all five fixed threshold Brier scores, but it worsened RMSE and materially underpredicted the mean.

| Metric | Foundation | HGB log |
|---|---:|---:|
| Mean projection (actual 40.14) | 40.36 | 27.00 |
| MAE | 24.5346 | **23.3462** |
| RMSE | **32.4958** | 33.9439 |
| Average threshold Brier | 0.15716 | **0.14600** |
| Threshold Brier wins | — | **5 of 5** |

The paired bootstrap confirmed the split: MAE delta -1.196 yards (95% CI -2.036 to -0.282) and Brier delta -0.01124 (-0.01616 to -0.00632), but RMSE delta **+1.428** (+0.215 to +2.553). The model compresses the upper tail too severely. It fails the predeclared gate and is rejected.

The next valid architecture must model carry and target opportunity jointly, then model rushing and receiving efficiencies conditionally with correlated residuals. Summing one shrunken log target is not sufficient.

Neither market is authorized for production because the retained archive has no release-pure exact offer/price ledger for economic, grade, and board-impact evaluation.

