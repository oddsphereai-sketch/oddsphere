# NFL player props Receiving Yards recent-workload result

Date: 2026-10-15
Status: rejected at the frozen 2024 selection gate; no production change

## Decision

Retain the released independent Receiving Yards model. None of the six predeclared recent-workload
candidates improved both MAE and RMSE against the exact released Receiving Yards head on the 3,538
row 2024 selection set. The tournament therefore froze no candidate and did not open 2025
confirmation or the immutable 2026 offered-scope replay.

This is an independent-model result. The candidate and control use no sportsbook line, price,
consensus, movement, or market-derived feature.

## Exact control

The parity-correct incumbent is the active historical Receiving Yards head: for wide receivers,
50% expected-role foundation projection plus 50% direct Receiving Yards component; for other
receivers, the expected-role foundation projection. An initial local diagnostic compared against
the older foundation-only point and was discarded before this result because that was not the
released incumbent.

| 2024 selection | Rows | MAE | RMSE | Bias |
|---|---:|---:|---:|---:|
| Released incumbent | 3,538 | 19.7964 | **27.2979** | -2.5177 |
| `balanced_blend_25` | 3,538 | **19.7055** | 27.4907 | -4.0148 |
| `availability_blend_25` | 3,538 | 19.7068 | 27.4243 | -3.7800 |
| `short_blend_25` | 3,538 | 19.7137 | 27.4915 | -3.9812 |
| `availability_blend_50` | 3,538 | 19.7349 | 27.7319 | -5.0423 |
| `balanced_blend_50` | 3,538 | 19.7539 | 27.8746 | -5.5119 |
| `short_blend_50` | 3,538 | 19.7756 | 27.8813 | -5.4447 |

All six candidates reduced average absolute error, but every candidate increased RMSE and made the
negative bias worse. That shape says the recent-workload construction shrinks many ordinary misses
while creating or amplifying costly tail misses. It is not safe to advance under the predeclared
dual-error gate.

## Gate state

- `selectionEligible`: empty
- `frozenCandidate`: null
- `confirmationControl`: null
- `confirmationPass`: false
- `currentOpened`: false
- probability/actionability audit: not opened, because the point candidate did not qualify
- live model, calibration, decisions, grades, stakes, and locked records: unchanged

## Reproduction

```bash
football-research/cache/nfl-model-env/bin/python \
  scripts/operator/tournament_nfl_player_props_receiving_yards_recent_workload.py
```

The machine-readable result and row audit are written to the ignored research cache as
`nfl_player_props_receiving_yards_recent_workload_r1.json` and
`nfl_player_props_receiving_yards_recent_workload_rows_r1.parquet`.

## Product conclusion

Do not blend this workload estimate into the projection. Continue to show market movement as a
separate decision-support signal, consistent with the complete family audit. For Receiving Yards,
the next independent challenger needs a tail-aware target distribution or a route/coverage-level
input that adds information beyond shifted team targets and target share; another coefficient on
this same workload estimate is not justified by these results.

This supplements
[`2026-10-15-nfl-player-props-family-continuation-result.md`](./2026-10-15-nfl-player-props-family-continuation-result.md),
which already records explicit retain/reject decisions for all eight supported prop families.
