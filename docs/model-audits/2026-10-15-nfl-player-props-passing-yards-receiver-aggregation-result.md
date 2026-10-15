# NFL Player Props Passing Yards receiver-aggregation result

Date: 2026-10-15
Status: rejected on current-season offered replay; research only

## Decision

Reject the frozen 25% bottom-up receiver-room blend. It improved both chronological historical
windows, but it worsened both point metrics on the exact 16 offered 2026 thresholds and did not
improve direction. Production remains on the released independent completions × shifted
yards-per-completion head.

## Results

| Window | Rows | Incumbent MAE / RMSE | 25% receiver blend MAE / RMSE |
| --- | ---: | ---: | ---: |
| 2024 selection | 464 | 59.8092 / 76.3660 | **59.7195 / 76.0697** |
| 2025 confirmation | 490 | 57.3374 / 73.6645 | **57.1008 / 73.3007** |
| 2026 offered replay | 16 | **66.4321 / 88.8483** | 66.8013 / 88.9759 |

Threshold direction remains 43.75% for both current-season heads. The 10-game clustered
candidate-minus-incumbent MAE interval is `[-0.7075, 1.3858]` yards with a harmful median of
`+0.3660`; the candidate is not stable enough to advance.

## Interpretation

Bottom-up RB/FB/WR/TE aggregation does carry incremental historical signal, so receiver skill,
depth, target allocation, and position-matchup information are not irrelevant. But the gain is
small and does not resolve current game-script and quarterback-volume errors. Week 2 remains heavily
overpredicted because of partial-role/low-volume games, while Weeks 3 and 5 are underpredicted in
high-volume games. Receiver efficiency cannot repair an unidentified attempt/completion path.

This also answers the matchup question narrowly: aggregated receiver/opponent position context is
already present and was tested as a structural alternate head; it did not pass the current-season
release gate. The result does not justify inventing unavailable route-level WR/CB assignments.

## Safety and reproducibility

The script is
`scripts/operator/tournament_nfl_player_props_passing_yards_receiver_aggregation.py`. Its ignored
artifacts record the exact 16 offer-scoped thresholds, including alternate lines for the same
player-game, source checksums, and injury coverage. No market feature entered the candidate.
Production releases, the sole writer/lease, member rows, tracking, and every locked payload remain
unchanged.
