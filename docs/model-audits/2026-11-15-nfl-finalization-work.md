# NFL R100 / R119 finalization work

Base: 25e0d8749bd4203d1b887e6b6eefd424cc77a8f9. Own clean worktree only.

An ordinary R99/R118 cycle timed out at 540 seconds after its full-game append,
compact member snapshot and native props canonical writes had completed. The exact
outstanding await is unknown. This release removes independently reproduced redundant
CPU/copy work and adds private phase completion evidence; it does not assert a cure.

Compact member construction repeatedly decoded 3.108GB of historical data in a private
5117-row replay. An 8MB per-game market-only memo retained exact stored snapshot bytes,
with 149115 decodes reduced to 5170 in the initial diagnostic. The actual final source
must independently reproduce parity; timings are environment-specific. Other lazy
source groups, every verification/read bound and old first locks remain unchanged.

Foreign-game native baseline serialization is unnecessary for exact current-game
qualification. Filtering before clone preserves original own-row data, source/proof
hashes, sampled clocks and all reader/writer lock precedence. This modest copy saving
is not a demonstrated multi-minute bottleneck.

No mathematical demotion or promotion is proposed; every row, actionable grade,
projection, probability and stake must be identical under a fixed clock. Shared
NBA/NFL/MLB generation R39 and all numerical releases remain unchanged. Private logs
carry stage/release/time/process bytes only. The shared sport lease still drains both
writers; no new refresh, paid run, claim, provider request, DB migration or hold release.

Required before protected release: affected meaningful tests, mandatory model gate,
full TypeScript/lint/build, all-AI-mocked real PostgreSQL proof and hosted checks,
two consecutive fresh all-three whole-product clear rounds on the unchanged candidate,
fresh-main integration/overlap/protection/exact-tree proof. Then actual Ready-www/source
and only normal scheduled generation/publication/refresh/lock evidence. Missing live
cause, original paid-test ledger and historical evidence limitations remain explicit.
