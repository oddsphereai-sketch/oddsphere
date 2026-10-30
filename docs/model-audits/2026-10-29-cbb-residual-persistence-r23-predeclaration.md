# Private CBB r23 team-score residual persistence: predeclaration

This is a diagnostic of whether the independent r2 score model underreacts to
recent team-specific scoring misses. It cannot activate CBB or change the
production model, grades, stakes, reader, writer, cron, member scores, or
locked records. Both 2024 and 2025 are already opened; any apparent gain is
exploratory, not untouched validation.

Use the same exact 2024 r2 selection rows from a 2023-fitted correction and
the frozen 2025 r2 diagnostic rows from a 2023–24-fitted correction. For each
team entering a game, form one pregame signal: the arithmetic mean of its last
three *team-score* residuals, `actual points − forecast points`, from the
same season. A prior game qualifies only when its start plus six hours is at
or before the current row's forecast `asOf`; no same-day result enters. With
no prior eligible game, the signal is zero. Prior residuals are computed from
the contemporaneous frozen r2 forecast, not from a retrospectively refitted
version. Do not filter difficult games or change score targets.

Fit one shared coefficient on 2024 team-game rows by squared-error regression
of current team-score residual on the pregame signal with fixed L2 penalty
10,000. Apply that single fitted coefficient to *both* home and away projected
scores in 2025. Recompute margin, Total and home-win probability from the two
new scores with the same uncertainty; never adjust each market separately.
Report 2024 residual correlation and coefficient, 2025 coverage, paired
winner corrections/harms, winner count, margin and Total MAE, team-score MAE,
Brier and log loss. No coefficient grid or post-result retuning is allowed.

If this does not show a substantial, coherent 2025 gain, reject this
underreaction hypothesis. If it does, it remains a hypothesis requiring a
new immutable release, future chronological test, exact-quote
Moneyline/Spread/Total decisions, play-grade board impact, and full
model-change safety verification before any activation. The audit must use a
clean committed source SHA and source-file hash receipts, and write only a
local private report.
