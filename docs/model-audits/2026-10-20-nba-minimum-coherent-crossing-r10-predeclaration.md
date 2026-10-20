# NBA minimum-coherent crossing r10 predeclaration

Date: 2026-10-20

Status: production-candidate contract; no authority before gates and protected pull request

## Problem

The r9 qualified reader mirrors the complete independent residual across the
posted line when its Spread or Total read changes a decision. Historical
diagnosis found that the categorical side was useful, but mirroring the full
residual made the representative score move farther than necessary.

## Frozen candidate

The candidate does not add a model/market weight, ingest a market-implied team
score, change reader qualification, or create a second prediction path.

When the existing r9 reader does not apply, the independent margin and Total
remain unchanged. When it does apply:

- retain the exact r9 Moneyline, Spread, and Total directions;
- constrain the independent location to the nearest point that preserves those
  decisions against the executable line;
- use the existing 0.25-point minimum residual as decision separation; and
- derive both team scores and every probability from that one coherent margin
  and Total.

The fixed 0.25 points is not a market weight or a correction cap. It prevents a
tie at the decision boundary. Aligned independent projections remain untouched.

## Required gates

1. On the two-season historical proxy, preserve every r9 Moneyline, Spread,
   Total, selected-underdog, +3, and +6 direction.
2. Do not worsen team-score, margin, or Total MAE in either season.
3. Do not worsen winner Brier in either season.
4. Preserve one final score/side/probability tuple.
5. Report every current-board score, pick, probability, grade, promotion, and
   demotion before publication.
6. Preserve stored locked payload precedence and the sole NBA writer/lease.
7. Advance model, market-marriage, and unified-projection releases together.
8. Pass focused NBA tests, TypeScript, `verify:model-change`, integration
   safety from current `origin/main`, protected PR checks, and post-deploy
   release/board/lock verification.

## Rollback

Roll back r10 to r9 if any pick differs on same input, any locked payload
changes, the one-score coherence invariant fails, board actionability contracts,
or the writer/lease topology changes.
