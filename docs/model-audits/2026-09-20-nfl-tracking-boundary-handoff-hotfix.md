# NFL tracking verified-boundary handoff hotfix

Date: 2026-09-20

## Incident and scope

PR #436 correctly repaired the NFL tracking release allowlist and coherence
tolerance. Its production recovery recomputed all eight early-game immutable
T-60 payloads as eligible, then the record serializer rejected the four payloads
whose old stored `trackingEnabled` boolean was false. The redundant serializer
guard ran after the authoritative boundary revalidation and prevented the batch
from inserting any rows. Production remains at zero rows for the eight-game
cohort; no partial tracking write occurred.

The final repair adds an explicit `trackingBoundaryRevalidated` handoff from
the sole leased writer to the serializer. Only the writer path that has just
recomputed the complete release, timing, tuple, and registry boundary sets it.
Direct serializer calls still reject a false stored flag. The original payload
object and its evidence hash are unchanged.

## Releases and impact

Advance the sole writer to
`nfl_forward_evidence_writer_2026_09_20_r34_boundary_handoff` and official
tracking record to
`nfl_official_tracking_record_2026_09_20_r10_boundary_handoff`. Model,
calibration, decision, grade, member, lifecycle, composite, and tuple-boundary
releases remain unchanged from PR #436.

The frozen recovery remains 8 games / 24 markets from the on-time 16:06 UTC
T-60 evidence. Forecasts, probabilities, projected scores, sides, lines,
prices, grades, promotions, demotions, actions, stakes, provider calls,
schedules, leases, member rows, copy, and labels are unchanged. Promotions and
demotions are 0/0. The change appends missing tracking records only; it updates
or deletes no existing row and reconstructs no post-kick prediction.

## Verification and rollback

Focused tests must prove that direct calls still reject an unverified false
flag, the writer's explicit revalidated handoff succeeds, and the resulting
record retains the original immutable evidence hash. TypeScript, lint, the
full model-change suite, production build, latest-main integration safety,
protected PR checks, exact production deployment, one leased recovery run,
24/24 database readback, empty lease, and responsive member board are required.

Roll back to r33/r9 if the serializer can bypass the guard without an explicit
handoff, a record hash differs from its evidence payload, any old row changes,
the recovery count differs from 24, or writer/lease/reader health regresses.
