# NFL team-score residual forecast result

Date: 2026-09-21

Tournament: `nfl_team_score_residual_tournament_2026_09_21_r1`

Decision: rejected; research only; no production behavior changed

The shared home/away team-score construction produced no qualifying recipe on
the 2022-2023 selection set.  Its conservative fallback recipe was nevertheless
opened once on 2024-2025 as declared.

| Market | Metric | Market | Candidate | Result |
| --- | ---: | ---: | ---: | --- |
| Spread | MAE | 9.666360 | 9.662760 | Improved by 0.003600 |
| Spread | Brier | 0.250325 | 0.250109 | Improved by 0.000216 |
| Total | MAE | 10.061581 | 10.076467 | Worse by 0.014886 |
| Total | Brier | 0.250094 | 0.250242 | Worse by 0.000147 |

Spread corrections averaged only 0.1419 points and generated two actions at
the fixed two-point edge threshold, going 1-1.  Total corrections averaged
0.2046 points, had 48.98% direction accuracy, and generated no actions.  Total
was worse on both MAE and Brier in both confirmation seasons.  The shared score
recipe therefore failed the joint gate and is not eligible for production.

The result rejects a direct implementation of independently correcting both
team scores around market-implied team totals.  It does not justify increasing
the incumbent independent weight or changing live sides, grades, or stakes.

