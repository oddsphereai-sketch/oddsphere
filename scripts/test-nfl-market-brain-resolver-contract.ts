import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  bindMarketBrainMarginTotalPrior,
  buildMarketBrainCase,
} from "../lib/services/marketBrain/marketBrainContract";
import {
  NFL_MARKET_BRAIN_FROZEN_TOURNAMENT,
  bindNflMarketBrainResolverArtifact,
  buildNflMarketBrainResolverShadowOutput,
  resolverOutputAsResearchPrediction,
} from "../lib/services/marketBrain/nflMarketBrainResolverContract";
import { buildNflMarketBrainResolverFeatures } from "../lib/services/marketBrain/nflMarketBrainResolverFeatures";
import { materializeNflMarketBrainSequence } from "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";

const cutoffAt = "2026-10-20T16:00:00.000Z";
const startsAt = "2026-10-20T20:00:00.000Z";
const prior = bindMarketBrainMarginTotalPrior({
  eventId: "resolver-fixture",
  release: "independent-prior-fixture-r1",
  availableAt: cutoffAt,
  marginDistribution: { values: [-3, 3], probabilities: [0.55, 0.45] },
  totalDistribution: { values: [40, 44], probabilities: [0.4, 0.6] },
});
const marketCase = buildMarketBrainCase({
  sport: "nfl",
  eventId: "resolver-fixture",
  evaluatedAt: cutoffAt,
  captureBoundary: "raw_provider_response",
  captureLimitations: [],
  subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt },
  prior,
  evaluatedTargets: {},
  observations: [],
  sourceManifests: [],
  expectedInputs: [],
  blindSpots: [],
});
const sequence = materializeNflMarketBrainSequence({ cases: [marketCase], cutoffAt });
const features = buildNflMarketBrainResolverFeatures(sequence);
const artifact = bindNflMarketBrainResolverArtifact({
  release: "nfl-market-brain-resolver-fixture-r1",
  family: "regularized_joint_residual",
  featureAblation: "complete_joint_candidate",
  hyperparameters: { l2: 1, timeDecayHalfLifeDays: 90, maximumInteractions: 4 },
  trainedThrough: "2026-10-19T23:59:59.000Z",
  trainingManifestChecksum: "a".repeat(64),
  weightsSha256: "b".repeat(64),
  createdAt: "2026-10-20T00:30:00.000Z",
});
const actions = {
  confirm: 0.18,
  recenter: 0.42,
  flip: 0.20,
  fade_market: 0.04,
  retain: 0.08,
  stand_down: 0.08,
};
const shadow = buildNflMarketBrainResolverShadowOutput({
  sequence,
  features,
  artifact,
  inferredAt: cutoffAt,
  actionProbabilities: actions,
  jointScoreStates: [
    { margin: -3, total: 41, probability: 0.30 },
    { margin: 0, total: 42, probability: 0.10 },
    { margin: 3, total: 43, probability: 0.60 },
  ],
});

assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.families.length, 3);
assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.splitMethod, "rolling_origin_purged_no_random_split");
assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.selectionObjective.economicMetricsAreSecondary, true);
assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.invariants.signalCountRulesAllowed, false);
assert.equal(shadow.mode, "shadow_only");
assert.equal(shadow.invariants.productionInfluenceAllowed, false);
assert.equal(shadow.invariants.independentPriorPreserved, true);
assert.equal(shadow.posterior.awayWinProbability, 0.30);
assert.equal(shadow.posterior.tieProbability, 0.10);
assert.equal(shadow.posterior.homeWinProbability, 0.60);
assert.ok(Math.abs(shadow.posterior.marginMean - 0.9) < 1e-9);
assert.ok(Math.abs(shadow.posterior.totalMean - 42.3) < 1e-9);
assert.ok(Math.abs(shadow.posterior.awayScoreMean - 20.7) < 1e-9);
assert.ok(Math.abs(shadow.posterior.homeScoreMean - 21.6) < 1e-9);
assert.ok(shadow.uncertainty.actionEntropy > 0 && shadow.uncertainty.actionEntropy < 1);
assert.equal(shadow.checksum.length, 64);

const research = resolverOutputAsResearchPrediction(shadow);
assert.equal(research.sequenceChecksum, sequence.checksum);
assert.deepEqual(research.marginDistribution, shadow.posterior.marginDistribution);
assert.deepEqual(research.totalDistribution, shadow.posterior.totalDistribution);

assert.throws(
  () => buildNflMarketBrainResolverShadowOutput({
    sequence,
    features,
    artifact,
    inferredAt: cutoffAt,
    actionProbabilities: { ...actions, recenter: 0.50 },
    jointScoreStates: [{ margin: 3, total: 43, probability: 1 }],
  }),
  /action distribution probability mass/,
);
assert.throws(
  () => buildNflMarketBrainResolverShadowOutput({
    sequence,
    features,
    artifact,
    inferredAt: cutoffAt,
    actionProbabilities: actions,
    jointScoreStates: [{ margin: 2, total: 41, probability: 1 }],
  }),
  /impossible NFL score state/,
  "the resolver may not emit mutually inconsistent Margin/Total states or fractional team scores",
);
assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "unfrozen-hyperparameters",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: 0.777, timeDecayHalfLifeDays: 90, maximumInteractions: 4 },
    trainedThrough: "2026-10-19T23:59:59.000Z",
    trainingManifestChecksum: "a".repeat(64),
    weightsSha256: "b".repeat(64),
    createdAt: "2026-10-20T00:30:00.000Z",
  }),
  /not in the frozen tournament/,
);

const source = readFileSync("lib/services/marketBrain/nflMarketBrainResolverContract.ts", "utf8");
assert.doesNotMatch(source, /minimumSignals|signalCount\s*[><=]|threeOfFour|pointsTable/i,
  "the resolver contract must not encode an inference quota or points table");

console.log("NFL Market Brain resolver contract: frozen low-capacity tournament, probabilistic actions, coherent NFL score posterior, provenance, and shadow-only authority passed");
