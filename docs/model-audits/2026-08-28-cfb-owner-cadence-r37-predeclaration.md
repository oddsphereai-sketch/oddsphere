# CFB owner cadence r37 predeclaration

Date: 2026-08-28

## Scope

The owner requires the single CFB evidence writer to refresh unlocked games hourly once kickoff is within 48 hours, use a six-hour interval beyond 48 hours, and freeze each market at T-60. Production currently switches from six-hour to hourly only inside 24 hours.

Only the CFB collection scheduler, its displayed cadence description, the writer release, focused tests, and the release registry are in scope. Prediction inputs, the joint PMF, expected scores, sides, probabilities, exact-price decisions, grade thresholds, stakes, provider identity rules, Sharp split matching, T-60 eligibility, tracking, and member-fixture selection are out of scope.

## Release and ownership

- Base writer: `cfb_forward_evidence_writer_2026_08_28_r24_prior_event_disambiguation`
- Candidate writer: `cfb_forward_evidence_writer_2026_08_28_r25_owner_cadence`
- Sole write path: the existing CFB forward-evidence writer
- Lease: existing `prediction_pipeline:cfb`
- Provider budget: the existing per-run request cap and bounded writer are unchanged; eligible unlocked captures run more often in the 24-to-48-hour band
- Rollback: restore writer r24, the 24-hour threshold, and its prior cadence copy

## Required proof

- Boundary tests for beyond 48 hours, inside 48 hours, inside 24 hours, and T-60
- Zero prediction, side, probability, tuple, grade, stake, or lock changes
- Focused CFB production tests, responsive reader test, full model-change verification, typecheck, webpack build, integration safety, protected PR, and live production verification
