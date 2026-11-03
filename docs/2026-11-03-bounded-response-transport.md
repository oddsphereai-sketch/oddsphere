# Bounded database transport optimization

Starting production base: `205935ab292e5e4c780e090b140a5a04881f7b2b`.
Owner requested one evidence-based optimization pass before accepting more
recurring compute cost, preserving all required snapshots and product behavior.

## Scope and invariants

This changes physical execution of two existing operations:

1. The existing `upsertLabResponseSnapshot` writer sends the same eleven-column
   row to a single-argument JSONB RPC. PostgREST passes the body directly, avoiding
   the large `json_to_record` materialization in its table-upsert statement.
2. NBA obtains the same maximum observation ID for its unchanged league/event
   predicate through an event-filtered materialized CTE. The current plan can
   choose a backward primary-key scan over millions of unrelated observations
   to satisfy `ORDER BY id DESC LIMIT 1`.

Both functions are `SECURITY INVOKER`, have a fixed `pg_catalog` search path,
reference schema-qualified tables, and explicitly deny PUBLIC/anon/member
execution. Only the existing service role can execute them, with its existing
table privileges and RLS still enforced. No extra owner, timer, provider request,
privileged definer, index build, host setting or compute purchase is introduced.

The application falls back to the exact previous operation only when the named
function is absent (`PGRST202`/`42883`). Permission failures, timeouts and all
other errors retain the failure path and cannot trigger duplicate writes.

All selected fields, row order, complete history pagination, date/release/event
filters, bounds, payload values, stored locked precedence, expiry timestamps,
publication invalidation, model laws, grading, stakes, cadence, retention,
leases and tracking remain unchanged. The high-water helper replaces only the
physical maximum-ID lookup, leaving all subsequent price pages untouched.
The snapshot helper uses the same row object for RPC and migration fallback.

Runtime NBA model/marriage/grade at the starting base are r33/r35/r24 consumer-gap
continuity; consequence r6 and posture r8 remain authoritative. This is not a
new prediction/input rule or release: the successful query result and stored row
must equal the previous operations exactly. There are no proposed promotions,
demotions or board-count changes. No model identifier or registry is changed.
No historical lock is repaired or reinterpreted.

## Evidence before deployment

Current live cache statement statistics attributed 714,085 temporary blocks to
the eleven-column table-upsert shape across 6,448 calls. Selected read shapes
had zero temporary blocks. These are cumulative counters since the latest
reset, not current per-request allocations or proof of whole-host attribution.

Native PostgreSQL 17.6, work_mem 5 MB, frozen 8,815,707-byte snapshot input:

| SQL shape | Execution (two local runs) | Temporary written blocks |
| --- | ---: | ---: |
| Existing json_to_record upsert | 111.697 / 97.415 ms | 1,321 per call |
| Direct JSONB RPC prototype | 9.253 / 7.096 ms | 0 |

EXPLAIN execution timing excludes parameter conversion/planning work; it is
not an end-to-end API latency claim. Each native statement was rolled back
after checking the exact stored payload.

The actual candidate migration was then tested through official PostgREST
14.5 with one reader, fresh API process per case, eight complete sequential
writes and a five-second idle sample. Every stored payload matched:

| Actual API path | Peak RSS | Retained idle RSS | Temporary file bytes |
| --- | ---: | ---: | ---: |
| Existing table upsert | 376,684,544 | 376,619,008 | 86,564,560 |
| Candidate direct-body RPC | 316,178,432 | 316,129,280 | 0 |

Peak/idle RSS fell approximately 16% in this final run. An earlier prototype
run showed 28%; GC/allocation variation means neither is a promised production
percentage. These are local macOS measurements, not a Linux host memory census.
All local benchmark writes used a disposable database and frozen local fixture.

On a synthetic million-row table using only the existing event index:

| Event case | Existing descending-ID lookup | Equivalent filtered maximum |
| --- | ---: | ---: |
| No matching events | 99.431 ms, 15,778 hit blocks | 0.030 ms, 3 hit blocks |
| Matching events | 44.791 ms, 7,970 hit blocks | 0.648 ms, 232 hit blocks |

Adding a `(league,event,id)` index alone did not make the original LIMIT plan
choose it, so that index was rejected. No production index is needed.
A bounded read-only live EXPLAIN of the candidate on fourteen NBA event IDs
used the existing event bitmap index, found 278 rows, read 32 blocks and
executed in 9.039 ms, with no temporary blocks. It changed no production row.

## Validation and rollout

Focused TypeScript tests cover exact request row/timestamps, immutable input,
narrow absent-function fallback, no second write on genuine failure, exact
high-water arguments, null and unchanged failure behavior.
The PGlite SQL proof runs the actual migration twice and verifies every stored
column against the former json_to_record upsert, repeated locked payload
preservation, original release/hash/evidence precedence, empty/duplicate/mixed
events, exact maximum ID, service grants/RLS and anon/member denial. A separate
locked record remains byte-for-byte logically unchanged.

Also run the full model-safety suite, TypeScript, focused NBA reader tests,
published-member cache, NBA locked snapshot, CBB publication ownership and shared
derivation lock tests. Run integration safety from the clean committed candidate
on the latest main, protected PR checks, then verify production deployment.
The application may deploy before the additive migration because its absent-RPC
fallback preserves the exact prior path. Apply the reviewed migration after merge.
Verify service-only permissions, live exact historical snapshot, high-water
parity, actual scheduled writer usage and site/tracking reads.

An additional host restart occurred around 12:36 UTC (7:36 a.m. ET) before this
candidate was deployed. The 12:45 sample's lower 2.345 GB commitment cannot be
credited to these changes. Required schema reloads also rotate API pool
connections. Judge post-rollout behavior across ordinary refresh cycles;
never claim success from an immediate post-restart/pool-refresh memory drop.

## Decision and rollback

This is one bounded pass, not a promise that Small compute will be sufficient.
Observe commitment, available RAM, swap growth/paging, failures, process starts
and normal publication timestamps after rollout. If recurring pressure persists,
recommend the already-reviewed Medium capacity increase instead of extending
the investigation with speculative product changes.

Rollback application calls through a reviewed PR if any successful result or
stored payload changes, writer failures grow, or normal publication stalls.
The migration is additive and can remain unused without affecting behavior;
removing either function activates the exact legacy fallback. No data restore,
snapshot deletion, model rollback or locked-record rewrite is part of rollback.
