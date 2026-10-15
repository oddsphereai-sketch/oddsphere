import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPublicallyTracked } from "../lib/config/officialTrackingStart";
import { createNbaPredictionRecords } from "../lib/services/nba/buildNbaPredictionRecords";
import {
  NBA_ROLLING_SCHEDULE_RELEASE,
  nbaMemberAnalysisEligible,
} from "../lib/services/nba/nbaRollingSchedule";

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
assert.equal(nbaMemberAnalysisEligible("2026-06-13", "2026-10-15"), true);
assert.equal(nbaMemberAnalysisEligible("2026-10-05", "2026-10-15"), false);
assert.equal(nbaMemberAnalysisEligible("2026-10-20", "2026-10-15"), false);
assert.equal(nbaMemberAnalysisEligible("2026-10-20", "2026-10-20"), true);

const dailyEdgeRouteSource = readFileSync(
  new URL("../app/api/lab/daily-edge/route.ts", import.meta.url),
  "utf8",
);
const responseSnapshotIndex = dailyEdgeRouteSource.indexOf(
  'url.searchParams.get("snapshotBypass") !== "true"',
);
const historicalPreseasonBoundaryIndex = dailyEdgeRouteSource.indexOf(
  'requestedDate < currentDailyEdgeBoardDate("nba")',
);
assert.ok(
  historicalPreseasonBoundaryIndex >= 0 && historicalPreseasonBoundaryIndex < responseSnapshotIndex,
  "historical NBA preseason requests must fail closed before cached snapshots are read",
);
assert.ok(
  responseSnapshotIndex >= 0 && dailyEdgeRouteSource.includes("nbaScheduleContractOutdated"),
  "NBA member route must reject snapshots that predate the schedule-only contract",
);
assert.ok(
  dailyEdgeRouteSource.includes("NBA_ROLLING_SCHEDULE_RELEASE"),
  `NBA member route must require ${NBA_ROLLING_SCHEDULE_RELEASE}`,
);

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

  console.log("NBA preseason-only tracking window tests passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
