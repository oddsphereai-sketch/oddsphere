import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planNflPlayerPropsRefresh } from "../lib/services/football/nflPlayerPropsCadence";
import type { NflPlayerPropsProductionSnapshot } from "../lib/services/football/nflPlayerPropsProductionContract";

const NOW = "2026-10-07T16:00:00.000Z";

assert.equal(planNflPlayerPropsRefresh({ now: NOW, previous: null }).reason, "missing_snapshot");

const hourlyFresh = planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:21:00.000Z", lockAt: "2026-10-11T16:00:00.000Z" }),
});
assert.deepEqual(
  { run: hourlyFresh.run, cadence: hourlyFresh.cadenceMinutes, reason: hourlyFresh.reason },
  { run: false, cadence: 60, reason: "not_due" },
  "a far-away slate does not recall every provider on each quarter-hour heartbeat",
);

const hourlyDue = planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:00:00.000Z", lockAt: "2026-10-11T16:00:00.000Z" }),
});
assert.equal(hourlyDue.reason, "hourly_refresh_due");

const precedingRelease = planNflPlayerPropsRefresh({
  now: NOW,
  previous: {
    ...snapshot({ generatedAt: "2026-10-07T15:59:00.000Z", lockAt: "2026-10-11T16:00:00.000Z" }),
    release: "nfl_player_props_member_2026_10_27_r47_receiving_direction_correction",
  },
});
assert.deepEqual(
  { run: precedingRelease.run, reason: precedingRelease.reason, release: precedingRelease.release },
  {
    run: true,
    reason: "release_refresh_due",
    release: "nfl_player_props_cadence_2026_10_27_r4_release_aware_refresh",
  },
  "a newly deployed model family immediately recomputes unlocked rows instead of waiting for snapshot age",
);

const schedulerJitterDue = planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:00:01.494Z", lockAt: "2026-10-11T16:00:00.000Z" }),
});
assert.deepEqual(
  { run: schedulerJitterDue.run, reason: schedulerJitterDue.reason, release: schedulerJitterDue.release },
  {
    run: true,
    reason: "hourly_refresh_due",
    release: "nfl_player_props_cadence_2026_10_27_r4_release_aware_refresh",
  },
  "the observed 1.494-second scheduler lead cannot stretch an hourly refresh to 75 minutes",
);
assert.equal(planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:00:05.001Z", lockAt: "2026-10-11T16:00:00.000Z" }),
}).run, false, "the five-second tolerance does not flatten the released cadence");

const sixHourFresh = planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:40:00.000Z", lockAt: "2026-10-07T21:00:00.000Z" }),
});
assert.deepEqual(
  { run: sixHourFresh.run, cadence: sixHourFresh.cadenceMinutes },
  { run: false, cadence: 30 },
  "inside six hours, the authoritative writer becomes due every thirty minutes",
);
assert.equal(planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:30:00.000Z", lockAt: "2026-10-07T21:00:00.000Z" }),
}).reason, "thirty_minute_refresh_due");

assert.equal(planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:45:00.000Z", lockAt: "2026-10-07T17:30:00.000Z" }),
}).reason, "fifteen_minute_refresh_due", "inside two hours, every quarter-hour heartbeat refreshes");

const lockDue = planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "2026-10-07T15:55:00.000Z", lockAt: "2026-10-07T15:59:00.000Z" }),
});
assert.deepEqual(
  { run: lockDue.run, reason: lockDue.reason, cadence: lockDue.cadenceMinutes },
  { run: true, reason: "lock_due", cadence: 15 },
  "a due lock can never be skipped because the preceding market snapshot is recent",
);

assert.equal(planNflPlayerPropsRefresh({
  now: NOW,
  previous: snapshot({ generatedAt: "invalid", lockAt: "2026-10-11T16:00:00.000Z" }),
}).reason, "invalid_snapshot_time");

const routeSource = readFileSync(new URL("../app/api/cron/nfl-forward-evidence/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /planNflPlayerPropsRefresh\(/, "the existing NFL heartbeat owns the cadence plan");
assert.match(routeSource, /playerPropsEnabled && playerPropsCadence\?\.run/, "the full writer is gated by the plan");
assert.match(
  routeSource,
  /playerPropsCadence = planNflPlayerPropsRefresh\(\{ now: cycleNow, previous: null \}\)/,
  "a snapshot lookup failure fails open to the existing recovery writer",
);
assert.equal(
  (routeSource.match(/runNflPlayerPropsProductionWriter\(\{/g) ?? []).length,
  1,
  "the cadence repair does not create a second props writer",
);

console.log("PASS NFL player props state-aware cadence preserves hourly, near-game, and lock refreshes");

function snapshot(args: { generatedAt: string; lockAt: string }): Pick<NflPlayerPropsProductionSnapshot, "generatedAt" | "board"> & { release: string } {
  const scheduledStart = Number.isFinite(Date.parse(args.lockAt))
    ? new Date(Date.parse(args.lockAt) + 60 * 60_000).toISOString()
    : "2026-10-11T17:00:00.000Z";
  return {
    release: "nfl_player_props_member_2026_10_27_r51_passing_yards_direction",
    generatedAt: args.generatedAt,
    board: {
      decisions: [{ state: "unlocked", scheduledStart, lockAt: args.lockAt }],
    } as NflPlayerPropsProductionSnapshot["board"],
  };
}
