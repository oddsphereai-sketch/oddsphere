import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  determineNflForwardCollectionNeed,
  planNflForwardEvidenceCaptures,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../lib/services/football/nflForwardEvidence";
import { buildTeamDepthSnapshot } from "../lib/services/football/balldontlieNflRoster";
import type { NflPreviewGame } from "../lib/services/football/balldontlieNflPreviewSlate";
import { __NFL_VENUE_WEATHER_TEST__ } from "../lib/services/football/nflVenueWeather";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "../lib/services/football/nflRegularDecisionEvidence";

const game: NflPreviewGame = {
  providerGameId: "1001",
  providerWeek: 1,
  season: 2026,
  scheduledStart: "2026-09-10T00:20:00.000Z",
  status: "scheduled",
  away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
  home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
};

function stored(stage: "opening" | "unlocked" | "t60", capturedAt: string): NflForwardStoredEvidence {
  return {
    id: `${stage}-${capturedAt}`,
    providerGameId: game.providerGameId,
    stage,
    capturedAt,
    gameStartAt: game.scheduledStart,
    payloadSha256: "a".repeat(64),
    payload: { slateGameCount: 1 } as NflForwardEvidencePayload,
  };
}

const early = "2026-09-01T12:00:00.000Z";
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [], capturedAt: early, unlockedCadenceMinutes: 360 })
    .map((plan) => plan.stage),
  ["opening"],
);
assert.equal(determineNflForwardCollectionNeed({ existing: [], now: early }).reason, "opening_seed");

const opening = stored("opening", early);
assert.equal(determineNflForwardCollectionNeed({ existing: [opening], now: "2026-09-01T18:00:00.000Z" }).reason, "unlocked_refresh_due");
assert.deepEqual(
  planNflForwardEvidenceCaptures({
    games: [game], existing: [opening], capturedAt: "2026-09-01T18:00:00.000Z", unlockedCadenceMinutes: 360,
  }).map((plan) => plan.stage),
  ["unlocked"],
);

const t60Time = "2026-09-09T23:30:00.000Z";
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [], capturedAt: t60Time, unlockedCadenceMinutes: 60 })
    .map((plan) => [plan.stage, plan.captureTiming]),
  [["opening", "late_first_observation"], ["t60", "on_time"]],
);
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [opening], capturedAt: t60Time, unlockedCadenceMinutes: 60 })
    .map((plan) => plan.stage),
  ["t60"],
);
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [opening], capturedAt: game.scheduledStart, unlockedCadenceMinutes: 60 }),
  [],
);

const depth = buildTeamDepthSnapshot({
  team: "SEA",
  capturedAt: early,
  sourceSnapshotId: null,
  rows: [
    { player: { id: 10, first_name: "Starter", last_name: "Quarterback", position_abbreviation: "QB" }, depth: "QB1" },
    { player: { id: 11, first_name: "Backup", last_name: "Quarterback", position_abbreviation: "QB" }, depth: "QB2" },
  ],
});
assert.equal(depth.starterStatus, "projected");
assert.equal(depth.expectedStartingQuarterback?.name, "Starter Quarterback");
assert.equal(depth.quarterbackDepth.length, 2);

for (const abbreviation of [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]) assert.ok(__NFL_VENUE_WEATHER_TEST__.NFL_VENUES[abbreviation], `missing NFL venue ${abbreviation}`);

const route = readFileSync(path.resolve("app/api/cron/nfl-forward-evidence/route.ts"), "utf8");
assert.match(route, /leaseGroup: "prediction_pipeline"/);
assert.match(route, /requireLease: true/);
assert.match(route, /publication_attempted: false/);
assert.match(route, /tracking_attempted: false/);
const writer = readFileSync(path.resolve("lib/services/football/nflForwardEvidenceWriter.ts"), "utf8");
assert.doesNotMatch(writer, /writeCurrentNflPublishedMemberSnapshot|buildNflTrackingProposals/);
assert.match(writer, /evaluatedBets: \[\], outcomeConfidence: \[\]/);
assert.equal(NFL_T60_MAX_CAPTURE_LAG_MINUTES, 20);
assert.match(writer, /NFL_T60_MAX_CAPTURE_LAG_MINUTES/);
assert.doesNotMatch(writer, /t60LagMinutes[^\n]*> 20/);
const migration = readFileSync(path.resolve("lib/db/schema-migration-v38-nfl-forward-evidence.sql"), "utf8");
const executableMigration = migration.replace(/--.*$/gm, "");
assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.nfl_forward_evidence_snapshots TO service_role/);
assert.match(
  migration,
  /REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.nfl_forward_evidence_snapshots FROM service_role/,
);
assert.doesNotMatch(executableMigration, /GRANT[^;]*(UPDATE|DELETE)[^;]*nfl_forward_evidence_snapshots/i);
const vercel = JSON.parse(readFileSync(path.resolve("vercel.json"), "utf8")) as { crons: Array<{ path: string }> };
assert.equal(vercel.crons.filter((cron) => cron.path === "/api/cron/nfl-forward-evidence").length, 1);

console.log("NFL forward evidence planner, cadence, roster/QB, immutable DB, lease, and no-publication boundaries passed.");
