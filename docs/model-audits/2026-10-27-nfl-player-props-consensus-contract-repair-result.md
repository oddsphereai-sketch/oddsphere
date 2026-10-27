# NFL player-props Receiving Yards consensus-contract repair result

Date: 2026-10-27

## Exact replay

| Block | r34 categorical override | Repaired residual posterior |
| --- | ---: | ---: |
| Week 6, 61 consensus scopes | 33-28 (54.1%) | 36-25 (59.0%) |
| Week 7, 57 consensus scopes | 31-26 (54.4%) | 37-20 (64.9%) |
| Combined, 118 scopes | 64-54 (54.2%) | 73-45 (61.9%) |

The ten categorical side changes made by r34 contain one correction and nine
harms. This is not a preference for Unders; it is a rejection of a direction
override that failed the actual member line contract.

Settled actionables move from one (0-1) under r34 to five (4-1) under the
repair. The board expands rather than flattens.

## Frozen current-board rehearsal

Against the same 2026 Week 8 frozen inputs, old and new boards each contain 493
matched exact decision rows. Only Receiving Yards changes: eleven projection
and probability rows, three forecast sides, one actionable promotion, zero
demotions, and actionables 1 to 2. Every other market is byte-equivalent.

## Release and immutability

The repaired family is r18/r29/r31/r35/r36/r39/r48/r30/r62/r36 across portable
artifact, model, calibration, decision, runtime, board, member, lifecycle,
writer, and tracking. Ordinary unlocked rows are recomputed. Existing locked
rows retain exact stored values and their original releases.

Rollback the complete repair family to r34 only if a future-only production
cycle fails coherence, coverage, or writer health. Never rewrite a stored lock.
