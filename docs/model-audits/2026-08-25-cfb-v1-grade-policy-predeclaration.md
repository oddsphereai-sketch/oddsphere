# CFB v1 exact-price grade policy predeclaration

Date: 2026-08-25

Status: frozen before grade-policy selection and repeated confirmation

The qualified r3 independent joint score distribution is fixed. This phase
cannot change its scores, PMF, winner, spread, or total probabilities.

For each historical game, expanding past-only fits produce the independent
probability at the archived terminal spread/total. The archived research source
does not contain named-book American prices, so historical Spread and Total
execution uses -110 and Moneyline execution uses a past-only empirical
spread-to-win curve with a conservative 4.5% synthetic overround. This
limitation is displayed in evidence and prevents any claim of historical CLV.
The forward board instead evaluates the real named sportsbook/line/price and a
target-excluded same-line consensus.

On 2023 only, each market selects:

- independent probability weight from 25%, 35%, 50%, 65%, or 100%, with the
  remainder assigned to the synchronized market fair probability;
- minimum fair-probability edge from 1, 2, 3, 4, or 5 percentage points;
- minimum expected value from 0%, 1%, 2%, or 3%.

The selection objective requires at least 15 Moneyline or 20 Spread/Total
actions, positive units after removing the largest win, and maximizes a
variance-penalized weekly return score. The selected rule is frozen before
2024/2025 repeated confirmation.

A Lean lane qualifies only if pooled confirmation units and largest-win-removed
units are positive, neither season is below -3% ROI, and the weekly-cluster
bootstrap median ROI is positive. A stronger Best Angle subgroup adds two
percentage points to both edge and EV thresholds and requires at least five
actions plus positive raw and largest-win-removed units in each confirmation
season. Watchlist requires a complete tuple with positive edge and EV that
misses the qualified Lean rule. No Play is a complete non-positive tuple. Held
is reserved for missing identity, PMF, named two-sided price, target-excluded
consensus, or lock health.

No quota, forced minimum board count, forced side, weekly cap, stake, or
reader-side grade override is allowed.
