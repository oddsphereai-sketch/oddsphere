import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  assertMarketBrainEvaluatedTarget,
  bindMarketBrainMarginTotalPrior,
  buildMarketBrainCase,
} from "../lib/services/marketBrain/marketBrainContract";
import {
  NFL_MARKET_BRAIN_FROZEN_TOURNAMENT,
  bindNflMarketBrainResolverArtifact,
  buildNflMarketBrainResolverShadowOutput,
  persistNflMarketBrainResolverArtifact,
  readNflMarketBrainResolverArtifact,
  resolverOutputAsResearchPrediction,
  type NflMarketBrainSerializedWeights,
} from "../lib/services/marketBrain/nflMarketBrainResolverContract";
import {
  buildNflMarketBrainResearchManifest,
  persistNflMarketBrainResearchManifest,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";
import {
  NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES,
  buildNflMarketBrainResolverFeatures,
} from "../lib/services/marketBrain/nflMarketBrainResolverFeatures";
import { materializeNflMarketBrainSequence } from "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";

const cutoffAt = "2026-10-20T16:00:00.000Z";
const startsAt = "2026-10-20T20:00:00.000Z";

async function main() {
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
assert.throws(() => assertMarketBrainEvaluatedTarget("spread", {
  identity: "future", family: "book", selection: "home", line: -3, price: -110,
  observedAt: "2026-10-20T16:00:01.000Z",
}, cutoffAt), /Invalid Market Brain evaluated target/);
assert.throws(() => assertMarketBrainEvaluatedTarget("moneyline", {
  identity: "line", family: "book", selection: "home", line: 0, price: -110, observedAt: cutoffAt,
}, cutoffAt), /Invalid Market Brain evaluated target/);
assert.throws(() => assertMarketBrainEvaluatedTarget("total", {
  identity: "selection", family: "book", selection: "home", line: 44.5, price: -110, observedAt: cutoffAt,
}, cutoffAt), /Invalid Market Brain evaluated target/);
const sequence = materializeNflMarketBrainSequence({ cases: [marketCase], cutoffAt });
const features = buildNflMarketBrainResolverFeatures(sequence);
async function trainingManifestFor(candidateRelease: string) {
  const developmentEvents = Array.from({ length: 800 }, (_, index) => ({
    eventId: `development-${index + 1}`,
    foldId: index < 200 ? "development-week-a" : "development-week-b",
    startsAt: "2026-08-20T20:00:00.000Z",
    cutoffAt: "2026-08-19T16:00:00.000Z",
    firstCaptureAt: "2026-08-19T12:00:00.000Z",
    lastCaptureAt: "2026-08-19T16:00:00.000Z",
    outcomeOpenedAt: "2026-08-21T00:00:00.000Z",
  }));
  const manifest = buildNflMarketBrainResearchManifest({
    candidateRelease,
    createdAt: "2026-08-21T01:00:00.000Z",
    storageId: `fixture-${candidateRelease}`,
    purgeGapHours: 24,
    partitions: [
      { role: "development", evidenceStatus: "opened_development_only", events: developmentEvents },
      { role: "selection", evidenceStatus: "untouched", events: [{
        eventId: "resolver-fixture", foldId: "selection-week", startsAt,
        cutoffAt,
        firstCaptureAt: "2026-10-20T12:00:00.000Z", lastCaptureAt: cutoffAt, outcomeOpenedAt: null,
      }] },
      { role: "confirmation", evidenceStatus: "untouched", events: [{
        eventId: "confirmation-fixture", foldId: "confirmation-week", startsAt: "2026-10-27T20:00:00.000Z",
        cutoffAt: "2026-10-27T16:00:00.000Z",
        firstCaptureAt: "2026-10-27T12:00:00.000Z", lastCaptureAt: "2026-10-27T16:00:00.000Z", outcomeOpenedAt: null,
      }] },
      { role: "prospective_shadow", evidenceStatus: "prospective", events: [{
        eventId: "prospective-fixture", foldId: "prospective-week", startsAt: "2026-11-03T20:00:00.000Z",
        cutoffAt: "2026-11-03T16:00:00.000Z",
        firstCaptureAt: "2026-11-03T12:00:00.000Z", lastCaptureAt: "2026-11-03T16:00:00.000Z", outcomeOpenedAt: null,
      }] },
    ],
  });
  return persistNflMarketBrainResearchManifest({
    manifest,
    client: manifestPersistenceClient(manifest) as never,
  });
}
const trainingManifest = await trainingManifestFor("nfl-market-brain-resolver-fixture-r1");
const fixtureWeights = {
  schema: "nfl_market_brain_serialized_weights_v1" as const,
  trainerRelease: NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease,
  family: "regularized_joint_residual" as const,
  orderedFeatureNames: [...NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES],
  coefficients: Array.from({ length: NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length * 2 }, () => 0),
  preprocessing: NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.map((feature) => ({
    feature, mean: 0, standardDeviation: 1,
  })),
  calibrationParameters: [],
  featureSchemaSha256: createHash("sha256")
    .update(JSON.stringify(NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES)).digest("hex"),
  trainingRowsSha256: "d".repeat(64),
  trainingManifestChecksum: trainingManifest.checksum,
  trainedThrough: "2026-08-21T00:00:00.000Z",
  finalLoss: 1,
  finalGradientInfinityNorm: 0,
  optimizerIterations: 12,
  converged: true,
};
const unpersistedArtifact = bindNflMarketBrainResolverArtifact({
  release: "nfl-market-brain-resolver-fixture-r1",
  family: "regularized_joint_residual",
  featureAblation: "complete_joint_candidate",
  hyperparameters: { l2: 1 },
  fittedParameterCount: NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length * 2,
  trainedThrough: "2026-08-21T00:00:00.000Z",
  trainingManifest,
  weights: fixtureWeights,
  createdAt: "2026-08-21T00:30:00.000Z",
});
const artifactClient = resolverArtifactPersistenceClient(unpersistedArtifact, fixtureWeights);
const persistedArtifact = await persistNflMarketBrainResolverArtifact({
  client: artifactClient as never, artifact: unpersistedArtifact, weights: fixtureWeights,
});
const artifact = persistedArtifact.artifact;
const reloadedArtifact = await readNflMarketBrainResolverArtifact({
  client: artifactClient as never, artifactSha256: artifact.sha256,
});
assert.equal(reloadedArtifact.artifact.sha256, artifact.sha256,
  "a process restart must recreate private artifact attestation only from exact stored bytes");
const shadow = buildNflMarketBrainResolverShadowOutput({
  sequence,
  features,
  artifact,
  weights: fixtureWeights,
  inferredAt: cutoffAt,
});

assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.families.length, 1);
assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.splitMethod, "rolling_origin_purged_no_random_split");
assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.selectionObjective.economicMetricsAreSecondary, true);
assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.invariants.signalCountRulesAllowed, false);
assert.equal(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.invariants.fixedSportsbookWeightsAllowed, false);
assert.deepEqual(NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.families[0].implementation.basis,
  ["frozen_96_feature_vector", "separate_margin_and_total_exponential_tilts"],
  "the frozen artifact contract must describe the executable 96-feature vector exactly");
assert.equal(shadow.mode, "shadow_only");
assert.equal(shadow.invariants.productionInfluenceAllowed, false);
assert.equal(shadow.invariants.independentPriorPreserved, true);
assert.ok(Math.abs(shadow.posterior.awayWinProbability + shadow.posterior.tieProbability +
  shadow.posterior.homeWinProbability - 1) < 1e-9);
assert.ok(shadow.posterior.states.length > 1_000,
  "the artifact-driven resolver must emit the complete feasible score-state posterior");
assert.ok(shadow.uncertainty.posteriorEntropyNats > 0);
assert.equal(shadow.checksum.length, 64);
assert.equal(shadow.trainingManifestChecksum.length, 64);
assert.equal(shadow.weightsSha256.length, 64);

assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "nfl-market-brain-resolver-fixture-r1",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: 1 },
    fittedParameterCount: NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length * 2,
    trainedThrough: "2026-08-21T00:00:00.000Z",
    trainingManifest: structuredClone(trainingManifest) as typeof trainingManifest,
    weights: fixtureWeights,
    createdAt: "2026-08-21T00:30:00.000Z",
  }),
  /append-only persistence attestation/,
  "an artifact cannot bind a copied or caller-forged manifest without the runtime database attestation",
);

const research = resolverOutputAsResearchPrediction(shadow);
assert.equal(research.sequenceChecksum, sequence.checksum);
assert.deepEqual(research.marginDistribution, shadow.posterior.marginDistribution);
assert.deepEqual(research.totalDistribution, shadow.posterior.totalDistribution);

const replay = buildNflMarketBrainResolverShadowOutput({ sequence, features, artifact,
  weights: fixtureWeights, inferredAt: cutoffAt });
assert.equal(replay.checksum, shadow.checksum,
  "the persisted weights and fixed vectorizer must exactly reproduce the posterior");
assert.throws(() => buildNflMarketBrainResolverShadowOutput({ sequence, features, artifact,
  weights: { ...fixtureWeights, coefficients: fixtureWeights.coefficients.map((value, index) =>
    index === 0 ? value + 0.01 : value) }, inferredAt: cutoffAt }), /do not match the bound artifact bytes/,
"caller-supplied score states or unbound coefficients must not influence inference");
assert.throws(() => buildNflMarketBrainResolverShadowOutput({ sequence, features,
  artifact: structuredClone(artifact) as typeof artifact, weights: fixtureWeights, inferredAt: cutoffAt }),
/append-only artifact persistence attestation/,
"a structural copy must lose the private database-backed artifact attestation");
assert.throws(
  () => buildNflMarketBrainResolverShadowOutput({
    sequence,
    features,
    artifact,
    weights: fixtureWeights,
    inferredAt: startsAt,
  }),
  /before kickoff/,
  "a hindsight inference at kickoff must fail closed",
);
const unfrozenManifest = await trainingManifestFor("unfrozen-hyperparameters");
assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "unfrozen-hyperparameters",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: 0.777 },
    fittedParameterCount: NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length * 2,
    trainedThrough: "2026-08-21T00:00:00.000Z",
    trainingManifest: unfrozenManifest,
    weights: { ...fixtureWeights, trainingManifestChecksum: unfrozenManifest.checksum },
    createdAt: "2026-08-21T00:30:00.000Z",
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

console.log("NFL Market Brain resolver contract: reproducible executable learned-model tournament, coherent NFL score posterior, manifest provenance, and shadow-only authority passed");

}

function manifestPersistenceClient(manifest: ReturnType<typeof buildNflMarketBrainResearchManifest>) {
  return {
    from() { return { insert() { return { select() { return { single: async () => ({ data: {
      id: manifest.storageId,
      manifest_checksum: manifest.checksum,
      manifest,
      created_at: "2026-08-21T02:00:00.000Z",
    }, error: null }) }; } }; } }; },
  };
}

function resolverArtifactPersistenceClient(
  artifact: ReturnType<typeof bindNflMarketBrainResolverArtifact>,
  weights: NflMarketBrainSerializedWeights,
) {
  const row = {
    artifact_sha256: artifact.sha256,
    weights_sha256: artifact.weightsSha256,
    artifact,
    weights,
    created_at: "2026-08-21T02:30:00.000Z",
  };
  return {
    from() { return {
      insert() { return { select() { return { single: async () => ({ data: row, error: null }) }; } }; },
      select() { return { eq() { return this; }, single: async () => ({ data: row, error: null }) }; },
    }; },
  };
}

void main();
