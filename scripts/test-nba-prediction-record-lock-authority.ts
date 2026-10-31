import assert from "node:assert/strict";

import {
  NBA_PREDICTION_RECORD_LOCK_AUTHORITY_RELEASE,
  resolveNbaPredictionRecordLocks,
  type NbaPredictionRecordLockRow,
} from "../lib/services/nba/nbaPredictionRecordLockAuthority";

const tuple = (gameId: number, release: string, lockedAt: string | null): NbaPredictionRecordLockRow[] =>
  ["moneyline", "spread", "total"].map((market) => ({
    game_id: gameId,
    market,
    model_version: release,
    locked_at: lockedAt,
  }));

const current = "nba_current";
const legacy = "nba_legacy";
const lockedAt = "2026-10-31T21:00:31.087Z";

assert.match(NBA_PREDICTION_RECORD_LOCK_AUTHORITY_RELEASE, /legacy_locked_tuple_precedence/);

assert.equal(
  resolveNbaPredictionRecordLocks([1], tuple(1, current, lockedAt)).get(1),
  lockedAt,
  "a complete current-release lock remains authoritative",
);
assert.equal(
  resolveNbaPredictionRecordLocks([2], tuple(2, legacy, lockedAt)).get(2),
  lockedAt,
  "a complete legacy-release lock remains authoritative after a model release bump",
);
assert.equal(
  resolveNbaPredictionRecordLocks([3], [
    ...tuple(3, current, null),
    ...tuple(3, legacy, lockedAt),
  ]).get(3),
  lockedAt,
  "new unlocked rows cannot displace the immutable legacy lock",
);
assert.equal(
  resolveNbaPredictionRecordLocks([4], tuple(4, current, null)).get(4),
  null,
  "an unlocked tuple remains eligible for the current T-60 writer",
);
assert.equal(
  resolveNbaPredictionRecordLocks([5], tuple(5, legacy, lockedAt).slice(0, 2)).get(5),
  null,
  "a partial legacy tuple cannot fabricate a lock",
);
assert.equal(
  resolveNbaPredictionRecordLocks([6], [
    { ...tuple(6, legacy, lockedAt)[0]! },
    { ...tuple(6, current, lockedAt)[1]! },
    { ...tuple(6, legacy, lockedAt)[2]! },
  ]).get(6),
  null,
  "rows from different releases cannot be mixed into one lock tuple",
);
assert.equal(
  resolveNbaPredictionRecordLocks([7], [
    ...tuple(7, current, "2026-10-31T21:05:00.000Z"),
    ...tuple(7, legacy, lockedAt),
  ]).get(7),
  lockedAt,
  "the earliest exact stored lock wins when two complete historical releases exist",
);

console.log("NBA prediction-record lock authority tests passed");
