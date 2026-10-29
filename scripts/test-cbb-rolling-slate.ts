import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cbbRollingSlateDates, cbbRollingSlateGames } from "../lib/cbb/rollingSlate";
import { buildCbbRollingSchedule, excludeAnalyzedCbbScheduleGames } from "../lib/services/cbb/cbbRollingSchedule";
import { cbbFixtureRefreshDates } from "../lib/services/cbb/seedCbbGamesService";
import type { CbbGame, CbbTeam } from "../lib/cbb/types";

const home: CbbTeam = { id: 92, conference_id: 1, name: "Wildcats",
  full_name: "Villanova Wildcats", college: "Villanova", abbreviation: "VILL" };
const away: CbbTeam = { id: 11, conference_id: 1, name: "Fighting Irish",
  full_name: "Notre Dame Fighting Irish", college: "Notre Dame", abbreviation: "ND" };
const game = (id: number, date: string): CbbGame => ({ id, date, season: 2026,
  home_team: home, visitor_team: away, status: "pre", status_state: "scheduled",
  period: 0, home_score: 0, away_score: 0 });

assert.deepEqual(cbbRollingSlateDates("2026-11-01"), [
  "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04",
  "2026-11-05", "2026-11-06", "2026-11-07",
]);
assert.throws(() => cbbRollingSlateDates("2026-11-1"), /Invalid/);
assert.deepEqual(cbbFixtureRefreshDates("2026-11-02"), [
  "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04",
  "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08",
]);
const rows = cbbRollingSlateGames([
  game(3, "2026-11-02T04:59:00Z"), // 11:59 PM ET, November 1.
  game(2, "2026-11-01T14:30:00Z"),
  game(4, "2026-11-02T05:01:00Z"), // 12:01 AM ET, November 2.
  game(5, "2026-11-08T04:59:00Z"), // 11:59 PM ET, November 7.
  game(6, "2026-11-08T05:01:00Z"), // Outside the seven-day window.
], "2026-11-01");
assert.equal(rows.length, 7);
assert.deepEqual(rows.map(row => row.games.map(value => value.id)), [[2, 3], [4], [], [], [], [], [5]]);
assert.throws(() => cbbRollingSlateGames([game(2, "2026-11-01T14:30:00Z"),
  game(2, "2026-11-02T14:30:00Z")], "2026-11-01"), /Duplicate/);
const teamRows = [
  { id: 100, abbreviation: "VILL", display_name: home.full_name,
    logo_url: "https://a.espncdn.com/i/teamlogos/ncaa/500/222.png" },
  { id: 200, abbreviation: "ND", display_name: away.full_name,
    logo_url: "https://a.espncdn.com/i/teamlogos/ncaa/500/87.png" },
];
const scheduleRows = [{ external_id: 2, slate_date: "2026-11-01", game_date: "2026-11-01T14:30:00Z",
  status: "STATUS_SCHEDULED", away_team_id: 200, home_team_id: 100, venue: null }];
const schedule = buildCbbRollingSchedule({ anchorDate: "2026-11-01", games: scheduleRows, teams: teamRows });
assert.equal(schedule.games.length, 1);
assert.equal(schedule.games[0].awayTeamDisplayName, away.full_name);
assert.equal(schedule.games[0].homeTeamLogo, teamRows[0].logo_url);
assert.equal(schedule.throughDate, "2026-11-07");
assert.equal(excludeAnalyzedCbbScheduleGames(schedule, [2]).games.length, 0);
assert.equal(excludeAnalyzedCbbScheduleGames(schedule, [999]).games.length, 1);
assert.equal(schedule.games.length, 1); // Filtering cannot mutate the source snapshot.
assert.throws(() => buildCbbRollingSchedule({ anchorDate: "2026-11-01", games: scheduleRows,
  teams: teamRows.slice(0, 1) }), /unresolved team/);
assert.throws(() => buildCbbRollingSchedule({ anchorDate: "2026-11-01", games: [scheduleRows[0], scheduleRows[0]],
  teams: teamRows }), /duplicated|inconsistent/);
assert.throws(() => buildCbbRollingSchedule({ anchorDate: "2026-11-01",
  games: [{ ...scheduleRows[0], slate_date: "2026-11-02" }], teams: teamRows }), /inconsistent/);
const memberPage = readFileSync(new URL("../app/lab/daily-edge/CandidateDailyEdgePage.tsx", import.meta.url), "utf8");
const privatePage = readFileSync(new URL("../app/dev/experience-preview/page.tsx", import.meta.url), "utf8");
const cardView = readFileSync(new URL("../app/dev/experience-preview/ActualDailyEdgePreview.tsx", import.meta.url), "utf8");
assert.match(memberPage, /CBB_ACTIVATION\.memberPublication &&/);
assert.match(memberPage, /excludeAnalyzedCbbScheduleGames/);
assert.match(privatePage, /snapshot\.cbbRollingSchedule = await loadCbbRollingSchedule/);
assert.match(privatePage, /sport === "cbb" && process\.env\.NODE_ENV === "production"\) notFound\(\)/);
assert.match(cardView, /sport === "cbb" \? "College Basketball" : "NBA"/);
assert.match(cardView, /groupByDay=\{Boolean\(renderedWeeklySlate\) \|\| sport === "cbb"\}/);
console.log("CBB rolling slate tests passed");
