# NFL Player Props canonical snapshot capacity predeclaration — 2026-09-20

## Scope and production defect

The active Week 2 NFL Player Props writer began failing after the canonical retained-week snapshot
crossed its 16,000,000-byte decoded JSON ceiling. Natural runs at `2026-09-20T10:21:09Z` and
`2026-09-20T10:36:09Z` failed closed with `NFL player props snapshot exceeds the 16000000-byte JSON
limit.` The last-known-good `10:06:09Z` snapshot remains readable and contains 3,254 evaluated rows,
but the failure prevents subsequent unlocked price and availability refreshes.

The last-known-good canonical storage payload is 14,257,201 decoded bytes and 644,247 gzip bytes.
Its member-lifecycle projection at `10:36Z` is smaller: 2,734 current/future rows, 11,980,833 decoded
bytes, and 563,508 gzip bytes. The difference is required locked prior-date evidence retained for
tracking and settlement, not member-request expansion.

## Candidate

- Raise only the server-side canonical retained-week decoded ceiling from 16 MB to 32 MB and its
  compressed ceiling from 1 MB to 2 MB.
- Preserve the existing gzip envelope, checksum, single snapshot key, cached member reader, and
  `prediction_pipeline:nfl` writer lease.
- Before every canonical write, build the exact member-lifecycle DTO for the write timestamp and
  enforce the unchanged 16 MB decoded / 2 MB gzip member-transport ceilings. A canonical snapshot
  may retain older locked evidence beyond the member ceiling only when that evidence has rolled off
  the current member DTO.
- Advance the writer release because publication capacity changes. Model, calibration, decision,
  runtime, board, member, member lifecycle, tracking, settlement, and envelope releases remain
  unchanged.

## Invariants and acceptance

The repair changes no provider request, forecast input, projection, probability, selected side,
price tuple, grade, promotion/demotion, stake, lock, settlement result, UI copy, label, or member row.
Board impact is exactly zero promotions, zero demotions, and zero member-row changes for an identical
candidate snapshot. Tests must prove canonical-only retained history can exceed 16 MB, an oversized
current member DTO still fails closed before the write, legacy envelopes remain readable, and the
current member transport remains inside both unchanged ceilings.

Live acceptance requires an up-to-date protected merge, a successful natural leased NFL writer run,
a newer readable props snapshot, unchanged active model/decision/grade releases, a member transport
below 16 MB / 2 MB, nonempty coverage across all eight supported markets, and no new load or lease
failure. Rollback restores the prior canonical ceilings and writer release while preserving the last
coherent snapshot and all immutable tracking rows.
