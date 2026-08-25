# NFL actionable grading r9 Watchlist predeclaration

Date: 2026-08-25

The r8 Best Angle and Lean policies remain frozen. This pass changes no actionable side, price,
probability, threshold, return, stake, or tracking behavior. It defines a coherent monitoring
lane for corrected Spread and Total probabilities so that `Watchlist` means close to—but not
through—the exact-price Lean boundary rather than requiring the older uncorrected 60% threshold.

For a market that does not qualify as Lean:

- Spread Watchlist requires selected probability at least 50%, expected value at least -2%,
  target-excluded consensus edge at least -1 percentage point, and score cushion within 0.5
  points of the frozen Lean cushion after the same key-number penalty.
- Total Watchlist requires selected probability at least 52.5%, nonnegative expected value,
  nonnegative target-excluded consensus edge, and score cushion within 0.5 points of the frozen
  Lean cushion after the same low/high-total-zone penalty.
- missing multi-book comparison, stale/post-kick prices, an out-of-range price, or any health hold
  remains fail-closed rather than Watchlist.

These boundaries are one fixed step below the r8 Lean thresholds. They are descriptive monitoring
states, not bets, do not count as actionable promotions, and do not authorize a stake. Week 1
counts will be reported only after this document is committed.
