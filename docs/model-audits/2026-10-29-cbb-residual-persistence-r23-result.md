# Private CBB r23 recent score-error persistence: result

Decision: **reject the recent-residual correction**. This test was declared in
`2026-10-29-cbb-residual-persistence-r23-predeclaration.md` before fitting.
It changes no active or unpublished r2 model behavior and no production
scores, picks, grades, stakes, reader, writer, cron, or locked records.

The question was whether a team that repeatedly scored above or below its
r2 forecast would tend to do so again—evidence that the model was adapting
too slowly. For each game we used only a team's last three same-season
team-score errors from games whose start plus six hours preceded the forecast
as-of. No current-game result or same-day outcome entered. The single shared
coefficient was fitted on 2024 and then applied, without retuning, to the
already-opened 2025 r2 diagnostic. Both team scores were adjusted by the same
rule; margin, Total and winner probability were derived from those two scores.

| 2025 diagnostic, 5,721 games | R2 baseline | Recent-residual correction |
| --- | ---: | ---: |
| Outright winners | **4,112** | 4,105 |
| Margin MAE | 9.27887 | 9.27107 |
| Total MAE | **13.63783** | 13.64174 |
| Team-score MAE | 8.29945 | 8.29909 |
| Brier | 0.180016 | 0.179931 |
| Log loss | 0.530108 | 0.529923 |

The 2024 training correlation between the prior-three residual signal and
the next team-score residual was **−0.0097**, effectively zero. The fitted
coefficient was only −0.0157. In 2025 it corrected nine previous winner
errors but harmed sixteen previously correct winners (net seven fewer).
The tiny improvements in margin and Brier do not compensate for worse Total
MAE and winner correctness. A stronger reaction to recent misses is not
supported by this test.

The signal was observable for 11,056 of 11,420 2024 team-game rows and
11,075 of 11,442 2025 team-game rows; zero was used at season start. All
5,721 2025 games remain in the evaluation, including 66 incomplete-input
forecasts. The private report at
`/private/tmp/oddsphere-cbb-data/residual-persistence-r23-report.json`
records source hashes, a clean source commit and zero production writes.
The cached 2023/24 feature hashes are cross-checked against the clean r22
source-generation audit. The 2025 row-level feature-generation parity is not
separately proven here; the r2 aggregate exactly reproduces its frozen result.

This rejects only the *specific* last-three-score-error signal. It does not
prove that roster availability, tactical changes, opponent matchups, or
other pregame information are uninformative. Both 2024 and 2025 were already
opened, so even a favorable result would require new chronological evidence
and exact-line Moneyline/Spread/Total checks before any release proposal.
