# CFB history reader memory pilot — November 4, 2026

The owner authorized optimizing the heavy history reader while retaining all
history and snapshots and preserving market interpretation, predictions and
tracking. Starting production base: `e8014fbd6aba6c74211755d8f85d65f8f097624b`.
The refinement starts from merged production base
`94a28cdbd56dd2e31f0e7704c731bf2482df3bc2`. Operational transport identifier:
`cfb_market_history_transport_2026_11_04_r2_ordered_scalar_pages`.

## Scope and preservation contract

The existing SELECT expands large JSON fields before sorting and limiting them.
The additive v58/v59 invoker function first materializes ordered narrow row
identities, then expands exactly those rows into the existing 25-field projection. Returning
a JSON array directly avoids an additional PL/pgSQL row-result tuplestore. V59
feeds ordered narrow identities directly to the aggregate, with each projection
evaluated in a correlated scalar subquery. No outer join can reorder that input,
and there is no expanded-JSON ORDER BY sort. This follows PostgreSQL
[ordered aggregate input guidance](https://www.postgresql.org/docs/17/functions-aggregate.html). The
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
| Database peak process RSS | 408,911,872 B | 281,870,336 B |
| Aggregate query execution | 1,586.514 ms | 885.835 ms |
| Temporary blocks written | 24,982 | 0 |
| PostgREST 14.5 peak process RSS | 326,696,960 B | 176,422,912 B |
| Full HTTP read elapsed | 2,602 ms | 1,812 ms |

This is approximately 31% lower database peak RSS, zero temporary writes and
46% lower API peak RSS. RSS includes shared mappings. These are local measurements
on one reproducible workload, not production-host commitment attribution, a load
test or a guarantee the Supabase warning clears. The retained API RSS was also
lower in this test, but production pools, allocators and concurrent traffic vary.
125/100-row trials produced only a further roughly 4% database RSS reduction while
doubling request counts; 250 is the measured compromise.

Every complete native SQL and real HTTP response hashes identically, with all
1,740 rows and all 25 fields in the same order:
`e9f644aad74d37a6dc4ab3f991b4a9301cc535999668176430a2481fe2c28afb`.
An earlier TABLE-return prototype had negligible memory benefit and more temporary
I/O; it was rejected and is not the migration in this change.

## First production activation and follow-up

PR1002 merged as94a28cdb and its exact verified tree10680ef5 deployed successfully.
The first migration preserved all1,172 complete history rows across six completed
games: six openings from October25, six T-60 records and1,160 unlocked records.
All25 fields and normalization matched the frozen legacy read. Original full
locked snapshot hashes remained identical. All108 member cards matched before
and after, including the two already-started cards; coverage stayed324 markets,
zero missing FBS prices and zero presentation errors. The18:10UTC natural leased
run succeeded without provider requests and used33 new RPC calls, while the old
query's call count stopped increasing.

That production comparison exposed a V58 disk regression despite its local19%
reduction: the18:05legacy run added23,574 temporary blocks, while the18:10 V58
run added42,866. The latter aggregate sorted expanded JSON to enforce ordering.
V59 removes that wide sort, retaining explicit narrow ordering and exactly the
same fields, page contract and access. Its complete local replay reports zero
temporary writes, and CI now exercises this specific regression. This follow-up
must pass the same protected-publication and live normal-cycle checks.

Host memory remains a separate observation. At18:10:48UTC commitment was3.978GB
against a3.079GB limit, available RAM1.540GB and occupied swap446.6MB. No new
swap-out pages or OOM kills occurred between17:57 and18:10, but this short window
cannot establish that host memory pressure is resolved or attribute the observed
decline to the new reader.

## Verification and reproduction

`scripts/test-cfb-bounded-history-page-postgres.mjs` executes the actual migrations
twice against disposable PostgreSQL/PGlite. A synthetic numeric-tape test under
64 KiB work_mem reproduces V58 wide-sort disk spilling, verifies exactly equal
V59 results, and requires zero V59 temporary blocks. It checks exact projection equality,
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
game cohort's complete history and source snapshots. After each additive migration,
compare the live RPC with that baseline and verify normal leased refresh, published
member coverage, existing lock hashes and unchanged tracking. Apply no ad-hoc
provider refresh. Measure current host commitment/swap separately; a successful
transport pilot does not establish that whole-host memory pressure is resolved.

Rollback: restore the prior application transport; the unused SELECT-only function
can remain. Never delete or rewrite snapshots, locks or tracking to roll back.
