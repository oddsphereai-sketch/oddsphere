# MLB props r40 missing-comparator publication gate

Status: qualified production repair pending protected publication.

## Incident and boundary

The first natural r39 cycle started at `2026-09-02T21:17:20.939Z`, completed at
`2026-09-02T21:17:42.214Z`, made the normal 28 provider calls, and wrote zero rows. The complete r39
board failed `ACTIONABLE_ROWS_FAILED_DATA_GATE`, so the writer correctly preserved the r38
last-known-good snapshot. No r39 snapshot became authoritative.

The r39 forecast removed the evaluated sportsbook from every forecast layer and intentionally made a
missing target-excluded comparator neutral. Its downstream grade policies may still qualify an
independent player-distribution forecast at an exact evaluated price. The older publication gate,
however, rejected every actionable row whose comparator-derived `modelEdge` was null. That required
the missing comparator to exist after the forecast correctly excluded the target, making the release
unpublishable whenever a legitimate independent-only exact-price action was present.

R40 changes only that predicate. If a target-excluded `marketProbability` exists, `modelEdge` remains
required. If it does not exist, both fields remain null and neutral; the independent forecast plus the
exact evaluated price must still pass the existing category grade policy, EV, signal-eligible price,
research, freshness, odds-sanity, projection-side, and health gates. No target quote becomes a
forecast reference or a synthetic market edge. Forecast coefficients, distributions, projections,
probabilities, sides, category policies/caps, grades, prices, stakes, provider calls, query/write
counts, lock behavior, writer, cron, lease, member DTO, and UI are unchanged from r39.

Release: `mlb_props_2026_09_02_r40`. The market-aware context release remains
`mlb_props_market_aware_context_2026_09_02_r2_target_excluded_forecast`.

## Frozen latest-board replay

The SELECT-only replay used r38 snapshot `1e8bddab-4b37-4351-b627-7b0f5492de3e` at
`2026-09-02T20:47:20.506Z`: 5,269 rows, 4,815 measurable, two SELECTs, zero provider calls, and zero
writes. R40 is row-identical to r39; relative to r38 it changes 4,521 projections, 4,704
probabilities, and 209 forecast sides. It yields 23 Best Angles / 82 Leans / 1,450 Watchlists /
1,923 No Plays / 1,468 Research / 323 Pending Data, or 105 actionables versus 126. There are four
promotions and 25 demotions. No actionable crossing lacks the exact complementary same-book,
same-line, same-cycle quote, no actionable row has a projection/side contradiction, and locked rows
remain unchanged (zero are present in this slate snapshot).

Target-excluded breadth across exact evaluated quotes is 1,789 / 1,986 / 624 / 207 for zero / one /
two / three-plus alternatives. The corresponding minimum identity breadth is 1,789 / 925 / 264 /
159. Evaluated-offer forecast references remain zero; verified split adjustments remain absent and
neutral. Forty-five candidate actionables have no target-excluded comparator. They retain a null
`marketProbability` and null `modelEdge`; their independent distribution and exact-price EV remain
separate. R40 creates zero forecasts, sides, grades, promotions, demotions, or stakes relative to r39.

| Category | Rows | Candidate actionables | Promotions / demotions |
| --- | ---: | ---: | ---: |
| Pitcher strikeouts | 40 | 3 | 0 / 1 |
| Pitcher outs | 43 | 1 | 0 / 0 |
| Pitcher hits allowed | 40 | 0 | 0 / 0 |
| Pitcher walks | 40 | 0 | 0 / 0 |
| Pitcher earned runs | 40 | 0 | 0 / 0 |
| Batter strikeouts | 246 | 28 | 0 / 0 |
| Batter hits | 508 | 5 | 2 / 11 |
| Total bases | 468 | 0 | 0 / 0 |
| Home runs | 273 | 3 | 0 / 0 |
| RBIs | 499 | 1 | 1 / 1 |
| Runs | 501 | 9 | 0 / 2 |
| Hits + runs + RBIs | 504 | 2 | 0 / 1 |
| Singles | 499 | 30 | 0 / 8 |
| Doubles | 489 | 10 | 1 / 0 |
| Triples | 245 | 0 | 0 / 0 |
| Batter walks | 488 | 13 | 0 / 1 |
| Stolen bases | 346 | 0 | 0 / 0 |

The no-flat rule is evaluated against r39 behavior: r40 changes no row and cannot flatten a category.
Zero-action categories were already zero under r38/r39 and retain their supported Watchlist/No Play
coverage rather than being suppressed.

## Automatic safety and rollback

Natural writer telemetry reports the runtime and snapshot releases, publication disposition,
target-excluded reference and independent-fallback rows, actionables without a comparator,
actionable data-gate failures, projection-side action conflicts, and locks. A failed cycle writes no
snapshot and preserves the prior canonical/member last-known-good row. R40 uses the existing sole
`/api/cron/mlb-player-props-refresh` writer and `prediction_pipeline:mlb` lease. Rollback is r38; r39
never produced an authoritative snapshot.
