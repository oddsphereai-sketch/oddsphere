import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseMlbHitterSeasonStats,
} from "../lib/providers/real_api/_mlbStatsApiClient";
import {
  hasFreshTeamBattingCoverage,
} from "../lib/services/seasonBattingStatsService";

const parsed = parseMlbHitterSeasonStats({
  stats: [{
    group: { displayName: "hitting" },
    splits: [{
      player: { id: 123 },
      team: { id: 147 },
      stat: {
        gamesPlayed: 91,
        atBats: 350,
        runs: 62,
        hits: 101,
        avg: ".289",
        doubles: 22,
        triples: 3,
        homeRuns: 19,
        rbi: 64,
        totalBases: 186,
        baseOnBalls: 41,
        strikeOuts: 77,
        stolenBases: 8,
        obp: ".365",
        slg: ".531",
        ops: ".896",
        plateAppearances: 402,
        hitByPitch: 6,
        sacFlies: 5,
      },
    }],
  }],
}, 2026);

assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.mlb_person_id, 123);
assert.equal(parsed[0]?.ops, 0.896);
assert.equal(parsed[0]?.plate_appearances, 402);

const nowMs = Date.parse("2026-07-28T18:00:00.000Z");
const players = [
  { id: 1, team_id: 10, mlb_person_id: 101, provider_ids: null },
  { id: 2, team_id: 10, mlb_person_id: 102, provider_ids: null },
  { id: 3, team_id: 10, mlb_person_id: 103, provider_ids: null },
  { id: 4, team_id: 20, mlb_person_id: 104, provider_ids: null },
  { id: 5, team_id: 20, mlb_person_id: 105, provider_ids: null },
  { id: 6, team_id: 20, mlb_person_id: 106, provider_ids: null },
];
const freshStats = players.map((player) => ({
  player_id: player.id,
  batting_ops: 0.750,
  batting_pa: 200,
  updated_at: "2026-07-28T17:00:00.000Z",
}));
assert.equal(hasFreshTeamBattingCoverage({
  teamIds: [10, 20],
  players,
  stats: freshStats,
  nowMs,
}), true);
assert.equal(hasFreshTeamBattingCoverage({
  teamIds: [10, 20],
  players,
  stats: freshStats.map((row) =>
    row.player_id === 6
      ? { ...row, updated_at: "2026-07-27T17:00:00.000Z" }
      : row
  ),
  nowMs,
}), false);

const orchestrator = readFileSync("lib/services/automationOrchestrator.ts", "utf8");
const battingStep = orchestrator.indexOf('runStep("s5_1_season_batting"');
const firstInningStep = orchestrator.indexOf('runStep("s6_first_inning_refresh"');
const modelStep = orchestrator.indexOf('"m2_automodel",');
assert.ok(battingStep >= 0 && battingStep < firstInningStep);
assert.ok(firstInningStep < modelStep);
assert.match(orchestrator, /runStep\("s5_1_season_batting",\s*effectiveWriteMode\.season,\s*"season"/);

const battingService = readFileSync("lib/services/seasonBattingStatsService.ts", "utf8");
assert.doesNotMatch(battingService, /game_predictions|prediction_records|locked_at|tracking_records/);
assert.match(battingService, /getMlbHitterSeasonStats/);
assert.match(battingService, /MLB_BATTING_STATS_FRESH_MS = 6 \* 60 \* 60 \* 1000/);
assert.equal((battingService.match(/getMlbHitterSeasonStats\(/g) ?? []).length, 1);
assert.match(battingService, /\.upsert\(payload, \{ onConflict: "player_id,season,season_type" \}\)/);

const statsClient = readFileSync("lib/providers/real_api/_mlbStatsApiClient.ts", "utf8");
assert.match(statsClient, /playerPool=ALL&limit=2000/);

const vercel = readFileSync("vercel.json", "utf8");
assert.doesNotMatch(vercel, /season-batting|batting-refresh/);

console.log("MLB data freshness tests passed");
