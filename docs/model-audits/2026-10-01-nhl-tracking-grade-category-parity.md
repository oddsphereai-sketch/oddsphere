# NHL tracking grade/category parity — 2026-10-01

## Scope

This is a read-only tracking aggregation repair. It changes no NHL prediction,
projection, probability, side, line, price, grade, result, lock, model release,
calibration release, stake, Daily Edge card, member copy, label, or layout.
Immutable `prediction_records` and `prediction_grades` rows are not rewritten.

## Defect

The NHL writer stores the same model verdicts using the shared Daily Edge
presentation vocabulary:

- `best_signal` = Best Angle
- actionable `model_only` = Lean
- `market_watch` = Watchlist
- `model_only` with `no_bet=true` = No Play / Pass

The tracking aggregate recognized only canonical `best_angle`, `lean`, and
`watchlist` tokens. NHL therefore remained in overall market-category accuracy
but silently disappeared from Best Angle/Lean cuts and from canonical
play-grade grouping.

## Repair

`effectiveTrackingPlayGrade` translates the NHL locked vocabulary at read time.
Explicit display overrides and immutable member-facing-at-lock grades retain
their existing higher precedence. All other sports retain their prior behavior.

## Live-data replay

The read-only consistency audit used the exact eligible, deduplicated locked
rows and their attached outcomes:

- 2026-09-29: 15 rows; 4 Moneyline Leans (2-2), 4 puck-line Leans (3-1), and
  2 Total Leans (1-1).
- 2026-09-30: 9 rows; 1 Moneyline Lean (1-0), 1 puck-line Lean (0-1), and
  3 Total Leans (0-3).
- Both canonical locked cohorts contain zero Best Angles. The repair does not
  promote or relabel any row to manufacture one. It ensures that a future
  eligible `best_signal` row is counted as a Best Angle.
- Expected and aggregate outputs matched with zero mismatches on both dates.

## Verification and rollback

Focused aggregate tests cover all four NHL translations, TypeScript passes,
and the live-data consistency audit remains write-free. Roll back by restoring
aggregate v11; do not alter the immutable rows.
