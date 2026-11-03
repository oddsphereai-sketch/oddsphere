# CFB retained news reader admission — November 3

Starting clean worktree base `5f8ce7bc8473aa8cefb9fb2a55987866be7b6f68`;
fresh-integrated main `08ed77d5fa142e845366b248048816cfae9e5ce2` before editing.

PR956 corrected fresh parsing and source retention, but the normal post-deploy
14:45:37 member snapshot still exposed both old fake ESPN player names. The
member fixture's availability map copied each latest raw report directly;
not-yet-refreshed games could therefore republish previously malformed partial
news even though the live parser no longer admitted it.

Reader source release `cfb_member_availability_2026_11_03_r1_retained_news_identity`
now requalifies only an explicitly open game with lockedAt=null. The same R2
news identity check is reused; valid players and clocks stay exact, malformed
partial news is absent rather than medical clearance, and raw evidence is never
modified. Locked, locking, missed, unknown-state or existing lockedAt payloads
retain their exact original report. The release is recorded separately in the
fixture's availabilityEvidenceRelease provenance; numerical fixture/snapshot
contracts remain unchanged because no score, probability, pick, price, grade,
stake or model input authority changes. Public news still has zero numerical
model authority; no injury-point penalty is introduced.

A member-fixture integration test reproduces the stale raw row, verifies it
cannot republish on open cards before the next capture, compares the complete
prediction/grade games byte-for-byte, proves raw source immutability and checks
exact locked report precedence. Focused news, full model safety, type/lint/build,
clean fresh-main overlap safety, protected PR and normal post-deploy publication
proof remain required. There is no new provider call, job, writer, lease,
schema migration or locked correction.
