# NFL Player Props Passing Attempts game-state qualification result

Date: 2026-10-15
Status: rejected; research only; simulation not authorized

## Decision

Reject the independent score-state input and stop this branch before game-path simulation. The
candidate confirmed on the 2024/2025 historical selection windows, but it failed the predeclared
2026 lead-passer point gate and did not improve the small offered replay consistently. It therefore
does not change any production projection, probability, grade, stake, or locked record.

The rejected candidate used an expanding-window, market-free team scoring model to add predicted
points, opponent points, margin, and total to a direct team-attempt model, then allocated attempts
to the expected lead passer. It consumed no sportsbook spread, total, line, or price.

## Chronological results

| Window | Rows | Incumbent MAE / RMSE | Frozen 25% blend MAE / RMSE | Result |
| --- | ---: | ---: | ---: | --- |
| 2024 selection | 464 | 6.7247 / 8.9557 | 6.7084 / 8.9359 | selected |
| 2025 confirmation | 490 | 6.8564 / 8.6838 | 6.8289 / 8.6664 | confirmed |
| 2026 lead passers, Weeks 1-5 | 158 | 6.2684 / 8.2321 | 6.2877 / 8.2528 | failed |
| 2026 offered replay | 16 | 8.9446 / 11.2646 | 8.9068 / 11.3355 | mixed; RMSE worse |

The 2026 lead-passer candidate was worse in Weeks 1-3, slightly better in Weeks 4-5, and worse in
aggregate. Because the predeclaration required improvement in both current-season MAE and RMSE,
`stateInputPointGatePassed` and `simulationAuthorizedForNextStage` are both false.

## Interpretation

Pregame score-state estimates built from the available independent team features do not add enough
game-specific information beyond the released independent head. The small improvement on earlier
seasons does not survive the current-season replay. Building a larger simulation on top of this
unqualified state input would add machinery without fixing the identified error.

The remaining Passing Attempts miss is concentrated in role realization: whether the expected
starter plays a full game, is injured, benched, replaced, or shares attempts. The next materially
different candidate should therefore model full-game starter survival and partial-game exposure as
a hurdle/mixture distribution. Postgame lead-passer identity may be used only to score the replay,
never as a pregame feature.

## Reproducibility and safety

The research script is
`scripts/operator/tournament_nfl_player_props_passing_attempts_game_state.py`. Its ignored result
artifact is
`football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_attempts_game_state_r1.json`.
The artifact records source checksums and `marketFeatures: []`. Production releases, the sole
writer and lease, member rows, tracking, and every locked payload remain unchanged.
