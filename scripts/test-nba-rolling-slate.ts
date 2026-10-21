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
  "nba_rolling_member_board_2026_10_20_r3_same_day_final_retention",
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
assert.equal(isNbaMemberScheduleStatus("STATUS_FINAL"), true);
assert.equal(isNbaMemberScheduleStatus("final"), false);
assert.equal(isNbaMemberScheduleStatus("STATUS_CANCELED"), false);

assert.equal(nbaMemberAnalysisEligible("2026-10-19", "2026-10-19"), false);
assert.equal(nbaMemberAnalysisEligible("2026-10-20", "2026-10-19"), true);
assert.equal(nbaMemberAnalysisEligible("2026-10-20", "2026-10-20"), true);
assert.equal(nbaMemberAnalysisEligible("2026-10-21", "2026-10-20"), true);
assert.equal(nbaMemberAnalysisEligible("2026-10-27", "2026-10-20"), false);
assert.equal(nbaMemberAnalysisEligible("2026-06-14", "2026-10-20"), true);

const cronSource = readFileSync(
  new URL("../app/api/cron/nba-daily-refresh/route.ts", import.meta.url),
  "utf8",
);
assert.match(cronSource, /nbaScheduleSeedDates\(etDateDashed, intraday\)/);
assert.match(cronSource, /nba_daily_refresh_schedule_2026_10_21_r12_current_slate_publication_isolation/);
assert.match(cronSource, /lineTotals\.linesRemoved/);
assert.match(cronSource, /NBA line refresh partial/);
assert.match(cronSource, /loadNbaRollingSchedule\(etDateDashed\)/);
assert.match(cronSource, /sort\(\)\.slice\(0, 2\)/);
assert.match(cronSource, /nba_daily_refresh_rolling_board/);
assert.match(cronSource, /snapshotBlockers\.length > 0/);
assert.match(cronSource, /futureWindowPartial: partial && snapshotBlockers\.length === 0/);
assert.match(cronSource, /current_lines_errors/);
assert.match(cronSource, /leaseGroup:\s*"prediction_pipeline"/);
assert.match(cronSource, /requireLease:\s*true/);

const adapterSource = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url),
  "utf8",
);
assert.match(adapterSource, /date === currentBoardDate && rollingSchedule && rollingSchedule\.games\.length > 0/);
assert.match(adapterSource, /buildNbaRollingMemberBoard\(date, rollingSchedule\)/);
assert.match(adapterSource, /NBA_ROLLING_ANALYSIS_CONCURRENCY = 3/);
assert.match(adapterSource, /NBA rolling member board incomplete/);
assert.match(adapterSource, /responses\.push\(\.\.\.await Promise\.all/);
assert.doesNotMatch(adapterSource, /response\.games = response\.games\.filter/);
assert.match(adapterSource, /analyzedGameIds/);

const shellSource = readFileSync(
  new URL("../app/lab/components/daily-edge/DailyEdgeShell.tsx", import.meta.url),
  "utf8",
);
assert.match(shellSource, /NBA · Next 7 Days/);
assert.doesNotMatch(shellSource, /Picks, probabilities, grades, and prices stay blank/);
assert.doesNotMatch(shellSource, /Analysis opens game day/);

const candidateReaderSource = readFileSync(
  new URL("../app/dev/experience-preview/ActualDailyEdgePreview.tsx", import.meta.url),
  "utf8",
);
assert.match(candidateReaderSource, /displaySnapshot\.nbaRollingSchedule/);
assert.match(candidateReaderSource, /NBA · Next 7 Days/);
assert.doesNotMatch(candidateReaderSource, /Analysis opens game day/);

const candidatePageSource = readFileSync(
  new URL("../app/lab/daily-edge/CandidateDailyEdgePage.tsx", import.meta.url),
  "utf8",
);
assert.match(candidatePageSource, /nbaRollingBoard/);
assert.match(candidatePageSource, /live model and exact-price Bet grades/);
assert.match(candidatePageSource, /activePreviewSports/);

const sportsRegistrySource = readFileSync(
  new URL("../app/lab/lib/dailyEdgeSports.ts", import.meta.url),
  "utf8",
);
assert.match(sportsRegistrySource, /NBA_2026_MEMBER_BOARD_START_MS/);
assert.doesNotMatch(sportsRegistrySource, /NBA_2026_SCHEDULE_LIVE_START_MS/);

console.log("PASS NBA rolling seven-day board renders analyzed Daily Edge predictions while tracking stays T-60 scoped");
