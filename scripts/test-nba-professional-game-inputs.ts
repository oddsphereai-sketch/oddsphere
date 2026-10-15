import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE,
  normalizeNbaProfessionalGameInput,
} from "../lib/services/nba/nbaProfessionalGameInputs";

const game = {
  id: 7001,
  season: 2026,
  datetime: "2026-10-20T23:30:00.000Z",
  status: "Final",
  status_state: "final",
  home_team: { id: 21, abbreviation: "OKC" },
  visitor_team: { id: 11, abbreviation: "HOU" },
  home_team_score: 120,
  visitor_team_score: 110,
};
const box = (id: number, teamId: number, playerId: number, points: number) => ({
  id,
  game: { id: 7001 },
  team: { id: teamId },
  player: { id: playerId },
  min: "120",
  fgm: 20,
  fga: 45,
  fg3m: 5,
  fg3a: 15,
  ftm: 5,
  fta: 6,
  oreb: 5,
  dreb: 15,
  ast: 10,
  stl: 3,
  blk: 2,
  turnover: 4,
  pf: 8,
  pts: points,
  plus_minus: teamId === 21 ? 5 : -5,
});
const result = normalizeNbaProfessionalGameInput({
  game,
  boxes: [box(1, 21, 101, 60), box(2, 21, 102, 60), box(3, 11, 103, 55), box(4, 11, 104, 55)],
  capturedAt: "2026-10-21T06:00:00.000Z",
});
assert.equal(result.game.gameId, 7001);
assert.equal(result.homeBox.points, 120);
assert.equal(result.awayBox.points, 110);
assert.equal(result.homeBox.minutes, 240);
assert.equal(result.homeBox.fga, 90);
assert.equal(result.insert.collector_release, NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE);

const source = readFileSync(
  new URL("../lib/services/nba/nbaProfessionalGameInputs.ts", import.meta.url),
  "utf8",
);
assert.match(source, /\.from\("nba_professional_game_inputs"\)[\s\S]*?\.insert\(/);
assert.doesNotMatch(source, /\.from\("nba_professional_game_inputs"\)[\s\S]*?\.update\(/);
assert.doesNotMatch(source, /\.from\("nba_professional_game_inputs"\)[\s\S]*?\.upsert\(/);
assert.doesNotMatch(source, /\.from\("nba_professional_game_inputs"\)[\s\S]*?\.delete\(/);

const migration = readFileSync(
  new URL("../lib/db/schema-migration-v44-nba-professional-game-inputs.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /UNIQUE \(collector_release, provider_game_id\)/);
assert.match(migration, /GRANT SELECT, INSERT/);
assert.doesNotMatch(migration, /GRANT[\s\S]*UPDATE/);

console.log("NBA professional game inputs: aggregate parity and append-only storage contract passed.");
