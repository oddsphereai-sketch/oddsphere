# NFL player props kicking strict chronology result

Date: 2026-10-16

Release: `nfl_player_props_kicking_chronological_2026_10_16_r2`

Production changes: none

Training used 3,783 eligible kicker-games from 2017-2023. Separate component selection on 561 eligible 2024 kicker-games chose the regularized Poisson GLM for both Field Goals Made and PATs Made. After refitting through 2024, the components scored 562 eligible 2025 kicker-games across 285 games.

## Field Goals Made

| 2025 metric | Independent foundation | Selected FG component | Change |
|---|---:|---:|---:|
| Mean projection (actual 1.721) | 1.711 | 1.651 | candidate bias -0.070 |
| MAE | 1.03294 | **1.00055** | **-0.03240** |
| Mean Poisson deviance | 1.13464 | **1.04731** | **-0.08732** |
| Average threshold Brier | 0.16906 | **0.16112** | **-0.00795** |
| Threshold Brier wins | — | **4 of 4** | pass |

The 285-game paired bootstrap excluded zero for Poisson deviance (-0.08768; 95% interval -0.14188 to -0.03203) and average Brier (-0.00795; -0.01286 to -0.00269). The MAE delta was directionally favorable but its interval ended just above zero (-0.03240; -0.06315 to **+0.00020**).

Field Goals Made therefore **fails** the frozen r2 gate. It improved all three primary metrics in every low/medium/high scoring-opportunity tier and in the controlled, outdoor-mild, and outdoor-adverse diagnostics, but the declaration required all three clustered intervals below zero. Preserve the GLM as a promising candidate; do not relax the interval rule after seeing this result.

## Kicking Points

| 2025 metric | Component foundation | Selected FG + PAT components | Change |
|---|---:|---:|---:|
| Mean projection (actual 7.393) | 7.386 | 7.168 | candidate bias -0.225 |
| MAE | 3.10679 | **2.98191** | **-0.12487** |
| RMSE | 3.90752 | **3.73810** | **-0.16942** |
| Average threshold Brier | 0.22779 | **0.21934** | **-0.00845** |
| Threshold Brier wins | — | **6 of 6** | pass |

The 285-game paired bootstrap excluded zero for every primary delta: MAE -0.12552 (95% interval -0.21738 to -0.02854), RMSE -0.17074 (-0.27676 to -0.06003), and average Brier -0.00848 (-0.01514 to -0.00185). Every low/medium/high scoring-opportunity tier improved all three metrics. Controlled, outdoor-mild, and outdoor-adverse diagnostics also improved all three primary metrics.

Kicking Points **passes** every frozen retrospective r2 gate. The already-inspected 2026 Weeks 2-5 result remained consistent: MAE 3.293 to 2.985, RMSE 3.960 to 3.586, and average Brier 0.24803 to 0.22483; all three 63-game clustered intervals were below zero.

Retain the decomposed GLM components as the Kicking Points research foundation. Do not authorize production. The earlier r1 work had already opened 2025, so neither result is epistemically untouched. The next blockers are newly declared prospective outcomes, exact kicking settlement semantics, and release-pure Field Goals Made and Kicking Points books, alternate lines, both side prices, and provider timestamps.
