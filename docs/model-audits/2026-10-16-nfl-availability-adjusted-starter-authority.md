# NFL availability-adjusted starter authority

Date: 2026-10-16

Status: candidate correctness repair; production publication requires protected merge and live
verification.

## Scope and base

- Sport/product: NFL Daily Edge, all three full-game markets.
- Starting production base: `a0780589b15d2388fcb10e02c72b29cab9d81dd0`.
- Sole write path: `runNflForwardEvidenceWriter` under the existing
  `prediction_pipeline:nfl` lease.
- Prediction releases remain r28 model / r27 calibration / r36 decision and grade / r33 member.
- Publication-only releases advance to collector r23, writer r64, fixture r46, and snapshot r38.
- Existing locked evidence and older compact snapshots are immutable and remain readable under
  their stored releases.

## Defect

The exact-game injury feed had already marked Jalen Hurts Out and the calculation's private
quarterback resolver had already selected Tanner McKee. The writer nevertheless persisted the raw
BALLDONTLIE expected-starter pointer in `startersAndDepth`. Member key stats and the card-detail
reader consumed that raw pointer, so calculation and display could disagree.

This was not an injury-collection miss. It was a handoff/authority split after successful
collection.

## Correction

`resolveNflAvailabilityAdjustedQuarterbackDepth` is now the shared league-wide authority. For each
team it:

1. compares the provider starter status with the verified exact-game injury designation;
2. leaves a healthy or merely Questionable starter unchanged;
3. removes an Out or Doubtful starter;
4. selects the highest healthy quarterback already present in the provider depth chart; and
5. returns an unknown starter when no eligible replacement exists, preserving the existing
   fail-closed personnel hold.

The writer stores that resolved depth in `startersAndDepth`, which is used by both calculation and
member readers. It separately stores `providerStartersAndDepth` for raw provenance and uses that raw
field for future provider-continuity fallback. No name or roster row is invented.

The member evidence label is changed from “provider depth chart” to “availability-adjusted depth
chart” so the displayed source semantics are accurate.

## Same-input Week 6 rehearsal

The rehearsal ran with `apply=false`; database, member snapshot, and tracking writes were all zero.

- Complete board: 14 games / 42 markets before and after.
- Grades: 15 Best Angle / 7 Lean / 8 Watchlist / 12 No Play before and after.
- Actionables: 22 before and after.
- Promotions: 0.
- Demotions: 0.
- Side changes: 0.
- Probability changes beyond `1e-12`: 0.
- Held-game changes: 0.
- Candidate future rows: 13; inserted rows: 0.
- Carolina-Philadelphia expected quarterbacks: Bryce Young / Tanner McKee.
- Philadelphia quarterback history: exact Tanner McKee frozen-artifact match.
- Philadelphia health holds: none.

The absence of forecast changes is expected: the model calculation was already applying the same
availability replacement internally. This release makes the persisted/member authority agree with
that calculation.

## Best Angle concentration audit (no grade mutation)

The current board has 15 Best Angles among 42 market cards, not 15 games. They occur in nine of 14
games: six Moneylines, four Spreads, and five Totals. Five games have multiple Best Angles, with
Carolina-Philadelphia carrying all three.

The release-pure settled evidence is not sufficient to retune the current r36 policy safely:

- Current r36: three settled markets, including two Best Angles at 2-0. This is far too small for
  threshold selection.
- October 2 r27: Best Angle 5-11 while Lean was 3-1.
- October 9 r32: Best Angle 9-7 while Lean was 6-0.

The older releases show a real non-monotonic label-calibration warning, but pooling them into the
new r36 architecture and treating the blend as current performance would violate release-pure
evaluation. Therefore this repair does not impose a quota, one-per-game cap, blind EV threshold,
or unpaired demotion rule. A future grade candidate must use r36 locked outcomes, include a tested
promotion path for qualified Leans, report game-clustered uncertainty and board mix, and remain in
shadow until it has enough evidence.

## Verification and rollback

Required before publication:

- `npx tsx scripts/test-nfl-r6-shadow-writer.ts`
- `npx tsx scripts/test-nfl-forward-evidence-writer.ts`
- `npx tsx scripts/test-nfl-week-one-held-member-fixture.ts`
- `npx tsx scripts/test-nfl-forward-member-snapshot.ts`
- TypeScript, `npm run verify:model-change`, and latest-main integration safety.
- Protected PR checks and post-deploy proof of the r23/r64/r46/r38 tuple, McKee member display,
  one writer/lease, stable board counts, and unchanged locks.

Rollback restores future unlocked publication to r22/r63/r45/r37. It never removes or rewrites a
stored candidate row or any locked record.
