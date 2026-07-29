import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseMlbHitterSeasonStats,
  parseMlbPitcherSeasonStats,
} from "../lib/providers/real_api/_mlbStatsApiClient";
import {
  hasFreshTeamBattingCoverage,
} from "../lib/services/seasonBattingStatsService";
import {
  hasFreshSlatePitchingCoverage,
} from "../lib/services/seasonPitchingRosterStatsService";
import {
  seasonStatsDailyRefreshSource,
} from "../lib/services/seasonStatsDailyRefreshMarker";

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

const parsedPitchers = parseMlbPitcherSeasonStats({
  stats: [{
    group: { displayName: "pitching" },
    splits: [{
      player: { id: 456 },
      stat: {
        gamesPlayed: 42,
        gamesStarted: 0,
        wins: 4,
        losses: 2,
        era: "2.70",
        whip: "1.100",
        inningsPitched: "40.1",
        hits: 35,
        earnedRuns: 12,
        homeRuns: 4,
        baseOnBalls: 9,
        strikeOuts: 48,
        saves: 3,
        holds: 12,
      },
    }],
  }],
}, 2026);
assert.equal(parsedPitchers.length, 1);
assert.equal(parsedPitchers[0]?.mlb_person_id, 456);
assert.equal(parsedPitchers[0]?.innings_pitched, 40 + 1 / 3);
assert.ok(Math.abs((parsedPitchers[0]?.strikeouts_per_9 ?? 0) - 10.7107) < 0.001);

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
  slateDate: "2026-07-28",
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
  slateDate: "2026-07-28",
  nowMs,
}), false);

const orchestrator = readFileSync("lib/services/automationOrchestrator.ts", "utf8");
const pitchingStep = orchestrator.indexOf('runStep("s5_season_pitching"');
const battingStep = orchestrator.indexOf('runStep("s5_1_season_batting"');
const firstInningStep = orchestrator.indexOf('runStep("s6_first_inning_refresh"');
const modelStep = orchestrator.indexOf('"m2_automodel",');
assert.ok(battingStep >= 0 && battingStep < firstInningStep);
assert.ok(pitchingStep >= 0 && pitchingStep < battingStep);
assert.ok(firstInningStep < modelStep);
assert.match(orchestrator, /refreshSlateSeasonPitchingStats/);
assert.match(orchestrator, /runStep\("s5_1_season_batting",\s*effectiveWriteMode\.season,\s*"season"/);

const battingService = readFileSync("lib/services/seasonBattingStatsService.ts", "utf8");
assert.doesNotMatch(battingService, /game_predictions|prediction_records|locked_at|tracking_records/);
assert.match(battingService, /getMlbHitterSeasonStats/);
assert.equal((battingService.match(/getMlbHitterSeasonStats\(/g) ?? []).length, 1);
assert.match(battingService, /MLB_STATS_UPSERT_BATCH_SIZE = 250/);
assert.match(battingService, /\.upsert\(batch, \{ onConflict: "player_id,season,season_type" \}\)/);

const statsClient = readFileSync("lib/providers/real_api/_mlbStatsApiClient.ts", "utf8");
assert.match(statsClient, /playerPool=ALL&limit=2000/);
assert.equal((statsClient.match(/getMlbPitcherSeasonStats\(/g) ?? []).length, 1);

const pitchingPlayers = [
  { id: 11, team_id: 10, mlb_person_id: 201, provider_ids: null },
  { id: 12, team_id: 20, mlb_person_id: 202, provider_ids: null },
];
const pitchingStats = pitchingPlayers.map((player) => ({
  player_id: player.id,
  pitching_era: 3.5,
  pitching_ip: 40,
  updated_at: "2026-07-28T17:00:00.000Z",
}));
assert.equal(hasFreshSlatePitchingCoverage({
  players: pitchingPlayers,
  stats: pitchingStats,
  slateDate: "2026-07-28",
}), true);
assert.equal(hasFreshSlatePitchingCoverage({
  players: pitchingPlayers,
  stats: pitchingStats.map((row) =>
    row.player_id === 12
      ? { ...row, updated_at: "2026-07-27T17:00:00.000Z" }
      : row
  ),
  slateDate: "2026-07-28",
}), false);

const vercel = readFileSync("vercel.json", "utf8");
assert.doesNotMatch(vercel, /season-batting|batting-refresh/);
assert.equal(
  seasonStatsDailyRefreshSource("batting", "2026-07-28"),
  "mlb_season_batting_bulk:2026-07-28",
);
assert.equal(
  seasonStatsDailyRefreshSource("pitching", "2026-07-28"),
  "mlb_season_pitching_bulk:2026-07-28",
);
assert.match(battingService, /hasSuccessfulSeasonStatsDailyRefresh/);
const pitchingService = readFileSync("lib/services/seasonPitchingRosterStatsService.ts", "utf8");
assert.match(pitchingService, /hasSuccessfulSeasonStatsDailyRefresh/);
assert.doesNotMatch(vercel, /mlb_season_(batting|pitching)_bulk/);

console.log("MLB data freshness tests passed");
