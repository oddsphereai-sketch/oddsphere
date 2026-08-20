# EPL production coverage gate v13

## Trigger

The first private production refresh wrote 40 prediction records, but direct database inspection found four held rows: Total and BTTS for Tottenham–Brentford and Liverpool–Newcastle. The same release returned 40/40 prices in an immediate independent read-only probe, identifying a transient server-region/provider completeness failure rather than a missing market.

## Change

- Projection release remains `epl_club_dixon_coles_2026_08_18_r8`.
- Calibration/runtime release is `epl_grade_policy_2026_08_19_v13`.
- Probabilities, projections, grading thresholds, market selection, and stakes are unchanged.
- Incomplete Sharp fixtures receive one sequential recovery load, capped at four fixtures per refresh.
- Publication now requires 40/40 selected current prices and 100/100 complete outcome-board rows.
- An incomplete refresh is logged partial and cannot overwrite the last coherent member snapshot.

## Board impact

There are no rule-driven promotions or demotions. Contemporaneous read-only v13 boards produced 4–5 Best Angles, 2 Leans, 7–8 Watchlists, and 26 No Plays; the one-row movement comes from changed market prices.

The weekly member snapshot retains completed games through the end of the active gameweek, exposes the verified final score, and advances to the next round only after the current round is complete.
