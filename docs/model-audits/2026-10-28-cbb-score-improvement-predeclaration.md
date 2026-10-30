# CBB private score-error improvement research

Owner targets: Total MAE below 10 points and margin MAE below 6 if achievable, while preserving
useful winner accuracy and one logical forecast. Remains private and unmerged in draft #851.
Starting remote main is `3e64ed8372d9b70d18254a57479bc1dcbda42040`; task-owned head is
`ef6cabcbfda0961b03435ea25dd8b706e4678617`. R1 artifacts remain immutable baselines.

2025 has already been opened. It is now an opened diagnostic confirmation, never a newly
untouched test. New numerical choices use 2023 development and 2024 selection only. Report all
tried candidates and the full same-game cohort, not a cherry-picked low-error subset.

First diagnose bias, excessive score/pace compression, overtime, early-season versus mature
state, close games and mismatches. Postgame actual pace/efficiency substitutions are oracles
for diagnosis only: never eligible runtime features or accuracy claims.

Predeclare a regularization tournament: offense/defense penalties 1, 3, 6 and baseline 10;
tempo penalties 0.25, 1, 3 and baseline 10; current-season prior carry 0.5 and 0.8, 90-day
recency. The tempo penalty needs its own units because the two-team tempo coefficients are
halves. Test a small frozen subset after diagnosis rather than select on 2025.
Predeclare a development-trained affine score correction and a matchup-feature residual head
using prior-game Four Factors, tempo and rest. Select on 2024 MAE across both heads, while
checking winner accuracy, Brier/log loss and monthly stability. No future roster membership,
final-season averages, actual current-game box scores or fictional intraday market history.

Before opening any new r2 2025 result, also predeclare two shallow absolute-error gradient
boosting heads on the selected regularization state's features: depth 2 / 80 rounds / 0.05
learning rate and depth 3 / 100 rounds / 0.03 learning rate; minimum leaf 100, 16 bins.
Fit on 2023, select on 2024. Their residual leaves use medians because the owner's primary
error target is MAE. They receive no market or future labels. Retain every result, including
rejected tree heads; no further complexity is chosen after seeing their 2025 diagnostic.

Research references:
- https://kenpom.com/blog/ratings-methodology-update/ — additive offense/defense, schedule
  strength, contemporaneous league environment and mismatch calibration.
- https://adamcwisports.blogspot.com/p/every-possession-counts.html — opponent/venue-adjusted
  efficiency, tempo, prior phaseout and garbage-time considerations.
- https://supermariogiacomazzo.github.io/sports-analytics-intelligence-laboratory/projects/Yunus_Poster_2026.pdf
  — rolling matchup/context features; its 9.42 margin MAE is a different-cohort reference,
  not a direct benchmark or a lower bound for our model.

If a candidate qualifies, freeze a distinct r2 artifact/release and paired diagnostics. No
activation, grades, stakes, writer, lock, cron, reader, UI redesign or shared market contract
change. A market-informed improvement may be claimed only with actual pregame timestamped
evidence; source adapters and current quotes alone do not establish historical improvement.
