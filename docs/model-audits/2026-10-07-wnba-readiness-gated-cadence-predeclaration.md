# WNBA readiness-gated cadence predeclaration

Date: 2026-10-07

## Scope

This operational release changes WNBA refresh scope, timing, and member
board-date cutover only. It does not change the independent model, market
marriage, probability, projection, side, exact-price selection, grade, stake,
tracking eligibility, member copy, label, or layout.

The existing `wnba_daily_refresh` route remains the sole WNBA seed, line,
split, model, tracking-record, and snapshot owner under the existing
`prediction_pipeline:wnba` lease. Its once-daily full mode keeps the three-day
future seed. Intraday mode limits date-scoped seed, split, record, and Market
Intelligence collection to the current ET slate while retaining the same line
and model implementations.

## Intended member behavior

- The default WNBA board date changes at 03:00 America/New_York across both
  daylight and standard time.
- The existing writer prepares the incoming date before that cutover.
- A complete zero-game slate is a truthful ready state.
- A failed or partial source/model/record cycle cannot replace the incoming
  member snapshot.
- If cutover arrives without today's snapshot, default navigation silently
  retains yesterday's last published board until the next successful cycle.
  Explicit `?date=` reads never fall back to another date.
- No provider request, stale badge, warning, replacement label, or copy is
  added to member reads.

## Cadence and load

- Full three-day preparation: once daily at 11:23 UTC.
- Current-slate volatile work: hourly at minute 23 during the quiet window and
  every 30 minutes at minutes 23/53 during the active market/game window.
- Existing game-time locks and immutable rows remain independent from board
  rollover.

The manifest changes from 30 full three-day runs to one full run plus 38
current-slate runs per UTC day. HTTP invocations rise from 30 to 39 so there is
no 9.5-hour freshness hole, while date-scoped seed/split/record/MI work falls
from 90 slate scopes to 41 (54.4% less). Ordinary volatile age becomes at most
60 minutes overnight and 30 minutes during the active window.

## Frozen acceptance gates

1. EDT and EST both cut over at local 03:00.
2. Spring-forward and fall-back simulations cannot switch early or twice.
3. Stored `games.slate_date` remains the ordinary ET date.
4. Explicit date navigation is unchanged.
5. Partial incoming cycles retain the prior complete snapshot.
6. The daily full cycle preserves the three-date future seed.
7. Intraday date-scoped work uses only the current slate.
8. The sole writer and sport prediction lease remain unchanged.
9. Locked rows and tracking-record immutability remain unchanged.
10. For identical model inputs, predictions, projections, probabilities,
    prices, grades, promotions, demotions, actionables, copy, and layout are
    identical.

Rollback restores the two prior 30-minute UTC windows and midnight default
WNBA board date without rewriting any snapshot, prediction, or lock.
