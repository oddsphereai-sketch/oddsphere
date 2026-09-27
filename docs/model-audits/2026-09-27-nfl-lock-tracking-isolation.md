# NFL lock and tracking isolation — 2026-09-27

## Scope

- Sport: NFL only.
- Paths: sole forward-evidence writer, compact member snapshot publication, and official T-60 tracking serialization.
- Prediction behavior: unchanged.
- Member presentation: unchanged; no copy, labels, layout, side, probability, projection, price, line, grade, or stake changes.

## Incident evidence

Four games had valid immutable T-60 evidence before kickoff: ARI@SF, MIN@TB, BAL@DAL, and LV@NO. Their locks were appended successfully, but the writer then rejected MIN@TB while serializing tracking because its published Total decision disagreed with its own score distribution. Tracking ran before compact snapshot publication, so the exception prevented the already-valid locks from reaching the member snapshot. The compact snapshot was restored exclusively from the stored immutable evidence without recollection or recomputation.

## Repair contract

1. Publish the compact member snapshot before official tracking serialization. A tracking-only exception can no longer hide a valid lock.
2. Keep the strict tracking serializer authoritative for coherent tuples.
3. Permit the sole writer to use a bounded recovery serializer only when `decision_forecast_side_disagreement` is the complete set of coherence failures for an already-published immutable T-60 tuple.
4. Recovery copies the exact pregame side, line, price, model probability, market probability, expected value, grade, lock timestamp, and evidence hash. It cannot recompute or reinterpret a pick.
5. Any other coherence failure remains fatal. Inserts remain append-only and idempotent through the existing sport-scoped writer path.

## Verification and rollback

Focused tests must prove that the strict path still rejects a contradictory tuple, the recovery path preserves its exact immutable values, and snapshot publication precedes tracking. The four incident games must produce exactly twelve unique tracking rows with the original evidence hashes and lock timestamps. The production writer must retain its `prediction_pipeline:nfl` lease and complete a natural cycle without a tracking or member-snapshot failure.

Rollback reverts the writer and tracking-record releases together. Already inserted immutable tracking rows remain historical evidence and are never deleted or rewritten.
