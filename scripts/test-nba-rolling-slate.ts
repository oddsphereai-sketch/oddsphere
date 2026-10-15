import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NBA_REGULAR_SEASON_OPENER,
  NBA_ROLLING_SCHEDULE_DAYS,
  NBA_ROLLING_SCHEDULE_RELEASE,
  isNbaMemberScheduleStatus,
  nbaMemberAnalysisEligible,
  nbaRollingScheduleWindow,
  nbaScheduleSeedDates,
} from "../lib/services/nba/nbaRollingSchedule";

assert.equal(NBA_ROLLING_SCHEDULE_DAYS, 7);
assert.equal(NBA_REGULAR_SEASON_OPENER, "2026-10-20");
assert.equal(
  NBA_ROLLING_SCHEDULE_RELEASE,
  "nba_rolling_member_schedule_2026_10_15_r1_schedule_only",
);

assert.equal(nbaRollingScheduleWindow("2026-10-13"), null);
assert.deepEqual(nbaRollingScheduleWindow("2026-10-14"), {
  from: "2026-10-20",
  through: "2026-10-20",
});
assert.deepEqual(nbaRollingScheduleWindow("2026-10-15"), {
  from: "2026-10-20",
  through: "2026-10-21",
});
assert.deepEqual(nbaRollingScheduleWindow("2026-10-20"), {
  from: "2026-10-20",
  through: "2026-10-26",
});

assert.deepEqual(nbaScheduleSeedDates("2026-10-15", false), [
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
  "2026-10-19",
  "2026-10-20",
  "2026-10-21",
]);
assert.deepEqual(nbaScheduleSeedDates("2026-10-15", true), [
  "2026-10-15",
  "2026-10-21",
]);
assert.deepEqual(nbaScheduleSeedDates("2026-11-01", false).slice(-2), [
  "2026-11-06",
  "2026-11-07",
]);

assert.equal(isNbaMemberScheduleStatus("STATUS_SCHEDULED"), true);
assert.equal(isNbaMemberScheduleStatus("status_in_progress"), true);
assert.equal(isNbaMemberScheduleStatus("STATUS_HALFTIME"), true);
assert.equal(isNbaMemberScheduleStatus("STATUS_END_PERIOD"), true);
assert.equal(isNbaMemberScheduleStatus("STATUS_DELAYED"), true);
assert.equal(isNbaMemberScheduleStatus("STATUS_POSTPONED"), true);
assert.equal(isNbaMemberScheduleStatus("STATUS_FINAL"), false);
assert.equal(isNbaMemberScheduleStatus("STATUS_CANCELED"), false);

assert.equal(nbaMemberAnalysisEligible("2026-10-19", "2026-10-19"), false);
assert.equal(nbaMemberAnalysisEligible("2026-10-20", "2026-10-19"), false);
assert.equal(nbaMemberAnalysisEligible("2026-10-20", "2026-10-20"), true);
assert.equal(nbaMemberAnalysisEligible("2026-10-21", "2026-10-20"), false);
assert.equal(nbaMemberAnalysisEligible("2026-06-14", "2026-10-20"), true);

const cronSource = readFileSync(
  new URL("../app/api/cron/nba-daily-refresh/route.ts", import.meta.url),
  "utf8",
);
assert.match(cronSource, /nbaScheduleSeedDates\(etDateDashed, intraday\)/);
assert.match(cronSource, /nba_daily_refresh_schedule_2026_10_15_r6_professional_state/);
assert.match(cronSource, /nba_daily_refresh_schedule_only/);
assert.match(cronSource, /leaseGroup:\s*"prediction_pipeline"/);
assert.match(cronSource, /requireLease:\s*true/);

const adapterSource = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url),
  "utf8",
);
assert.ok(
  adapterSource.indexOf("if (!nbaMemberAnalysisEligible(date, currentBoardDate))") <
    adapterSource.lastIndexOf("const { nbaDto, openPricesByGame } = await buildNbaDailyEdgePipeline(date)"),
  "future/preseason schedule-only requests must be gated before the prediction pipeline runs",
);
assert.match(adapterSource, /games:\s*\[\]/);
assert.doesNotMatch(adapterSource, /response\.games = response\.games\.filter/);
assert.match(adapterSource, /analyzedGameIds/);

const shellSource = readFileSync(
  new URL("../app/lab/components/daily-edge/DailyEdgeShell.tsx", import.meta.url),
  "utf8",
);
assert.match(shellSource, /NBA · Next 7 Days/);
assert.match(shellSource, /Picks, probabilities, grades, and prices stay blank/);
assert.match(shellSource, /Analysis opens game day/);
assert.match(shellSource, /s\.scheduleLive \? "Schedule live" : "Offseason"/);

const sportsRegistrySource = readFileSync(
  new URL("../app/lab/lib/dailyEdgeSports.ts", import.meta.url),
  "utf8",
);
assert.match(sportsRegistrySource, /scheduleLive: Date\.now\(\) >= NBA_2026_SCHEDULE_LIVE_START_MS/);
assert.match(sportsRegistrySource, /NBA_2026_SCHEDULE_LIVE_START_MS/);
assert.match(sportsRegistrySource, /NBA_2026_REGULAR_SEASON_START_MS/);

console.log("PASS NBA rolling seven-day schedule stays separate from member predictions and tracking");
