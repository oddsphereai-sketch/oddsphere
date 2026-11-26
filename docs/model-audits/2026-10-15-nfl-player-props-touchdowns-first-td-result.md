# NFL player props: touchdown count and first touchdown result

Date: 2026-10-15

Release: `nfl_player_props_touchdowns_first_td_tournament_2026_10_15_r1`

Production changes: none

## Player Touchdowns — reject candidate

The 2025 selection chose the Poisson HGB scoring-intensity model. On 1,084 eligible 2026 Weeks 2-5 player-games, it improved distributional fit and all four fixed threshold probabilities but worsened absolute count error.

| Metric | Foundation | Poisson HGB |
|---|---:|---:|
| MAE | **0.35541** | 0.37058 |
| RMSE | 0.53357 | **0.51664** |
| Mean Poisson deviance | 0.83443 | **0.73802** |
| Average threshold Brier | 0.05212 | **0.04942** |
| Threshold Brier wins | — | **4 of 4** |

The game-cluster bootstrap makes the tradeoff unambiguous. Candidate-minus-foundation MAE was +0.01521 (95% CI +0.00696 to +0.02410), while deviance was -0.09578 (-0.13756 to -0.05702) and Brier was -0.00269 (-0.00403 to -0.00122). Because the frozen gate required MAE improvement too, the candidate is rejected for Player Touchdowns. Better rare-event probabilities do not authorize silently worsening the requested count projection.

## First Touchdown — point improvement, insufficient promotion evidence

The same scoring intensities were normalized within each game. The remaining probability explicitly covers games where no eligible offensive player is the first touchdown scorer.

| 63 games / 1,084 player rows | Foundation | Poisson HGB |
|---|---:|---:|
| Positive first scorers represented | 56 | 56 |
| Brier | 0.04817 | **0.04751** |
| Log loss | 0.19493 | **0.18987** |

The point gate passes, but the uncertainty is not strong enough for promotion. The 63-game paired bootstrap Brier delta was -0.000686 (95% CI -0.001978 to +0.000703) and log-loss delta was -0.00521 (-0.01422 to +0.00365). Both intervals cross zero. The model also assigned about 98.6% total eligible-scorer probability per game while only 56 of 63 games had a represented eligible first scorer, so a separately predeclared game-level residual-mass calibration is required.

Decision: retain the coherent hazard architecture as a research starting point, but do not ship either output. Complete route/end-zone opportunity data, full historical eligible-offer coverage, and exact retained prices remain missing. No market line, price, consensus, or movement entered the independent model.

