import assert from "node:assert/strict";
import { CFB_FORWARD_MAX_PRIOR_GAME_IDS, CFB_FORWARD_RESULTS_BATCH_SIZE, planCfbPriorResultReads } from "../lib/services/football/cfbForwardEvidenceWriter";

const rows = Array.from({ length: CFB_FORWARD_MAX_PRIOR_GAME_IDS }, (_, i) => ({ providerGameId: String(450000 + i),
  gameStartAt: new Date(Date.parse("2026-08-25T16:00:00Z") + Math.floor(i / 100) * 3 * 86400000).toISOString(), capturedAt: "2026-08-01T00:00:00Z" }));
const before = "2026-12-31", bytes = JSON.stringify(rows);
for (const count of [1200, 1201, CFB_FORWARD_MAX_PRIOR_GAME_IDS]) {
  const reads = planCfbPriorResultReads({ rows: rows.slice(0, count), before });
  const ids = reads.flatMap(r => r.gameIds);
  assert.equal(ids.length, count); assert.equal(new Set(ids).size, count);
  assert.deepEqual([...ids].sort(), rows.slice(0, count).map(r => r.providerGameId).sort());
  assert(reads.every(r => r.gameIds.length <= CFB_FORWARD_RESULTS_BATCH_SIZE && r.dates.length <= 3));
  assert.deepEqual(planCfbPriorResultReads({ rows: rows.slice(0, count).reverse(), before }), reads);
}
assert.equal(JSON.stringify(rows), bytes, "stored lifecycle evidence is never changed");
assert.throws(() => planCfbPriorResultReads({ rows: [...rows, { ...rows[0]!, providerGameId: "overflow" }], before }), /2400-ID season budget/);
const future = { ...rows[0]!, providerGameId: "next-week", gameStartAt: "2027-01-01T00:00:00Z" };
assert.deepEqual(planCfbPriorResultReads({ rows: [...rows, future], before }), planCfbPriorResultReads({ rows, before }), "target/future results remain excluded before the season count");
const moved = { ...rows[0]!, gameStartAt: "2026-11-22T21:00:00Z", capturedAt: "2026-11-20T12:00:00Z" };
const movedReads = planCfbPriorResultReads({ rows: [...rows, moved], before });
assert.equal(movedReads.flatMap(r => r.gameIds).filter(id => id === moved.providerGameId).length, 1);
assert(movedReads.some(r => r.gameIds.includes(moved.providerGameId) && r.dates.includes("2026-11-22")), "latest corrected schedule date retains precedence");
console.log("CFB full-season results: 1,201 and 2,400 exact identities, bounded batches, complete coverage, deterministic replay, hard ceiling, future exclusion and unchanged originals passed.");
