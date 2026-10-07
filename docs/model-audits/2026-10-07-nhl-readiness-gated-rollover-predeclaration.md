# NHL readiness-gated rollover predeclaration

Date: 2026-10-07

## Scope

This operational release changes NHL refresh timing and member board-date
cutover only. It does not change the independent model, market marriage,
probability, projection, side, price selection, grade, stake, tracking
eligibility, member copy, label, or layout.

The existing `nhl_daily_refresh` route remains the sole NHL seed, line,
split, prediction, and snapshot owner. It retains the sport-scoped
`prediction_pipeline:nhl` lease. Expensive team and goalie inputs remain once
daily; intraday cycles continue to refresh only volatile inputs and outputs.

## Intended member behavior

- The default NHL board date changes at 03:00 America/New_York, including
  across daylight-saving transitions.
- The existing NHL writer prepares the new ET calendar date before cutover.
- A verified empty slate publishes an empty date-keyed snapshot and is a
  valid ready state.
- A failed or partial source cycle cannot publish or replace the incoming
  snapshot.
- If cutover arrives without today's snapshot, a default-date read silently
  retains yesterday's last published board until today's writer succeeds.
  Explicit `?date=` reads never fall back to another date.
- Member reads add no provider request, stale badge, warning, replacement
  label, or copy.

## Cadence

- Stable team and goalie inputs: once daily at 11:45 UTC, staggered from NBA
  and other primary jobs.
- Volatile seed, exact lines, provider-separated splits, predictions, and
  snapshot: hourly at minute 18 during the quiet pre-rollover window and every
  30 minutes at minutes 18/48 through the active market/game window.
- Existing targeted T-60 market refresh and locking remain owned by
  `pregame-sweep` and canonical game time, not board rollover.

The scheduled route count changes from 35 to 42 invocations per UTC day, but
only one run performs the team/goalie refresh. The prior 45-minute EDT / early
45-minute EST reader-writer mismatch is removed and the ordinary volatile age
remains at most 60 minutes overnight and 30 minutes in the active window.

## Frozen acceptance gates

1. EDT and EST both cut over at local 03:00, not a fixed UTC hour.
2. Spring-forward and fall-back simulations cannot switch early or twice.
3. Stored `games.slate_date` remains the ordinary ET calendar date.
4. An explicit date request is unchanged.
5. A source-partial cycle cannot replace a complete member snapshot.
6. A clean no-games result can publish a truthful empty ready snapshot.
7. The prior board remains readable if the incoming writer fails.
8. Team and goalie inputs run once daily; intraday cycles skip them.
9. The existing sport prediction lease, model, writer, and T-60 owner remain
   authoritative.
10. Existing locked rows, projections, probabilities, grades, tracking, copy,
    and layout remain unchanged.

Rollback restores the r8 schedule and midnight default NHL date without
rewriting any snapshot, prediction, or lock.
