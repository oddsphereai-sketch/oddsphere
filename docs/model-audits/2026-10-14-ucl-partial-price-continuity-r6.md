# UCL partial-price continuity r6

Date: 2026-10-14

## Incident

After r8u/r10 deployed, the first healthy production writer cycle received 32
of 36 selected current quotes. The complete previous member snapshot had 36.
The provider recovered all 36 on the immediately following zero-write read,
but the publication gate blocked only a 36-to-zero collapse. It therefore
published one unlocked fixture with three blank price fields despite retaining
all four predictions.

## Repair

Member lifecycle `ucl_member_snapshot_lifecycle_2026_10_14_r6_partial_price_continuity`
compares the same active fixture and four market identities with the prior
member snapshot. If an unlocked market had a selected price and the incoming
cycle temporarily lacks one, publication preserves the prior complete member
snapshot. A fresh available quote continues to replace the prior quote. The
ordinary writer may still retain the current evidence in prediction records
and line history under the shared `prediction_pipeline:soccer` lease.

Locked cards are excluded from this gate because their exact four-market DB
cohort remains authoritative. The repair creates no synthetic price, stale
label, copy, layout, side, probability, projection, grade, promotion,
demotion, stake, provider call, schedule or tracking change. Existing locked
rows remain byte-identical.

## Verification and rollback

Focused contracts prove complete cold-start publication, 36-to-zero LKG
continuity, partial unlocked regression continuity, locked-card exclusion and
immutable lock precedence. Production verification requires 9/9 fixtures,
36/36 member markets, zero member holds, the r8u/r10 unlocked release, and the
two exact r7 locks at their original timestamps. Roll back only member
lifecycle r6 to r5 if a complete fresher quote is suppressed or a same-round
snapshot fails to advance after complete provider recovery.
