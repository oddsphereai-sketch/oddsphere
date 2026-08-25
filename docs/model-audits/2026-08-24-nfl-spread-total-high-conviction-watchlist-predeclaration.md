# NFL Spread/Total High-Conviction Watchlist — Predeclaration

## Release boundary

This is a non-actionable product taxonomy release, not a newly validated wagering lane.
The prior exact-price, high-conviction, residual-classifier, and topology tournaments did
not authorize any Spread or Total Lean or Best Angle. Those rejections remain binding.

The release prevents every healthy forecast from collapsing into the same No Play bucket.
It identifies a small set of coherent, high-conviction forecasts worth monitoring while
keeping their exact-price Bet grade explicitly non-actionable. No stake or tracking row is
created from a Watchlist.

## Frozen Watchlist semantics

For each Spread and Total market, the single existing writer evaluates every current
comparable sportsbook quote at its exact line. For a target quote:

- r10 supplies the selected side, conditional win probability, push probability, and
  expected scoring cushion at that exact line;
- leave-one-book-out consensus is built only from other comparable books offering the same
  two-sided line; the target book is excluded;
- at least two other books, a quote timestamp before kickoff, and American price from -200
  through +200 are required;
- the best coherent quote is selected deterministically by model EV, then edge, price,
  sportsbook name;
- Watchlist requires r10 conditional probability >=60%, EV >=0%, model edge over the
  target-excluded consensus >=3 percentage points, and expected scoring cushion >=1 point;
- key spreads (3, 7, 10, 14) and extreme totals (<=41 or >=50) require an additional
  half-point of cushion.

If every health check passes but the fixed thresholds do not, the grade is No Play. Held
is reserved for missing identity, current two-sided quote, same-line comparison inventory,
or other true data-health failure. Lean and Best Angle are impossible in this release.

## Audit disclosure

The owner-provided current Week 1 examples were inspected before this product-semantic
rule was frozen. Therefore current board counts are impact analysis, not validation or
threshold-selection evidence. Historical 2023/2024/2025 returns, calibration, CLV,
largest-win sensitivity, and weekly bootstrap are reported for transparency but cannot
promote the non-actionable tier into a Lean.
