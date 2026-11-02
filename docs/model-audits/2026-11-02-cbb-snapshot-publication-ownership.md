# CBB snapshot publication ownership and duplicate-work repair

Starting production base: `cd51ad1277f8d71f35d44970415c5953561fc2bb`.
Operational release: `cbb_snapshot_publication_2026_11_02_r1_pipeline_only`.

The November 2 production public-splits verification completed at 17:33Z.
It correctly captured new observations, but its generic snapshot step read the
existing complete CBB board, overlaid reader evidence, and wrote the same
canonical snapshot key with generic payload version `v1`. This replaced the
pipeline's r10 envelope and renewed generated/expiry clocks despite not running
the authoritative model pipeline. The strict post-deploy release check detected
the unexpected v1 envelope; it did not establish that predictions were missing.
The full available board was about 7.27 MB in the earlier live proof, so this
also duplicated a large database transfer/serialization/write every public poll.

The public collector now retains both source-capture paths and its existing
sport-scoped lease but skips that generic CBB recopy. The shared generic
publisher rejects CBB before request-time board reads, database access or writes,
so another generic caller cannot accidentally renew CBB freshness. The existing
CBB pipeline publishes its unchanged r10 envelope on its usual cadence. Fresh
qualified public/named evidence remains available through the existing unlocked
reader overlay and the pipeline's persisted evidence. Existing locked payloads
retain exact stored evidence and all reader/writer precedence rules.

This is publication ownership and workload repair. It does not change any model
input, formula, projection, probability, price, pick, grade, stake or lock.
Promotions/demotions and active board-count impact are zero. No new provider
request, writer, lease, refresh cadence or member copy is added.

Verification executes the actual generic publisher with controlled dependencies:
CBB must reach no GET/read/write/cache-expiration path; all other sports retain
the exact payload/source/key publication path. The actual public route still
captures CBB public/v2 observations with unchanged provider calls, while making
no board-publication call. Existing complete/locked CBB suites, the full model
verification, production build, TypeScript/lint and fresh-base integration checks
must pass before protected PR publication. Live proof must show the pipeline
envelope survives a subsequent public-splits run, complete priced coverage and
unchanged original locked records.

Rollback removes only the generic ownership guard and public route exclusion.
It restores the duplicate read/write and misleading freshness renewal; no
stored record needs rewriting. The separate database restart cause remains
unconfirmed, and no paid infrastructure upgrade has been applied.
