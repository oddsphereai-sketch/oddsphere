# Confirmed completed-game DNP settlement

Base: `3bd2e39d0f95e4348c1a2b51efc774dc9056700d`.

The result audit found that missing stats and snaps correctly stayed unknown,
but explicit completed-game DNP declarations had no settlement path. R7 uses
the existing provider's documented game-scoped `player_designations` endpoint
only after exact final stats and positive snap lookup fail for a player. It
requires one exact provider player, game, team ID/abbreviation, season/week and
season phase, strict `did_not_play:true`, and no starting/played contradiction.
Active status and practice participation cannot stand in for game participation.
Voids retain `actual_value:null`; zero-stat players with verified participation
keep the existing numerical result path. Unknown or conflicting evidence remains
pending instead of being fabricated as a favorable Under or a void.

No prediction, probability, projection, pick, play grade, stake, calibration,
market selection, model input, review schedule, AI request, monthly target or
emergency limit changes. Board-count impact: zero promotions/demotions. The sole
sport-scoped leased writer is R79. Provider designation requests are lazy and
bounded to two pages per affected game; the conservative incremental request
ceiling advances from132 to168. There is no additional read for an established
stat or positive-snap result. API errors/incomplete pagination cannot create
outcomes. Predictions/member publication precede this existing settlement postlude.

The historical recovery operator requires an owner-reviewed audit digest before
application. V3 adds nullable void proposals and optional exact-file-hash-bound
official NFL gamebook evidence for a specifically reviewed DNP. It does not guess
participation from missing rows, edit a locked snapshot or become a normal cron
override. Source disagreement is explicit and included in the owner's approval.
Existing settled outcomes must match the approved audit before any recovery write.
Only `result`, `actual_value`, `settled_at`, `updated_at` may change under the same
lease. Original identities and all locked source fields remain exact.

Validation: mocked actual-settlement path covers DNP voids, active/unknown/false/
string/duplicate flags, exact identity/phase/finality, stat and snap precedence,
unknown retained, dry run and already settled immutability, page/request bounds.
Pure reviewed-source tests bind record/game/player/team/source bytes and reject
altered PDFs. Existing locked reader/writer/tracking tests, full protected model
gate and real PostgreSQL proof, build/types/lint and latest-main integration apply.
No paid AI tests or manual review/cron calls. Production code readiness and actual
normal post-deploy outcome writes must be verified separately. Historical recovery
is not authorized by merging this code; explicit owner approval is still required.

Primary API contract: https://nfl.balldontlie.io/#player-designations .
Rollback through a fresh protected PR restores settlement R6/writer R78 while
retaining all legitimately filled outcomes, locked data and source documents.
