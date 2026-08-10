import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};
const crons = vercel.crons ?? [];
const source = (path: string) => readFileSync(path, "utf8");
const scheduled = (path: string) => crons.some((cron) => cron.path === path);

assert.ok(scheduled("/api/cron/slate-cycle"), "cold slate-cycle is scheduled");
assert.ok(scheduled("/api/cron/slate-cycle?intraday=true"), "intraday slate-cycle is scheduled");
assert.ok(scheduled("/api/cron/lineup-watch"), "lineup-watch is scheduled");
assert.ok(scheduled("/api/cron/pregame-sweep?lockOnly=true"), "targeted lock sweep is scheduled");
assert.ok(scheduled("/api/cron/public-splits-observations-refresh"), "public-splits refresh is scheduled");
assert.ok(scheduled("/api/cron/tracking-refresh"), "tracking refresh is scheduled");
assert.ok(scheduled("/api/cron/mlb-player-props-refresh"), "fast Player Props refresh is scheduled");
assert.ok(scheduled("/api/cron/mlb-player-props-refresh?full=true"), "full Player Props refresh is scheduled");
assert.ok(scheduled("/api/cron/mlb-player-props-settlement"), "Player Props settlement is scheduled");

for (const legacy of ["/api/cron/midday-refresh", "/api/cron/afternoon-refresh", "/api/cron/evening-refresh"]) {
  assert.equal(scheduled(legacy), false, `${legacy} is not a competing scheduled writer`);
}

for (const path of [
  "app/api/cron/slate-cycle/route.ts",
  "app/api/cron/lineup-watch/route.ts",
  "app/api/cron/pregame-sweep/route.ts",
  "app/api/cron/public-splits-observations-refresh/route.ts",
  "app/api/cron/mlb-player-props-refresh/route.ts",
]) {
  const body = source(path);
  assert.match(body, /leaseGroup:\s*["']prediction_pipeline["']/, `${path} uses the shared prediction lease`);
  assert.match(body, /requireLease:\s*true/, `${path} requires the shared prediction lease`);
}

assert.match(source("app/api/cron/slate-cycle/route.ts"), /refreshDailyEdgeResponseSnapshot/, "slate cycle republishes Daily Edge");
assert.match(source("app/api/cron/lineup-watch/route.ts"), /refreshDailyEdgeResponseSnapshot/, "lineup changes republish Daily Edge");
assert.match(source("app/api/cron/pregame-sweep/route.ts"), /refreshDailyEdgeResponseSnapshot/, "locks republish Daily Edge");
assert.match(source("app/api/cron/public-splits-observations-refresh/route.ts"), /refreshDailyEdgeResponseSnapshot/, "split changes republish Daily Edge");
assert.match(source("app/api/cron/tracking-refresh/route.ts"), /refreshTrackingResponseSnapshot/, "tracking cron republishes member Tracking");
assert.match(source("app/api/cron/mlb-player-props-refresh/route.ts"), /refreshMlbPropsBoard/, "Player Props has one canonical board refresh");

const coldSlateSchedules = crons.filter((cron) => cron.path === "/api/cron/slate-cycle").map((cron) => cron.schedule);
assert.ok(coldSlateSchedules.includes("5 8,10-12 * * *"), "cold slate schedule includes the 11:05 UTC freshness run");
assert.ok(crons.some((cron) => cron.path === "/api/cron/tracking-refresh" && cron.schedule === "33 * * * *"), "Tracking publishes hourly");
assert.ok(crons.some((cron) => cron.path === "/api/cron/pregame-sweep?lockOnly=true" && cron.schedule?.startsWith("*/5")), "lock sweep remains targeted at five minutes");

console.log("PASS current refresh-cycle schedules use the authoritative leased writers and republish member snapshots");
