# NFL player props Longest Pass strict chronology result

Date: 2026-10-16

Release: `nfl_player_props_longest_pass_chronological_2026_10_16_r2`

Production changes: none

Training used 2017-2023. Selection on 597 eligible 2024 quarterback-games chose HGB-log again. After refitting through 2024, the model scored 602 eligible 2025 quarterback-games across 271 games.

| 2025 metric | Independent foundation | HGB-log | Change |
|---|---:|---:|---:|
| Mean projection (actual 32.767) | 35.338 | 31.103 | candidate bias -1.665 |
| MAE | 13.3084 | **10.0364** | **-3.2720** |
| RMSE | 16.9443 | **13.7021** | **-3.2422** |
| Average threshold Brier | 0.21984 | **0.18702** | **-0.03283** |
| Threshold Brier wins | — | **5 of 5** | pass |

The 271-game paired bootstrap excluded zero for every primary delta: MAE -3.263 yards (95% interval -4.038 to -2.457), RMSE -3.240 (-4.139 to -2.341), and average Brier -0.03271 (-0.04072 to -0.02406).

All low/medium/high pass-volume segments improved MAE, RMSE, and average Brier. All three 2024-frozen explosive-rate segments also improved all three. No segment approached the allowed 3% regression boundary. The expanding-window 2026 Weeks 2-5 result remained consistent: MAE 13.297 to 10.576, RMSE 17.097 to 14.343, Brier 0.22465 to 0.19760, with all game-clustered intervals below zero.

Retain HGB-log as the independent Longest Pass research foundation. Do not authorize production. The earlier r1 work already opened 2025, so this calendar-ordered confirmation is not epistemically untouched. The exact next blocker is prospective post-declaration outcomes joined to release-pure Longest Pass books, alternate lines, both side prices, and provider timestamps.
