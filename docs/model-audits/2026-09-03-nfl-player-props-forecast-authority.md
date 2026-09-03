# NFL player-props forecast authority — September 3, 2026

## Scope and predeclared rules

This is a versioned structural correction to the single NFL player-props writer. It does not
introduce a new coefficient, provider request, query, write, route, cron, lease, threshold,
stake, category, or presentation. Existing locked rows retain exact precedence.

1. Exclude the evaluated sportsbook from every market benchmark. With no independent
   alternative, use the existing independent player distribution; the exact quote is EV and
   grade input only, and the existing independent-book action gate remains closed.
2. Apply the existing target-excluded quarterback Passing Yards point head once. Do not feed
   the same alternatives through the residual head a second time.
3. Select one empirical residual family from the independent point, shift that single family
   to the final posterior probability, and derive the published decimal posterior median and
   80% interval from it. Do not reselect a residual bucket during inverse solving.
4. An ordinary Over/Under quote opposite the posterior side may remain visible as Watchlist or
   No Play but cannot be Lean or Best Angle. Anytime-TD remains an intentional one-sided
   milestone market. The rule is symmetric and its synthetic tests exercise both sides.

## Frozen production replay

The final SELECT-only replay used the immutable natural Week 1 snapshot generated at
`2026-09-03T16:06:09.608Z`: member r15, board r12, 1,221 board rows and 1,145 member rows.
It performed one database SELECT, zero provider calls and zero writes.

| Category | Rows | Actions before → after | Projection changes | Final-probability changes | Promotions | Demotions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Anytime TD | 351 | 0 → 0 | 0 | 114 | 0 | 0 |
| Passing attempts | 0 | 0 → 0 | 0 | 0 | 0 | 0 |
| Passing completions | 0 | 0 → 0 | 0 | 0 | 0 | 0 |
| Passing yards | 126 | 0 → 1 | 122 | 116 | 1 | 0 |
| Receiving yards | 342 | 9 → 9 | 70 | 272 | 0 | 0 |
| Receptions | 192 | 24 → 19 | 162 | 30 | 0 | 5 |
| Rushing attempts | 0 | 0 → 0 | 0 | 0 | 0 | 0 |
| Rushing yards | 210 | 4 → 4 | 40 | 170 | 0 | 0 |
| **Total** | **1,221** | **37 → 33** | **394** | **702** | **1** | **5** |

Candidate grades are 2 Best Angles, 31 Leans, 114 Watchlists, 998 No Plays and 76 Held.
There are zero forecast-side field changes. The maximum absolute projection change is
16.4851395053 and maximum final-probability change is 0.3115651104. Those large probability
changes occur only on evaluation-only non-actionable rows whose incumbent benchmark was the
evaluated quote; they now truthfully expose the independent fallback.

The replay proves 698 evaluation-only rows and zero remaining evaluated-offer fallback
references; 122 quarterback point-head rows and zero residual reapplications; and 11→0
ordinary actionable projection/side contradictions. No previously actionable category becomes
flat. The natural Passing Yards promotion demonstrates the exact-price promotion path; the
five Receptions demotions are the symmetric opposite-posterior safety rule rather than a quota.
Missing verified splits remain neutral.

## Safety and operations

The candidate changes no provider/query/write budgets: collection remains at most 49 calls,
incremental work at most 67 calls, and publication remains one coherent canonical snapshot under
`prediction_pipeline:nfl`. It changes no collector, market-board, snapshot envelope, cache,
settlement, route, UI, or lock algorithm. The production contract tests retain old locked rows
byte-for-byte and keep tracking separated by the new decision release. Rollback restores the
complete r6/r7/r1/r9/r12/r15/r18/r9 forecast/publication family while retaining the independent
September 3 identity-capacity repair.
