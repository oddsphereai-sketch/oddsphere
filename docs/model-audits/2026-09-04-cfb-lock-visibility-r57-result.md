# CFB cross-release lock visibility r57 — result

Date: 2026-09-04

Status: production candidate; focused and full safety gates remain required before protected publication.

## Finding

SJSU at Eastern Michigan (provider game 457907) was scheduled for 22:30:00Z with a 21:30:00Z T-60 boundary. The sole writer captured a valid lock at 21:39:53.584Z, 9 minutes 53.584 seconds after the scheduled boundary and inside the declared 20-minute maximum lag. Evidence r20/member r32/decision r29 has no health hold, enables tracking, and stores all three decisions as `t60_locked` at that exact timestamp.

The r56 card incorrectly showed `open`, `lockedAt=null`, and an unlocked September 1 tuple. The r21 reader knew neither r20 nor r19 as transition authorities. Because both r20 and r21 were partial waves, the reader fell through to the older unlocked evidence even though the immutable r20 row and all three tracking records were intact.

## Correction

- The bounded store now reads and validates r19 and r20 alongside active r21.
- The member selector assembles r19 as the preceding authority, overlays only independently valid immutable r20 T-60 rows, and then applies the existing r21 boundary transition.
- The lock-only overlay rejects unlocked, held, late, non-tracking, timestamp-incoherent, unknown-game, and release-incoherent rows. It cannot manufacture a prediction or refresh an unlocked game across releases.
- Fixture/outcome advance to r48, compact snapshot to r6, and the sole leased writer to r50. Evidence r21, member r33, decision r30, grade policy r11, tracking r18, and the zero-stake policy are unchanged.

## Read-only production comparison

At 2026-09-04T23:12:27.484Z, the candidate read 5,462 bounded evidence rows and rebuilt all 106 current weekly games. Normalized comparison with the latest production r5 snapshot found exactly one changed game: SJSU@EMU.

- Production card before: open; no lock timestamp; EMU -156 Lean, EMU -3 -108 Lean, Under 56.5 -110 Lean.
- Candidate card after: locked at 21:39:53.584Z; EMU -118 Lean, EMU -1.5 -108 Watchlist, Under 55.5 -115 Watchlist.
- The candidate tuple exactly matches immutable prediction records 203003–203005, whose internal game ID is 62180 and external ID is 457907. All three retain decision r29 and the exact lock timestamp.
- The 318-market board changes only because the stale unlocked EMU card is replaced by its authoritative locked tuple: 67 Leans / 100 Watchlists / 143 No Plays / 8 Best Angles becomes 65 / 102 / 143 / 8. This is not a new grade calculation or a retrospective prediction change.
- The other 105 games have no normalized lock, pick, grade, price, or locked-line change.

## Acceptance and rollback

The focused regression constructs a complete r19 authority, an incomplete r20 wave containing one valid T-60 lock, and an incomplete r21 refresh. It proves the exact r20 row survives byte-for-byte and the member card renders the stored lock timestamp. Existing transition, T-60, pagination, writer, tracking, and public-coherence assertions remain in the same production suite.

Rollback restores writer r49, fixture/outcome r47, and compact snapshot r5. It must not delete or rewrite r20 evidence or prediction records 203003–203005.
