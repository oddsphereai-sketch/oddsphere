# NFL evidence response memory

Starting production base: `6d8a4439c47f4bd100b88167c6a59c0fbb582373`.

The reader currently returns up to 250 complete evidence snapshots per API
request. One production week-8 page serializes to 27,614,703 bytes. A bounded
native PostgreSQL 17.6 probe measured 61,185,624 bytes in its two main JSON
contexts before wire serialization. At 50 rows, those contexts use 13,852,384
bytes. Measuring with pg_column_size avoids extra text copies made by a naive
JSON-to-text diagnostic.

Change only the transport page size to 50. Keep the same selected fields,
release/season/week filters, captured_at/id ordering, complete traversal,
5,000-row safety ceiling, normalization and exact stored hash validation.
No history, openings, frozen payloads, model inputs, clocks, leases, grades,
stakes, read windows or tracking semantics change. No model release changes
apply to this physical partitioning change.

## Reproduction

Disposable localhost PostgreSQL 17.6 and official PostgREST 14.5, two Haskell
capabilities, pool maximum five, shared_buffers 512 MB and work_mem 5 MB.
Replayed one frozen 250-row page with all payloads and hashes compared equal.
Each case starts a fresh local API process. Both traverse every original row.

| Single-reader case | API peak RSS | RSS after 45 seconds idle |
| --- | ---: | ---: |
| 250 rows/request, upstream runtime defaults | 218,644,480 | 218,595,328 |
| 250 rows/request, local idle-GC override | 218,546,176 | 163,250,176 |
| 50 rows/request, upstream runtime defaults | 124,960,768 | 113,983,488 |

The local replay demonstrates buffering/retention and a reduction from smaller
requests. It does not prove the private memory breakdown on the production
Linux host. macOS socket-buffer limits invalidated an initial concurrent run;
the reported comparison uses one reader and makes no concurrent-load claim.
Only disposable local services were restarted; all were stopped afterward.

Production probing separately found small PostgreSQL-managed API connection
contexts while overall commitment rose. These contexts exclude some allocator
reservations and are not process RSS. Root attribution of every committed byte
and the earlier unclean environment restarts remain unconfirmed.

Validation covers complete history across page boundaries for all four reader
releases, original stored locked object/hash precedence, unchanged fail-closed
5k ceiling, errors/checksum rejection and append-only writer behavior. Run the
full model-change verification and focused NFL transport/reader tests before
protected publication. Verify the deployed SHA, reader parity, tracking and
current memory afterward; a benchmark alone is not a live memory resolution.
