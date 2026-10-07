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
assert.match(sweep, /\.in\("market", \["moneyline", "total"\]\)/);
assert.match(writer, /externalIdsFilter\?: readonly number\[\]/);
assert.match(writer, /for \(const market of \["moneyline", "total"\]/);
assert.match(writer, /displayed_context_markets:[\s\S]+spread:/);

console.log("NBA T-60 lock lifecycle tests passed");
