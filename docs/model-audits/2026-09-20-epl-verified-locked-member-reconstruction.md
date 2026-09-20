# EPL verified locked-member reconstruction — 2026-09-20

## Declared scope

Affected scope is limited to the Premier League member snapshot publisher and
the existing `epl-daily-refresh` and `epl-pregame-lock` cron paths. The active
forecast model remains
`epl_goals_coherent_2026_09_02_r18_structural_target_exclusion`; the active
grade policy remains
`epl_grade_policy_2026_09_02_v23_positive_forecast_ev`. The single
authoritative writers and shared sport-scoped `prediction_pipeline` lease are
unchanged. No provider call, retry, concurrency, schedule, database writer, or
member-request path is added.

The behavior is versioned as member publication lifecycle
`epl_member_snapshot_lifecycle_2026_09_20_r3_verified_locked_record_reconstruction`
and tracking lock policy
`epl_tracking_lock_2026_09_20_r2_verified_member_reconstruction`.

## Incident evidence

The September 20 Liverpool at Bournemouth fixture (`provider_id=3818236`) was
published with Match Result and BTTS prices but without Double Chance or Total.
The exact active-release `prediction_records` cohort proves that all four
markets were captured and locked at `2026-09-20T12:01:02.873Z`:

- Match Result: +127, three-outcome price board, No Play.
- Double Chance: -253, three-outcome price board, No Play.
- Total: -188, two-outcome price board, Watchlist.
- BTTS: -211, two-outcome price board, Watchlist.

All four rows are non-held and carry the same immutable member projection.
The price-provider and tracking writer therefore completed successfully. The
defect was downstream: the lock route built a new incomplete provider response,
marked the game locked, and published that response instead of reconstructing
the member card from the immutable records. The ordinary locked-snapshot guard
could preserve an older already-locked snapshot, but it could not repair the
first incomplete locked publication.

## Correction and failure behavior

Both EPL publication routes now verify every due locked game against a complete
four-market database cohort. A row qualifies only when its model release,
calibration release, and competition match the active slate and its stored
member market agrees with the immutable price, side, probability, edge, EV,
line, grade, actionability, and hold fields. All four rows must carry the same
stored projection. The publisher then restores those exact stored market and
projection objects; it performs no inference or recomputation.

One missing, mixed-release, corrupt, or projection-incoherent row fails the
whole game closed and blocks publication. Only a complete verified cohort may
replace a prior locked member card. The last coherent snapshot remains in
place on any failure.

## Board and capacity impact

- Prediction flips: 0.
- Probability or projection changes: 0.
- Price substitutions: 0.
- Actionable promotions: 0.
- Actionable demotions: 0.
- Grade changes: 0.
- Stake changes: 0.
- Additional provider requests: 0.
- Additional database writes: 0.
- Added database work: one bounded read of the current weekly slate's due
  external IDs on an existing leased writer invocation.

Focused tests prove complete restoration, all-or-nothing handling of a missing
market, scalar-corruption rejection, ordinary locked-snapshot preservation, and
the restricted verified-repair override.
