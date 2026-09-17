# NFL player props no-Held member coverage predeclaration

Date: 2026-09-17

The live Week 2 snapshot contains 1,994 evaluated rows but only 1,798 member rows because 196
role/identity operational exceptions are excluded; 98 of those are anytime-touchdown candidates.
This conflicts with the product requirement that every evaluated prediction remain visible and
that `Held` never be a member-facing outcome.

The candidate changes only the member projection: internal `Held` audit rows become non-actionable
`No Play` rows in the member DTO. It does not alter probabilities, projections, predicted sides,
the ranked touchdown cohort, prices, EV, actionable grades, locks, stakes, tracking eligibility,
the writer, or the NFL prediction-pipeline lease. Expected same-snapshot impact is 196 additional
member rows, 196 additional No Plays, zero actionable promotions/demotions, and unchanged scorer
predictions. Roll back if any actionable count, probability, prediction side, or tracking row moves.

