# NFL Player Props observed scheduler-jitter repair — October 20, 2026

## Production incident

After writer r58 deployed, the normal `13:21:09.467Z` production heartbeat
evaluated a snapshot generated at `12:21:10.961Z`. The heartbeat was 1.494
seconds before the exact one-hour boundary. Cadence r2 allowed only one second
and returned `not_due`, so the hourly writer would not run until `13:36`.

This was observed in production refresh records: the `13:21` cycle completed
successfully with zero provider calls and zero updated records, while the prior
`13:06` route cycle completed normally. The model and providers were not the
cause; the pure due-time comparison was too narrow for observed scheduler
jitter.

## Repair

Cadence r3 allows at most five seconds of early scheduler arrival. This is less
than 0.56% of the shortest 15-minute cadence and cannot convert the
quarter-hour heartbeat into an extra writer. The existing elapsed 60/30/15
minute policy, lock-due priority, sole route, shared lease, and provider limits
remain unchanged.

The focused regression proves the exact observed 1.494-second lead is due and
that a 5.001-second-early wake is still not due. The cadence test is also added
to the repository's mandatory `verify:model-change` chain so this boundary can
no longer escape the production gate.

## Model and lock impact

For identical writer input this changes zero projections, probabilities,
sides, prices, grades, promotions, demotions, stakes, tracking rows, or member
records. It changes only whether an already-authorized writer wake is deferred
by scheduler jitter. Locked rows retain exact stored precedence.

Rollback the five-second constant and cadence identifier to r2 if production
runs outside the released state-aware interval. Do not alter or reconstruct a
locked record.

