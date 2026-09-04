# Daily Edge confidence / execution r2 activation predeclaration

Status: outcome-blind, pre-implementation declaration. MLB first inning is excluded.

## Product behavior being corrected

`Best Angle`, `Lean`, `Watchlist`, and `No Play` describe confidence that the published side will
win. A named-book price remains attached to the recommendation, but the price and its exact-price
EV do not determine that confidence label. The price instead determines whether an otherwise
confident recommendation is `Bet`, `Shop`, or `Unavailable` at the displayed sportsbook.

This is not permission to make every forecast actionable. Game, team, market, side, line, quote
provenance, quote freshness, coherent probability, required model-health inputs, release identity,
pregame timing, and immutable lock rules remain hard requirements. Missing optional splits are
neutral. Ordinary split disagreement, sharp money, public money, and same-book movement are signed,
bounded evidence; no one ordinary signal is an automatic promotion, demotion, veto, or side flip.

## Shared decision contract

The r2 shared resolver receives a sport-owned continuous confidence score and optional previous
unlocked confidence grade. It applies only the sport's final display bands plus price-blind
hysteresis. It then evaluates a real quote independently:

- `Bet`: Best Angle/Lean confidence and non-negative exact-price EV at a fresh coherent quote.
- `Shop`: Best Angle/Lean confidence but negative exact-price EV at the displayed quote. The exact
  sportsbook and quote remain visible; stake is zero and the row is excluded from wager ROI.
- `Monitor`: Watchlist/No Play confidence with a real quote. Positive EV cannot promote it.
- `Unavailable`: missing, stale, incoherent, or invalid quote; never a wager.

All locked side-bearing predictions continue to count in prediction accuracy. Confidence-grade
accuracy is distinct from displayed-quote Bet ROI. A Shop can be evaluated for side accuracy but
must never be retrospectively assigned units at a price the system did not lock.

## Model scope

Production candidates are evaluated separately for MLB full-game Moneyline/Total, CFB and NFL
Moneyline/Spread/Total, WNBA Moneyline/Spread/Total, NBA Moneyline/Spread/Total, NHL
Moneyline/Total, EPL/World Cup/UCL regulation markets, and the supported Daily Edge soccer
markets. MLB first inning remains owned by its independent r85 release and is compatibility-only.
CBB has no active actionable champion and receives a contract guard rather than fabricated grades.

Player Props remain outside this full-game activation. Portfolio quotas there control correlated
exposure and require a separate cluster-aware release; they may not be silently removed by a
full-game contract.

## Evidence and activation gates

Each sport must identify its sole writer and current immutable releases, report identical-board
confidence promotions/demotions, Bet/Shop/Monitor/Unavailable counts, side changes, quote coverage,
and market mix, and evaluate chronological release-pure locked results where available. No score or
band may be tuned on the final evaluation outcomes. Sports without an adequate independent cohort
remain forward-evaluated under the same frozen r2 semantics until their activation gate is met.

Every production cutover requires sport-scoped release bumps, writer/reader/tracking coherence,
the shared `prediction_pipeline` lease, focused tests, `npm run verify:model-change`, TypeScript,
production build, latest-main integration safety, protected PR publication, and natural-writer
production proof. Existing locked and settled records are immutable.

Rollback is the complete preceding sport release. Mixed releases, missing prices presented as
normal wagers, a flat actionable board, source-identity drift, writer overlap, tracking/reader
incoherence, or unexpected board expansion outside the reviewed comparison blocks or rolls back
activation without deleting the new release's evidence.
