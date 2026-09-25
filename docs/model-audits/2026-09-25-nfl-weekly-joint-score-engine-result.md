# NFL weekly joint-score engine r1 result

Date: 2026-09-25

Tournament: `nfl_weekly_joint_score_engine_tournament_2026_09_25_r1`

Decision: rejected; research only; production unchanged

The orientation-symmetric team-score model selected ridge regression with 10%
independent matchup weight and 90% market weight on the frozen 2023 selection
season. The independent forecast was materially weaker than market. On the
untouched 2024-2025 confirmation, the calibrated candidate produced:

| Metric | Candidate | Market | Gate |
| --- | ---: | ---: | --- |
| Team-score MAE | 7.1633 | 7.1613 | Fail |
| Margin MAE | 9.6652 | 9.6664 | Pass by 0.0012 |
| Total MAE | 10.0716 | 10.0616 | Fail |
| ML direction | 68.32% | 68.32% | Pass/non-regression |
| Spread direction | 51.21% | n/a | Pass |
| Total direction | 50.09% | n/a | Pass |
| ML Brier | 0.20696 | 0.20614 | Fail |
| Spread Brier | 0.24986 | 0.25033 | Pass |
| Total Brier | 0.25036 | 0.25009 | Fail |

The two-point action lane was +8.06 units for spreads but -0.86 units for
totals. Spread ROI was -9.29% in 2025 and total ROI was -12.48% in 2024, so the
year-stability gate also failed. The candidate cannot be promoted.

This result confirms that pairing two direct score regressions is not enough.
It also confirms that a tiny margin-MAE win cannot justify a release when team
scores, totals, probability calibration, and action stability regress.
