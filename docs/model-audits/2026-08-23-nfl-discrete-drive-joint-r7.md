# NFL discrete drive joint r7 audit

Date: 2026-08-23

Status: rejected after frozen confirmation; no production behavior changed.

The r7 operator reconstructed all 1,906 training games from the official
play-by-play score path and selected the neutral shared-environment state on
2023. The candidate produced a coherent, football-reachable Week 1 score PMF:
modal team-score SD 2.936, margin SD 4.755, total SD 3.160, six Over and ten
Under directions. The displayed score range was 10–27 by team, -7 to +17 by
margin, and 27–40 by total.

All frozen proper-score, moneyline, calibration, margin-coverage, and 2025
total-coverage gates passed. The candidate failed only the predeclared 2024
total 80% interval gate: 240/272 games were covered (88.235%), above the 88%
ceiling. This failure is not rounded away. r7 is not qualified and is not
published.

The ignored deterministic report is
`football-research/reports/nfl_discrete_drive_joint_2026_08_23_r7.json`.
