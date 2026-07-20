import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BATTER_HITS_PA_MODEL_VERSION } from "../lib/mlb/props/batterHitsPaModel";
import { BATTER_HRR_MODEL_VERSION } from "../lib/mlb/props/batterHrrCountModel";
import { MLB_PROP_MARKET_KEYS } from "../lib/mlb/props/config";
import { activeMlbPropMarketModelVersions } from "../lib/mlb/props/marketModelVersions";

const versions = activeMlbPropMarketModelVersions();
assert.deepEqual(Object.keys(versions).sort(), [...MLB_PROP_MARKET_KEYS].sort());
assert.equal(versions.batter_hits, BATTER_HITS_PA_MODEL_VERSION);
assert.equal(versions.batter_hits_runs_rbis, BATTER_HRR_MODEL_VERSION);
assert.equal(versions.pitcher_strikeouts, "pitcher_strikeouts_distribution_v3_verified");
assert.equal(versions.pitcher_outs, "pitcher_outs_workload_distribution_v2_verified");

const liveBoard = readFileSync(resolve(process.cwd(), "lib/mlb/props/liveBoard.ts"), "utf8");
const hitsBranch = liveBoard.indexOf('args.definition.marketKey === "batter_hits"');
const hrrBranch = liveBoard.indexOf('args.definition.marketKey === "batter_hits_runs_rbis"');
const legacyHitterMath = liveBoard.indexOf("const l5 = recent", hitsBranch);
assert.ok(hitsBranch >= 0 && hitsBranch < legacyHitterMath, "Batter Hits must exit before legacy hitter math");
assert.ok(hrrBranch >= 0 && hrrBranch < legacyHitterMath, "H+R+RBI must exit before legacy hitter math");

const tracking = readFileSync(resolve(process.cwd(), "lib/mlb/props/internalTracking.ts"), "utf8");
assert.ok(tracking.includes("snapshot.modelContext?.marketModelVersions?.[row.market]"));
assert.ok(!tracking.includes("process.env.ODDSPHERE_PROPS_MODEL_VERSION"));

console.log(`PASS market model ownership: ${Object.keys(versions).length} markets versioned; dedicated branches precede legacy hitter math`);
