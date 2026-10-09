# CFB started-game board-retention correction

Date: 2026-10-09  
Production base: `407b6b30947155b8911f07bd1b21b46d57e04df9`

## Live failure and root cause

Florida State at Louisville (`providerGameId=457337`) started at
`2026-10-09T23:00:00Z`. Production still contains its valid immutable T-60
capture from `2026-10-09T22:09:48Z`. That payload belongs to the complete
81-game CFB slate, is tracking-enabled, and contains three evaluated markets.
It was not deleted, mutated, or reconstructed.

The first r58 provider-continuity collection after kickoff could create plans
for only the 80 games that had not started. Those new rows therefore declared
an internally complete 80-game release wave. The release-aware reader correctly
preferred that newer wave but had no lifecycle rule to carry a locked game
that could no longer receive a row under the new release. The compact snapshot
therefore contracted from 81 to 80 and Florida State-Louisville disappeared at
kickoff even though its public record was still stored.

## Correction

After selecting the authoritative release wave, the CFB member fixture retains
a missing game only when all of the following are true:

- an exact stored row passes the existing immutable T-60 boundary validator;
- the row's game date equals the shared current Daily Edge board date; and
- the selected release does not already contain that provider game ID.

The retained value is the exact stored immutable row. No projection,
probability, pick, grade, price, stake, evidence field, or timestamp is changed
or mathematically reconstructed. The shared CFB board-date helper rolls at
03:00 ET, so the record remains visible through the night and becomes
ineligible exactly when the next board day begins.

Unlocked, late, unhealthy, incomplete, and non-T60 rows fail closed and cannot
be resurrected. A current-release row always takes precedence over retention,
so the rule does not create duplicate games.

## Release and impact boundary

This lifecycle correction shares the r59 provider-continuity publication
family because both defects were discovered while validating the first r58
production cycle. It advances the collector, member, writer, fixture, public
outcome, compact snapshot, and reader identifiers. The evidence schema,
independent score, probability calibration, grade policy, decision policy,
professional market reader, and official tracking contracts are unchanged.

The credential-backed reconstruction also found an earlier same-day instance:
Florida A&M at Alabama State started at noon ET with a valid immutable T-60
record but had been omitted by an earlier post-kickoff release transition. The
expected current-board impact is therefore two restored locked games (80 to
82), with each game's exact previously published score, sides, probabilities,
grades, prices, stakes, and evidence. There are no promotions, demotions,
changed predictions, or newly actionable plays.

## Required verification

- Unit proof that an immutable lock remains at 02:59:59 ET and leaves at
  03:00:00 ET.
- Unit proof that an unlocked row is not retained.
- Credential-backed reconstruction of the current production evidence showing
  Florida State-Louisville and Florida A&M-Alabama State restored as `locked`
  and the board restored to 82.
- The CFB publication, reader-transition, lock, coherence, and model-change
  suites.
- Clean latest-main integration safety, protected PR checks, and a post-deploy
  CFB cycle proving the r59/r45 release family, an 82-game member snapshot,
  immutable lock equality, one writer/lease, and no mixed reader tuple.

Rollback the complete r59/r45 family to r58/r44 if the restored row differs
from its stored T-60 payload, any ineligible row is retained, the record remains
after the 03:00 ET rollover, or any release, lock, lease, or board-coherence
check fails.
