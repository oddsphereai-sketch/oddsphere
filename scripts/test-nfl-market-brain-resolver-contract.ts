import assert from "node:assert/strict";
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
  nflMarketBrainJointLogBasis,
  persistNflMarketBrainResolverArtifact,
  readNflMarketBrainResolverArtifact,
  resolverOutputAsResearchPrediction,
  type NflMarketBrainSerializedWeights,
} from "../lib/services/marketBrain/nflMarketBrainResolverContract";
import { marketBrainCanonicalJson, marketBrainSha256 } from "../lib/services/marketBrain/marketBrainCanonical";
import { NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE, fixtureMarketBrainPriorInputLineage } from
  "./fixtures/marketBrainPriorInputLineage";
import {
  NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE,
  readNflMarketBrainResearchInput,
} from "../lib/services/marketBrain/nflMarketBrainResearchInput";
import {
  buildNflMarketBrainResearchManifest,
  persistNflMarketBrainResearchPrediction,
  persistNflMarketBrainResearchManifest,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";
import {
  buildNflMarketBrainResolverFeatures,
  type NflMarketBrainResolverFeatures,
} from "../lib/services/marketBrain/nflMarketBrainResolverFeatures";
import { materializeNflMarketBrainSequence, type NflMarketBrainSequence } from
  "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";
import { trainNflMarketBrainRegularizedJointResidual } from
  "../lib/services/marketBrain/nflMarketBrainDeterministicTrainer";

const cutoffAt = "2026-10-20T16:00:00.000Z";
const startsAt = "2026-10-20T20:00:00.000Z";

async function main() {
const prior = bindMarketBrainMarginTotalPrior({
  eventId: "resolver-fixture",
  release: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
  availableAt: cutoffAt,
  inputLineage: fixtureMarketBrainPriorInputLineage({
    eventId: "resolver-fixture", asOf: cutoffAt,
  }),
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
  const developmentEvents = developmentEventsFixture();
  const manifest = buildNflMarketBrainResearchManifest({
    candidateRelease,
    createdAt: "2026-09-12T01:00:00.000Z",
    storageId: `fixture-${candidateRelease}`,
    purgeGapHours: 24,
    partitions: [
      { role: "development", evidenceStatus: "opened_development_only", events: developmentEvents },
      { role: "selection", evidenceStatus: "untouched", events: [{
        eventId: "resolver-fixture", foldId: "selection-week", startsAt,
        cutoffAt,
        captureWindowOpensAt: "2026-10-20T12:00:00.000Z", captureWindowClosesAt: cutoffAt,
        expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000101", stage: "t60", plannedAt: cutoffAt }], outcomeOpenedAt: null,
      }] },
      { role: "confirmation", evidenceStatus: "untouched", events: [{
        eventId: "confirmation-fixture", foldId: "confirmation-week", startsAt: "2026-10-27T20:00:00.000Z",
        cutoffAt: "2026-10-27T16:00:00.000Z",
        captureWindowOpensAt: "2026-10-27T12:00:00.000Z", captureWindowClosesAt: "2026-10-27T16:00:00.000Z",
        expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000102", stage: "t60", plannedAt: "2026-10-27T16:00:00.000Z" }], outcomeOpenedAt: null,
      }] },
      { role: "prospective_shadow", evidenceStatus: "prospective", events: [{
        eventId: "prospective-fixture", foldId: "prospective-week", startsAt: "2026-11-03T20:00:00.000Z",
        cutoffAt: "2026-11-03T16:00:00.000Z",
        captureWindowOpensAt: "2026-11-03T12:00:00.000Z", captureWindowClosesAt: "2026-11-03T16:00:00.000Z",
        expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000103", stage: "t60", plannedAt: "2026-11-03T16:00:00.000Z" }], outcomeOpenedAt: null,
      }] },
    ],
  });
  return persistNflMarketBrainResearchManifest({
    manifest,
    client: manifestPersistenceClient(manifest) as never,
  });
}
const trainingManifest = await trainingManifestFor("nfl-market-brain-resolver-fixture-r1");
const researchInput = await fixtureResearchInput(sequence, features, trainingManifest.checksum);
const trainingResult = trainNflMarketBrainRegularizedJointResidual({
  manifest: trainingManifest,
  examples: developmentExamples(),
});
const fixtureWeights = trainingResult.weights;
const unpersistedArtifact = bindNflMarketBrainResolverArtifact({
  release: "nfl-market-brain-resolver-fixture-r1",
  family: "regularized_joint_residual",
  featureAblation: "complete_joint_candidate",
  hyperparameters: { l2: fixtureWeights.selectedL2 },
  trainingManifest,
  trainingResult,
  createdAt: "2026-09-12T02:15:00.000Z",
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
  researchInput,
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
  ["frozen_source_direction_state_vector", "five_head_joint_exponential_tilt"],
  "the frozen artifact contract must describe the executable contextual joint vector exactly");
assert.equal(shadow.mode, "shadow_only");
assert.equal(shadow.invariants.productionInfluenceAllowed, false);
assert.equal(shadow.invariants.independentPriorPreserved, true);
assert.ok(Math.abs(shadow.posterior.awayWinProbability + shadow.posterior.tieProbability +
  shadow.posterior.homeWinProbability - 1) < 1e-9);
assert.ok(shadow.posterior.states.length > 1_000,
  "the artifact-driven resolver must emit the complete feasible score-state posterior");
assert.ok(shadow.uncertainty.posteriorEntropyNats > 0);
assert.ok(nflMarketBrainJointLogBasis(sequence).some((state) => state.total === 113 && state.margin === 73),
  "the frozen score support must include historically observed legal NFL extremes");
assert.equal(shadow.checksum.length, 64);
assert.equal(shadow.trainingManifestChecksum.length, 64);
assert.equal(shadow.weightsSha256.length, 64);

assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "nfl-market-brain-resolver-fixture-r1",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: fixtureWeights.selectedL2 },
    trainingManifest: structuredClone(trainingManifest) as typeof trainingManifest,
    trainingResult,
    createdAt: "2026-09-12T02:15:00.000Z",
  }),
  /append-only persistence attestation/,
  "an artifact cannot bind a copied or caller-forged manifest without the runtime database attestation",
);
assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "nfl-market-brain-resolver-fixture-r1",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: fixtureWeights.selectedL2 },
    trainingManifest,
    trainingResult: structuredClone(trainingResult),
    createdAt: "2026-09-12T02:15:00.000Z",
  }),
  /deterministic trainer attestation/,
  "caller-constructed coefficients cannot be labeled as learned training output",
);

const research = resolverOutputAsResearchPrediction(shadow);
assert.equal(research.resolverOutputChecksum, shadow.checksum);
assert.equal(research.sequenceChecksum, sequence.checksum);
assert.deepEqual(research.marginDistribution, shadow.posterior.marginDistribution);
assert.deepEqual(research.totalDistribution, shadow.posterior.totalDistribution);
assert.ok(Math.abs(shadow.zeroMarketPosterior.awayWinProbability + shadow.zeroMarketPosterior.tieProbability +
  shadow.zeroMarketPosterior.homeWinProbability - 1) < 1e-9);
const persistedPrediction = await persistNflMarketBrainResearchPrediction({
  client: predictionPersistenceClient() as never,
  resolverOutput: shadow,
});
assert.equal(persistedPrediction.resolverOutputChecksum, shadow.checksum);
await assert.rejects(
  () => persistNflMarketBrainResearchPrediction({
    client: predictionPersistenceClient() as never,
    resolverOutput: structuredClone(shadow),
  }),
  /verified resolver output/,
  "a caller-authored or copied posterior cannot enter the prediction ledger",
);

const replay = buildNflMarketBrainResolverShadowOutput({ researchInput, artifact,
  weights: fixtureWeights, inferredAt: cutoffAt });
assert.equal(replay.checksum, shadow.checksum,
  "the persisted weights and fixed vectorizer must exactly reproduce the posterior");
assert.throws(() => buildNflMarketBrainResolverShadowOutput({ researchInput, artifact,
  weights: { ...fixtureWeights, coefficients: fixtureWeights.coefficients.map((value, index) =>
    index === 0 ? value + 0.01 : value) }, inferredAt: cutoffAt }), /do not match the bound artifact bytes/,
"caller-supplied score states or unbound coefficients must not influence inference");
assert.throws(() => buildNflMarketBrainResolverShadowOutput({ researchInput,
  artifact: structuredClone(artifact) as typeof artifact, weights: fixtureWeights, inferredAt: cutoffAt }),
/append-only artifact persistence attestation/,
"a structural copy must lose the private database-backed artifact attestation");
assert.throws(
  () => buildNflMarketBrainResolverShadowOutput({
    researchInput,
    artifact,
    weights: fixtureWeights,
    inferredAt: startsAt,
  }),
  /before kickoff/,
  "a hindsight inference at kickoff must fail closed",
);
assert.throws(
  () => bindNflMarketBrainResolverArtifact({
    release: "nfl-market-brain-resolver-fixture-r1",
    family: "regularized_joint_residual",
    featureAblation: "complete_joint_candidate",
    hyperparameters: { l2: 0.777 },
    trainingManifest,
    trainingResult,
    createdAt: "2026-09-12T02:15:00.000Z",
  }),
  /weights do not bind|not in the frozen tournament/,
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

function developmentEventsFixture() {
  return Array.from({ length: 4 }, (_, index) => ({
    eventId: `development-${index + 1}`,
    foldId: index < 2 ? "development-week-a" : "development-week-b",
    startsAt: index < 2 ? "2026-09-03T20:00:00.000Z" : "2026-09-10T20:00:00.000Z",
    cutoffAt: index < 2 ? "2026-09-02T16:00:00.000Z" : "2026-09-09T16:00:00.000Z",
    captureWindowOpensAt: index < 2 ? "2026-09-02T16:00:00.000Z" : "2026-09-09T16:00:00.000Z",
    captureWindowClosesAt: index < 2 ? "2026-09-02T16:00:00.000Z" : "2026-09-09T16:00:00.000Z",
    expectedCaptureAttempts: [{ runId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      stage: "t60" as const, plannedAt: index < 2 ? "2026-09-02T16:00:00.000Z" : "2026-09-09T16:00:00.000Z" }],
    outcomeOpenedAt: index < 2 ? "2026-09-04T00:00:00.000Z" : "2026-09-11T00:00:00.000Z",
  }));
}

function developmentExamples() {
  return developmentEventsFixture().map((event, index) => {
    const developmentPrior = bindMarketBrainMarginTotalPrior({
      eventId: event.eventId,
      release: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
      availableAt: event.cutoffAt,
      inputLineage: fixtureMarketBrainPriorInputLineage({
        eventId: event.eventId, asOf: event.cutoffAt,
      }),
      marginDistribution: { values: [-3, 3], probabilities: [0.5, 0.5] },
      totalDistribution: { values: [41, 45], probabilities: [0.5, 0.5] },
    });
    const developmentCase = buildMarketBrainCase({
      sport: "nfl",
      eventId: event.eventId,
      evaluatedAt: event.cutoffAt,
      captureBoundary: "raw_provider_response",
      captureLimitations: [],
      subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt: event.startsAt },
      prior: developmentPrior,
      evaluatedTargets: {},
      observations: [],
      sourceManifests: [],
      expectedInputs: [],
      blindSpots: [],
    });
    const developmentSequence = materializeNflMarketBrainSequence({
      cases: [developmentCase], cutoffAt: event.cutoffAt,
    });
    return {
      sequence: developmentSequence,
      features: buildNflMarketBrainResolverFeatures(developmentSequence),
      outcome: index % 2 === 0
        ? { eventId: event.eventId, awayScore: 22, homeScore: 19, labelAvailableAt: event.outcomeOpenedAt }
        : { eventId: event.eventId, awayScore: 21, homeScore: 24, labelAvailableAt: event.outcomeOpenedAt },
    };
  });
}

function manifestPersistenceClient(manifest: ReturnType<typeof buildNflMarketBrainResearchManifest>) {
  const { checksum: _checksum, ...payload } = manifest;
  return {
    from() { return { insert() { return { select() { return { single: async () => ({ data: {
      id: manifest.storageId,
      manifest_checksum: manifest.checksum,
      manifest,
      manifest_payload: marketBrainCanonicalJson(payload),
      created_at: "2026-09-12T02:00:00.000Z",
    }, error: null }) }; } }; } }; },
  };
}

async function fixtureResearchInput(
  sequence: NflMarketBrainSequence,
  features: NflMarketBrainResolverFeatures,
  manifestChecksum: string,
) {
  const payload = {
    release: NFL_MARKET_BRAIN_RESEARCH_INPUT_RELEASE,
    eventId: sequence.eventId,
    cutoffAt: sequence.cutoffAt,
    startsAt: sequence.startsAt,
    captureSetRecordId: "00000000-0000-4000-8000-000000000201",
    captureSetChecksum: "9".repeat(64),
    manifestChecksum,
    sequence,
    features,
    sequenceChecksum: sequence.checksum,
    featureChecksum: features.checksum,
  };
  const researchInput = { ...payload, checksum: marketBrainSha256(payload) };
  return readNflMarketBrainResearchInput({
    checksum: researchInput.checksum,
    client: { from() { return { select() { return { eq() { return this; }, single: async () => ({ data: {
      id: researchInput.captureSetRecordId,
      research_input_checksum: researchInput.checksum,
      research_input: reorderObjectKeys(researchInput),
      research_input_payload: marketBrainCanonicalJson(payload),
      created_at: cutoffAt,
    }, error: null }) }; } }; } } as never,
  });
}

function resolverArtifactPersistenceClient(
  artifact: ReturnType<typeof bindNflMarketBrainResolverArtifact>,
  weights: NflMarketBrainSerializedWeights,
) {
  const row = {
    artifact_sha256: artifact.sha256,
    weights_sha256: artifact.weightsSha256,
    artifact: reorderObjectKeys(artifact),
    weights: reorderObjectKeys(weights),
    created_at: "2026-09-12T02:30:00.000Z",
  };
  return {
    from() { return {
      insert() { return { select() { return { single: async () => ({ data: row, error: null }) }; } }; },
      select() { return { eq() { return this; }, single: async () => ({ data: row, error: null }) }; },
    }; },
  };
}

function predictionPersistenceClient() {
  return {
    from() { return {
      insert(row: Record<string, unknown>) { return { select() { return { single: async () => ({ data: {
        id: "00000000-0000-4000-8000-000000000501",
        prediction_sha256: row.prediction_sha256,
        prediction: row.prediction,
        prediction_payload: row.prediction_payload,
        created_at: "2026-10-20T16:01:00.000Z",
      }, error: null }) }; } }; },
    }; },
  };
}

function reorderObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderObjectKeys) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse()
      .map(([key, child]) => [key, reorderObjectKeys(child)])) as T;
  }
  return value;
}

void main();
