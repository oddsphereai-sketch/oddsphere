import { readFileSync } from "node:fs";
import {
  MLB_OFFICIAL_LINEUP_TEAM_START_RESERVE_MS,
  canStartMlbOfficialLineupTeamUnit,
  parseMlbStatsOfficialLineups,
} from "../lib/services/mlbOfficialLineupService";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}`);
    fail++;
  }
}

function teamBox(teamId: number, firstBatterId: number) {
  const battingOrder = Array.from({ length: 9 }, (_, index) => firstBatterId + index);
  return {
    team: { id: teamId },
    battingOrder,
    players: Object.fromEntries(
      battingOrder.map((id) => [
        `ID${id}`,
        {
          person: { id, fullName: `Batter ${id}` },
          position: { abbreviation: "DH" },
        },
      ]),
    ),
  };
}

const awayBox = teamBox(10, 100);
const homeBox = teamBox(20, 200);
const payload = {
  gameData: {
    teams: {
      away: { id: 10 },
      home: { id: 20 },
    },
    probablePitchers: {
      away: { id: 901, fullName: "Away Starter" },
      home: { id: 902, fullName: "Home Starter" },
    },
    players: {
      ...Object.fromEntries(
        [...awayBox.battingOrder, ...homeBox.battingOrder].map((id) => [
          `ID${id}`,
          {
            id,
            fullName: `Batter ${id}`,
            primaryPosition: { abbreviation: "DH" },
            batSide: { code: "R" },
          },
        ]),
      ),
      ID901: {
        id: 901,
        fullName: "Away Starter",
        primaryPosition: { abbreviation: "P" },
        pitchHand: { code: "R" },
      },
      ID902: {
        id: 902,
        fullName: "Home Starter",
        primaryPosition: { abbreviation: "P" },
        pitchHand: { code: "L" },
      },
    },
  },
  liveData: {
    boxscore: {
      teams: {
        away: awayBox,
        home: homeBox,
      },
    },
  },
};

const dbGame = {
  id: 77,
  game_date: "2026-07-25T17:00:00Z",
  home_team_id: 2,
  away_team_id: 1,
  home_abbr: "HME",
  away_abbr: "AWY",
};
const teams = new Map([
  ["AWY", { id: 1, abbreviation: "AWY" }],
  ["HME", { id: 2, abbreviation: "HME" }],
]);

console.log("\n━━━ MLB official lineup starter confirmation tests ━━━\n");

const spots = parseMlbStatsOfficialLineups(payload, 12345, dbGame, teams);
const starters = spots.filter((spot) => spot.isStartingPitcher);
const batters = spots.filter((spot) => !spot.isStartingPitcher);

check("official batting orders still emit 18 confirmed hitters", batters.length === 18);
check("official feed emits one confirmed starter row per team", starters.length === 2);
check(
  "starter rows use P with no batting position",
  starters.every(
    (spot) =>
      spot.startingPosition === "P" &&
      spot.battingPosition === null &&
      spot.isDh === false,
  ),
);
check(
  "starter handedness is preserved",
  starters.find((spot) => spot.playerMlbId === 901)?.throws === "R" &&
    starters.find((spot) => spot.playerMlbId === 902)?.throws === "L",
);

const pendingPayload = structuredClone(payload);
pendingPayload.liveData.boxscore.teams.away.battingOrder = [];
const pendingSpots = parseMlbStatsOfficialLineups(
  pendingPayload,
  12345,
  dbGame,
  teams,
);
check(
  "probable pitcher is not confirmed before an official batting order posts",
  !pendingSpots.some(
    (spot) => spot.dbTeamId === 1 && spot.isStartingPitcher,
  ),
);

check(
  "a complete team unit starts only with the full reserve available",
  canStartMlbOfficialLineupTeamUnit(112_000, 100_000) === true &&
    canStartMlbOfficialLineupTeamUnit(111_999, 100_000) === false &&
    MLB_OFFICIAL_LINEUP_TEAM_START_RESERVE_MS === 12_000,
);

const serviceSource = readFileSync("lib/services/mlbOfficialLineupService.ts", "utf8");
const teamUpsertIndex = serviceSource.indexOf('.upsert(rows, { onConflict: "game_id,team_id,player_id" })');
const staleDeleteIndex = serviceSource.indexOf('.not("player_id", "in"');
check(
  "official team replacement publishes the complete unit before stale-row cleanup",
  teamUpsertIndex >= 0 && staleDeleteIndex > teamUpsertIndex,
);
check(
  "official provider and database operations share the bounded deadline signal",
  serviceSource.includes("signal: deadlineSignal(options)") &&
    serviceSource.includes(".abortSignal(deadlineSignal(options))") &&
    serviceSource.includes('deadline_stage = "official_team_persistence"'),
);

console.log(`\n━━━ Results ━━━\n  ✓ ${pass}    ✗ ${fail}`);
if (fail > 0) process.exit(1);
