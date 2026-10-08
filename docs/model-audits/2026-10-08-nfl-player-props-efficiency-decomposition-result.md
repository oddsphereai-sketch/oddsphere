# NFL player props efficiency-decomposition result

Date: 2026-10-08  
Decision: retain the complete r1 expected-role foundation

Exposure weighting selected and confirmed historically for Passing Completions. Its 2025 MAE moved
from `4.65620` to `4.62113` and RMSE from `5.99747` to `5.97315`. The remaining markets inherited
the r1 foundation: their challengers either did not improve both 2024 selection metrics or failed
2025 confirmation. Decomposed Receiving Yards reduced 2025 bias from `-2.12257` to `-1.98992` but
worsened MAE and RMSE, so it was rejected.

On all 207 exact 2026 locked scopes, the frozen Passing Completions challenger improved its market
MAE by `0.06252` and RMSE by `0.01643`, with unchanged direction. Its Brier score worsened by
`0.00152`. Overall MAE improved only `0.00181` and overall Brier worsened `0.00004`.

The predeclared cumulative gate requires point and probability quality not to regress. Therefore no
r2 efficiency head advances, no production release is proposed, and the complete
`nfl_player_props_expected_role_system_2026_10_08_r1` system remains the independent research
foundation. Coverage remained 207/207; no line, price, side, or current-game outcome entered the
candidate.

