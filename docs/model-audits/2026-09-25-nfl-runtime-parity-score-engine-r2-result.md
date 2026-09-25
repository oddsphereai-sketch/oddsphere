# NFL runtime-parity score engine r2 result

Date: 2026-09-25

Tournament: `nfl_runtime_parity_score_engine_tournament_2026_09_25_r2`

Decision: rejected; research/shadow only; production unchanged

The runtime-parity model used 125 pre-week features restricted to points,
plays, sacks, turnovers, red-zone rate, Elo, rest, injuries, continuity,
venue, and weather. Selection chose ridge regression, 100% market margin, and
90% market total. A recipe that selects zero independent margin influence is
not an independent matchup-engine improvement.

On the already-open 2024-2025 development replay:

| Metric | Candidate | Market | Result |
| --- | ---: | ---: | --- |
| Team-score MAE | 7.1653 | 7.1613 | Worse |
| Margin MAE | 9.6664 | 9.6664 | Identical; zero independent weight |
| Total MAE | 10.0827 | 10.0616 | Worse |
| ML direction | 68.32% | 68.32% | Identical |
| Spread direction | no independent call | n/a | Fail |
| Total direction | 45.66% | n/a | Fail |
| ML Brier | 0.20702 | 0.20614 | Worse |
| Spread Brier | 0.25000 | 0.25033 | Better only because it is neutral |
| Total Brier | 0.25069 | 0.25009 | Worse |

All substantive shadow gates failed. The result rejects feeding season-average
runtime box-score state into another direct score regression. The next engine
candidate must model possessions and scoring efficiency explicitly rather than
use another small residual or score-level correction.
