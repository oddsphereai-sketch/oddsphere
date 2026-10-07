import assert from "node:assert/strict";
import {
  lineupTeamKey,
  selectCompleteProjectedLineupUnits,
  type ProjectedLineupPersistenceRow,
} from "../lib/services/projectedLineupContinuity";

function rows(gameId: number, teamId: number, count: number): ProjectedLineupPersistenceRow[] {
  return Array.from({ length: count }, (_, index) => ({
    game_id: gameId,
    team_id: teamId,
    player_id: teamId * 100 + index + 1,
    batting_position: index + 1,
    starting_position: index === 0 ? "CF" : "DH",
    is_confirmed: false,
    is_dh: index > 0,
  }));
}

const expected = new Map<number, ReadonlySet<number>>([[10, new Set([1, 2])]]);

const empty = selectCompleteProjectedLineupUnits({ rows: [], expectedTeamIdsByGame: expected });
assert.equal(empty.units.length, 0);
assert.deepEqual(empty.incompleteTeamKeys.sort(), ["10|1", "10|2"]);

const partial = selectCompleteProjectedLineupUnits({
  rows: [...rows(10, 1, 7), ...rows(10, 2, 9)],
  expectedTeamIdsByGame: expected,
});
assert.equal(partial.units.length, 1);
assert.equal(lineupTeamKey(partial.units[0]!.gameId, partial.units[0]!.teamId), "10|2");
assert.deepEqual(partial.incompleteTeamKeys, ["10|1"]);

const confirmed = selectCompleteProjectedLineupUnits({
  rows: [...rows(10, 1, 9), ...rows(10, 2, 9)],
  expectedTeamIdsByGame: expected,
  confirmedTeamKeys: new Set(["10|1"]),
});
assert.equal(confirmed.units.length, 1);
assert.equal(confirmed.units[0]!.teamId, 2);
assert.deepEqual(confirmed.confirmedTeamKeys, ["10|1"]);

const duplicatePositions = rows(10, 1, 8).map((row) => ({ ...row, batting_position: 1 }));
const duplicatePlayers = rows(10, 2, 8).map((row) => ({ ...row, player_id: 201 }));
const malformed = selectCompleteProjectedLineupUnits({
  rows: [...duplicatePositions, ...duplicatePlayers],
  expectedTeamIdsByGame: expected,
});
assert.equal(malformed.units.length, 0);
assert.equal(malformed.incompleteTeamKeys.length, 2);

const wrongTeam = selectCompleteProjectedLineupUnits({
  rows: rows(10, 3, 9),
  expectedTeamIdsByGame: expected,
});
assert.equal(wrongTeam.units.length, 0);
assert.equal(wrongTeam.incompleteTeamKeys.length, 2);

console.log("PASS projected lineup continuity retains prior data unless an exact complete team replacement exists");
