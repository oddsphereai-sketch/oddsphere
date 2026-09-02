# NFL player props snapshot envelope — behavior-neutral storage audit

Date: 2026-09-02  
Production base: `4a8357f239261aa2d2b042865ec487f56169f131`  
Envelope release: `nfl_player_props_snapshot_envelope_2026_09_02_r1_gzip_deduplicated_member`

## Disposition

The NFL player-props forecast, probability, projection, side, grade, stake, lock,
tracking, provider, cron, and lease contracts are unchanged. This release changes
only the representation of the existing single `lab_response_snapshots` payload.
It adds no key, table, writer, query, provider call, backfill, or deletion.

Further embedded evidence growth remains frozen. Contextual forecast work must
consume the already-captured evidence and persist only bounded derived state.

## Live operational baseline

Read-only measurements used the natural Week 1 production snapshot generated at
`2026-09-02T13:36:09.849Z`:

| Measure | Observed value |
| --- | ---: |
| Legacy canonical JSON | 9,594,515 bytes |
| Capture increment within canonical JSON | 449,822 bytes |
| `board.decisions` JSON | 4,694,094 bytes |
| duplicated `memberDecisions` JSON | 4,533,967 bytes |
| Stored/member decisions | 1,147 / 1,082 |
| Live full-row reads | 4,154 / 4,285 / 4,894 ms |
| Live full-row median | 4,285 ms |
| Metadata-only read median | 188 ms |
| Member DTO derivation | 28.6 ms |
| Natural writer cadence | every 15 minutes |
| Latest natural writer | 1,082 rows, 44 provider calls, 26.4 seconds |
| Healthy writer duration median | 27.9 seconds |
| Observed writer lease overlaps | 0 |

The member page and production writer each performed one full JSONB payload read.
The member page then serialized a 4,877,775-byte member DTO. The readiness operator
was the only other direct payload reader.

## Candidate measurements

Encoding the same immutable live snapshot locally through the candidate produced:

| Measure | Candidate value |
| --- | ---: |
| Deduplicated decoded JSON | 5,060,529 bytes |
| gzip bytes | 301,320 bytes |
| complete base64-envelope JSON | 402,267 bytes |
| duplicate member bytes omitted | 4,533,986 bytes |
| stored-row reduction | 9,192,248 bytes (95.81%) |
| legacy/envelope ratio | 23.85:1 |
| bounded local decode, median | 17.85 ms |
| bounded local decode, range | 16.36–28.96 ms |

One additional live legacy read during candidate measurement took 4,493 ms. The
candidate was not written to production, so post-migration network latency is not
claimed from a synthetic upload. It must be measured after a natural writer cycle.

## Compatibility and safety contract

- New payloads use deterministic gzip level 9, base64 transport, SHA-256 checksum,
  exact compressed and decoded byte declarations, and identity metadata.
- Decoded JSON is capped at 12,000,000 bytes and gzip input at 1,000,000 bytes.
  `gunzipSync` also enforces the decoded cap independently of declared metadata.
- Normal writer snapshots omit `memberDecisions` only when it is byte-equivalent
  to the existing non-`Held` derivation from `board.decisions`.
- If a future in-memory snapshot contains a non-derivable member list, the envelope
  embeds that list instead of reinterpreting it.
- Legacy uncompressed rows retain their stored `memberDecisions` verbatim. New
  derivation never overrides a legacy or locked payload field.
- A malformed envelope, checksum mismatch, length mismatch, oversized payload, or
  decompression failure fails closed. The member deadline uses its existing
  unavailable fallback; the writer receives an error instead of treating corruption
  as an empty prior and reconstructing locked records.
- The member page, writer, and readiness audit all consume the dual-schema store.
  No current NFL props payload reader bypasses it.
- The database operation budget remains one snapshot read and one snapshot upsert
  per applicable writer cycle. Tracking queries and writes remain unchanged.

The large JSONB row is necessarily TOASTed. The smaller envelope should reduce
PostgREST egress and TOAST/WAL/dead-tuple churn materially, but exact physical table
and TOAST sizes are not exposed by the current PostgREST credentials and are not
estimated here.

## Verification requirements

The focused test proves deterministic encoding, exact canonical-value and member-
DTO round trips, legacy precedence, locked-row identity, derivation safety,
embedded-list fallback, checksum/length/base64 corruption handling, bounded
decompression, one-read/one-write counts, and complete reader centralization.
The existing production-contract test remains authoritative for health-held rows,
T-60 locks, tracking, closing-price handling, lifecycle counts, provider limits,
and sole-writer behavior.
