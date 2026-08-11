# MLB player props row-scoped research holds — r24

Date: 2026-08-11

## Scope

- Sport: MLB
- Market family: all supported player props
- Candidate release: `mlb_props_2026_08_11_r24`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through `refreshMlbPropsBoard`
- Lease: MLB-scoped shared `prediction_pipeline`
- Reader: existing MLB props snapshot/member readers

## Incident

The August 11 board had complete provider and price coverage but did not
publish. The canonical dry-run produced 5,821 member rows, 23,433 mapped price
rows, zero stale odds, and 103 complete actionable rows. Publication was
blocked because 403 other rows carried missing research:

- 370 rows lacked an announced opposing starter and therefore pitch-mix evidence.
- 33 additional rows lacked a sufficiently usable pitch-mix join.
- All 403 were already fail-closed: 310 `PENDING_DATA` and 93 `RESEARCH`.
- No incomplete row carried units or an actionable grade.

The former validator treated any missing row as a board-wide error, so a data
hold in two games hid complete rows from the other thirteen games.

## r24 contract

Missing required research is allowed only when the row is visibly held as
`PENDING_DATA` or `RESEARCH`. The snapshot carries
`REQUIRED_RESEARCH_HELD_ROWS_<count>` as a warning. Any incomplete row stamped
No Play, Watchlist, Lean, or Best Angle remains a blocking
`REQUIRED_RESEARCH_INCOMPLETE_<count>` error. Existing stale-odds, invalid
price, mapping, payload-size, and actionable-data gates are unchanged.

## Paired board impact

| Measure | r23 validator | r24 validator |
|---|---:|---:|
| Source rows | 23,433 | 23,433 |
| Member rows | 5,821 | 5,821 |
| Complete actionable rows | 103 | 103 |
| Incomplete rows promoted | 0 | 0 |
| Complete rows demoted | 0 | 0 |
| Net actionable change | 0 | 0 |
| Stale odds | 0 | 0 |
| Snapshot publishable | No | Yes |

This is an availability correction, not a probability, projection, grade,
stake, or side change. It pairs the removal of a board-wide demotion (the
entire coherent slate being withheld) with explicit row-level holds; it does
not manufacture replacement actions.

## Required verification

- `npm run verify:model-change`
- `npm run test:mlb-props-launch`
- Non-persisting r24 full-slate rebuild
- Confirm every incomplete row is `PENDING_DATA` or `RESEARCH`
- Confirm zero incomplete actionable rows and zero stale displayed odds
- After deployment, verify the live r24 release stamp, cron lease, snapshot
  freshness, member reader, tracking lock behavior, and the next fast refresh
