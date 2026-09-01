import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/cron/cleanup-stream-tables/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};

assert.match(route, /LAB_RESPONSE_SNAPSHOT_RETENTION_GRACE_HOURS = 24/);
assert.match(route, /LAB_RESPONSE_SNAPSHOT_BATCH = 250/);
assert.match(route, /LAB_RESPONSE_SNAPSHOT_MAX_BATCHES = 8/);
assert.match(
  route,
  /"lab_response_snapshots",\s*"snapshot_key",\s*"stale_until",\s*labSnapshotCutoff/,
);
assert.match(route, /now - LAB_RESPONSE_SNAPSHOT_RETENTION_GRACE_HOURS \* 3_600_000/);
assert.doesNotMatch(route, /\.from\("prediction_records"\)/);
assert.doesNotMatch(route, /\.from\("prediction_grades"\)/);
assert.doesNotMatch(route, /\.from\("tracking_entries"\)/);
assert.doesNotMatch(route, /\.from\("market_split_observations_v2"\)/);
assert.doesNotMatch(route, /\.from\("market_price_observations_v2"\)/);
assert.doesNotMatch(route, /\.from\("prop_scoring_runs"\)/);

const cleanupCron = vercel.crons?.find((cron) => cron.path === "/api/cron/cleanup-stream-tables");
assert.deepEqual(cleanupCron, {
  path: "/api/cron/cleanup-stream-tables",
  schedule: "25 1,7,13,19 * * *",
});

console.log("database retention safety: PASS");
