# NFL forward-evidence history read serialization

## Scope

- Writer/read health: `nflForwardEvidenceWriter`, the compact forward member-snapshot audit, and `nfl-daily-edge-health`.
- No provider, model, projection, probability, side, grade, stake, lock, tracking, schema, or member-reader change.
- The sole writer and `prediction_pipeline:nfl` lease remain unchanged.

## Production diagnosis

At `2026-09-01T13:32:53Z`, a SELECT-only timing audit of the exact Week 1 release reads measured:

- current r4: 64 rows in 1.357 seconds;
- previous r3: 3,360 rows in 17.217 seconds;
- prior r2: 80 rows in 1.288 seconds;
- legacy r1: 32 rows in 0.580 seconds.

The scheduled writer launched those four independently paginated JSON reads in one `Promise.all`. Production recorded statement-timeout failures at `2026-09-01T12:36:09Z` and `2026-09-01T13:06:09Z`, followed by a successful cycle at `2026-09-01T13:21:09Z`. The failure was therefore intermittent query contention, not an absent slate or a model failure.

## Repair

Writer r18 awaits r4, r3, r2, and r1 in order. Page size, per-release hard cap, selected columns, immutable-payload validation, and the final combined history are unchanged. This preserves the complete same-book odds trail and lowers concurrent database pressure.

The health route now reads the same release-keyed compact snapshot as the production member route. The prior health implementation still inspected the retired manual preseason publication key, so it reported `NFL published member snapshot is unavailable` even when the current forward member snapshot was healthy. The audit checks three markets per game, current-price and Opening/current trail coverage, grades, publication freshness, and the existing six-hour far-window / hourly inside-48h evidence cadence.

## Rollback

Rollback is writer r17. Revert if serialized reads increase cycle duration beyond the existing five-minute route limit or if the combined release counts differ from the pre-release read.
