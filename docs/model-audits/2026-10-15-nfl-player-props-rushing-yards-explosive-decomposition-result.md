# NFL player props Rushing Yards explosive decomposition result

Date: 2026-10-15
Decision: reject; retain the released independent Rushing Yards head

The ordinary-rush plus explosive-rush decomposition improves RMSE but worsens MAE, so no identity
passes 2024 selection. ID-backed public play by play covers `97.31%` of player-game rushing rows;
unmatched rows were excluded rather than joined by name.

The closest 25% identity moves 2024 MAE/RMSE from `18.58703/26.48103` to
`18.65236/26.38758`. On 2025 it similarly moves `18.06505/26.91924` to
`18.12286/26.87407`. The architecture reduces large tail errors but pays for that with worse typical
absolute error. Because point selection requires both, chronology stops before the current challenger
gate.

The released exact-current head remains `16.35322` MAE, `22.78103` RMSE, and `43.33%`
offered-line direction over 30 stored offered scopes. No production release, projection,
probability, grade, stake, writer, lease, or locked record changes. Board impact is zero.
