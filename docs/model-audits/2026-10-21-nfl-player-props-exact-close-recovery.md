# NFL player props exact T-60 close recovery

## Problem

The writer attached a close only from the newest live observation snapshot,
then settled records, and captured the append-only market-observer history
after settlement. When an offer disappeared from the newest snapshot, the
ledger could permanently retain a null close even though an exact immutable
same-book T-60 row had been stored separately.

## Repair

The existing market-observer schema/release and source rows remain unchanged.
The sole writer now stores the observer landmark after the authoritative member
and lock writes but before settlement, reads the same checksum-protected weekly
history, and fills only an absent `closing_price`, derived implied probability,
and CLV. A candidate must match exact game, normalized player, market,
canonical line, side, sportsbook, and decision release. Different-line,
different-book, post-start, stale, or non-T-60 observations are rejected.

No locked pick, line, locked price, probability, projection, grade, stake,
result, model release, or snapshot payload is changed. The writer/tracking
provenance advances to r59/r33; all model, calibration, decision, member,
provider, cadence, lease, and settlement releases remain unchanged.

## Current production audit

The SELECT-only 2026 Weeks 1-7 audit read 16,421 observer rows and 1,032 exact
T-60 side quotes. There were 42 records with a missing close. Two settled wins
have an exact stored tuple and are eligible for an additive close backfill;
40 have no exact tuple and must remain missing rather than be reconstructed.

Publication requires focused observer/production tests, TypeScript, the full
model-change suite, latest-main integration safety, a protected PR, then one
exact post-deploy writer cycle. Any historical backfill must report its exact
updated count and may fill null close metadata only. Roll back r59/r33 to
r58/r32 for future cycles without deleting captured history or altering locks.
