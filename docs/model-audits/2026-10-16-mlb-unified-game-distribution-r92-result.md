# MLB unified game distribution r92 result

Date: 2026-10-16
Frozen window: 2026-06-07 through 2026-10-15
Evidence status: opened retrospective replay plus chronology; not a claim of untouched holdout

## Decision

Advance r92 for future unlocked MLB forecasts. The release replaces the split Total/score handoff
with one factorized margin/Total forecast, preserves the complete r91 Moneyline path, retains the
target-excluded market reader, and keeps run line shadow-only. Existing locked rows are immutable.

## Exact writer replay

The final authoritative replay artifact is
`/tmp/oddsphere-mlb-unified-r92-replay-final-20261016/mlb-foundational-scoreboard-2026-06-07-to-2026-10-15.json`.

| Measure | Incumbent | r92 candidate |
|---|---:|---:|
| Final Total | 600-573-7 (51.15%), -23.804u | 622-551-7 (53.03%), +25.152u |
| Actionable Total | 130-112 (53.72%), +3.303u | 105-74 (58.66%), +23.591u |
| Best Angle Total | 26-16 (61.90%), +6.561u | 29-17 (63.04%), +9.736u |
| Moneyline side changes | — | 0 / 1,180 |
| Moneyline probability changes | — | 0 / 1,180 |
| Moneyline grade/action changes | — | 0 / 1,180 |

The candidate action board has 179 plays: 46 Best Angles and 133 Leans. The integrated writer
produces two additional winning Leans versus the 177-row predeclaration reference, so the observed
board is larger rather than silently flattened and exceeds every frozen minimum.

Actionable chronology is positive in every block:

- Development: Best Angle 11-6 (+3.825u); Lean 37-28 (+6.004u).
- Opened validation: Best Angle 9-7 (+2.231u); Lean 19-17 (+0.984u).
- Chronological confirmation: Best Angle 9-4 (+3.680u); Lean 20-12 (+6.867u).

Across every Total, the candidate changes 301 sides, corrects 161 incumbent misses, harms 139
incumbent wins, and gains 22 net correct decisions. It reports 140 promotions and 203 demotions;
those demotions are explicit and are not described as model improvement by board contraction.

## Score and alternate-line coherence

On the exact 1,180-row writer cohort, favorable Total +1 is 713-456-11 (60.99%) and favorable
Total +2 is 823-344-13 (70.52%). A broader 1,192-game score cohort moves the main Total from
50.71% to 52.87%. The unified margin distribution's
shadow run-line direction is 692-500 (58.05%), versus 703-783 (47.31%) when mechanically attaching
the shipped Moneyline side to a run line. At +1 and +2 the candidate reaches 70.81% and 76.59%.

This is evidence that the scores have more useful separation; it is not authorization to publish a
run-line pick. Run line remains a captured shadow market until release-separated forward evidence
includes exact prices and beats its paired benchmarks.

## Architecture and safety

- One expected Total plus one preserved margin recomposes one home/away score pair.
- Moneyline and run-line probabilities come from the same preserved margin distribution.
- Total and alternate-Total probabilities come from the repaired Total axis and frozen logistic.
- The existing market reader remains downstream; a qualified Total correction regenerates the
  final score pair while preserving margin.
- A failed score, direction, containment, or monotonicity invariant fails the future unlocked game
  closed instead of publishing contradictory market tuples.
- A bundle containing any locked record returns unchanged before r92 attachment or reinterpretation.
- The sole writer and `prediction_pipeline:mlb` lease are unchanged.

The 2026-10-16 SELECT-only current-board rehearsal used one frozen input snapshot for both paths.
It found one game, made zero promotions, zero demotions, zero Moneyline side/probability/grade
changes, zero Total side changes, and zero invariant failures. The Total probability changed only
inside a non-actionable Market Aligned row; the Moneyline remained the same Best Angle tuple.

## Verification

- `npm run verify:model-change`: passed, including the model-change and locked-record suites.
- `npx tsc --noEmit --pretty false`: passed.
- Changed-file ESLint: zero errors; four pre-existing unused-variable warnings remain in
  `predictionRecordService.ts`.
- `scripts/test-mlb-unified-game-distribution.ts`: passed, including score identity, containment,
  monotonicity, locked-bundle immutability, and contradictory-final-side fail-closed coverage.
- `scripts/operator/audit-mlb-unified-current-board.ts --date 2026-10-16`: passed in SELECT-only
  mode with one frozen input snapshot and no database writes.
- Repository-wide `npm run lint` remains red on unrelated pre-existing debt (1,306 errors); the
  release adds no changed-file lint error and does not modify those unrelated files.

## Rollback

Restore the r91 registry and future-unlocked computation if production shows mixed release identity,
lock mutation, invariant failures, reader/score disagreement, unexplained board contraction, or
prospective harm. A rollback cannot mutate an already locked r92 payload.
