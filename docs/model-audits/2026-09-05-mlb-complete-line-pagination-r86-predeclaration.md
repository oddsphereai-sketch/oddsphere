# MLB complete line pagination r86 — predeclaration

Date: 2026-09-05

## Production defect

The full-game feature snapshot reads all Moneyline, Total, and Spread history
for the slate in one PostgREST request without pagination. The September 5 MLB
slate has 1,329 qualifying rows, while the unpaginated response contains 1,000.
The omitted rows belong to the highest-id/final three games, causing their
otherwise available named-book prices to be reported as missing and their Bet
Grades to be operational No Plays.

## Candidate fixed before outcome review

- Read line history in stable ascending `lines.id` order, 500 rows per page.
- Stop only on a short page.
- Fail closed at 10,000 rows rather than publishing a partial snapshot.
- Preserve the model, probability, projection, grade thresholds, FI behavior,
  stakes, leases, locks, and sole authoritative writer.

## Acceptance gates

1. A deterministic 1,329-row fixture retains all 15 games and reads three pages.
2. A saturated bound throws instead of returning partial evidence.
3. A read-only production replay retains current named-book Moneyline and Total
   evidence for all 15 September 5 games, including the final three.
4. Report same-input board impact before publication; no hidden actionability
   collapse is acceptable.
5. Focused MLB tests, the mandatory model-change suite, TypeScript, build, and
   latest-main integration safety must pass.
