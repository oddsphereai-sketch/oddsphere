# EPL locked score reconstruction and NFL outcome visibility

Date: 2026-08-23

## Scope

- EPL Match Result reader only: recover the active Dixon-Coles score head for
  immutable legacy snapshots that predate `matchResultOutlook`.
- NFL Week 1 reader only: surface the already-published independent winner and
  win probability in the collapsed reader and cards while exact-price Bet
  grades remain Held.
- No writer, cron, lease, provider call, probability, pick, grade, stake, lock,
  settlement, or tracking behavior changes.

## EPL reconstruction

The locked BOU@MNC snapshot preserved the active Match Result probabilities
(MNC 66.1%, draw 19.0%, BOU 14.9%) but predated the same-head score DTO. The
reader now inverts those immutable probabilities within the same tau=-0.1
Dixon-Coles family. The recovered rates are approximately MNC 2.50 and BOU
1.145 and reproduce the three-way probabilities with squared error below
0.00005. A failed fit remains withheld. The separate market-informed Total and
BTTS goal outlook is never substituted.

Locked picks, evaluated prices, grades, and timestamps remain immutable.
Promotions: 0. Demotions: 0. Net actionable-board change: 0.

## NFL presentation

The Week 1 snapshot already contains 16 independent football forecasts, but
the collapsed summary and card headline continued to show `Pick Held` and
`Model —` because the exact-price market DTO is intentionally Held. Those
surfaces now label the separate game-level outcome forecast and win probability
from `footballProjection`; each market's exact-price Bet grade remains visibly
Held. No shadow moneyline Lean is promoted and no spread/total action is
invented.

NFL promotions: 0. NFL demotions: 0. Tracking impact: none.
