# NBA preseason-only tracking window correction

## Finding

The first October 5 repair correctly removed October preseason results but used
an October 20 launch boundary. That boundary also removed six valid 2025-26
postseason market rows from June 8-13. Those rows belong in lifetime tracking.

## Corrected contract

- NBA has no new public-history start boundary.
- Valid NBA history before July 1, 2026 remains eligible.
- Dates July 1 through October 19, 2026 are excluded as offseason/preseason.
- The 2026-27 regular season becomes eligible on October 20.
- The sole NBA writer uses the same eligibility function, so preseason refresh
  or retry paths cannot create member-tracked prediction records.
- Both tracking readers use the same eligibility function, and every tracking
  cache key is bumped again so the corrected lifetime history is restored live.

The production inventory used to verify the correction contains six eligible
June rows and four excluded October rows. The corrected aggregate is 2-4
across the three June games, with one Moneyline win/two losses and one Total
win/two losses; it contains no October preseason result. No stored prediction
or grade is deleted or rewritten.

## Product and model impact

This correction changes tracking eligibility only. It does not change an NBA
prediction, probability, projected score, side, grade, stake, price, member
copy, label, layout, provider request, schedule, or lease.
