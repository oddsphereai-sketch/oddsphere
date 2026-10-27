# NFL player-props Receiving Yards direction correction predeclaration

Date: 2026-10-27

## Scope and frozen champion

- Sport/product: NFL Player Props.
- Affected market: Receiving Yards only.
- Affected layers: target-book-excluded market reader, coherent published posterior/projection, exact-price grades derived from that posterior, member snapshot, writer, and tracking release stamps.
- Unchanged: every independent point head, distributions, features, injuries, usage inputs, Passing Attempts, Passing Completions, Passing Yards, Receptions, Rushing Attempts, Rushing Yards, Anytime TD, prices, line selection, provider bounds, cadence, UI, copy, public tracking, and the `prediction_pipeline:nfl` lease.
- Frozen champion: r16/r27/r29/r33/r34/r37 portable artifact/model/calibration/decision/runtime/board, member r46, lifecycle r28, writer r60, tracking r34.
- Sole authoritative writer: `runNflPlayerPropsProductionCycle` under `prediction_pipeline:nfl`.
- Locked rows: immutable and reader-authoritative; only future unlocked rows may use the candidate.

## Problem statement

The current board looked globally Under-heavy, but a release-pure market-by-market audit rejected a universal direction rule. Quarterback volume was approximately balanced, Receptions already had a qualified market correction, and a Rushing Yards correction failed later-week confirmation. Receiving Yards was the reproducible defect: the independent direction and the residual posterior remained heavily Under despite target-book-excluded prices identifying correct direction changes.

## Candidate

Receiving Yards joins the existing source-aware reference lane. When at least one fresh target-book-excluded comparison exists and its transported, source-weighted direction crosses 50% opposite the independent direction, that market direction becomes the final posterior direction. When the directions agree, or no independent comparison exists, the preceding posterior is exact. This is categorical arbitration after the independent model, not scalar market weighting and not an Over quota.

## Frozen evidence plan

1. Selection block: exact 2026 Week 6 r32 canonical-main-line Receiving Yards outcomes.
2. Confirmation block: exact 2026 Week 7 r32 canonical-main-line Receiving Yards outcomes.
3. Current unlocked rehearsal: a credential-backed Week 8 no-write production cycle using fresh ordinary quotes plus the isolated Pinnacle/NoVig lane.
4. Rejection controls: the same rule for Rushing Yards and any broad all-market direction-balancing rule.

Required reporting: direction record, Brier score, Over/Under mix, projection/side coherence, exact grade promotions/demotions, action count, unchanged-market parity, API ceiling, lock immutability, and one-writer/one-lease invariants.

## Release and rollback boundary

The candidate advances portable artifact/model/calibration/decision/runtime/board to r17/r28/r30/r34/r35/r38; market reader/residual/coherent projection to r5/r10/r4; member/lifecycle/writer/tracking to r47/r29/r61/r35. Roll back only future unlocked rows to the frozen champion if direction confirmation regresses, current coverage contracts, mixed releases appear, a stored lock changes, provider calls exceed the existing bound, or the board becomes incoherent.
