# NFL spread actionable-grade recalibration predeclaration

Date: 2026-10-02

Scope: NFL Daily Edge Spread grades only. Moneyline and Total grades, every prediction side,
probability, expected score, market-reading input, exact evaluated quote, stake, lock, tracking
tuple, provider call, schedule, member label, copy, and layout are out of scope.

Writes during audit: zero.

## Problem and frozen evidence

The current Week 4 production writer is healthy and complete, but the live grade policy makes 27
of 48 markets actionable, including 12 of 16 Spreads. That is not supported by the settled public
record: across the season's append-only published releases, Spread predictions are 20-27 with two
pushes and published actionable Spreads are 9-13. Those mixed-release results diagnose the board,
but do not select the replacement rule.

Rule selection uses the exact 47-game r23 replay already frozen in
`/private/tmp/nfl-total-direction-coherent-candidate-r106.json`. Weeks 1-2 are the selection period;
Week 3 is later confirmation. Results were already known when that artifact was created, so this is
opened diagnostic evidence rather than a pristine holdout or a promised future win rate.

## Predeclared candidate

Spread actionability will require all existing exact-price reliability, nonnegative expected-value,
nonnegative edge, and score/line cushion gates plus a model probability of at least 56.5%.
Best Angle will require at least 59.0% model probability while retaining the existing positive
expected-value and edge requirements. A qualifying row below 59.0% is a Lean. Rows below 56.5%
continue through the existing Watchlist / No Play ladder.

The rule is symmetric across refreshes: an unlocked non-actionable Spread promotes when fresh
model and exact-price evidence clears every gate, and an unlocked actionable Spread demotes when
it no longer does. Grades remain strictly downstream; they cannot alter the frozen side,
probability distribution, expected score, or quote. Locked tuples remain immutable.

## Required gates

1. Weeks 1-2 selected actionables must be at least 60% correct with at least eight settled rows.
2. Week 3 confirmation actionables must be at least 60% correct with at least four settled rows.
3. The combined candidate must retain at least 30% of settled Spreads and both Lean and Best Angle
   tiers; it may not flatten the board.
4. The current Week 4 replay must retain all 16 games and 48 markets, preserve all prediction sides,
   probabilities, scores, prices, and locks, and retain at least six actionable Spreads and at least
   18 total actionables.
5. Report exact promotions, demotions, and market counts. Zero current promotions is acceptable only
   when the same symmetric future promotion path is covered by focused tests and the board remains
   above the predeclared non-flat floor.
6. Run focused NFL decision, writer, fixture, snapshot, coherence, tracking, and grade tests plus
   `npm run verify:model-change` and integration safety from the latest production base.

If any gate fails, the policy remains audit-only and the production release identifiers do not
change.
