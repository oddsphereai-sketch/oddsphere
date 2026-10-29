# NBA consumer movement-trail coherence

Date: 2026-10-29  
Status: candidate passed; production verification pending

## Owner requirement

The member product must show a real regulated consumer line such as ATL -1 or
-1.5. Circa and Pinnacle remain valuable internal sharp-reader inputs, but a
Circa PK must not replace the consumer handicap in the displayed movement
panel. No line may be rounded, converted, or invented.

## Change boundary

`selectNbaMovementReference` now accepts only the approved consumer execution
cohort for member-facing odds and line history. It prefers the sportsbook that
owns the evaluated exact price when a fresh complete two-sided pair exists,
then falls back to the deepest fresh consumer-book chronology. The professional
reader continues to receive the complete eligible sharp and consumer price
set. The separately labeled sharp-split resolver is unchanged.

Model r24, market marriage r25, grade policy r15, line refresh r20, injuries,
scores, probabilities, sides, exact prices, grades, stakes, provider calls,
writer, lease, cadence, and lock boundary are unchanged. This repair changes
only future-unlocked member evidence. Locked snapshot/publication advance to
`nba_locked_member_snapshot_2026_10_29_r7_consumer_trail_coherence` and
`nba_member_lock_publication_2026_10_29_r9_consumer_trail_coherence` so older
locked payloads remain exact and readable.

## Required gates

- A same-depth Circa trail cannot displace the evaluated FanDuel trail.
- A fresh Circa PK cannot enter the member line trail for a consumer 5.5 (or
  ATL -1/-1.5) selection.
- Circa can still reclaim the separately labeled sharp-split panel when a
  complete current Circa split pair exists.
- Locked writer immutability and reader precedence must pass.
- Same-input scores, picks, probabilities, exact prices, grades, promotions,
  demotions, actionables, and stakes must remain unchanged.

## Candidate result

The October 29 credential-backed read-only rehearsal covered three games, nine
markets, 214 complete price rows, and 12 books with zero incomplete groups or
provider errors. The incumbent and candidate both contained two actionables.
There were zero promotions, zero demotions, zero side changes, and zero score
changes. CLE-ATL retained ATL Moneyline at FanDuel -108 and ATL -1.5 -104 at
FanDuel; the member movement trail now remains on FanDuel rather than exposing
Circa's internal PK. The full model-change suite, focused reader tests, locked
snapshot precedence, T-60 lifecycle, TypeScript, and source-eligibility gates
passed before publication.

## Rollback

Revert the member-reference filter and the r7/r9 publication identifiers as
one unit. Do not rewrite, reinterpret, or replace any existing locked payload.
