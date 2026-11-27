import assert from "node:assert/strict";
import { nbaPlayerStateHash } from "../lib/research/nba/nbaPlayerStateLedger";
import { NBA_REGULATION_PACE_FEATURE_RELEASE } from "../lib/services/nba/nbaPointInTimeFeatures";
import { NBA_ROLLING_PACE_TOTAL_RELEASE, scoreNbaRollingPaceTotal, validateNbaRollingPaceHead, type NbaRollingPaceHead } from "../lib/research/nba/nbaRollingPaceTotal";
const design = (normalized: boolean) => ({ features: Array.from({ length: 75 }, (_, i) => i < 13 ? `${normalized ? "pace48" : "pace"}_${i}` : `feature_${i}`),
  rawFeatureMedians: Array(75).fill(0), missingIndicatorColumns: [], designColumns: 75, designMeans: Array(75).fill(0), designStandardDeviations: Array(75).fill(1), splineKnots: [] });
const coefficients = (slope: number, intercept: number) => [...Array.from({ length: 75 }, (_, i) => i === 0 ? slope : 0), intercept];
const core = { release: NBA_ROLLING_PACE_TOTAL_RELEASE, featureRelease: NBA_REGULATION_PACE_FEATURE_RELEASE, alpha: 1000, rawFitSha256: "a".repeat(64),
  models: [2023, 2024, 2025].map(origin => ({ origin, trainingRows: 2457, trainingEnd: `${origin}-04-10T00:00:00Z`, firstEvaluation: `${origin}-10-01T00:00:00Z`,
    trainingIdsHash: "b".repeat(64), firstOriginFrozenMaxDifference: origin === 2023 ? 0 : null,
    legacy: { design: design(false), margin: coefficients(1, 5), total: coefficients(2, 220) }, candidateTotal: { design: design(true), total: coefficients(3, 220) } })) };
const head: NbaRollingPaceHead = { ...core, hash: nbaPlayerStateHash(core) }, before = nbaPlayerStateHash(head);
assert.deepEqual(scoreNbaRollingPaceTotal(head, 2024, "2024-11-01T00:00:00Z", { pace_0: 10 }, { pace48_0: 2 }),
  { baselineMargin: 15, candidateMargin: 15, baselineTotal: 240, candidateTotal: 226 });
assert.deepEqual(scoreNbaRollingPaceTotal(head, 2024, "2024-11-01T00:00:00Z", { pace_0: 10, actualTotal: 9999 }, { pace48_0: 2, actualMargin: -9999 }),
  { baselineMargin: 15, candidateMargin: 15, baselineTotal: 240, candidateTotal: 226 });
assert.throws(() => scoreNbaRollingPaceTotal(head, 2024, "2024-09-01T00:00:00Z", {}, {}));
assert.throws(() => scoreNbaRollingPaceTotal(head, 2026, "2026-11-01T00:00:00Z", {}, {}));
assert.throws(() => validateNbaRollingPaceHead({ ...head, alpha: 1 }));
for (const mutate of [
  (h: NbaRollingPaceHead) => { h.models[0].legacy.margin = [NaN]; },
  (h: NbaRollingPaceHead) => { h.models[0].candidateTotal.design.designStandardDeviations[0] = 0; },
  (h: NbaRollingPaceHead) => { h.models[0].trainingEnd = h.models[0].firstEvaluation; },
  (h: NbaRollingPaceHead) => { h.models[0].candidateTotal.design.features[0] = "pace_0"; },
]) {
  const changed = structuredClone(head); mutate(changed);
  const { hash: _hash, ...changedCore } = changed; void _hash;
  changed.hash = nbaPlayerStateHash(changedCore);
  assert.throws(() => validateNbaRollingPaceHead(changed));
}
assert.equal(nbaPlayerStateHash(head), before);
console.log("PASS rolling origin admission, exact copied Margin, independent Total units, poisoned target exclusion, immutable heads and dimension guards");
