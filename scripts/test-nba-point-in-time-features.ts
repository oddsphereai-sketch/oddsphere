import assert from "node:assert/strict";
import {
  buildNbaPointInTimeFeatures,
  normalizeNbaHistoricalGame,
  normalizeNbaHistoricalPlayerBox,
  type NbaHistoricalGame,
  type NbaHistoricalPlayerBox,
} from "../lib/services/nba/nbaPointInTimeFeatures";

function game(args: {
  id: number;
  season: number;
  date: string;
  homeScore: number;
  awayScore: number;
  homeTeamId?: number;
  awayTeamId?: number;
}): NbaHistoricalGame {
  return {
    gameId: args.id,
    season: args.season,
    startTime: `${args.date}T23:00:00.000Z`,
    homeTeamId: args.homeTeamId ?? 1,
    awayTeamId: args.awayTeamId ?? 2,
    homeTeam: `T${args.homeTeamId ?? 1}`,
    awayTeam: `T${args.awayTeamId ?? 2}`,
    homeScore: args.homeScore,
    awayScore: args.awayScore,
  };
}

function teamBoxes(gameId: number, teamId: number, score: number, startRowId: number): NbaHistoricalPlayerBox[] {
  const points = [Math.floor(score * 0.3), Math.floor(score * 0.24), Math.floor(score * 0.19), Math.floor(score * 0.15)];
  points.push(score - points.reduce((sum, value) => sum + value, 0));
  return points.map((playerPoints, index) => ({
    rowId: startRowId + index,
    gameId,
    teamId,
    playerId: teamId * 100 + index,
    minutes: 48,
    fgm: 6 + index,
    fga: 12 + index,
    fg3m: 2,
    fg3a: 5,
    ftm: 2,
    fta: 3,
    oreb: 1,
    dreb: 4,
    ast: 3,
    stl: 1,
    blk: 1,
    turnover: 2,
    pf: 2,
    points: playerPoints,
    plusMinus: teamId === 1 ? 2 : -2,
  }));
}

function boxesFor(gameRow: NbaHistoricalGame): NbaHistoricalPlayerBox[] {
  return [
    ...teamBoxes(gameRow.gameId, gameRow.homeTeamId, gameRow.homeScore, gameRow.gameId * 100),
    ...teamBoxes(gameRow.gameId, gameRow.awayTeamId, gameRow.awayScore, gameRow.gameId * 100 + 10),
  ];
}

function withoutTargets(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("target_")));
}

const first = game({ id: 1, season: 2024, date: "2025-04-01", homeScore: 110, awayScore: 100 });
const second = game({ id: 2, season: 2025, date: "2025-10-21", homeScore: 120, awayScore: 115 });
const third = game({ id: 3, season: 2025, date: "2025-10-24", homeScore: 108, awayScore: 112 });
const games = [third, first, second];
const boxes = [first, second, third].flatMap(boxesFor);
const rows = buildNbaPointInTimeFeatures({ games, boxes });

assert.deepEqual(rows.map((row) => row.game_id), [1, 2, 3], "games must be processed chronologically");
assert.equal(rows[0]?.home_current_games, 0);
assert.equal(rows[1]?.home_current_games, 0);
assert.equal(rows[1]?.home_prior_games, 1);
assert.equal(rows[1]?.home_offRating_5, null);
assert.equal(typeof rows[1]?.home_offRating_prior, "number");
assert.equal(rows[2]?.home_current_games, 1);
assert.equal(typeof rows[2]?.home_offRating_5, "number");
assert.equal(rows[2]?.home_games_last_4_days, 1);
assert.equal(rows[2]?.home_back_to_back, 0);

const changedSecond = { ...second, homeScore: 90, awayScore: 130 };
const changedRows = buildNbaPointInTimeFeatures({
  games: [first, changedSecond, third],
  boxes,
});
assert.deepEqual(
  withoutTargets(rows[1] as Record<string, unknown>),
  withoutTargets(changedRows[1] as Record<string, unknown>),
  "a game's finalized result must not alter its own pregame features",
);
assert.notEqual(
  rows[2]?.home_offRating_5,
  changedRows[2]?.home_offRating_5,
  "a finalized result should affect later games only",
);

const simultaneousA = game({
  id: 20,
  season: 2025,
  date: "2025-11-01",
  homeScore: 150,
  awayScore: 80,
  homeTeamId: 1,
  awayTeamId: 2,
});
const simultaneousB = game({
  id: 21,
  season: 2025,
  date: "2025-11-01",
  homeScore: 100,
  awayScore: 99,
  homeTeamId: 3,
  awayTeamId: 4,
});
const simultaneousRows = buildNbaPointInTimeFeatures({
  games: [simultaneousA, simultaneousB],
  boxes: [...boxesFor(simultaneousA), ...boxesFor(simultaneousB)],
});
assert.equal(simultaneousRows[0]?.league_off_rating, 110);
assert.equal(
  simultaneousRows[1]?.league_off_rating,
  110,
  "a simultaneous game's final score must not enter another game's pregame state",
);

const normalizedGame = normalizeNbaHistoricalGame({
  id: 10,
  season: 2025,
  datetime: "2025-10-21T23:30:00Z",
  status_state: "final",
  home_team_score: 125,
  visitor_team_score: 124,
  home_team: { id: 21, abbreviation: "okc" },
  visitor_team: { id: 11, abbreviation: "hou" },
});
assert.equal(normalizedGame.homeTeam, "OKC");
const normalizedBox = normalizeNbaHistoricalPlayerBox({
  id: 50,
  min: "30:30",
  fgm: 7,
  fga: 14,
  fg3m: 2,
  fg3a: 5,
  ftm: 3,
  fta: 4,
  oreb: 1,
  dreb: 5,
  ast: 4,
  stl: 1,
  blk: 0,
  turnover: 2,
  pf: 3,
  pts: 19,
  plus_minus: 6,
  game: { id: 10 },
  team: { id: 21 },
  player: { id: 175 },
});
assert.equal(normalizedBox.minutes, 30.5);

console.log("NBA point-in-time feature and no-leakage tests passed.");
