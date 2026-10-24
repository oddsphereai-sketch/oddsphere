# NFL player props Longest Rush strict chronology result

Date: 2026-10-16

Release: `nfl_player_props_longest_rush_chronological_2026_10_16_r2`

Production changes: none

Training used 12,544 eligible rusher-games from 2017-2023. Selection on 1,890 eligible 2024 rusher-games across 272 games chose Ridge-log. After refitting through 2024, the model scored 1,844 eligible 2025 rusher-games across 272 games.

| 2025 metric | Independent foundation | Ridge-log | Change |
|---|---:|---:|---:|
| Mean projection (actual 11.283) | 12.563 | 8.955 | candidate bias **-2.327** |
| MAE | 8.1471 | **6.0812** | **-2.0659** |
| RMSE | 11.8592 | **10.6091** | **-1.2501** |
| Average threshold Brier | 0.15805 | **0.12340** | **-0.03464** |
| Threshold Brier wins | — | **5 of 5** | pass |

The 272-game paired bootstrap excluded zero for every primary delta: MAE -2.063 yards (95% interval -2.323 to -1.816), RMSE -1.247 (-1.582 to -0.931), and average Brier -0.03457 (-0.03922 to -0.03005).

All low/medium/high carry-volume segments improved MAE, RMSE, and average Brier. All three 2024-frozen prior explosive-rush-rate segments also improved all three. No segment approached the allowed 3% regression boundary. The already-inspected 2026 Weeks 2-5 result remained directionally consistent: MAE 7.297 to 5.330, RMSE 10.197 to 9.272, and average Brier 0.14831 to 0.11553. Its 63-game clustered intervals were below zero for all three deltas.

Do **not** advance Ridge-log under the frozen r2 gate. Its 2025 mean projection underpredicted the actual mean by 2.327 yards, failing the predeclared absolute-bias-below-2-yards requirement. The earlier r1 work had already opened 2025, so this result is also not epistemically untouched. Preserve it as a promising research candidate; do not recalibrate it on 2025 or change the gate after seeing the result.

The exact next blocker is a newly declared prospective window that can test the underprojection without tuning, joined to a release-pure exact Longest Rush offer/price ledger. Production remains unauthorized.
