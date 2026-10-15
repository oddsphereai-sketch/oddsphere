# UCL tracking release-transition continuity

Date: 2026-10-15  
Scope: tracking reader only; no prediction, grade, settlement, lock, price, member copy, or model change

## Defect

The tracking aggregate applied the active UCL model-and-calibration predicate before building every result surface. That predicate is correct for release-pure current-model and lifetime reporting, but it is not correct for calendar reporting. When the active release advanced on October 14, valid immutable October 13 locks and two October 14 games that had locked under the preceding release stopped appearing in yesterday, weekly, monthly, trend, and recent-result views.

No prediction record or grade was lost. The reader hid existing rows solely because their exact release identifier was no longer current.

## Production evidence before the repair

The bounded read of October 13–14 contained:

- 18 complete games and 72 immutable four-market lock rows;
- 60 settled side-bearing predictions: 47 wins and 13 losses;
- October 13: 27 predictions, 20–7;
- October 14: 33 predictions, 27–6;
- 12 genuine null-side held rows, correctly excluded from accuracy.

The active reader displayed only 25 predictions at 19–6. It hid 35 valid settled predictions: all 27 from October 13 plus eight from two October 14 games that locked before the release deployment.

## Repair

Tracking aggregate contract `tracking_aggregate_v14_ucl_calendar_release_continuity_2026_10_15` now maintains two explicit scopes:

1. Current-release/lifetime scope remains restricted to the exact active UCL model and calibration release.
2. Calendar scope retains every public, complete, immutable, side-bearing lock in the requested date window regardless of a later release transition.

The calendar scope owns yesterday, trailing week, trailing month, daily trend, recent picks, recently settled picks, and weekly/monthly alternate-line results. Held rows, Toss-Ups, incomplete four-market cohorts, unlocked rows, and non-public dates remain excluded under the existing contracts.

The repair does not mutate, reconstruct, relabel, or reinterpret a locked record. It adds no member-facing copy or labels.

## Verification

The repaired reader replayed the same production rows as:

- trailing week: 60 predictions, 47–13 (78.33%);
- yesterday (October 14): 33 predictions, 27–6 (81.82%);
- current-release/lifetime scope: still 25 predictions, 19–6, release-pure;
- held null-side rows: still excluded.

Focused regression coverage proves that a complete prior-release UCL cohort remains in calendar tracking after a deployment, never enters current-release tracking, and cannot admit a held row.

## Rollback

Rollback is the prior tracking reader contract. No database rollback is required because this change performs no writes and changes no stored record.
