# Playbook CFB league-identity live correction

Date: 2026-10-09  
Base: `407b6b30947155b8911f07bd1b21b46d57e04df9`

## Production evidence

The first production CFB cycle after football provider-feed continuity deployed
the intended writer `cfb_forward_evidence_writer_2026_10_09_r112_provider_feed_continuity`,
acquired the sole `prediction_pipeline:cfb` lease on its first attempt, published
89 games and 231 evaluations, updated the compact member snapshot, and preserved
all 18 existing tracking records. It also returned the fail-closed health hold
`playbook_injuries_request_failed`; prior injury evidence remained available
instead of being erased.

The current official Playbook league-convention contract identifies college
football as `CFB`, while Oddsphere's internal and legacy market-feed identity is
`ncaaf`. The first repair uppercased that internal value to unsupported `NCAAF`.
This follow-up maps only the injuries endpoint's `ncaaf` identity to documented
`CFB`. NFL and other league identities remain uppercase, and the already-working
legacy lines and splits requests are unchanged.

## Safety boundary

The documented injury response still normalizes into report-only rows with
`modelAuthorityEligible: false`. This correction can restore current member
injury reports and their timestamps, but it cannot change a CFB score,
probability, side, grade, promotion, demotion, stake, or locked record. Existing
previously qualified legacy rows retain their prior authority. A separate
versioned proposal remains required before current-contract rows can influence
model decisions.

Collector, member, writer, fixture, public outcome, compact snapshot, snapshot
reader, and Playbook request releases advance so the live correction never
runs under the failed release identifiers. The r58/r44 publication family is
the immediate reader predecessor, with r57/r43 and r53/r39 retained behind it
for immutable-lock continuity. The evidence schema, score, calibration, grade,
decision, professional market reader, and tracking releases do not change.

## Required verification

- Regression proof that both `ncaaf` and `cfb` produce `league=CFB` for injuries.
- Existing documented and legacy response-normalization tests.
- CFB publication, reader-transition, writer, lock, and model-change suites.
- Clean latest-main integration-safety proof and protected PR checks.
- Post-deploy CFB cycle with no `playbook_injuries_request_failed`, the expected
  r113 writer and r59/r45 member family, a healthy sole lease, current injury
  timestamps on the member snapshot, unchanged prediction/grade releases, and
  unchanged existing locks.

Rollback the complete r59/r45 publication family to r58/r44 on malformed
provider data, a recurring Playbook request failure, reader mismatch, writer
overlap, model-authority leakage, or any locked-record mutation.
