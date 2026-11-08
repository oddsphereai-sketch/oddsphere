# NFL player props Longest Reception strict chronology result

Date: 2026-10-16

Release: `nfl_player_props_longest_reception_chronological_2026_10_16_r2`

Production changes: none

Training used 24,634 eligible receiver-games from 2017-2023. Selection on 3,500 eligible 2024 receiver-games across 272 games chose HGB-log. After refitting through 2024, the model scored 3,456 eligible 2025 receiver-games across 272 games.

| 2025 metric | Independent foundation | HGB-log | Change |
|---|---:|---:|---:|
| Mean projection (actual 15.110) | 18.119 | 12.680 | candidate bias **-2.430** |
| MAE | 10.9748 | **7.0808** | **-3.8939** |
| RMSE | 13.9087 | **11.1025** | **-2.8062** |
| Average threshold Brier | 0.18801 | **0.13473** | **-0.05328** |
| Threshold Brier wins | — | **5 of 5** | pass |

The 272-game paired bootstrap excluded zero for every primary delta: MAE -3.893 yards (95% interval -4.148 to -3.649), RMSE -2.809 (-3.069 to -2.546), and average Brier -0.05330 (-0.05668 to -0.04993).

All low/medium/high target-volume segments improved MAE, RMSE, and average Brier. All three 2024-frozen prior explosive-reception segments also improved all three. No segment approached the allowed 3% regression boundary. The already-inspected 2026 Weeks 2-5 result remained directionally consistent: MAE 11.345 to 7.523, RMSE 14.309 to 11.894, and average Brier 0.18852 to 0.13888. Its 63-game clustered intervals were also below zero for all three deltas.

Do **not** advance HGB-log under the frozen r2 gate. Its 2025 mean projection underpredicted the actual mean by 2.430 yards, failing the predeclared absolute-bias-below-2-yards requirement. The earlier r1 work had already opened 2025, so this result is also not epistemically untouched. Preserve it as a promising research candidate; do not recalibrate it on 2025 or change the gate after seeing the result.

The exact next blocker is a newly declared prospective window that can test the underprojection without tuning, joined to a release-pure exact Longest Reception offer/price ledger. Production remains unauthorized.
