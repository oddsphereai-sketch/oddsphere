# NHL coherent exact-price package r22 predeclaration

Date: 2026-10-23

Status: predeclared, read-only replay. No live authority.

## Hypothesis

The seven-game score-head handoff improves winner and score accuracy. The fixed
historical puck calibration improves later-season puck Brier/log loss but, by
itself, promotes too many seven-through-nine-game puck sides. Separately, the
released exact-price resolver permits a raw Lean to remain actionable when the
best exact quote has negative model edge. The coherent package should admit the
calibrated puck corrections while removing actionables that the final model
itself prices below break-even.

## Fixed package

1. Use the already-predeclared seven-game score-head handoff.
2. Use the frozen historical puck calibration only in the seven-through-nine
   maximum-team-game window: intercept `0.9295113063140249`, slope
   `0.002986632490336848` on raw selected-side log odds.
3. After the existing market-specific raw verdict and price-aware adjustments,
   demote any future unlocked Best Angle or Lean to Watchlist when its final
   selected-side probability is below the American-price break-even
   probability. Null or prohibited prices remain Pass under the existing rule.
4. Preserve every selected side, score, margin, Total, line, price, stake
   mapping, reader input, writer, lease, and locked payload.

This is an exact-price semantic invariant, not a fitted edge threshold. A
positive edge of any size passes the invariant but does not independently
promote a Watchlist. Promotions still require the existing market-specific
rules or the frozen puck calibration.

## Gates

- Pre-r18 selection and combined r18/r20 confirmation overall actionable
  accuracy and exact-price units do not decline versus r20.
- r18 and r20 confirmation are also reported separately; neither may lose more
  than one net actionable win versus r20.
- Any market with at least ten confirmation actionables may not lose more than
  two percentage points of accuracy versus r20.
- Full-cohort all-market actionable Brier does not worsen, actionable count
  does not exceed r20, and the package produces both promotions and demotions.
- Full-cohort Moneyline and puck-line actionable units each do not decline
  versus r20. Total actionable units must improve, or Total actionables must
  contract by at least 20% while retaining at least 15% of settled Total rows.
- The 2026-10-23 unlocked board retains at least one actionable and contains no
  negative-exact-edge actionable.
- Exact-price coverage is complete and locked records remain immutable.

Failure rejects the package. No threshold tuning follows the opened result.

