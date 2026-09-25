import assert from "node:assert/strict";
import {
  buildNflWeeklyPossessionMargin,
  NFL_WEEKLY_POSSESSION_MARGIN_RELEASE,
} from "@/lib/services/football/nflWeeklyPossessionMargin";
import {
  NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
  type NflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonTeamStat,
} from "@/lib/services/football/nflPlayerPropsCurrentSeasonState";

function teamStat(team: string, opponent: string, home: boolean): NflPlayerPropsCurrentSeasonTeamStat {
  return {
    gameId: "week-1-test",
    season: 2026,
    week: 1,
    scheduledStart: "2026-09-10T00:00:00.000Z",
    team,
    opponent,
    home,
    pointsFor: team === "PHI" ? 31 : 17,
    pointsAgainst: team === "PHI" ? 17 : 31,
    firstDowns: team === "PHI" ? 24 : 17,
    thirdDownConversions: 5,
    thirdDownAttempts: 11,
    fourthDownConversions: 1,
    fourthDownAttempts: 2,
    totalOffensivePlays: team === "PHI" ? 69 : 58,
    totalYards: team === "PHI" ? 410 : 285,
    yardsPerPlay: team === "PHI" ? 5.94 : 4.91,
    netPassingYards: team === "PHI" ? 260 : 190,
    passingAttempts: team === "PHI" ? 34 : 31,
    sacksAllowed: team === "PHI" ? 1 : 4,
    rushingYards: team === "PHI" ? 150 : 95,
    rushingAttempts: team === "PHI" ? 34 : 23,
    redZoneScores: team === "PHI" ? 3 : 1,
    redZoneAttempts: team === "PHI" ? 4 : 3,
    turnovers: team === "PHI" ? 0 : 2,
    fumblesLost: team === "PHI" ? 0 : 1,
    interceptionsThrown: team === "PHI" ? 0 : 1,
    possessionTimeSeconds: team === "PHI" ? 2010 : 1590,
  };
}

const state: NflPlayerPropsCurrentSeasonState = {
  release: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
  season: 2026,
  completeThroughWeek: 1,
  updatedAt: "2026-09-18T00:00:00.000Z",
  games: [],
  stats: [],
  teamStats: [teamStat("PHI", "TEN", true), teamStat("TEN", "PHI", false)],
};
const before = JSON.stringify(state);
const first = buildNflWeeklyPossessionMargin({
  currentSeasonState: state,
  homeTeam: "PHI",
  awayTeam: "TEN",
  marketHomeMargin: 7,
});
const second = buildNflWeeklyPossessionMargin({
  currentSeasonState: state,
  homeTeam: "PHI",
  awayTeam: "TEN",
  marketHomeMargin: 7,
});

assert.deepEqual(first, second);
assert.equal(first.release, NFL_WEEKLY_POSSESSION_MARGIN_RELEASE);
assert.equal(first.completeThroughWeek, 1);
assert.equal(first.calibratedHomeMargin, 0.1 * first.independentHomeMargin + 0.9 * 7);
assert.ok(first.independentHomeScore > first.independentAwayScore);
assert.equal(JSON.stringify(state), before, "weekly score state must remain immutable");
assert.throws(() => buildNflWeeklyPossessionMargin({
  currentSeasonState: { ...state, season: 2025 },
  homeTeam: "PHI",
  awayTeam: "TEN",
  marketHomeMargin: 7,
}), /requires the 2026 current-season state/);

console.log("NFL weekly possession margin tests passed");
