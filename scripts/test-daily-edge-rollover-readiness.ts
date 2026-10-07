import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  currentDailyEdgeBoardDate,
  currentSlateDate,
  DAILY_EDGE_BOARD_ROLL_HOUR_ET,
  isMlbRolloverSeedWindow,
  MLB_DAILY_REFRESH_SCHEDULE_RELEASE,
  previousReadyBoardDate,
} from "../lib/dates/slateDate";

assert.equal(DAILY_EDGE_BOARD_ROLL_HOUR_ET, 3);
assert.equal(MLB_DAILY_REFRESH_SCHEDULE_RELEASE, "mlb_daily_refresh_schedule_2026_10_07_r1_readiness_gated_rollover");

// Summer: New York is UTC-4.
assert.equal(currentSlateDate("nba", new Date("2026-07-15T06:59:00.000Z")), "2026-07-15");
assert.equal(currentDailyEdgeBoardDate("nba", new Date("2026-07-15T06:59:00.000Z")), "2026-07-14");
assert.equal(currentDailyEdgeBoardDate("mlb", new Date("2026-07-15T06:59:00.000Z")), "2026-07-14");
assert.equal(currentDailyEdgeBoardDate("mlb", new Date("2026-07-15T07:00:00.000Z")), "2026-07-15");
assert.equal(currentDailyEdgeBoardDate("nba", new Date("2026-07-15T07:00:00.000Z")), "2026-07-15");

// Winter: New York is UTC-5.
assert.equal(currentDailyEdgeBoardDate("nba", new Date("2026-12-15T07:59:00.000Z")), "2026-12-14");
assert.equal(currentDailyEdgeBoardDate("nba", new Date("2026-12-15T08:00:00.000Z")), "2026-12-15");
assert.equal(currentDailyEdgeBoardDate("nhl", new Date("2026-12-15T07:59:00.000Z")), "2026-12-14");
assert.equal(currentDailyEdgeBoardDate("nhl", new Date("2026-12-15T08:00:00.000Z")), "2026-12-15");
assert.equal(currentDailyEdgeBoardDate("wnba", new Date("2026-12-15T07:59:00.000Z")), "2026-12-14");
assert.equal(currentDailyEdgeBoardDate("wnba", new Date("2026-12-15T08:00:00.000Z")), "2026-12-15");
assert.equal(currentDailyEdgeBoardDate("mlb", new Date("2026-12-15T07:59:00.000Z")), "2026-12-14");
assert.equal(currentDailyEdgeBoardDate("mlb", new Date("2026-12-15T08:00:00.000Z")), "2026-12-15");
assert.equal(isMlbRolloverSeedWindow(new Date("2026-07-15T07:05:00.000Z")), true);
assert.equal(isMlbRolloverSeedWindow(new Date("2026-07-15T08:05:00.000Z")), false);
assert.equal(isMlbRolloverSeedWindow(new Date("2026-12-15T07:05:00.000Z")), false);
assert.equal(isMlbRolloverSeedWindow(new Date("2026-12-15T08:05:00.000Z")), true);

// DST transitions stay tied to the local 03:00 boundary rather than a fixed
// UTC hour. The spring missing hour and fall repeated hour cannot advance the
// board before local 03:00.
assert.equal(currentDailyEdgeBoardDate("nba", new Date("2026-03-08T06:59:00.000Z")), "2026-03-07");
assert.equal(currentDailyEdgeBoardDate("nba", new Date("2026-03-08T07:00:00.000Z")), "2026-03-08");
assert.equal(currentDailyEdgeBoardDate("nba", new Date("2026-11-01T06:30:00.000Z")), "2026-10-31");

assert.equal(previousReadyBoardDate({
  sport: "mlb",
  requestedDate: "2026-07-15",
  now: new Date("2026-07-15T07:05:00.000Z"),
}), "2026-07-14");
assert.equal(previousReadyBoardDate({
  sport: "nba",
  requestedDate: "2026-07-15",
  now: new Date("2026-07-15T07:05:00.000Z"),
}), "2026-07-14");
assert.equal(previousReadyBoardDate({
  sport: "nba",
  requestedDate: "2026-07-14",
  now: new Date("2026-07-15T06:55:00.000Z"),
}), null, "before the 3 AM rollover the intended prior-day board does not fall back another day");
assert.equal(previousReadyBoardDate({
  sport: "nhl",
  requestedDate: "2026-12-15",
  now: new Date("2026-12-15T08:05:00.000Z"),
}), "2026-12-14");
assert.equal(previousReadyBoardDate({
  sport: "wnba",
  requestedDate: "2026-12-15",
  now: new Date("2026-12-15T08:05:00.000Z"),
}), "2026-12-14");

const routeSource = readFileSync(new URL("../app/api/lab/daily-edge/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /sport === "mlb" \|\| sport === "nba"[\s\S]*currentDailyEdgeBoardDate\(sport\)/,
  "MLB, NBA, NHL, and WNBA default to the 3 AM ET member board date");
assert.match(routeSource, /sport === "mlb" \|\| sport === "nba" \|\| sport === "nhl" \|\| sport === "wnba"/,
  "daily North American models share only the board-date readiness primitive, not a writer or model");
assert.match(routeSource, /!snapshot && !explicitDate && readinessGatedRollover/,
  "only a default-date readiness-gated read may retain the previous ready board");
assert.match(routeSource, /readLatestLabResponseSnapshot<DailyEdgeResponse>\(fallbackKey\)/,
  "rollover continuity reads the last published prior board without a provider call");
assert.match(routeSource, /fallbackSnapshot\?\.payload\.memberPresentation\?\.releaseId ===[\s\S]*DAILY_EDGE_MEMBER_PRESENTATION_RELEASE_ID/,
  "rollover continuity cannot restore a superseded member presentation release");

console.log("PASS MLB/NBA/NHL/WNBA Daily Edge rollover is DST-safe, readiness-gated, and explicit-date preserving");
