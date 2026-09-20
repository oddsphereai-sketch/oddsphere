# NFL locked-transition publication hotfix — 2026-09-20

## Scope

This is a publication-boundary repair for NFL Daily Edge Week 2. It changes no forecast,
probability, projected score, side, exact price, grade, actionability, stake, provider request,
schedule, tracking record, member copy, or label. The sole
`/api/cron/nfl-forward-evidence` writer and `prediction_pipeline:nfl` lease remain authoritative.

## Incident

The r31 writer produced the current r17/r20 decision family for all 15 unstarted Week 2 games.
BALLDONTLIE no longer returned the completed Thursday `DET@BUF` game in the current schedule
response. Production already held a valid immutable T-60 record for that game at
`2026-09-17T23:21:09.498Z`, stamped with the immediately preceding r16/r19 member/decision family.
The fixture transition guard still named the older September 3 family, so it rejected the
otherwise coherent board as 15/16 rather than retaining the immutable locked game.

## Repair and evidence

Fixture r24 recognizes only the actual immediately preceding r16/r19 family as its transition
authority. A preceding row may cross the boundary only when it is a valid T-60 row with
`trackingEnabled=true`; unlocked, late, incomplete, or future-game rows remain rejected. The
completed `DET@BUF` tuple retains its original releases and values. The remaining 15 games use
the r17/r20 ML/Total coherence release. Snapshot r16 retains r15 then r14 as bounded availability
fallbacks; writer r32 remains the sole leased writer.

The paired production read contains 16 games and 48 markets: the immutable completed game plus
15 current-release games. Current-release actionability for the unstarted games is produced by
evidence rather than quota. This repair itself has zero promotions, zero demotions, zero side
changes, and zero probability changes.

## Rollback

Rollback is writer r31 / fixture r23 / snapshot r15. Do not alter or delete the immutable
`DET@BUF` evidence or tracking records. Roll back if any unlocked preceding-release game crosses
the transition, the board is not 16/16 and 48/48, release identifiers are incoherent, or the
single NFL lease/writer contract changes.
