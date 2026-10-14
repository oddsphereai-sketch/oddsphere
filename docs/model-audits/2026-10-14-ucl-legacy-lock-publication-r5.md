# UCL legacy-lock publication repair r5

Date: 2026-10-14

## Incident

The full-market identity and bounded provider-recovery repairs produced a complete current UCL
board, including PSG–Manchester City BTTS. Two 12:45 p.m. ET fixtures had already frozen their
four-market records under the prior r7 calibration release before the r9 reader deployed. The
writer correctly refused to replace those immutable records. The all-market reader verifier,
however, required the newly deployed release identifier and therefore treated both complete legacy
cohorts as incomplete. That global publication gate left the member snapshot at its older partial
market state.

## Repair

- Prefer a complete locked cohort from the current model and calibration releases.
- If the current cohort does not exist because an earlier release already owns the lock, accept the
  newest complete prior-release cohort only when every row's stored competition, model release and
  calibration release agree with its immutable database columns.
- Require all four markets, exact agreement between every captured member market and its immutable
  scalar tuple at each database column's declared numeric precision, and one identical stored score
  projection across the cohort. The verifier rejects any difference larger than half of a stored
  numeric column's rounding quantum.
- Never combine markets from different releases.
- Never reconstruct, update or replace a locked row.

The member lifecycle release advances to
`ucl_member_snapshot_lifecycle_2026_10_14_r5_legacy_lock_precedence`. The independent model,
market reader, projected score, prediction, probability, grade, stake, copy, labels and layout do
not change.

## Required verification

- `npm run test:ucl-db-contract`
- `npm run test:ucl-production`
- `npm run verify:model-change`
- latest-main integration safety and protected PR checks
- production refresh and stored member-snapshot verification, including complete PSG–Manchester
  City BTTS prices

## Rollback

Restore the r4 member lifecycle and current-release-only verifier for future reads. Do not mutate
or delete any locked record. Roll back if a mixed-release cohort passes, a captured market differs
from an immutable scalar, any locked row changes, or production publication remains blocked.
