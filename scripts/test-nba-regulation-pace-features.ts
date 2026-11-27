import assert from "node:assert/strict";
import { buildNbaPointInTimeFeatures, buildNbaRegulationPaceFeatures,
  type NbaHistoricalGame, type NbaHistoricalPlayerBox } from "../lib/services/nba/nbaPointInTimeFeatures";
const games: NbaHistoricalGame[] = [1, 2, 3].map((id, index) => ({ gameId: id, season: 2025,
  startTime: `2025-11-${String(1 + index * 3).padStart(2, "0")}T23:00:00Z`, homeTeamId: 1, awayTeamId: 2,
  homeTeam: "ATL", awayTeam: "BOS", homeScore: 111, awayScore: 109 }));
const boxes: NbaHistoricalPlayerBox[] = games.flatMap(g => [1, 2].map(teamId => ({ gameId: g.gameId, teamId, playerId: teamId,
  rowId: g.gameId * 10 + teamId, minutes: g.gameId === 1 ? 265 : 240, fgm: 40, fga: 90, fg3m: 10, fg3a: 30,
  ftm: 20, fta: 25, oreb: 10, dreb: 30, ast: 25, stl: 7, blk: 4, turnover: 10, pf: 20,
  points: teamId === 1 ? 111 : 109, plusMinus: teamId === 1 ? 2 : -2 })));
const gameMinutes = new Map([[1, 53], [2, 48], [3, 48]]);
const args = { games, boxes, gameMinutes };
const before = JSON.stringify(args);
const legacy = buildNbaPointInTimeFeatures(args), rows = buildNbaRegulationPaceFeatures(args);
assert.equal(rows[1].home_pace_5, legacy[1].home_pace_5);
const possessions = 90 + .44 * 25 - 10 + 10;
assert.equal(rows[1].home_pace48_5, possessions * 48 / 53);
assert.equal(rows[1].home_recent_overtime_count_5, 1);
assert.equal(rows[1].home_offRating_5, 100 * 111 / possessions);
assert.equal(rows[1].home_defRating_5, 100 * 109 / possessions);
for (let i = 0; i < rows.length; i++) {
  for (const [key, value] of Object.entries(legacy[i])) {
    if (key !== "release") assert.deepEqual(rows[i][key], value, `legacy field ${key}`);
  }
}
const changedDurations = buildNbaRegulationPaceFeatures({ ...args, gameMinutes: new Map([[1, 53], [2, 63], [3, 48]]) });
assert.deepEqual(changedDurations[1], rows[1], "target's duration cannot enter its own forecast");
assert.notEqual(changedDurations[2].home_pace48_5, rows[2].home_pace48_5);
assert.throws(() => buildNbaRegulationPaceFeatures({ ...args, gameMinutes: new Map([[1, 50], [2, 48], [3, 48]]) }));
assert.throws(() => buildNbaRegulationPaceFeatures({ ...args, gameMinutes: new Map() }));
const finals = new Map(games.map(g => [g.gameId, new Date(Date.parse(g.startTime) + 4 * 3600000).toISOString()]));
const original = buildNbaRegulationPaceFeatures({ ...args, finalAvailableAt: finals });
assert.equal(original[1].home_pace48_5, rows[1].home_pace48_5);
const late = new Map(finals); late.set(1, "2025-11-05T00:00:00Z");
const held = buildNbaRegulationPaceFeatures({ ...args, finalAvailableAt: late });
assert.equal(held[1].home_pace48_5, null);
assert.equal(JSON.stringify(args), before);
assert.deepEqual(buildNbaPointInTimeFeatures(args), legacy);
console.log("PASS duration normalization, all legacy fields exact, per100 efficiencies unchanged, target/future/late-source controls and immutable originals");
