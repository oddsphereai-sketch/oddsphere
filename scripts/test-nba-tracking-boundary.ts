import assert from "node:assert/strict";
import { isPublicallyTracked } from "../lib/config/officialTrackingStart";
import { createNbaPredictionRecords } from "../lib/services/nba/buildNbaPredictionRecords";

let dbCalls = 0;
const noDbClient = {
  from(): never {
    dbCalls += 1;
    throw new Error("NBA preseason boundary must return before any database or pipeline work");
  },
};

assert.equal(isPublicallyTracked("nba", "2026-10-19"), false);
assert.equal(isPublicallyTracked("nba", "2026-10-20"), true);

async function main(): Promise<void> {
  const result = await createNbaPredictionRecords({
    slateDate: "2026-10-04",
    apply: true,
    launchDay: false,
    supabase: noDbClient as never,
  });

  assert.equal(dbCalls, 0);
  assert.equal(result.scanned, 0);
  assert.equal(result.insertedCount, 0);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.proposed.length, 0);
  assert.equal(result.errors.length, 0);

  console.log("NBA regular-season tracking boundary tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
