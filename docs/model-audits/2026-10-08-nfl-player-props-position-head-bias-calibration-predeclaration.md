# NFL player props position-head bias calibration predeclaration

## Trigger

The position-matchup candidate produced material, statistically clear MAE gains for Passing Yards,
Rushing Yards, and Receiving Yards. Rushing and Receiving Yards improved all four 2025 chronological
segments, but the selected absolute-loss heads failed the frozen bias/underprediction gate because
their conditional-median objective shifted the point center downward.

## Frozen repair

For each model fit and evaluation season, calculate the fitted model's mean residual on its training
rows only and add that one scalar to its future predictions before applying the already-declared
25%, 50%, 75%, or 100% blend. Test calibrated and uncalibrated versions of the same three model
families. The correction cannot use selection-, confirmation-, or holdout-season outcomes.

No feature, eligibility rule, model hyperparameter, market input, settlement cohort, or acceptance
gate changes. Lines and prices remain absent. Selection remains 2023, confirmation remains 2024,
and 2025 remains unopened until the calibrated candidate name and blend are frozen.

The candidate must still improve MAE and RMSE, clear clustered uncertainty, improve all four
segments, avoid the original bias and underprediction regression, and pass CRPS/NLL/coverage gates.
This is point-center calibration, not permission to relax the bias gate.
