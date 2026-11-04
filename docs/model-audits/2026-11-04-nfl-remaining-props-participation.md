# Remaining NFL props: official identity and participation recovery

Starting production base: `1c2dd053ac133f7fb226818d60411ea75b191614` (PR985).
Scope: NFL props settlement and future insert-only tracking identity. The sole
NFL prediction writer and shared `prediction_pipeline:nfl` lease remain.
No model input, forecast, probability, projection, pick, evaluated price,
calibration, grade, stake, member selection or frozen payload changes.
Promotions/demotions/side changes/actionable-board delta:0/0/0/0.

## Diagnosis and evidence

Of24 pending records,17 have the same unique official game/team/player after
removing a conventional trailing Sr., Jr. or III suffix. Seven lack a box-score
row but have positive final-game official snap counts:

- Mark Redman GB, game1392323:27 offensive /7 special-teams snaps.
- Devontez Walker BAL, game1392324:8 offensive snaps.
- Jack Bech LV, game1392328:25 offensive snaps (two records).
- Emanuel Wilson SEA, game1392336:7 special-teams snaps.
- Eric Saubert SEA, game1392336:15 offensive /16 special-teams snaps (two records).

Participation is established independently of a missing stats row. No player
is guessed to be DNP; no outcome is guessed from an empty/failed stats response.
Official source: https://nfl.balldontlie.io/#snap-counts . Exact-game final stats
and snap evidence were captured through14 bounded authenticated read requests.
The DraftKings participation rule includes special-teams plays; Emanuel Wilson
therefore has action with zero rushing yards, rather than an invented DNP void.
Regulator-hosted house rules:
https://massgaming.com/wp-content/uploads/DraftKings-House-Rules-8.1.24.pdf .

Read-only audit:
`/private/tmp/oddsphere-nfl-remaining24-owner-review-20261104.json`.
SHA256: `362a4937913450e257cbb96a997bb8389b93296052f14f611bbf9720706c368e`.
It proposes24 results, leaves0 unmatched, and hashes all original protected
fields. The owner explicitly approved this exact24-record recovery in chat.
Application remains separate from this document and follows protected deployment.
Original IDs, full snapshots, probabilities, prices, grades and stakes cannot
be updated. The operator rechecks fresh official results before each write.

## Prospective correction

Tracking r42 uses conventional trailing-suffix equivalence only for new inserts,
within the incumbent unique exact-game/start/team pre-T60 roster guard. A quote
ID has precedence. Existing rows remain insert-only, including null IDs.
Settlement r5 accepts only exact requested-game final stats, skips unsupported
markets and malformed nonnumeric fields, and uses positive valid final-game
participation as a fallback for omitted zero-stat players. A complete successful
stats response containing a final game is required first. Snap reads are lazy,
at most two100-row pages per game; pagination overflow/duplicates fail closed.
The normal null-ID queue isolation is preserved. Recovery never becomes a cron
identity repair. The sole writer is r68; no second timer or prediction writer.

## Required validation

Focused settlement tests cover suffix collisions, exact game/team/finality,
regular vs special-teams participation, zero/missing/malformed snap counts,
empty/wrong-game stats, pagination overflow, read-only proposals, outcome-only
writes and bounded old-null-ID isolation. Tracking tests prove pre-T60 identity,
wrong game/team/time rejection, suffix collisions, quote-ID precedence and exact
legacy locked-row immutability. Existing lifecycle-reader precedence tests and
full model verification, types, lint, strict current-main integration, protected
PR and production release/normal-writer/settlement/reader proof remain required.
