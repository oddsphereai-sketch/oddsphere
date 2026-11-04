# CFB history reader memory pilot — November 4, 2026

The owner authorized optimizing the heavy history reader while retaining all
history and snapshots and preserving market interpretation, predictions and
tracking. Starting production base: `e8014fbd6aba6c74211755d8f85d65f8f097624b`.
Operational transport identifier:
`cfb_market_history_transport_2026_11_04_r1_bounded_json_pages`.

## Scope and preservation contract

The existing SELECT expands large JSON fields before sorting and limiting them.
The additive v58 invoker function first materializes ordered narrow row identities,
then expands exactly those rows into the existing 25-field projection. Returning
a JSON array directly avoids an additional PL/pgSQL row-result tuplestore. The
application uses 250-row responses and continues paging through the complete
result. It does not store a replacement history or discard fields.

Unchanged: all snapshot rows and original JSON, stored hashes and timestamps,
compatible releases, season and game filtering, ten-game batches, ordering by
capture time and ID, immutable openings outside the recent window, the existing
72-hour live continuity window and global 50,000-row fail-closed ceiling. The
existing normalizer owns identity validation, legacy values and reader precedence.
No model equation, input value, pick, probability, grade, stake, tracking rule,
snapshot writer, lease, provider call, source cadence, table index, retention or
Postgres memory setting changes. The numerical/model release tuple remains the
same because successful reader values are exactly equal; only transport is versioned.
There are zero intended board promotions/demotions or changed decisions.

The RPC is STABLE, SELECT-only, SECURITY INVOKER, with fixed pg_catalog search path.
Only service_role receives EXECUTE, and the underlying SELECT privileges and RLS
still apply. Invalid bounds fail. An absent named RPC alone retries the existing
view; its existing absent-view fallback remains. Timeouts, permission failures and
unrelated missing objects never cause a second heavy scan. Malformed or oversized
responses fail instead of silently dropping history.

## Controlled local measurements

Six actual preserved T-60 payload shapes were frozen read-only; their combined
source SHA-256 is
`01e253a9a56413b80d2880e6f60ce19eb934c8a31b02e48df356897cca8d353e`.
Private fixture contents are deliberately excluded from this repository.
The disposable PostgreSQL 17.6 test creates 3,000 synthetic history rows from these
shapes, changing only local synthetic capture/stage metadata. It reproduces the
source table's existing indexes and uses 7 MiB work_mem. The unchanged predicate
selects 1,740 rows, including old openings.

| Complete read | Legacy 1,000-row pages | New 250-row pages |
| --- | ---: | ---: |
| Pages | 2 | 7 |
| Database peak process RSS | 409,698,304 B | 295,387,136 B |
| Aggregate query execution | 1,613.434 ms | 1,297.612 ms |
| Temporary blocks written | 24,982 | 20,317 |
| PostgREST 14.5 peak process RSS | 327,696,384 B | 176,553,984 B |
| Full HTTP read elapsed | 2,523 ms | 1,980 ms |

This is approximately 28% lower database peak RSS, 19% fewer temporary writes and
46% lower API peak RSS. RSS includes shared mappings. These are local measurements
on one reproducible workload, not production-host commitment attribution, a load
test or a guarantee the Supabase warning clears. The retained API RSS was also
lower in this test, but production pools, allocators and concurrent traffic vary.
125/100-row trials produced only a further roughly 6% database RSS reduction while
doubling request counts; 250 is the measured compromise.

Every complete native SQL and real HTTP response hashes identically, with all
1,740 rows and all 25 fields in the same order:
`e9f644aad74d37a6dc4ab3f991b4a9301cc535999668176430a2481fe2c28afb`.
An earlier TABLE-return prototype had negligible memory benefit and more temporary
I/O; it was rejected and is not the migration in this change.

## Verification and reproduction

`scripts/test-cfb-bounded-history-page-postgres.mjs` executes the actual migrations
twice against disposable PostgreSQL/PGlite. It checks exact projection equality,
SQL/JSON nulls, malformed legacy shapes, stable tied timestamps, complete paging,
openings outside the window, wrong season/release/game isolation, argument bounds,
service-only grants, underlying denied SELECT, invoker RLS and unchanged full
original rows. CI runs this SQL proof and the application transport tests.

`scripts/test-cfb-bounded-history-reader.ts` compares complete paged normalized
output with the old reader, including original locked evidence; checks exact
filters, game batching, absent-migration fallback, real-error non-retry,
malformed responses, source-object immutability and saturation. Existing CFB
production tests cover sole writer, lock immutability, legacy reader precedence,
full board continuity, prediction/grade coherence and tracking.

The two benchmark scripts accept local test modules and a private frozen fixture;
they reject hosted database URLs. The native benchmark requires a disposable
Unix-socket PostgreSQL cluster on port 55478 and creates its own UUID database.
The API benchmark uses the official PostgREST binary with a temporary localhost
port and that private database only. No production writes or provider requests
are performed by these benchmarks. Their dated full artifacts remain in
`/private/tmp/oddsphere-cfb-history-{native,api}-benchmark-20261104.json`.

Required release checks: focused SQL and transport tests, existing CFB production
suite, full verify:model-change, TypeScript, ESLint, fresh-main integration guard,
protected PR and production deployment proof. Before activation, freeze a completed
game cohort's complete history and source snapshots. After the additive migration,
compare the live RPC with that baseline and verify normal leased refresh, published
member coverage, existing lock hashes and unchanged tracking. Apply no ad-hoc
provider refresh. Measure current host commitment/swap separately; a successful
transport pilot does not establish that whole-host memory pressure is resolved.

Rollback: restore the prior application transport; the unused SELECT-only function
can remain. Never delete or rewrite snapshots, locks or tracking to roll back.
