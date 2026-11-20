# NBA prospective player-stat evidence retention

Base: 4200415dbb5698a858ccb8cfda8054d740d45aeb. November 20, 2026.

Scope: retain content-addressed, compressed per-game normalized BALLDONTLIE box
and advanced state already returned by the existing daily NBA player-state
collector. The original provider IDs and every normalized numerical field stay
exact. This is an observation foundation; it cannot alter any live forecast,
probability, grade, stake, market reader, lock or settlement. No model fitting.

The existing current-season player state allows official source corrections in
place. Main Daily Edge inputs are team aggregates. The checked player caches
contain 1,230 prior-season games (43,268 box / 32,202 advanced rows) and 226 current
season games (6,518 box / 6,382 advanced rows), but do not establish immutable
historical knowledge times or injury/transaction crosswalks. Reusing them as
original historical availability would be incorrect.

Reuse the sole existing full-refresh collection and prediction_pipeline:nba
lease. No provider call, schedule, independent job or new prediction writer.
The collector reports its exact collected game IDs; only these may be archived.
Archive only after the existing current-state write succeeds. Keep first-retained
and source-state clocks distinct; new retention never claims old knowledge.
Semantic source changes create new content-addressed rows; exact repeats retain
the original bytes and first-retained clock. No update/delete of an archive.

Use existing private lab_response_snapshots keys outside every member/lock namespace,
maximum 128 games / 4MB compressed / bounded 2.5-second storage window per run.
At most two grouped 64-key inventory reads, one insert and one ambiguous-ACK reconciliation
are allowed. Verify the actual active lease run ID before insertion; no run ID or
an expired/wrong lease means unavailable. Duplicate collisions must verify exact
original content, not overwrite it. Ten-year source retention is distinct from
member snapshot expiration. Archive failure is an explicit private finding and
cannot suppress a valid current state, forecast or publication.

Do not archive an entire season for each game, repeat historical/current source
bundles in three market records, add raw source claims to normalized data, or
backdate a new receipt. This does not yet supply the full player-state ledger:
verified pregame availability, effective-dated identities and transaction evidence
remain separate qualification gaps. The earlier ledger gates (including 1,000
complete historical selection games and 300 genuine changes) remain binding.
No new fit or numerical release until those gates pass.

Required checks: content/codec/bounds/identity/source-clock corruption, idempotent
repeat/correction/first-clock preservation, wrong or expired lease, insert collision
and lost ACK, storage failure with current-state write/forecast continuation,
unchanged collected source counts and numerical state, reader/writer lock precedence,
focused NBA source tests, TypeScript, lint, full model-change verification, clean
fresh-main integration and protected PR. All actual publication requires live
ordinary full-refresh evidence; no success from preview alone.
