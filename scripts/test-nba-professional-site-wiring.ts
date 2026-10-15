import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradePrediction } from "../lib/services/predictionGrader";

const pipeline = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url),
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
assert.match(writer, /\["moneyline", "spread", "total"\]/);
assert.match(writer, /nba_game_dto_at_capture/);
assert.doesNotMatch(writer, /displayed_context_markets:\s*\{\s*spread:/);
assert.match(sweep, /rows\.length === 3/);
assert.match(sweep, /updated \$\{\(lockedRows \?\? \[\]\)\.length\}\/3 rows/);

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
