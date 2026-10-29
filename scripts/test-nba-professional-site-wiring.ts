import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradePrediction } from "../lib/services/predictionGrader";

const pipeline = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url),
  "utf8",
);
const featureSnapshot = readFileSync(
  new URL("../lib/services/nba/featureSnapshot.ts", import.meta.url),
  "utf8",
);
const writer = readFileSync(
  new URL("../lib/services/nba/buildNbaPredictionRecords.ts", import.meta.url),
  "utf8",
);
const sweep = readFileSync(
  new URL("../app/api/cron/pregame-sweep/route.ts", import.meta.url),
  "utf8",
);
const adapter = readFileSync(
  new URL("../lib/services/nba/adaptNbaToDailyEdgeResponse.ts", import.meta.url),
  "utf8",
);
const snapshotWriter = readFileSync(
  new URL("../lib/services/labResponseSnapshotWriter.ts", import.meta.url),
  "utf8",
);
const lockedMemberSnapshot = readFileSync(
  new URL("../lib/services/nba/nbaLockedMemberSnapshot.ts", import.meta.url),
  "utf8",
);
const reader = readFileSync(
  new URL("../app/lab/components/daily-edge/DailyEdgeShell.tsx", import.meta.url),
  "utf8",
);
const consumerHistory = readFileSync(
  new URL("../lib/services/nba/nbaConsumerMemberLineHistory.ts", import.meta.url),
  "utf8",
);

for (const required of [
  "loadNbaProfessionalCurrentState",
  "buildNbaProfessionalRuntimeFeatures",
  "buildNbaProfessionalCandidate",
  "applyNbaProfessionalCandidate",
  "applyNbaLockedMemberSnapshotPrecedence",
]) {
  assert.ok(pipeline.includes(required), `NBA member pipeline must invoke ${required}`);
}
assert.match(pipeline, /prediction:\s*pred/);
assert.match(pipeline, /games:\s*dynamicGames,[\s\S]*rows:\s*lockedRows/);
assert.match(pipeline, /public_splits|marketSignalsCapability/);
assert.match(
  pipeline,
  /loadCompleteCurrentGameLines\([\s\S]*context:\s*"buildNbaDailyEdgePipeline"/,
  "NBA member intelligence must read every current line past the PostgREST 1,000-row boundary",
);
assert.match(pipeline, /buildNbaMovementHistoryFromCanonicalPrices/);
assert.doesNotMatch(
  pipeline,
  /\.from\("line_history"\)/,
  "NBA opening evidence must not use a silently truncated direct line_history read",
);
assert.match(pipeline, /splitHighWaterRead[\s\S]*\.gt\("id", lastSplitId\)[\s\S]*\.lte\("id", splitHighWaterId\)/);
assert.match(pipeline, /priceHighWaterRead[\s\S]*\.gt\("id", lastPriceId\)[\s\S]*\.lte\("id", priceHighWaterId\)/);
assert.match(pipeline, /loadNbaConsumerMemberLineHistory/);
assert.match(
  pipeline,
  /priceRows:\s*\[[\s\S]*readerPriceRowsByGame[\s\S]*consumerMemberHistory\.rowsByExternalGameId/,
  "unlocked member evidence must merge consumer history after the professional reader",
);
assert.match(consumerHistory, /\.from\("line_history"\)/);
assert.match(consumerHistory, /\.gt\("id", lastId\)[\s\S]*\.lte\("id", highWaterId\)/);
assert.match(consumerHistory, /isNbaConsumerExecutionSportsbook/);
assert.match(
  featureSnapshot,
  /loadCompleteCurrentGameLines\([\s\S]*context:\s*"buildNbaFeatureSnapshots"/,
  "NBA feature snapshots must read every current line past the PostgREST 1,000-row boundary",
);
assert.match(pipeline, /selectNbaCurrentLineBoard/);
assert.match(featureSnapshot, /selectNbaCurrentLineBoard/);
assert.doesNotMatch(
  pipeline,
  /independent_score_shadow|buildNbaIndependentScoreShadow/,
  "NBA production snapshots must not compute or persist a shadow model",
);
assert.match(writer, /\["moneyline", "spread", "total"\]/);
assert.match(lockedMemberSnapshot, /nba_game_dto_at_capture/);
assert.match(lockedMemberSnapshot, /nba_daily_edge_game_at_capture/);
assert.match(writer, /buildNbaLockedMemberCapture/);
assert.match(writer, /memberGame/);
assert.doesNotMatch(writer, /displayed_context_markets:\s*\{\s*spread:/);
assert.match(sweep, /rows\.length === 3/);
assert.match(sweep, /updated \$\{\(lockedRows \?\? \[\]\)\.length\}\/3 rows/);
assert.match(sweep, /refreshNbaPublishedLockMetadata/);
assert.match(adapter, /lockedAt: game\.locked_at \?\? null/);
assert.match(adapter, /scheduledLockAt: computeLocksAt\(game\.tip_iso_utc\)/);
assert.match(adapter, /lockedMemberGamesByExternalId/);
assert.match(adapter, /if \(lockedMemberGame !== undefined\) return lockedMemberGame/);
assert.match(adapter, /nbaAvailability:[\s\S]*away_players[\s\S]*home_players/);
assert.match(reader, /function NbaAvailabilityPanel/);
assert.match(reader, /Verified Availability/);
assert.match(reader, /sourcePlayerId \?\? player\.name/);
assert.match(snapshotWriter, /applyNbaPublishedLockMetadata/);
assert.match(snapshotWriter, /payloadVersion: NBA_MEMBER_LOCK_PUBLICATION_RELEASE/);

const awayCover = gradePrediction({
  record: {
    id: 1,
    game_id: 1,
    sport: "nba",
    market: "spread",
    pick: "Away +6.5",
    side: "away",
    line_value: 6.5,
    no_bet: false,
  } as unknown as Parameters<typeof gradePrediction>[0]["record"],
  game: { status: "final", home_score: 112, away_score: 108, first_inning_runs: null },
  source: "auto_score_ingest",
});
assert.equal(awayCover.result, "win", "NBA picked-side spread must settle through the shared grader");

const homePush = gradePrediction({
  record: {
    id: 2,
    game_id: 2,
    sport: "nba",
    market: "spread",
    pick: "Home -4",
    side: "home",
    line_value: -4,
    no_bet: false,
  } as unknown as Parameters<typeof gradePrediction>[0]["record"],
  game: { status: "final", home_score: 112, away_score: 108, first_inning_runs: null },
  source: "auto_score_ingest",
});
assert.equal(homePush.result, "push", "NBA integer spread must preserve pushes");

console.log("NBA professional member, writer, Spread, and lock wiring tests passed");
