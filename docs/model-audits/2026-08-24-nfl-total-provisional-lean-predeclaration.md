# NFL Total provisional Lean predeclaration

Date: 2026-08-24

## Scope and current champion

- Sport / market: NFL regular-season Total only.
- Forecast: retain `nfl_v1_discrete_drive_joint_2026_08_23_r10_qualified` and its
  exact-line PMF probabilities without refitting.
- Current member / decision / grade releases:
  `nfl_v1_member_release_2026_08_24_r4_spread_total_watchlist`,
  `nfl_v1_daily_edge_decision_2026_08_24_r4_spread_total_watchlist`, and
  `nfl_v1_grade_policy_2026_08_24_r4_spread_total_watchlist`.
- Authoritative path: the existing leased `nfl-forward-evidence` writer under the
  sport-scoped `prediction_pipeline:nfl` lease. No additional writer, timer, provider
  call, tracking write, or stake behavior is in scope.
- Moneyline and Spread outputs are controls. Moneyline grades must remain identical.
  The historically negative Spread cohort must remain Watchlist / No Play / true-data Held.

## Frozen chronology

- 2023 selects at most one Total policy.
- 2024 and 2025 are confirmation seasons and must not change the selection.
- Every offer is the exact named-book Total side, line, price, and timestamp. Fair
  probability is computed from at least two *other* comparable books at the identical
  line. The target book is excluded.
- Rows must retain base data health, forecast/side coherence, price in [-200,+200], and
  the r10 PMF scoring cushion with the existing 0.5-point extreme-total penalty.
- One best exact offer per game is retained deterministically; there is no weekly quota,
  minimum action count, or Week 1 tuning.

## Candidate family and 2023 selection

The bounded grid is frozen before reading its result:

- PMF side probability floor: 0.60, 0.625, or 0.65;
- exact-price model EV floor: 0%, 2%, or 4%;
- model edge over target-excluded same-line consensus: 3, 4, or 5 percentage points;
- PMF scoring-cushion floor above the existing zone penalty: 1.0, 1.5, or 2.0 points;
- direction: both sides, Over only, or Under only.

A 2023 candidate is eligible only with at least 12 bets, positive units and ROI,
positive units after removing its largest win, nonnegative mean normalized CLV, and an
absolute probability calibration gap no worse than 10 percentage points. Select by:

1. highest return after removing the largest win;
2. highest mean normalized CLV;
3. lower calibration gap;
4. higher sample count;
5. stricter probability, EV, edge, and cushion floors, then direction label.

## Confirmation and grade contract

The frozen candidate may become an explicitly **provisional Total Lean** only if:

- 2024 and 2025 each contain at least eight bets and finish with positive units;
- pooled 2024-25 units remain positive after removing the largest win;
- pooled mean normalized CLV is nonnegative;
- pooled absolute calibration gap is at most 10 percentage points;
- a 20,000-draw weekly-cluster bootstrap has probability of positive units at least 65%.

The bootstrap interval may cross zero; that uncertainty is why the grade is provisional
Lean rather than Best Angle. Best Angle is forbidden. Stakes and tracking remain unchanged.
Eligible current Total Watchlists promote to provisional Lean; existing Leans in other
markets cannot be demoted. All other healthy Totals remain Watchlist or No Play under r4,
and missing coherent price inventory remains Held.

If no frozen Total candidate clears confirmation, production behavior remains r4. The
result is recorded as negative evidence rather than weakening the gates or forcing plays.
