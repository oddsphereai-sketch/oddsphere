# NBA readiness-gated rollover predeclaration

Date: 2026-10-07

## Scope

This operational release changes NBA refresh timing and member board-date
cutover only. It does not change the independent model, market marriage,
probability, projection, side, price selection, grade, stake, tracking
eligibility, member copy, label, or layout.

The existing `nba_daily_refresh` route remains the sole NBA seed/line owner.
It joins the sport-scoped `prediction_pipeline:nba` lease because it now
publishes the already-authoritative Daily Edge response snapshot after a
complete source cycle. The expensive ratings scrape remains once daily.

## Intended member behavior

- The default NBA board date changes at 03:00 America/New_York, including
  across daylight-saving transitions.
- The writer prepares the new ET calendar date before that cutover.
- A verified empty slate publishes an empty date-keyed snapshot and is a
  valid ready state.
- A failed or partial source cycle does not publish the incoming snapshot.
- If the 03:00 cutover arrives without today's snapshot, a default-date read
  silently retains yesterday's last published board until today's writer
  succeeds. Explicit `?date=` reads never fall back to another date.
- Member reads perform no new provider request and add no stale badge,
  warning, replacement label, or copy.

## Cadence

- Stable ratings: once daily at 11:30 UTC, staggered from the primary NHL,
  WNBA, football, and MLB jobs.
- Volatile seed/lines/snapshot: hourly at minute 12 during the quiet
  pre-rollover window and every 30 minutes at minutes 12/42 through the
  active market/game window.
- Existing T-60 locking remains owned by `pregame-sweep` and game time, not
  by board rollover.

The scheduled route count changes from 31 to 41 invocations per UTC day, but
only one run performs the ratings scrape. The prior 9.25/8.25-hour
EDT/EST unseeded member-date gap is removed; a completed incoming snapshot is
available before the 03:00 ET display cutover, with silent prior-board
continuity on failure.

## Frozen acceptance gates

1. EDT and EST both cut over at local 03:00, not a fixed UTC hour.
2. Spring-forward and fall-back simulations cannot switch early or twice.
3. Stored `games.slate_date` remains the ordinary ET calendar date.
4. An explicit date request is unchanged.
5. A source-partial cycle cannot replace a complete member snapshot.
6. A clean no-games result can publish a truthful empty ready snapshot.
7. The prior board remains readable if the first incoming writer fails.
8. Stable ratings run once daily; intraday cycles skip them.
9. The route uses the existing sport prediction lease and creates no writer.
10. Existing locked rows, model outputs, grades, tracking, copy, and layout
    remain unchanged.

Rollback restores the r2 schedule and midnight default NBA date without
rewriting any snapshot, prediction, or lock.
