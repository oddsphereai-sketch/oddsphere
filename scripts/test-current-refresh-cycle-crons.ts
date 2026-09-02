import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessSlateCyclePostludeBudget,
  buildSlateCyclePostludeTiming,
  SLATE_CYCLE_MARKET_INTELLIGENCE_BUDGET_MS,
  SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS,
  SLATE_CYCLE_TIMEOUT_SAFETY_RESERVE_MS,
} from "../lib/cron/slateCyclePostludeBudget";

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

const slateCycleSource = source("app/api/cron/slate-cycle/route.ts");
assert.match(slateCycleSource, /export const maxDuration = 300/, "slate-cycle retains its five-minute platform duration");
assert.match(slateCycleSource, /SLATE_CYCLE_MARKET_INTELLIGENCE_BUDGET_MS \+\s*SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS/, "the first boundary budgets both postlude stages");
assert.match(slateCycleSource, /requiredWorkMs: SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS/, "the route recomputes its budget before snapshot publication");
assert.match(slateCycleSource, /refreshDailyEdgeResponseSnapshot/, "slate cycle republishes Daily Edge when budget remains");
assert.match(slateCycleSource, /insufficient_time_after_core_orchestrator/, "slow core deferral is explicit");
assert.match(slateCycleSource, /insufficient_time_after_market_intelligence/, "snapshot budget is rechecked after MI-v2");
assert.match(slateCycleSource, /postlude_timing/, "postlude elapsed and deferred telemetry is returned");

const fullPostludeWorkMs =
  SLATE_CYCLE_MARKET_INTELLIGENCE_BUDGET_MS +
  SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS;
const exactFullBudget = assessSlateCyclePostludeBudget({
  routeStartedAtMs: 0,
  nowMs: 210_000,
  requiredWorkMs: fullPostludeWorkMs,
});
assert.equal(exactFullBudget.remainingMs, 90_000, "full postlude exact boundary retains 90 seconds");
assert.equal(exactFullBudget.canRun, true, "full postlude runs at the exact 90-second boundary");
assert.equal(
  assessSlateCyclePostludeBudget({
    routeStartedAtMs: 0,
    nowMs: 210_001,
    requiredWorkMs: fullPostludeWorkMs,
  }).canRun,
  false,
  "full postlude defers one millisecond below the 90-second boundary",
);

const exactSnapshotBudget = assessSlateCyclePostludeBudget({
  routeStartedAtMs: 0,
  nowMs: 255_000,
  requiredWorkMs: SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS,
});
assert.equal(exactSnapshotBudget.remainingMs, 45_000, "post-MI snapshot exact boundary retains 45 seconds");
assert.equal(exactSnapshotBudget.canRun, true, "post-MI snapshot runs at the exact 45-second boundary");
assert.equal(
  assessSlateCyclePostludeBudget({
    routeStartedAtMs: 5_000,
    nowMs: 4_000,
    requiredWorkMs: fullPostludeWorkMs,
  }).elapsedMs,
  0,
  "backward wall-clock skew cannot create negative elapsed time",
);

const completedStage = { status: "completed" as const, elapsed_ms: 22_000, deferred_reason: null };
const deferredStage = {
  status: "deferred" as const,
  elapsed_ms: 0,
  deferred_reason: "insufficient_time_after_market_intelligence",
};
const timing = buildSlateCyclePostludeTiming({
  routeStartedAtMs: 0,
  nowMs: 270_000,
  budgetAfterCore: exactFullBudget,
  marketIntelligenceV2: completedStage,
  responseSnapshot: deferredStage,
});
assert.deepEqual(
  timing,
  {
    max_duration_ms: 300_000,
    core_elapsed_ms: 210_000,
    remaining_after_core_ms: 90_000,
    required_remaining_after_core_ms: 90_000,
    safety_reserve_ms: SLATE_CYCLE_TIMEOUT_SAFETY_RESERVE_MS,
    market_intelligence_v2: completedStage,
    response_snapshot: deferredStage,
    total_elapsed_ms: 270_000,
    remaining_at_return_ms: 30_000,
  },
  "postlude telemetry derives exact core, stage, total, and remaining timing",
);
assert.match(source("app/api/cron/lineup-watch/route.ts"), /refreshDailyEdgeResponseSnapshot/, "lineup changes republish Daily Edge");
assert.match(source("app/api/cron/pregame-sweep/route.ts"), /refreshDailyEdgeResponseSnapshot/, "locks republish Daily Edge");
assert.match(source("app/api/cron/public-splits-observations-refresh/route.ts"), /refreshDailyEdgeResponseSnapshot/, "split changes republish Daily Edge");
assert.match(source("app/api/cron/public-splits-observations-refresh/route.ts"), /runScheduledMarketIntelligenceV2Collection/, "split refresh retries source-aware MLB splits");
assert.match(source("app/api/cron/public-splits-observations-refresh/route.ts"), /includeSharpApiHistory:\s*true/, "fast split refresh recovers event-specific Sharp history every 15 minutes");
assert.match(source("lib/services/marketIntelligenceV2/shadowSync.ts"), /path:\s*["']\/events["']/, "Sharp recovery discovers event IDs independently of the league split snapshot");
assert.match(source("app/api/cron/tracking-refresh/route.ts"), /refreshTrackingResponseSnapshot/, "tracking cron republishes member Tracking");
assert.match(source("app/api/cron/mlb-player-props-refresh/route.ts"), /refreshMlbPropsBoard/, "Player Props has one canonical board refresh");

const coldSlateSchedules = crons.filter((cron) => cron.path === "/api/cron/slate-cycle").map((cron) => cron.schedule);
assert.ok(coldSlateSchedules.includes("5 8,10-12 * * *"), "cold slate schedule includes the 11:05 UTC freshness run");
assert.ok(crons.some((cron) => cron.path === "/api/cron/tracking-refresh" && cron.schedule === "33 * * * *"), "Tracking publishes hourly");
assert.ok(crons.some((cron) => cron.path === "/api/cron/pregame-sweep?lockOnly=true" && cron.schedule?.startsWith("* ")), "lock sweep runs every minute while remaining targeted");
assert.ok(crons.some((cron) => cron.path === "/api/cron/public-splits-observations-refresh" && cron.schedule === "*/15 11-12 * * *"), "split recovery starts at 07:00 ET");
assert.match(source("app/api/cron/pregame-sweep/route.ts"), /leaseRetryMaxWaitMs:\s*!dryRun && gateActive \? 20_000/, "lock sweep briefly waits for the shared lease before deferring");
assert.match(source("app/lab/hooks/useDailyEdge.ts"), /refreshIntervalMs = 60_000/, "an open member board observes a newly published lock within a minute");

console.log("PASS current refresh-cycle schedules use the authoritative leased writers and republish member snapshots");
