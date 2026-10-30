# CFB immutable-lock release-wave handoff

Base: `ae535d9da9d9945ff4d9f86a2c617107ef2a1a76`.

The deployed r143 writer now has zero coherence failures, but reader selection
can lose the r55 locks created during its incomplete release wave. The r54/r55
compatibility chain omitted the existing immutable-lock overlay used by earlier
release families. As a result, missing locked games made the complete-current
boundary fail and forced an ancient full-board availability fallback.

Repair only that compatibility chain: overlay verified immutable r54/r55 locks
onto their supported complete predecessor, then apply the unchanged complete
current boundary. A missing FUTURE UNLOCKED row must still block a current wave.
Never overlay an unlocked row or replace an already valid earlier lock. Return
exact stored objects, original releases, probabilities, grades, prices and hashes.
No database mutation/reconstruction, model/calibration/policy change or new job.
No partial-current forecast exception. Fixture/snapshot/reader advance to
r98/r58/r43 and writer r144 solely to publish the repaired member envelope.
Decision/calibration remain r56/r29, collector r66, model/distribution/probability
r26/r24/r28 and policy r28; shared prediction_pipeline:cfb lease is unchanged.

Validate an incomplete intermediate release with a valid T-60 lock, newer
unlocked rows in the current release, older complete fallback rows, exact lock
identity/writer exclusion, and the still-failing missing-unlocked case. Run full
CFB/model verification, TypeScript/lint, and a READ-ONLY production evidence
replay proving selected rows are current or immutable locks—not ancient held
fallbacks. Publish only from fresh main through protected PR; verify actual
source/game timestamps and all prior locked hashes after deployment.

## Verification result

Read-only production replay at 2026-10-30 00:54 UTC read 1,079 existing source
rows, quarantined none, made ZERO provider requests/writes and selected all100
games with seven valid existing locks. Current source advanced to00:01UTC;
JMU/Troy renders its exact r55 T-60 JMU Watchlist, Under51.5 Lean and JMU-19.5
Watchlist at the original22:28UTC book prices. Baylor/UCF uses current00:00UTC
quotes rather than October25 held opening rows. Every input object stayed exact.
Machine evidence: `2026-10-29-cfb-lock-wave-replay.json`.

Focused lock-wave regression, full CFB production suite, full model-change
verification, no-emit TypeScript and changed-file lint passed. Optional local
Market Brain PostgreSQL proof was skipped without its dedicated URL; no Market
Brain code or database schema is changed. Required protected PR checks and live
source/lock verification remain before declaring completion.
