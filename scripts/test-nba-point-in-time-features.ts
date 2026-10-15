import assert from "node:assert/strict";
import {
  buildNbaPointInTimeFeatures,
  normalizeNbaHistoricalGame,
  normalizeNbaHistoricalPlayerAdvanced,
  normalizeNbaHistoricalPlayerBox,
  type NbaHistoricalPlayerAdvanced,
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
  const abbreviations: Record<number, string> = { 1: "ATL", 2: "BOS", 3: "BKN", 4: "CHA" };
  return {
    gameId: args.id,
    season: args.season,
    startTime: `${args.date}T23:00:00.000Z`,
    homeTeamId: args.homeTeamId ?? 1,
    awayTeamId: args.awayTeamId ?? 2,
    homeTeam: abbreviations[args.homeTeamId ?? 1] ?? `T${args.homeTeamId ?? 1}`,
    awayTeam: abbreviations[args.awayTeamId ?? 2] ?? `T${args.awayTeamId ?? 2}`,
    homeScore: args.homeScore,
    awayScore: args.awayScore,
  };
}

function teamAdvanced(gameId: number, teamId: number, startRowId: number): NbaHistoricalPlayerAdvanced[] {
  return Array.from({ length: 5 }, (_, index) => ({
    rowId: startRowId + index,
    gameId,
    teamId,
    playerId: teamId * 100 + index,
    period: 0,
    possessions: 70 - index,
    estimatedNetRating: teamId === 1 ? 4 - index : -4 + index,
    usagePercentage: 0.28 - index * 0.025,
    pointsPaint: 8 + index,
    pointsFastBreak: 2 + index,
    pointsSecondChance: 1 + index,
    pointsOffTurnovers: 2 + index,
    passes: 35 + index,
    touches: 50 + index,
    secondaryAssists: index % 2,
    screenAssistPoints: index * 2,
    deflections: 1 + index,
    contestedShots: 3 + index,
    defendedAtRimFga: 1 + index,
    defendedAtRimFgm: index,
    reboundChancesTotal: 8 + index,
    distance: 2.5 + index * 0.1,
    speed: 4 + index * 0.05,
  }));
}

function advancedFor(gameRow: NbaHistoricalGame): NbaHistoricalPlayerAdvanced[] {
  return [
    ...teamAdvanced(gameRow.gameId, gameRow.homeTeamId, gameRow.gameId * 100),
    ...teamAdvanced(gameRow.gameId, gameRow.awayTeamId, gameRow.gameId * 100 + 10),
  ];
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
const advanced = [first, second, third].flatMap(advancedFor);
const rows = buildNbaPointInTimeFeatures({ games, boxes, advanced });

assert.deepEqual(rows.map((row) => row.game_id), [1, 2, 3], "games must be processed chronologically");
assert.equal(rows[0]?.home_current_games, 0);
assert.equal(rows[0]?.elo_home_rating, 1500);
assert.equal(rows[0]?.elo_away_rating, 1500);
assert.equal(typeof rows[0]?.elo_home_win_probability, "number");
assert.equal(rows[1]?.home_current_games, 0);
assert.equal(rows[1]?.home_prior_games, 1);
assert.equal(rows[1]?.home_offRating_5, null);
assert.equal(typeof rows[1]?.home_offRating_prior, "number");
assert.equal(rows[2]?.home_current_games, 1);
assert.equal(typeof rows[2]?.home_offRating_5, "number");
assert.equal(typeof rows[2]?.home_pointsPaintShare_5, "number");
assert.equal(rows[2]?.home_rotation_expected_players_5, 5);
assert.equal(typeof rows[2]?.matchup_home_efg_edge_5, "number");
assert.equal(typeof rows[2]?.baseline_expected_margin_pp100, "number");
assert.notEqual(rows[2]?.elo_home_rating, rows[2]?.elo_away_rating);
assert.equal(rows[2]?.home_games_last_4_days, 1);
assert.equal(rows[2]?.home_back_to_back, 0);
assert.equal(typeof rows[2]?.home_travel_distance_miles, "number");
assert.equal(rows[2]?.home_venue_altitude_feet, 1050);

const travelFirst = game({
  id: 30,
  season: 2025,
  date: "2025-11-05",
  homeScore: 105,
  awayScore: 101,
  homeTeamId: 2,
  awayTeamId: 1,
});
const travelSecond = game({
  id: 31,
  season: 2025,
  date: "2025-11-08",
  homeScore: 109,
  awayScore: 103,
  homeTeamId: 1,
  awayTeamId: 3,
});
const travelRows = buildNbaPointInTimeFeatures({
  games: [travelFirst, travelSecond],
  boxes: [...boxesFor(travelFirst), ...boxesFor(travelSecond)],
  advanced: [...advancedFor(travelFirst), ...advancedFor(travelSecond)],
});
assert.ok(Number(travelRows[1]?.home_travel_distance_miles) > 800);
assert.ok(Number(travelRows[1]?.home_westward_travel_miles) > 800);
assert.equal(travelRows[1]?.home_eastward_travel_miles, 0);
assert.equal(travelRows[1]?.home_time_zones_westward, 0);
assert.equal(travelRows[1]?.home_time_zones_eastward, 0);

const changedSecond = { ...second, homeScore: 90, awayScore: 130 };
const changedRows = buildNbaPointInTimeFeatures({
  games: [first, changedSecond, third],
  boxes,
  advanced,
});
assert.deepEqual(
  withoutTargets(rows[1] as Record<string, unknown>),
  withoutTargets(changedRows[1] as Record<string, unknown>),
  "a game's finalized result must not alter its own pregame features",
);

const changedAdvanced = advanced.map((row) =>
  row.gameId === second.gameId && row.teamId === second.homeTeamId
    ? { ...row, pointsPaint: (row.pointsPaint ?? 0) + 20 }
    : row);
const changedAdvancedRows = buildNbaPointInTimeFeatures({ games: [first, second, third], boxes, advanced: changedAdvanced });
assert.deepEqual(
  withoutTargets(rows[1] as Record<string, unknown>),
  withoutTargets(changedAdvancedRows[1] as Record<string, unknown>),
  "a game's advanced result must not alter its own pregame features",
);
assert.notEqual(
  rows[2]?.home_pointsPaintShare_5,
  changedAdvancedRows[2]?.home_pointsPaintShare_5,
  "finalized tracking evidence should affect later games only",
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
  advanced: [...advancedFor(simultaneousA), ...advancedFor(simultaneousB)],
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
const normalizedAdvanced = normalizeNbaHistoricalPlayerAdvanced({
  id: 51,
  period: 0,
  possessions: 72,
  estimated_net_rating: 5.4,
  usage_percentage: 0.24,
  points_paint: 12,
  points_fast_break: 4,
  points_second_chance: 2,
  points_off_turnovers: 3,
  passes: 40,
  touches: 61,
  secondary_assists: 1,
  screen_assist_points: 4,
  deflections: 3,
  contested_shots: 7,
  defended_at_rim_fga: 4,
  defended_at_rim_fgm: 2,
  rebound_chances_total: 16,
  distance: 2.7,
  speed: 4.2,
  game: { id: 10 },
  team: { id: 21 },
  player: { id: 175 },
});
assert.equal(normalizedAdvanced.usagePercentage, 0.24);
assert.equal(normalizedAdvanced.defendedAtRimFgm, 2);

console.log("NBA point-in-time feature and no-leakage tests passed.");
