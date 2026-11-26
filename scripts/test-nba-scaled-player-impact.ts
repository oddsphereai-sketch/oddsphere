import assert from "node:assert/strict";
import { nbaPlayerStateHash } from "../lib/research/nba/nbaPlayerStateLedger";
import { NBA_TWO_WAY_SCHEMA_HASH } from "../lib/research/nba/nbaTwoWayRotation";
import { NBA_SCALED_PLAYER_IMPACT_RELEASE, scoreNbaScaledPlayerImpact, type NbaScaledImpactHead } from "../lib/research/nba/nbaScaledPlayerImpact";
import { compareNbaScaledImpactWithSavedIncumbent, nbaImpactDirectionAtSavedLine } from "../lib/research/nba/nbaScaledImpactIncumbentComparison";
const scales = [1, 2, 3, 4, 5, 6], coefficients = [.1, .2, .3, .4, .5, .6];
const p = { weightVariance: 2, noiseVariance: 4, alpha: 2, coefficients,
  rawCoefficients: coefficients.map((x, i) => x / scales[i]), intercept: 0 };
const core = { release: NBA_SCALED_PLAYER_IMPACT_RELEASE, trainingHash: "a".repeat(64), trainingEnd: "2023-04-10T00:00:00Z",
  trainingRows: 976, sourceSchemaHash: NBA_TWO_WAY_SCHEMA_HASH, ledgerHash: "b".repeat(64), trainingBaselineHash: "c".repeat(64),
  rawFitSha256: "d".repeat(64), featureScales: scales, scaleRule: "training_rms_no_centering" as const, margin: p, total: structuredClone(p) };
const head: NbaScaledImpactHead = { ...core, hash: nbaPlayerStateHash(core) };
const input = { features: [1, 2, 3, 4, 5, 6], snapshotHash: "e".repeat(64), sourceSchemaHash: NBA_TWO_WAY_SCHEMA_HASH,
  season: 2023, cutoff: "2023-10-01T00:00:00Z" };
const before = nbaPlayerStateHash({ head, input });
const result = scoreNbaScaledPlayerImpact(head, input);
assert(Math.abs(result.marginCorrection - 2.1) < 1e-12);
assert.equal(result.marginCorrection, result.totalCorrection);
assert.equal(scoreNbaScaledPlayerImpact(head, { ...input, features: [0, 0, 0, 0, 0, 0] }).marginCorrection, 0);
assert.equal(nbaPlayerStateHash({ head, input }), before);
for (const change of [{ season: 2022 }, { cutoff: head.trainingEnd }, { cutoff: "invalid" },
  { features: [1, 2] }, { features: [1, 2, 3, 4, 5, NaN] }, { snapshotHash: "bad" }, { sourceSchemaHash: "f".repeat(64) }]) {
  assert.throws(() => scoreNbaScaledPlayerImpact(head, { ...input, ...change }));
}
for (const change of [{ featureScales: [1, 2, 0, 4, 5, 6] }, { margin: { ...p, alpha: 1 } },
  { margin: { ...p, intercept: 1 } }, { margin: { ...p, rawCoefficients: [1, 1, 1, 1, 1, 1] } }]) {
  const changed = { ...core, ...change };
  assert.throws(() => scoreNbaScaledPlayerImpact({ ...changed, hash: nbaPlayerStateHash(changed) }, input));
}
const changedFeatures = { ...input, features: [6, 2, 3, 4, 5, 6] };
assert.notEqual(scoreNbaScaledPlayerImpact(head, changedFeatures).marginCorrection, result.marginCorrection);
assert.equal(nbaPlayerStateHash({ head, input }), before);
const comparison = { head, input, savedAsOf: input.cutoff, raw: { marginHome: 4, total: 220, homeScore: 112, awayScore: 108 },
  savedIndependent: { margin: 7, total: 225 }, oldRosterCorrection: { margin: 3, total: 5 } };
const compared = compareNbaScaledImpactWithSavedIncumbent(comparison);
assert(Math.abs(compared.candidate.margin - 6.1) < 1e-12);
assert(Math.abs(compared.candidate.total - 222.1) < 1e-12);
assert.equal(compared.incumbent.margin, 7);
assert.equal(compared.fullMarketReplay, false);
assert.throws(() => compareNbaScaledImpactWithSavedIncumbent({ ...comparison, savedAsOf: "2023-09-30T00:00:00Z" }));
assert.throws(() => compareNbaScaledImpactWithSavedIncumbent({ ...comparison, oldRosterCorrection: { margin: 0, total: 0 } }));
assert.equal(nbaPlayerStateHash({ head, input }), before);
const contract = { margin: 10, total: 220, market: "spread" as const, storedSide: "away", selectedLine: 8.5, actualMargin: 7, actualTotal: 223 };
assert.equal(nbaImpactDirectionAtSavedLine(contract).side, "home");
assert.equal(nbaImpactDirectionAtSavedLine(contract).result, "loss");
assert.equal(nbaImpactDirectionAtSavedLine({ ...contract, margin: 6 }).result, "win");
assert.equal(nbaImpactDirectionAtSavedLine({ ...contract, selectedLine: 7 }).result, "push");
assert.equal(nbaImpactDirectionAtSavedLine({ ...contract, market: "total", selectedLine: 223 }).result, "push");
assert.equal(nbaImpactDirectionAtSavedLine(contract).price, null);
console.log("PASS C6 scaled/raw prediction parity, zero shock, source/time/season/head/scale/numerical guards and immutable inputs");
