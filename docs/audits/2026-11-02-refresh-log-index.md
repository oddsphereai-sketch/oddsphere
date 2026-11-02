# Preserve market snapshots while reducing refresh lookup work

Starting production base: `d3366f168fa04272918297214cc09c21876f514f`.
Task branch: `codex/db-refresh-read-index-20261102`.

The owner requires the existing product and intraday market-reading processes
to remain intact while addressing Supabase memory pressure. Stored evidence is
an operational input, not merely an archive: the CFB writer calls
`readCfbForwardWriterEvidence` and `readCfbForwardMarketHistory`, and NFL's writer
loads the existing release-specific evidence before constructing its next board.
Older opening prices, compatible releases and frozen decisions can remain
necessary after their capture date. No snapshot retention or reader horizon is
changed by this repair.

## Measured inefficiency

At 19:38 UTC, the live refresh log had an estimated 187,560 rows and occupied
134,643,712 bytes including indexes. Its indexes covered source/start time,
status, and start time, but not the source/sport/completion ordering used by
`refreshLogger.getLastCompleted` and `getLastHealthyCompleted`.

Since the 19:21:33 UTC Postgres restart, the healthy-completion PostgREST query
had 90 calls, 8,680 ms total and 96.4 ms mean execution time. This is a narrow
efficiency opportunity, not proof of the restart or memory-pressure cause.

A SELECT-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the unchanged
`sharp_book_splits_refresh` / `cbb` healthy-completion lookup measured:

- 1,496 qualifying rows and 12,005 rows removed by the filter;
- 3,484 shared buffer hits;
- a top-N sort using 25 kB;
- 8.509 ms execution time with warm buffers.

Other workloads remain more expensive: current statistics showed tracking
projection reads, CFB market-history JSON projections and board-cache upserts.
This change deliberately leaves their payloads, evidence coverage and behavior
intact. It must not be represented as eliminating the severe memory warning.

## Change and preservation

Migration v52 adds one non-unique partial B-tree index on
`(data_source, sport, refresh_completed_at DESC)`, including `refresh_status`,
for rows with a completion timestamp. Existing SQL predicates, status rules,
null-sport behavior and timestamp selection are unchanged. Equal-time ties
still return the identical selected timestamp.

There are no row updates/deletes, payload transformations, reader changes,
capture/schedule changes, cache lifetime changes, provider calls, new writers,
lease changes or model-release changes. Every locked field and its precedence
remain unchanged because the only production statement is `CREATE INDEX` on
the lifecycle log.

## Validation and rollout

An isolated PGlite PostgreSQL 18.6 instance applied the exact migration twice
over 12,000 lifecycle fixture rows. Eighteen before/after cases covered two
real job names plus a missing job, CBB/NFL/null sport, and both healthy-only
and all-completed predicates. All results were identical. The index was ready
and valid, and the plan used an index-only scan with no sort. This local proof
does not substitute for checking the production PostgreSQL 17 plan.

Apply the single concurrent statement outside a transaction only after a
protected PR merge from the verified latest main. The small metadata index
keeps ordinary lifecycle writes available while building; it adds storage and
write-maintenance overhead. Do not run a rebuild, vacuum, full history scan or
other large migration alongside it. Check the exact definition, `indisready`
and `indisvalid` rather than assuming `IF NOT EXISTS` proves success.

Post-application acceptance: the unchanged production query uses the new index,
removes the full-source scan and sort, and normal completion metadata reads
still succeed. Compare within a stable read-only transaction with a sequential
scan if needed. Memory, swap and uptime must be reported separately; no memory
cure is claimed from one faster query or a restart. This work authorizes no
compute purchase, restart or external support message.

Rollback, if the index adds material write latency or is not useful: remove only
`public.idx_refresh_log_completed_lookup` with `DROP INDEX CONCURRENTLY` after
review. Preserve all preexisting indexes and all application data. A failed
concurrent build can leave an invalid index: inspect it and remove only this
task-owned invalid object before a controlled retry; never silently accept it.
