# NFL Spread/Total Market-Topology Provisional Lane — Predeclaration

## Purpose

This candidate tests a football-market topology policy rather than reusing a globally
overconfident r10 exact-price rule. The r10 PMF must still select the same side and supply
the scoring cushion, but the release learns separately whether that direction is credible
inside stable spread/total regimes. It does not use current Week 1 to choose a regime.

## Chronology and eligible inputs

- 2023 selects one fixed topology rule per market.
- 2024 and 2025 are confirmation.
- Inputs are restricted to the opening timestamp, r10 direction/probability/cushion, the
  target-excluded same-line fair probability and book count, target exact quote, home/away
  or over/under side, and frozen line topology.
- The result, closing line, post-kickoff state, and reconstructed final availability are
  prohibited. At least two comparison books and a price from -200 through +200 are required.

Spread topology is the cross product of all/home/away, all/favorite/underdog, and line
magnitude bands all, 0–2.5, 3–6.5, and 7+. Total topology is over/under crossed with line
bands all, <=41, 41.5–47.5, and >=48. The exact-price grid uses r10 probability floors
52.5%, 55%, 57.5%, and 60%; EV floors -1%, 0%, 1%, and 2%; leave-one-book-out edge floors
-1, 0, 1, and 2 percentage points; cushion floors 0, 0.5, and 1 point plus the frozen
key/zone half-point penalty.

## Pragmatic release gates

2023 selection requires at least 12 bets/six weeks, positive units, at least -0.5 units
without the largest win, calibration gap <=12 percentage points, and at least two books.

A provisional Lean requires at least 20 confirmation bets and six in each season,
positive pooled and largest-win-independent units, neither season below -10% ROI with at
least one positive, pooled calibration gap <=12 points and each season <=16, weekly-cluster
bootstrap probability-positive >=60%, and at least two books. Confidence intervals may
cross zero; no stake increase is permitted. Best Angle adds positive units and
largest-win-independent units in both seasons, >=4% pooled ROI, <=10-point calibration in
each season, and probability-positive >=75%.

Watchlist is non-actionable and uses the selected topology with an exact-price EV or edge
within two percentage points of the Lean boundary. No Play is the evaluated coherent
fallback. Held is only for genuine data/identity/availability failure. No quotas apply.
