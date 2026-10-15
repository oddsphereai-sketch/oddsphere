# NFL player props paired grade candidate predeclaration

Date: 2026-10-15
Status: frozen after diagnosis and before prospective outcomes

## Candidate

This is a decision-layer candidate, not an independent projection change.

### Demotion lane

Demote a future unlocked Rushing Yards Best Angle to Watchlist when all are true:

- canonical line is 5 yards or lower;
- the independent and published forecast select the same side;
- final probability is below 63%; and
- a qualified target-excluded Pinnacle/NoVig pair does not confirm the selected side.

### Promotion lane

Promote a future unlocked Receptions Watchlist to Lean when all are true:

- final selected-side probability is at least 63%;
- exact evaluated-price expected value and probability edge are each at least 5%;
- both target-excluded Pinnacle and NoVig confirm the selected side at the evaluated line;
- neither qualified reference opposes the side; and
- the independent point/probability and published forecast select the same side.

No book, source, or threshold may be substituted after outcomes are opened. The candidate never
changes the independent point, probability, side, exact price, or a locked payload.

## Known development impact

The already-opened Week 6 rehearsal demotes one Best Angle and promotes three Watchlists, changing
39 actionables to 41. This is board-impact evidence only; the names and outcomes cannot be used to
retune the rule.

## Gates

1. Evaluate only canonical main-line scopes at their immutable lock.
2. Preserve exact release identity and report demotions, promotions, corrections, harms, units,
   Brier/log loss, and board counts separately by family.
3. On an untouched completed week, the demotion lane must avoid more actionable losses than wins it
   suppresses and improve exact-price units.
4. The promotion lane must have nonnegative exact-price units and may not create a forecast harm.
5. Combined actionables must retain at least 90% of the incumbent board and must not exceed 125%
   without explicit owner review.
6. Existing locks are immutable. Any production release requires a decision-release bump, focused
   tests, full model-change verification, clean current-main ancestry, protected PR checks, and live
   post-deploy proof.

Until those gates pass, the candidate is research-only and production stays unchanged.
