# Daily Edge lock capacity repair — 2026-10-16

## Predeclared scope

This is an outcome-blind operational repair for two independent lock-lifecycle failures. It does
not change a projection, probability, side, score, grade, stake, exact price, provider, cadence,
lease, or reader decision. Existing locked records remain immutable.

## Production evidence

- The CFB sole writer failed every five minutes after the compatible 72-hour compact market-history
  projection reached 12,003 rows, three rows above its 12,000-row ceiling. All four CFB games that
  had actually reached their T-60 boundary remained locked; the first October 17 game was not yet
  lock-eligible. The outage nevertheless threatened the upcoming 95-game board because the writer
  stopped before collection and publication.
- MLB game 141164 reached T-60 with three unlocked member rows. The raw Moneyline proposal and the
  stored final public No Play matched on game, market, side, price, confidence, edge, release tuple,
  exact-price identity, canonical identity, and transition reason. The coherence gate rejected it
  because `prediction_records` returned six-decimal probability columns while the fresh proposal
  retained additional in-memory precision.

## Correction

- CFB writer r125 raises only the already-bounded compact market-history projection ceiling from
  12,000 to 20,000 rows. The 72-hour horizon, compatible releases, selected games, stable ordering,
  pagination, one leased writer, append path, T-60 rules, and fail-closed overflow remain unchanged.
- MLB lock coherence r5 compares the failed-economics tuple's numeric database columns at their
  six-decimal persistence boundary. Pick, side, line, price, public action state, evaluation identity,
  release identity, canonical identity, decision identity, and recomputed full-precision exact-price
  economics remain fail-closed. The lock freezes the existing public No Play; it does not promote the
  underlying raw Lean.

## Acceptance and rollback

Focused tests must prove the six-decimal MLB case passes while material tuple mismatches still fail,
and that CFB retains bounded stable pagination at the new ceiling. A zero-write production read must
return the complete current 12,003-row CFB history. After deployment, the natural writers must report
r125/r5, MLB game 141164 must lock before first pitch without changing its stored decision, and the
next CFB cycle must complete without rewriting prior evidence. Rollback restores the prior ceiling and
writer/coherence releases for future unlocked games only; no locked row may be rewritten.
