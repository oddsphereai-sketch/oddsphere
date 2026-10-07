# NFL Player Props state-aware cadence predeclaration

Date: 2026-10-07

## Scope

This operational release changes only when the existing authoritative NFL
Player Props writer is invoked by `/api/cron/nfl-forward-evidence`. It adds no
writer, provider, model feature, probability, projection, side, grade, stake,
copy, label, layout, or member request. The shared `prediction_pipeline:nfl`
lease, exact-price board, last-known-good reconciliation, T-60 immutability,
settlement, and current quarter-hour route remain authoritative.

The preceding route invoked the complete provider/model/settlement writer on
all 96 quarter-hour heartbeats per day even when games were days away. The
candidate reads the already persisted props snapshot before any props provider
call and plans one of three sport-specific cadences:

- hourly when the nearest unlocked T-60 boundary is more than six hours away;
- every 30 minutes inside six hours;
- every 15 minutes inside two hours;
- immediately on the first heartbeat at or after a due T-60 boundary;
- immediately when the current-week snapshot is missing or has an invalid
  timestamp.

The route continues running every 15 minutes, so a skipped provider cycle is
recoverable at the next heartbeat. Daily Edge collection and publication are
unchanged and cannot be suppressed by the props gate.

## Frozen acceptance gates

1. A missing/current-week rollover snapshot must run immediately.
2. A far-away slate younger than 60 minutes must make zero props provider
   calls.
3. Inside six hours the maximum observation age is 30 minutes; inside two
   hours it is 15 minutes.
4. A due T-60 lock is never skipped because a preceding snapshot is young.
5. On identical observations, the board is byte-identical apart from the
   operational writer source/release stamp; actionables, sides, projections,
   probabilities, prices, grades, and locks are unchanged.
6. Locked rows remain byte-for-byte immutable and member-reader precedence is
   unchanged.
7. The current live board count is not an optimization target. No promotion or
   demotion is authorized by this release.
8. Focused cadence, writer, snapshot, lock, and current refresh-cycle tests;
   `npm run verify:model-change`; full verification; build; latest-main
   integration safety; protected PR; exact production commit; and two natural
   refreshes are required before completion.

## Load envelope

The Vercel route remains at 96 lightweight heartbeats per day. Full props
provider cycles fall to a 24/day base away from games, rise to 30-minute cadence
inside six hours, and retain the existing 15-minute cadence inside two hours and
through T-60. With the currently observed 52-call natural cycle, the far-slate
base falls from roughly 4,992 calls/day to roughly 1,248 calls/day. The existing
101-call hard per-cycle circuit breaker remains unchanged.

Rollback removes the cadence gate and restores writer r38 without rewriting
any stored or locked record.
