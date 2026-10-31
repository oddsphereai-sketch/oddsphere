import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const sports = source("lib/cron/pregameSweepSports.ts");
const sweep = source("app/api/cron/pregame-sweep/route.ts");
const writer = source("lib/services/nba/buildNbaPredictionRecords.ts");

assert.match(sports, /GENERIC_PREGAME_SWEEP_OWNERS[^\n]+\["mlb", "nba", "nhl"\]/);
assert.match(sweep, /sport === "nba"[\s\S]+refreshNbaLines\(\{[\s\S]+externalIdsFilter:/);
assert.match(sweep, /createNbaPredictionRecords\(\{[\s\S]+deferLock: true,[\s\S]+externalIdsFilter: enteringExternalIds/);
assert.match(sweep, /assessNbaLockCoherence/);
assert.match(sweep, /NBA_PREDICTION_RECORD_RELEASE/);
assert.match(sweep, /resolveNbaPredictionRecordLocks/);
assert.match(sweep, /NBA_PREDICTION_RECORD_LOCK_MARKETS/);
assert.doesNotMatch(
  sweep,
  /select\("game_id, market, model_version, locked_at"\)[\s\S]{0,240}\.eq\("model_version", NBA_PREDICTION_RECORD_RELEASE\)/,
  "lock discovery must not erase an immutable legacy lock after a release bump",
);
assert.match(
  sweep,
  /update\(\{ locked_at: lockedAt \}\)[\s\S]{0,360}\.eq\("model_version", NBA_PREDICTION_RECORD_RELEASE\)[\s\S]{0,240}\.is\("locked_at", null\)/,
  "the writer must lock only the current release's previously unlocked rows",
);
assert.match(writer, /externalIdsFilter\?: readonly number\[\]/);
assert.match(writer, /\["moneyline", "spread", "total"\]/);
assert.match(writer, /NBA_SPREAD_OFFICIAL_TRACKING_START/);

console.log("NBA T-60 lock lifecycle tests passed");
