import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPublicallyTracked } from "../lib/config/officialTrackingStart";
import { createNbaPredictionRecords } from "../lib/services/nba/buildNbaPredictionRecords";

let dbCalls = 0;
const noDbClient = {
  from(): never {
    dbCalls += 1;
    throw new Error("NBA preseason boundary must return before any database or pipeline work");
  },
};

assert.equal(isPublicallyTracked("nba", "2026-06-08"), true);
assert.equal(isPublicallyTracked("nba", "2026-06-13"), true);
assert.equal(isPublicallyTracked("nba", "2026-07-01"), false);
assert.equal(isPublicallyTracked("nba", "2026-10-04"), false);
assert.equal(isPublicallyTracked("nba", "2026-10-19"), false);
assert.equal(isPublicallyTracked("nba", "2026-10-20"), true);

const dailyEdgeRouteSource = readFileSync(
  new URL("../app/api/lab/daily-edge/route.ts", import.meta.url),
  "utf8",
);
const nbaMemberBoundaryIndex = dailyEdgeRouteSource.indexOf(
  'sport === "nba" && !isPublicallyTracked("nba", requestedDate)',
);
const responseSnapshotIndex = dailyEdgeRouteSource.indexOf(
  'url.searchParams.get("snapshotBypass") !== "true"',
);
assert.ok(nbaMemberBoundaryIndex >= 0, "NBA member route must enforce the regular-season boundary");
assert.ok(
  responseSnapshotIndex >= 0 && nbaMemberBoundaryIndex < responseSnapshotIndex,
  "NBA member boundary must run before cached response snapshots are read",
);

async function main(): Promise<void> {
  const { GET: readDailyEdge } = await import("../app/api/lab/daily-edge/route");
  const preseasonResponse = await readDailyEdge(
    new Request("https://example.test/api/lab/daily-edge?sport=nba&date=2026-10-05"),
  );
  const preseasonBody = await preseasonResponse.json() as {
    sport: string;
    date: string;
    games: unknown[];
    slateState: string;
  };
  assert.equal(preseasonResponse.status, 200);
  assert.equal(preseasonBody.sport, "nba");
  assert.equal(preseasonBody.date, "2026-10-05");
  assert.equal(preseasonBody.slateState, "no_data");
  assert.deepEqual(preseasonBody.games, []);

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

  console.log("NBA preseason-only tracking window tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
