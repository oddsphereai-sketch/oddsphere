# CFB cross-release lock visibility r57 — predeclaration

Date: 2026-09-04

Status: production reader-correction candidate; implementation and publication gates remain required.

## Incident

Eastern Michigan vs. San Jose State kicked at 2026-09-04T22:30:00Z and was scheduled to lock at 21:30:00Z. The sole CFB writer captured a valid T-60 row at 21:39:53.584Z, within the declared 20-minute lag allowance. All three decisions are `t60_locked`, share that exact `lockedAt`, have no held markets, enable tracking, and produced immutable prediction records at 21:39:59Z.

The r56 member snapshot nevertheless publishes `lockedAt=null` and `lockState=open` for the game. The r21 evidence reader did not register the immediately prior r20/r32/r29 release as an eligible transition source. During the partial r21 refresh, it therefore fell through to an older unlocked release instead of retaining the valid r20 T-60 row.

## Predeclared correction

- Register r20 evidence, r32 member, and r29 decision as the immediate predecessor of active r21/r33/r30.
- Include r20 in the bounded evidence-store read and immutable-payload allowlists.
- Build the active r21 boundary from the preceding complete authority plus a lock-only r20 overlay, preserving valid r20 T-60 rows byte-for-byte even when r20 itself is incomplete. Unlocked r20 rows cannot enter this overlay.
- Keep the existing fail-closed checks: an upcoming missing game may cross the boundary only with an on-time T-60 row, lag within 20 minutes, no health hold, tracking enabled, and all decisions locked at the capture timestamp.

This changes no prediction, probability, projection, side, price, EV, grade, stake, tracking record, or locked payload. It changes only which already-authoritative evidence row the member reader selects at a release boundary and therefore restores the correct lock badge/time.

## Acceptance

- A fixture matching Eastern Michigan's r20 locked row plus an incomplete r21 wave must select the r20 row byte-for-byte and render `lockState=locked` with the exact stored `lockedAt`.
- An ordinary unlocked future r20 row must not bypass the boundary safety gate.
- Existing complete-release, held-T60, stale-release, tracking, writer, and CFB production tests remain green.
- Live verification must show Eastern Michigan locked on the current member snapshot without rewriting its r29 tracking records.

## Versioning and rollback

The fixture/outcome, compact snapshot, and sole writer identifiers will advance together so the corrected snapshot is regenerated through the existing `prediction_pipeline:cfb` lease. The model probability, grade policy, decision release, evidence schema, member release, tracking release, and stake policy remain unchanged. Rollback restores the prior reader publication identifiers; immutable evidence and prediction records are never changed.
