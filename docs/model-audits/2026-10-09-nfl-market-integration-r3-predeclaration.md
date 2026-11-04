# NFL market integration r3 predeclaration

Status: predeclared replacement candidate; no production publication authorized.

Date: 2026-10-09

Starting production base: `41cb2fc88d6c601d77a4932dbb1adcd1aaebfd93`.

This revision follows the failed r2 candidate. R2 correctly removed cross-book pseudo-movement but
exposed a second direction-selection defect: with no qualified sequence and no material same-book line
move, a tiny target-excluded no-vig price difference around 50% was allowed to choose and flip the Spread
side. In the opened replay that produced eight Spread side changes with three corrections and four harms.

## Frozen correction

- Qualified named-sequence authority retains first precedence.
- A validated same-book home-margin line delta of at least +0.5 may select home; at most -0.5 may select
  away.
- Without either authority, Spread direction status is `unavailable`. The independent score and Spread
  direction remain unchanged.
- Current target-excluded no-vig price quantifies a side selected by qualified direction evidence. It may
  confirm or weaken that side, but it cannot originate a direction from ordinary price noise.
- No threshold, grade rule, split rule, independent projection, Total rule, score-coherence rule, exact-
  price rule, provider, cadence, or lock behavior changes in this revision.

The r2 product-safety acceptance gate remains mandatory: no market with current actionables may go to
zero, the complete current board may not lose more than half its actionables, and the candidate must
retain a real promotion/confirmation path without lowering thresholds to fill the board.
