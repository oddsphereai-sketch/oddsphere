import assert from "node:assert/strict";
import { nbaPlayerStateHash } from "../lib/research/nba/nbaPlayerStateLedger";
import { NBA_REGULATION_PACE_FEATURE_RELEASE } from "../lib/services/nba/nbaPointInTimeFeatures";
import { NBA_REGULATION_PACE_TOTAL_RELEASE, scoreNbaRegulationPaceTotal, type NbaRegulationPaceTotalHead } from "../lib/research/nba/nbaRegulationPaceTotal";
const features = Array.from({ length: 75 }, (_, i) => i < 13 ? `pace48_${i}` : `feature_${i}`);
const core = { release: NBA_REGULATION_PACE_TOTAL_RELEASE, featureRelease: NBA_REGULATION_PACE_FEATURE_RELEASE,
  trainingHash: "a".repeat(64), trainingRows: 2457, trainingEnd: "2023-04-10T00:00:00Z", baselineHash: "b".repeat(64),
  durationSourceHash: "c".repeat(64), rawFitSha256: "d".repeat(64), alpha: 1000,
  design: { features, rawFeatureMedians: Array(75).fill(0), missingIndicatorColumns: [], designColumns: 75,
    designMeans: Array(75).fill(0), designStandardDeviations: Array(75).fill(1), splineKnots: [] },
  totalCoefficients: [...Array.from({ length: 75 }, (_, i) => i === 0 ? 2 : 0), 220] };
const head: NbaRegulationPaceTotalHead = { ...core, hash: nbaPlayerStateHash(core) };
const input = { pace48_0: 3 }, before = nbaPlayerStateHash({ head, input });
assert.equal(scoreNbaRegulationPaceTotal(head, input, "2023-10-01T00:00:00Z").total, 226);
assert.equal(scoreNbaRegulationPaceTotal(head, {}, "2023-10-01T00:00:00Z").total, 220);
const poisoned = { ...input, target_total: 10000, target_home_margin: 10000, gameMinutes: 999 };
assert.equal(scoreNbaRegulationPaceTotal(head, poisoned, "2023-10-01T00:00:00Z").total, 226);
assert.throws(() => scoreNbaRegulationPaceTotal(head, input, head.trainingEnd));
assert.throws(() => scoreNbaRegulationPaceTotal(head, input, "invalid"));
for (const change of [{ alpha: 1 }, { featureRelease: "legacy" }, { totalCoefficients: [NaN] }]) {
  const changed = { ...core, ...change };
  assert.throws(() => scoreNbaRegulationPaceTotal({ ...changed, hash: nbaPlayerStateHash(changed) } as NbaRegulationPaceTotalHead, input, "2023-10-01T00:00:00Z"));
}
assert.equal(nbaPlayerStateHash({ head, input }), before);
console.log("PASS C7 Total linear parity, no Margin fit, target/future exclusion, source/head/date guards and immutable inputs");
