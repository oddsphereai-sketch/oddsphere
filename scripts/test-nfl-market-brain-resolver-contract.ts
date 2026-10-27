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
import {
  attestPersistedNflMarketBrainResearchManifest,
  buildNflMarketBrainResearchManifest,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";
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
function trainingManifestFor(candidateRelease: string) {
  const developmentEvents = Array.from({ length: 400 }, (_, index) => ({
    eventId: `development-${index + 1}`,
    foldId: index < 200 ? "development-week-a" : "development-week-b",
    startsAt: "2026-08-20T20:00:00.000Z",
    firstCaptureAt: "2026-08-19T12:00:00.000Z",
    lastCaptureAt: "2026-08-19T16:00:00.000Z",
    outcomeOpenedAt: "2026-08-21T00:00:00.000Z",
  }));
  const manifest = buildNflMarketBrainResearchManifest({
    candidateRelease,
    createdAt: "2026-08-21T01:00:00.000Z",
    persistedAt: "2026-08-21T02:00:00.000Z",
    storageId: `fixture-${candidateRelease}`,
    purgeGapHours: 24,
    partitions: [
      { role: "development", evidenceStatus: "opened_development_only", events: developmentEvents },
      { role: "selection", evidenceStatus: "untouched", events: [{
        eventId: "resolver-fixture", foldId: "selection-week", startsAt,
        firstCaptureAt: "2026-10-20T12:00:00.000Z", lastCaptureAt: cutoffAt, outcomeOpenedAt: null,
      }] },
      { role: "confirmation", evidenceStatus: "untouched", events: [{
        eventId: "confirmation-fixture", foldId: "confirmation-week", startsAt: "2026-10-27T20:00:00.000Z",
        firstCaptureAt: "2026-10-27T12:00:00.000Z", lastCaptureAt: "2026-10-27T16:00:00.000Z", outcomeOpenedAt: null,
      }] },
      { role: "prospective_shadow", evidenceStatus: "prospective", events: [{
        eventId: "prospective-fixture", foldId: "prospective-week", startsAt: "2026-11-03T20:00:00.000Z",
        firstCaptureAt: "2026-11-03T12:00:00.000Z", lastCaptureAt: "2026-11-03T16:00:00.000Z", outcomeOpenedAt: null,
      }] },
    ],
  });
  return attestPersistedNflMarketBrainResearchManifest({
    manifest,
    stored: { id: manifest.storageId, serverCreatedAt: manifest.persistedAt, manifestChecksum: manifest.checksum },
  });
}
const trainingManifest = trainingManifestFor("nfl-market-brain-resolver-fixture-r1");
const fixtureWeights = {
  schema: "nfl_market_brain_serialized_weights_v1" as const,
  trainerRelease: NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease,
  family: "regularized_joint_residual" as const,
  orderedFeatureNames: Array.from({ length: 18 }, (_, index) => `continuous_feature_${index + 1}`),
  coefficients: Array.from({ length: 18 }, (_, index) => index / 100),
  preprocessing: Array.from({ length: 18 }, (_, index) => ({
    feature: `continuous_feature_${index + 1}`, mean: 0, standardDeviation: 1,
  })),
  calibrationParameters: [1, 1],
  optimizerIterations: 12,
  converged: true,
};
const artifact = bindNflMarketBrainResolverArtifact({
  release: "nfl-market-brain-resolver-fixture-r1",
  family: "regularized_joint_residual",
  featureAblation: "complete_joint_candidate",
  hyperparameters: { l2: 1, timeDecayHalfLifeDays: 90, maximumInteractions: 4 },
  fittedParameterCount: 20,
  trainedThrough: "2026-10-19T23:59:59.000Z",
  trainingManifest,
  weights: fixtureWeights,
  createdAt: "2026-10-20T00:30:00.000Z",
});
const shadow = buildNflMarketBrainResolverShadowOutput({
  sequence,
  features,
  artifact,
  inferredAt: cutoffAt,
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
assert.equal(shadow.posteriorRelationship.winnerBoundaryCrossed, true);
assert.ok(shadow.uncertainty.posteriorEntropyNats > 0);
assert.equal(shadow.checksum.length, 64);
assert.equal(shadow.trainingManifestChecksum.length, 64);
assert.equal(shadow.weightsSha256.length, 64);

assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "nfl-market-brain-resolver-fixture-r1",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: 1, timeDecayHalfLifeDays: 90, maximumInteractions: 4 },
    fittedParameterCount: 20,
    trainedThrough: "2026-10-19T23:59:59.000Z",
    trainingManifest: structuredClone(trainingManifest) as typeof trainingManifest,
    weights: fixtureWeights,
    createdAt: "2026-10-20T00:30:00.000Z",
  }),
  /append-only persistence attestation/,
  "an artifact cannot bind a copied or caller-forged manifest without the runtime database attestation",
);

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
    jointScoreStates: [{ margin: 2, total: 41, probability: 1 }],
  }),
  /impossible NFL score state/,
  "the resolver may not emit mutually inconsistent Margin/Total states or fractional team scores",
);
assert.throws(
  () => buildNflMarketBrainResolverShadowOutput({
    sequence,
    features,
    artifact,
    inferredAt: startsAt,
    jointScoreStates: [{ margin: 3, total: 43, probability: 1 }],
  }),
  /before kickoff/,
  "a hindsight inference at kickoff must fail closed",
);
assert.throws(
  () => buildNflMarketBrainResolverShadowOutput({
    sequence,
    features,
    artifact,
    inferredAt: cutoffAt,
    jointScoreStates: [{ margin: 1, total: 1, probability: 1 }],
  }),
  /impossible NFL score state/,
  "a 1-0 final is not a feasible NFL score state",
);
assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "unfrozen-hyperparameters",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: 0.777, timeDecayHalfLifeDays: 90, maximumInteractions: 4 },
    fittedParameterCount: 20,
    trainedThrough: "2026-10-19T23:59:59.000Z",
    trainingManifest: trainingManifestFor("unfrozen-hyperparameters"),
    weights: fixtureWeights,
    createdAt: "2026-10-20T00:30:00.000Z",
  }),
  /not in the frozen tournament/,
);
assert.throws(
  () => (NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.families[0].hyperparameterGrid.l2 as number[]).push(0.777),
  /read only|extensible|frozen|object is not extensible/i,
  "the predeclared tournament must be recursively immutable",
);

const source = readFileSync("lib/services/marketBrain/nflMarketBrainResolverContract.ts", "utf8");
assert.doesNotMatch(source, /minimumSignals|signalCount\s*[><=]|threeOfFour|pointsTable/i,
  "the resolver contract must not encode an inference quota or points table");

console.log("NFL Market Brain resolver contract: reproducible low-capacity tournament, coherent NFL score posterior, manifest provenance, and shadow-only authority passed");
