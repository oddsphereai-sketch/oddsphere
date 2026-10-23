# NHL Moneyline actionability r21 predeclaration

Date: 2026-10-23

Status: predeclared, SELECT-only. No live authority is granted by this document.

## Scope

The opening-head replay established that the current fast-state architecture is
strong across the larger 2026 reconstruction but that its recent exact-price
Moneyline actionables are poorly separated. Puck-line direction and the Total
reader must remain untouched. This audit tests whether a Moneyline-only grade
policy can retain a useful board while separating value and corroboration from
raw winner confidence.

## Cohorts

- Reconstruct the current fast-state output on every complete, settled NHL
  transition lock using only MoneyPuck games strictly before that slate.
- Selection: all complete locks before r18.
- Confirmation A: exact r18 locks.
- Confirmation B: exact r20 locks.
- Report every release separately. Existing locked records remain unchanged.

## Baseline

The baseline is the current raw Moneyline verdict followed by the current
exact-price policy. It uses the reconstructed fast-state output, its final
reader-adjusted side and probability, and the best exact locked price for that
side. No stored predecessor grade is substituted for the reconstructed model.

## Fixed candidates

Best Angle retains the existing 70% probability, 5pp exact-price edge, and
price-above-minus-200 requirements. Each candidate otherwise returns Lean only
when its fixed conditions pass; it returns Watchlist when they do not.

1. `price_value`: probability at least 58% and exact-price edge non-negative.
2. `dual_model`: probability at least 56%, exact-price edge non-negative, and
   the frozen roster-prior/mature comparator selects the same winner.
3. `market_arbitrated`: probability at least 56%, exact-price edge
   non-negative, and either the final model agrees with the target-excluded
   market favorite or independent conviction is at least 62% with at least a
   3pp exact-price edge.
4. `two_of_three`: probability at least 56%, exact-price edge non-negative,
   and at least one of the roster comparator or target-excluded market favorite
   agrees with the final winner.

The market favorite is evidence, not an automatic side authority. None of the
candidates changes a score, side, probability, reader decision, price, stake,
Spread, Total, writer, lease, or locked payload.

## Advancement gates

A candidate advances only if all are true:

1. Selection actionables equal or exceed baseline accuracy and units.
2. Confirmation A and Confirmation B each do not lose accuracy versus baseline.
3. Combined confirmation units are not lower than baseline by more than 0.50u.
4. Each confirmation retains at least 25% of Moneyline rows as actionable.
5. Full-cohort impact contains at least one actionable promotion and one
   actionable demotion; a demotion-only mask is rejected.
6. Full-cohort actionable Brier score does not worsen.
7. Missing exact prices are zero.

If multiple fixed candidates pass, choose in this order: `two_of_three`,
`market_arbitrated`, `dual_model`, then `price_value`. This favors replayable
independent and market evidence over a price threshold alone. Failure of every
candidate means no live change.
