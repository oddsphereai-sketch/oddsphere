import assert from "node:assert/strict";

import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";
import { applyNbaPublishedLockMetadata } from "../lib/services/nba/nbaPublishedLockMetadata";

const game = {
  external_id: 401909088,
  gameStartAt: "2026-10-20T19:00:00.000Z",
  scheduledLockAt: "2026-10-20T19:00:00.000Z",
  lockState: "open",
  lockedAt: null,
  projected: { home: 113.205, away: 114.955 },
  predictions: { ml: { pick: "BOS" } },
  markets: { moneyline: { verdict: "lean" } },
} as unknown as DailyEdgeResponse["games"][number];
const payload = {
  sport: "nba",
  date: "2026-10-20",
  requested_date: "2026-10-20",
  games: [game],
} as DailyEdgeResponse;
const original = JSON.parse(JSON.stringify(payload)) as DailyEdgeResponse;
const lockedAt = "2026-10-20T18:00:59.937Z";
const rows = ["moneyline", "spread", "total"].map((market) => ({
  game_id: 140067,
  market,
  locked_at: lockedAt,
}));

const result = applyNbaPublishedLockMetadata({
  payload,
  dbIdByExternalId: new Map([[401909088, 140067]]),
  rows,
});

assert.equal(result.lockedGames, 1);
assert.equal(result.changedGames, 1);
assert.equal(result.payload.games[0]!.lockState, "locked");
assert.equal(result.payload.games[0]!.lockedAt, lockedAt);
assert.equal(result.payload.games[0]!.scheduledLockAt, "2026-10-20T18:00:00.000Z");
assert.deepEqual(result.payload.games[0]!.projected, original.games[0]!.projected);
assert.deepEqual(result.payload.games[0]!.predictions, original.games[0]!.predictions);
assert.deepEqual(result.payload.games[0]!.markets, original.games[0]!.markets);
assert.deepEqual(payload, original, "the source snapshot remains immutable");

const idempotent = applyNbaPublishedLockMetadata({
  payload: result.payload,
  dbIdByExternalId: new Map([[401909088, 140067]]),
  rows,
});
assert.equal(idempotent.changedGames, 0);

assert.throws(() => applyNbaPublishedLockMetadata({
  payload,
  dbIdByExternalId: new Map([[401909088, 140067]]),
  rows: rows.slice(0, 2),
}), /published lock tuple is incomplete/);

assert.throws(() => applyNbaPublishedLockMetadata({
  payload,
  dbIdByExternalId: new Map([[401909088, 140067]]),
  rows: [rows[0]!, { ...rows[1]!, locked_at: "2026-10-20T18:01:00.000Z" }, rows[2]!],
}), /published lock tuple is incomplete/);

console.log("NBA published lock metadata tests passed");
