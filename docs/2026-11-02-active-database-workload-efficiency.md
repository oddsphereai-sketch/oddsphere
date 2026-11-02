# Active database workload efficiency — November 2, 2026

Starting production base: `a28b4489674a1b3678308afd2efdcdeff521d7cb`.

This change preserves every stored snapshot and locked value, every original
CFB PostgREST selector, release filter, opening, history window, page boundary,
ordering and normalizer. It changes no model release, lease, writer cadence,
cache key, JSON value, timestamp, TTL, tracking result or retention policy.

## Changes

- v54 materializes the exact CFB JSONB payload once in a Function Scan, avoiding
  repeated TOAST decompression across the existing 25 market-history selectors.
  The invoker view has SELECT-only service-role access; missing-view rollout
  falls back to the original table for the same page and subsequent pages.
- v55 sets native LZ4 compression for future cache-payload writes only. The
  short-lock metadata change does not rewrite existing values. PostgreSQL keeps
  existing values readable using their original compression method.
- The operator statistics script analyzes only filter/order metadata on five
  active tables, individually, with a 1 MB buffer ring and SKIP_LOCKED. Verify
  completion and retry skipped tables. Large JSON columns are excluded.

## Evidence

Native PostgreSQL 17 benchmarks used temporary RLS-enabled tables/views and
rolled back all changes. Three alternating trials per path:

| Workload | Original | Proposed | Equality |
| --- | ---: | ---: | --- |
| CFB original selectors, 30 frozen T60 rows | 49.801 ms | 17.900 ms | zero mismatches |
| CBB fresh JSON cache insert | 306.691 ms | 198.499 ms | exact JSON |
| NBA precompressed envelope insert | 130.412 ms | 34.519 ms | exact JSON |

CBB stored payload fell from 1,403,480 to 805,228 bytes. The incompressible NBA
envelope remained 5,693,172 bytes; LZ4 spent less time attempting compression.
These are isolated database benchmarks, not end-to-end API latency promises.

Validation: full `npm run verify:model-change`, TypeScript no-emit, focused
market-history query/fallback tests, and disposable PostgreSQL proofs covering
legacy shapes, SQL NULL versus JSON null, exact selector equality, frozen-row
immutability, idempotency and SELECT-only invoker permissions. The optional
Market Brain integration proof is skipped locally without its database URL.

## Deployment and rollback

Publish through a protected PR from a clean, current-main worktree. Apply v54,
then v55, then the five ANALYZE commands individually. Confirm the view's
permissions, actual cache column compression and per-table last_analyze;
compare the original and projected live REST results for frozen CFB records.
Verify deployment SHA and current production readers and cron health.

Reader rollback can use the legacy table; do not drop the view while the reader
uses it. Cache compression can be returned to `pglz` with the same short lock
timeout; existing values remain readable either way. ANALYZE changes planner
metadata only and has no snapshot or model-data rollback requirement.

These changes reduce proven query/write overhead. They do not establish the
cause of the earlier unclean compute restarts or guarantee a particular memory
commitment badge. Host-level private allocation and restart-trigger evidence
remain unavailable through the exposed database and exporter permissions.
