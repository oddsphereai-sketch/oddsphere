# Exact tracking projection with one snapshot decode

Base: `b4bd33f8d58ec44cde7d1e7cce3a6b84a0d1b0d1`.
Branch: `codex/tracking-single-snapshot-decode-20261102`.

The owner requires operational market snapshots, their intraday reads and
forward-validation history to remain intact while reducing database pressure.
This reader-only change preserves all stored payloads and all selected values.
It does not delete snapshots, shorten history, slow capture, alter deadlines,
change the forecast/grade/stake model, add a writer or change a pipeline lease.
The existing v19 tracking contract and cache keys retain their exact semantics.

## Evidence

At 19:38 UTC the current tracking record projection was the highest cumulative
service-role query: 24 calls, 60,137.9 ms total, 2,505.7 ms mean, and 4,608
temporary blocks written since the 19:21:33 UTC restart. It extracts eight
separate fields from `snapshot_json`. Even a narrow JSON projection can
repeatedly detoast/decompress a large stored document.

Read-only PostgreSQL 17 tests of 100 records in the October 27–November 2
window measured 68.317 ms for the warmed eight-field projection versus
27.231 ms for a single `jsonb_to_record` decode. Both used warm buffers, the
same ID order, date predicates and row limit. Buffer accesses fell from
12,150 to 9,030. The earlier cold baseline was 398.269 ms and is explicitly
not used for the warm comparison. A same-record comparison of all eight
transported values returned 100 checked records and zero mismatches.
These are bounded diagnostic measurements, not a memory-leak diagnosis or
a promise that the 2 GB compute tier is sufficient.

## Implementation and immutable legacy precedence

Migration v53 defines a SELECT-only, security-invoker view over the existing
base rows. It decodes the exact stored document and exposes the same eight
aliases that the existing PostgREST projection returned. It retains original
base columns, including the original JSON for the unchanged competition
filter, while the API continues selecting only its original compact columns.
The view guards null/non-object legacy snapshots so they do not suppress a
row or throw an error. It computes no replacement grade, price or evidence.

The reader derives its new column names from the original selector. Sport,
competition, date predicates, ID ordering, page size, complete paging,
grading precedence and eligibility remain unchanged. A missing view during
rollout retries that same page using the original selector and remains on
the original table for the rest of the read. Permission errors, timeouts and
unrelated missing relations are returned, not retried. No current-model
value can take precedence over a stored locked value.

The view grants SELECT to the existing service role only. It grants no
anonymous/member access and uses invoker permissions/RLS. The lateral join
does not create an application write path. No original table permissions,
policies, rows or evidence hashes change.

## Validation

- Required `npm run verify:model-change`: passed in the isolated worktree
  using dummy localhost database credentials. Its optional Market Brain
  PostgreSQL job is skipped by the existing script when its URL is unset.
- TypeScript `tsc --noEmit`: passed.
- Current tracking aggregate, tracking page and alternate-line tests: passed.
- New paged-reader tests: exact alias list, original predicates, 1,001-row
  paging, first/later-page missing-view fallback, real-error non-retry,
  unchanged frozen records and no full-payload download all passed.
- Exact migration applied twice in disposable PostgreSQL 18.6/PGlite:
  19 legacy payload shapes produced identical transported values, identical
  row counts, unchanged stored locks, correct invoker configuration, and
  SELECT-only service permissions. This does not replace post-merge PG17/API
  verification. Reproduce with
  `node scripts/test-tracking-snapshot-projection-postgres.mjs /path/to/pglite/dist/index.js`.
- Extra historical test `test-tracking-locked-grade.ts` fails the same two
  assertions on unchanged production-base source: it expects an older
  override precedence and a null-grade Watchlist fallback. This change leaves
  the actual production precedence intact. Extra `test-football-tracking-lifecycle.ts`
  lacks its ignored local NFL fixture on both base and candidate. Neither
  unrelated test was edited to make the candidate green.

## Rollout and acceptance

Publish via protected fresh-main PR only after overlap and tree checks.
Apply the merged v53 view migration; deployment ahead of the migration is
safe because of the exact legacy fallback. After schema-cache reload, verify
the view definition, invoker flag and permissions, compare full compact API
responses for the same frozen records, and confirm the live deployment SHA.
Memory, swap, uptime, API health and the intraday market-reader processes must
be assessed independently. The severe warning cannot be declared fixed from
this limited performance measurement.

Rollback is to restore the unchanged legacy query path in a fresh protected
PR; the view can remain unused. No evidence or tracking row needs repair,
reconstruction, replacement or deletion. Stop rollout on any value/row-count
parity failure, permission difference, incomplete page, or worsened read health.

## Production proof and default-grant correction

PR #936 merged as `6dad1738c5c789adc7821d3b1b79e94556dcab18` with the
tested tree and a successful production deployment. The PG17 Data API returned
identical complete 47-column projections for 100 recent multi-sport locks,
39 current-week NFL locks, and 100 legacy UCL locks. A read-only execution of
the old and new complete NFL aggregates also matched exactly, including all
alternate-line windows. The measured full-aggregate runs were 2,587 ms and
1,866 ms respectively; these timings are not a controlled memory comparison.

Production permission inspection exposed a gap in the disposable fixture:
Supabase default privileges grant the existing service role ALL privileges on
new views. A SELECT grant alone does not revoke those defaults. This follow-up
starts from `6dad1738c5c789adc7821d3b1b79e94556dcab18` on its own clean branch,
explicitly revokes the defaults from the new view before granting SELECT,
and reproduces the production default grant in the regression fixture. The
strengthened test fails before the migration correction and passes after it.
No base-table privilege or stored record changes; the lateral projection view
does not create an application writer. Apply the protected corrected migration
and prove the actual service role has SELECT but no write privileges.

At 20:02:43 UTC, commitment remained 2.752 GB against a 2.036 GB limit with
about 506 MB swap occupied and no database restart since 19:21:33 UTC. Thus
the memory incident remains unresolved despite verified workload improvements.
Intraday source collectors and football evidence jobs continued to record
completions; partial source statuses were preserved, not relabeled healthy.
Public member-route verification requires an active member session; the
available beta login did not establish one. No authentication setting was
changed. The authenticated service Data API and exact production runtime
provided the record and aggregate parity evidence instead.
