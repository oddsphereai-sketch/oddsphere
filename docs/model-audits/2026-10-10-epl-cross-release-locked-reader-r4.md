# EPL cross-release locked-reader repair r4

## Scope

- Sport/competition: Premier League only.
- Writer/reader: the existing `epl-daily-refresh` writer and EPL member-snapshot reconstruction path.
- Lease: the existing shared `prediction_pipeline:soccer` lease; no new writer, schedule, provider call, or database loop.
- Model/calibration: r19/v25 remain unchanged for unlocked games.
- Lifecycle release: `epl_member_snapshot_lifecycle_2026_10_10_r4_cross_release_locked_record_reconstruction`.

## Live defect

After v25 deployed, the October 10 production refresh captured complete current pricing (40/40 selected prices and 100/100 outcome prices) but correctly failed publication closed. Leeds-Arsenal had already locked under v24. The reconstruction gate incorrectly required that immutable v24 cohort to claim the active v25 calibration identifier, so it reported the otherwise complete four-market game as incomplete and preserved the last-known-good v24 member snapshot.

## Repair

Each locked row is authenticated against the model and calibration identifiers inside its own immutable captured payload, not the current unlocked release. Rows are grouped by provider game plus their exact stored model/calibration tuple. Only a complete four-market cohort whose scalar columns match its stored member objects and whose four projections are identical is eligible. If multiple complete cohorts exist, the earliest complete lock remains the public record. Different release eras cannot be mixed to manufacture completeness.

## Board impact

Zero predictions, probabilities, projections, sides, prices, grades, stakes, promotions, demotions, or actionable-count changes. The Arsenal Match Result remains the exact locked v24 Best Angle at Pinnacle -223, with its v24 projection and evidence. V25 applies only to unlocked games. Missing, corrupt, mixed-release, or projection-incoherent cohorts still fail the entire publication closed.

## Verification and rollback

Focused tests prove same-release reconstruction, cross-release legacy precedence, mixed-release rejection, corrupt-scalar rejection, and ordinary locked-card immutability. Publication additionally requires the full model-change suite, production build, current-main integration safety, protected PR checks, and post-deploy proof that the member snapshot is stamped v25/r4 while Arsenal remains byte-for-byte v24. Roll back only the r4 lifecycle reader if the live snapshot changes any locked field or combines release eras; never rewrite the locked database rows.
