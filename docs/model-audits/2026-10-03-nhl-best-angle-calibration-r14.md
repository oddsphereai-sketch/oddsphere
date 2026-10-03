# NHL Best Angle calibration r14 — 2026-10-03

## Decision

Release `nhl_regular_2026_r14_best_angle_calibration`, calibration
`nhl_regular_calibration_2026_r14_best_angle_calibration`, and decision
`nhl_regular_decision_2026_r14_best_angle_calibration` change only the
downstream exact-price confidence tier.

- Moneyline Best Angle requires at least 70% selected-side probability and a
  5-percentage-point edge over the exact selected price.
- Total Best Angle requires at least 65% calibrated selected-side probability
  and the same 5-point exact-price edge.
- A prior Best Angle that misses either requirement becomes a Lean. It does
  not become Watchlist or No Play.
- Puck-line Best Angle and the validated 58% / 5-point Watchlist-to-Lean
  promotion remain unchanged.

This release changes no score, side, probability, market-reading input,
price, stake, provider call, schedule, writer, lease, member copy, label,
layout, lock, or tracking contract.

## Evidence and board impact

The release-separated r13 settled sample is small and is not treated as a
future hit-rate estimate. It nevertheless shows that the existing confidence
tier is too permissive: seven settled Total Best Angles are 2-5 and four
settled Moneyline Best Angles are 1-3. The existing historical research still
supports the underlying prediction model and actionable surface, so the repair
does not flip picks or suppress actionability.

The exact October 3 production-board replay contains 13 games and 39 markets.
It moves 14 Best Angles / 16 Leans / 9 Watchlists to 6 / 24 / 9. Six Total and
two Moneyline Best Angles become Leans. There are zero side changes, zero
probability changes, zero score changes, zero actionable demotions, zero
actionable promotions, and all 30 actionable markets remain. The existing
puck-line promotion path remains active even though no current Watchlist
qualifies.

## Release gates and rollback

Run the focused NHL suite, TypeScript, `npm run verify:model-change`, an exact
current-board replay, latest-main integration safety, protected pull-request
checks, and live writer/reader verification. Locked r13/r12/r10/r9/r7 tuples
remain immutable and tracking-eligible. Roll back unlocked r14 output on any
pick, score, probability, price, stake, lock, tracking, game-count, or
actionable-count change; mixed unlocked releases; writer overlap; or reader
failure.
