import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MarketBrainDiscreteDistribution } from "./marketBrainContract";
import {
  MARKET_BRAIN_ACTIONS,
  type MarketBrainAction,
  type MarketBrainActionDistribution,
  type NflMarketBrainBehaviorScenario,
} from "./nflMarketBrainBehaviorScenarios";
import {
  assertNflMarketBrainAttestedResearchManifest,
  type NflMarketBrainAttestedResearchManifest,
  type NflMarketBrainResearchPrediction,
} from "./nflMarketBrainResearchEvaluator";
import {
  NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES,
  NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE,
  buildNflMarketBrainResolverFeatures,
  nflMarketBrainTrainerInput,
  type NflMarketBrainResolverFeatures,
  vectorizeNflMarketBrainTrainerInput,
} from "./nflMarketBrainResolverFeatures";
import {
  NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  assertNflMarketBrainSequence,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE =
  "nfl_market_brain_resolver_contract_2026_10_27_r7_interpretive_artifact_binding" as const;
export const NFL_MARKET_BRAIN_TOURNAMENT_RELEASE =
  "nfl_market_brain_tournament_2026_10_27_r7_interpretive_artifact_binding" as const;

export type NflMarketBrainResolverFamily = "regularized_joint_residual";

type HyperparameterValue = string | number | boolean;
type ResolverFamilySpec = {
  family: NflMarketBrainResolverFamily;
  purpose: string;
  hyperparameterGrid: Record<string, readonly HyperparameterValue[]>;
  maximumFittedParameters: number;
  implementation: {
    basis: readonly string[];
    preprocessing: string;
    loss: string;
    calibration: string;
    coherence: string;
  };
};

const tournamentWithoutChecksum = {
  release: NFL_MARKET_BRAIN_TOURNAMENT_RELEASE,
  frozenAt: "2026-10-27T00:00:00.000Z",
  sequenceRelease: NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  featureRelease: NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE,
  splitMethod: "rolling_origin_purged_no_random_split" as const,
  selectionObjective: {
    primary: "comparable_margin_plus_total_marginal_log_score" as const,
    candidateOnlyDiagnostic: "joint_margin_total_distribution_log_score" as const,
    requiredNonRegression: ["winner_brier", "margin_mae", "total_mae", "board_balance"] as const,
    economicMetricsAreSecondary: true as const,
    openedDevelopmentEvidenceCanQualify: false as const,
  },
  featureAblations: ["complete_joint_candidate"] as const,
  deterministicRuntime: {
    trainerRelease: "nfl_market_brain_deterministic_trainer_2026_10_27_r2_executable" as const,
    trainerInputSchema: "nfl_market_brain_trainer_input_v1" as const,
    optimizer: "deterministic_full_batch_gradient_descent_backtracking" as const,
    convergence: { maximumIterations: 500, gradientInfinityNorm: 1e-8, relativeLossTolerance: 1e-10 },
    seed: 20261027,
    serialization: "canonical_sorted_json_float64_v1" as const,
    standardization: "development_partition_only_mean_sd" as const,
    categoricalPolicy: "frozen_vocabulary_no_identity_hashing" as const,
    jointSupport: { minimumTotal: 0, maximumTotal: 100, minimumMargin: -70, maximumMargin: 70,
      integerParityAndNflScoreFeasibilityRequired: true as const },
    priorSmoothingStandardDeviation: 1.5,
    marginTiltScale: 12,
    totalTiltScale: 14,
  },
  families: [
    {
      family: "regularized_joint_residual",
      purpose: "Learn a shrunken correction to the independent Margin/Total prior.",
      hyperparameterGrid: { l2: [0.1, 1, 10] },
      maximumFittedParameters: 256,
      implementation: {
        basis: ["frozen_96_feature_vector", "separate_margin_and_total_exponential_tilts"],
        preprocessing: "development_partition_only_standardization; no event/source identity features",
        loss: "development_margin_nll_plus_total_nll_plus_l2",
        calibration: "none; selection and confirmation outcomes never fit parameters",
        coherence: "one normalized feasible NFL score-state posterior derived from smoothed independent prior mass",
      },
    },
  ] satisfies ResolverFamilySpec[],
  invariants: {
    signalCountRulesAllowed: false as const,
    fixedSportsbookWeightsAllowed: false as const,
    automaticMarketFollowingAllowed: false as const,
    outcomeFeaturesAllowed: false as const,
    targetFamilyEvidenceAllowed: false as const,
    oneCoherentScoreStateRequired: true as const,
    productionInfluenceAllowed: false as const,
  },
};

export const NFL_MARKET_BRAIN_FROZEN_TOURNAMENT = deepFreeze({
  ...tournamentWithoutChecksum,
  checksum: sha256(tournamentWithoutChecksum),
});

export type NflMarketBrainResolverArtifact = {
  schema: "nfl_market_brain_resolver_artifact_v1";
  release: string;
  contractRelease: typeof NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE;
  tournamentRelease: typeof NFL_MARKET_BRAIN_TOURNAMENT_RELEASE;
  tournamentChecksum: string;
  sequenceRelease: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  featureRelease: typeof NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE;
  family: NflMarketBrainResolverFamily;
  featureAblation: typeof NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.featureAblations[number];
  hyperparameters: Record<string, HyperparameterValue>;
  fittedParameterCount: number;
  effectiveTrainingGames: number;
  trainingWeekClusters: number;
  deterministicSeed: number;
  trainerRelease: typeof NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease;
  trainedThrough: string;
  trainingManifestChecksum: string;
  trainingManifestByteLength: number;
  weightsSha256: string;
  weightsByteLength: number;
  featureSchemaSha256: string;
  trainingRowsSha256: string;
  createdAt: string;
  sha256: string;
};

const persistedArtifactBrand: unique symbol = Symbol("persistedNflMarketBrainResolverArtifact");
export type NflMarketBrainAttestedResolverArtifact = NflMarketBrainResolverArtifact & {
  readonly persistenceAttestation: {
    recordId: string;
    serverCreatedAt: string;
    artifactSha256: string;
    weightsSha256: string;
  };
  readonly [persistedArtifactBrand]: true;
};

export type NflMarketBrainSerializedWeights = {
  schema: "nfl_market_brain_serialized_weights_v1";
  trainerRelease: typeof NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease;
  family: NflMarketBrainResolverFamily;
  orderedFeatureNames: string[];
  coefficients: number[];
  preprocessing: Array<{ feature: string; mean: number; standardDeviation: number }>;
  calibrationParameters: number[];
  featureSchemaSha256: string;
  trainingRowsSha256: string;
  trainingManifestChecksum: string;
  trainedThrough: string;
  finalLoss: number;
  finalGradientInfinityNorm: number;
  optimizerIterations: number;
  converged: boolean;
};

export type NflMarketBrainJointScoreState = {
  margin: number;
  total: number;
  probability: number;
};

export type NflMarketBrainJointPosterior = {
  schema: "nfl_market_brain_joint_score_posterior_v1";
  states: NflMarketBrainJointScoreState[];
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
  marginMean: number;
  totalMean: number;
  awayWinProbability: number;
  homeWinProbability: number;
  tieProbability: number;
  awayScoreMean: number;
  homeScoreMean: number;
  sha256: string;
};

export type NflMarketBrainResolverShadowOutput = {
  release: string;
  contractRelease: typeof NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE;
  tournamentRelease: typeof NFL_MARKET_BRAIN_TOURNAMENT_RELEASE;
  tournamentChecksum: string;
  artifactSha256: string;
  trainingManifestChecksum: string;
  weightsSha256: string;
  fittedParameterCount: number;
  family: NflMarketBrainResolverFamily;
  eventId: string;
  sequenceRelease: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  sequenceChecksum: string;
  featureRelease: typeof NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE;
  featureChecksum: string;
  featureCutoffAt: string;
  trainedThrough: string;
  inferredAt: string;
  posteriorRelationship: {
    winnerBoundaryCrossed: boolean;
    priorMarginMean: number;
    posteriorMarginMean: number;
    marginShift: number;
    priorTotalMean: number;
    posteriorTotalMean: number;
    totalShift: number;
    marketDirections: NflMarketBrainSequence["crossMarket"]["marketDirection"];
  };
  posterior: NflMarketBrainJointPosterior;
  uncertainty: {
    posteriorEntropyNats: number;
    sourceAvailabilityRegime: NflMarketBrainSequence["sourceAvailability"]["regime"];
    eligibleObservations: number;
  };
  mode: "shadow_only";
  invariants: {
    independentPriorPreserved: true;
    actionsDoNotDirectlyAssignPointsOrGrades: true;
    posteriorDerivedFromOneFeasibleScoreState: true;
    lockedRecordMutationAllowed: false;
    productionInfluenceAllowed: false;
  };
  checksum: string;
};

export function bindNflMarketBrainResolverArtifact(args: {
  release: string;
  family: NflMarketBrainResolverFamily;
  featureAblation: NflMarketBrainResolverArtifact["featureAblation"];
  hyperparameters: Record<string, HyperparameterValue>;
  fittedParameterCount: number;
  trainedThrough: string;
  trainingManifest: NflMarketBrainAttestedResearchManifest;
  weights: NflMarketBrainSerializedWeights;
  createdAt: string;
}): NflMarketBrainResolverArtifact {
  assertNflMarketBrainAttestedResearchManifest(args.trainingManifest);
  if (args.trainingManifest.candidateRelease !== args.release) {
    throw new Error("NFL Market Brain artifact release diverges from its persisted research manifest.");
  }
  assertSerializedWeights(args.weights, args.family, args.fittedParameterCount);
  if (args.weights.trainingManifestChecksum !== args.trainingManifest.checksum ||
    canonicalTime(args.weights.trainedThrough, "weights.trainedThrough") !==
      canonicalTime(args.trainedThrough, "trainedThrough")) {
    throw new Error("NFL Market Brain weights do not bind the artifact training manifest and label horizon.");
  }
  const withoutHash = {
    schema: "nfl_market_brain_resolver_artifact_v1" as const,
    release: args.release,
    contractRelease: NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE,
    tournamentRelease: NFL_MARKET_BRAIN_TOURNAMENT_RELEASE,
    tournamentChecksum: NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.checksum,
    sequenceRelease: NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
    featureRelease: NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE,
    family: args.family,
    featureAblation: args.featureAblation,
    hyperparameters: { ...args.hyperparameters },
    fittedParameterCount: args.fittedParameterCount,
    effectiveTrainingGames: args.trainingManifest.partitions
      .filter((partition) => partition.role === "development")
      .reduce((sum, partition) => sum + partition.events.length, 0),
    trainingWeekClusters: new Set(args.trainingManifest.partitions
      .filter((partition) => partition.role === "development")
      .flatMap((partition) => partition.events.map((event) => event.foldId))).size,
    deterministicSeed: NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.seed,
    trainerRelease: NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease,
    trainedThrough: canonicalTime(args.trainedThrough, "trainedThrough"),
    trainingManifestChecksum: args.trainingManifest.checksum,
    trainingManifestByteLength: serializedByteLength(args.trainingManifest),
    weightsSha256: sha256(args.weights),
    weightsByteLength: serializedByteLength(args.weights),
    featureSchemaSha256: args.weights.featureSchemaSha256,
    trainingRowsSha256: args.weights.trainingRowsSha256,
    createdAt: canonicalTime(args.createdAt, "createdAt"),
  };
  const artifact = { ...withoutHash, sha256: sha256(withoutHash) };
  assertNflMarketBrainResolverArtifact(artifact);
  return artifact;
}

export function buildNflMarketBrainResolverShadowOutput(args: {
  sequence: NflMarketBrainSequence;
  features: NflMarketBrainResolverFeatures;
  artifact: NflMarketBrainAttestedResolverArtifact;
  weights: NflMarketBrainSerializedWeights;
  inferredAt: string;
}): NflMarketBrainResolverShadowOutput {
  assertNflMarketBrainAttestedResolverArtifact(args.artifact);
  assertNflMarketBrainSequence(args.sequence);
  assertSerializedWeights(args.weights, args.artifact.family, args.artifact.fittedParameterCount);
  if (sha256(args.weights) !== args.artifact.weightsSha256 ||
    serializedByteLength(args.weights) !== args.artifact.weightsByteLength) {
    throw new Error("NFL Market Brain resolver weights do not match the bound artifact bytes.");
  }
  if (args.sequence.release !== NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE) {
    throw new Error("NFL Market Brain resolver refuses a superseded sequence release.");
  }
  if (args.sequence.prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain resolver requires the exact independent Margin/Total prior.");
  }
  if (args.features.release !== NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE ||
    args.features.eventId !== args.sequence.eventId ||
    args.features.inputSequenceChecksum !== args.sequence.checksum ||
    args.features.inputSequenceRelease !== args.sequence.release) {
    throw new Error("NFL Market Brain resolver feature artifact does not bind the supplied sequence.");
  }
  if (JSON.stringify(buildNflMarketBrainResolverFeatures(args.sequence)) !== JSON.stringify(args.features)) {
    throw new Error("NFL Market Brain resolver features are not reproducible from the supplied sequence.");
  }
  const trainedThrough = timestamp(args.artifact.trainedThrough, "trainedThrough");
  const cutoff = timestamp(args.sequence.cutoffAt, "featureCutoffAt");
  const starts = timestamp(args.sequence.startsAt, "startsAt");
  if (cutoff >= starts || trainedThrough >= cutoff || trainedThrough >= starts ||
    timestamp(args.artifact.persistenceAttestation.serverCreatedAt, "artifactReceipt") >= cutoff) {
    throw new Error("NFL Market Brain resolver artifact training reaches the evaluated case.");
  }
  const inferredAt = canonicalTime(args.inferredAt, "inferredAt");
  const inferred = timestamp(inferredAt, "inferredAt");
  if (inferred < cutoff || inferred >= starts) {
    throw new Error("NFL Market Brain inference must occur after its feature cutoff and before kickoff.");
  }
  const posterior = inferJointPosterior(args.sequence, args.features, args.weights);
  const posteriorRelationship = {
    winnerBoundaryCrossed: Math.sign(args.sequence.prior.marginMean) !== 0 &&
      Math.sign(posterior.marginMean) !== 0 &&
      Math.sign(args.sequence.prior.marginMean) !== Math.sign(posterior.marginMean),
    priorMarginMean: args.sequence.prior.marginMean,
    posteriorMarginMean: posterior.marginMean,
    marginShift: posterior.marginMean - args.sequence.prior.marginMean,
    priorTotalMean: args.sequence.prior.totalMean,
    posteriorTotalMean: posterior.totalMean,
    totalShift: posterior.totalMean - args.sequence.prior.totalMean,
    marketDirections: structuredClone(args.sequence.crossMarket.marketDirection),
  };
  const withoutChecksum = {
    release: args.artifact.release,
    contractRelease: NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE,
    tournamentRelease: NFL_MARKET_BRAIN_TOURNAMENT_RELEASE,
    tournamentChecksum: NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.checksum,
    artifactSha256: args.artifact.sha256,
    trainingManifestChecksum: args.artifact.trainingManifestChecksum,
    weightsSha256: args.artifact.weightsSha256,
    fittedParameterCount: args.artifact.fittedParameterCount,
    family: args.artifact.family,
    eventId: args.sequence.eventId,
    sequenceRelease: args.sequence.release,
    sequenceChecksum: args.sequence.checksum,
    featureRelease: args.features.release,
    featureChecksum: args.features.checksum,
    featureCutoffAt: args.sequence.cutoffAt,
    trainedThrough: args.artifact.trainedThrough,
    inferredAt,
    posteriorRelationship,
    posterior,
    uncertainty: {
      posteriorEntropyNats: entropyNats(posterior.states.map((state) => state.probability)),
      sourceAvailabilityRegime: args.sequence.sourceAvailability.regime,
      eligibleObservations: args.sequence.accounting.eligibleObservations,
    },
    mode: "shadow_only" as const,
    invariants: {
      independentPriorPreserved: true as const,
      actionsDoNotDirectlyAssignPointsOrGrades: true as const,
      posteriorDerivedFromOneFeasibleScoreState: true as const,
      lockedRecordMutationAllowed: false as const,
      productionInfluenceAllowed: false as const,
    },
  };
  return { ...withoutChecksum, checksum: sha256(withoutChecksum) };
}

type PersistedResolverArtifactRow = {
  artifact_sha256: string;
  weights_sha256: string;
  artifact: unknown;
  weights: unknown;
  created_at: string;
};

export async function persistNflMarketBrainResolverArtifact(args: {
  client: SupabaseClient;
  artifact: NflMarketBrainResolverArtifact;
  weights: NflMarketBrainSerializedWeights;
  signal?: AbortSignal;
}): Promise<{ artifact: NflMarketBrainAttestedResolverArtifact; weights: NflMarketBrainSerializedWeights }> {
  assertNflMarketBrainResolverArtifact(args.artifact);
  assertSerializedWeights(args.weights, args.artifact.family, args.artifact.fittedParameterCount);
  if (sha256(args.weights) !== args.artifact.weightsSha256) {
    throw new Error("NFL Market Brain artifact persistence received different coefficient bytes.");
  }
  const { sha256: artifactSha256, ...artifactPayload } = args.artifact;
  let query = args.client.from("nfl_market_brain_resolver_artifacts").insert({
    artifact_sha256: artifactSha256,
    weights_sha256: args.artifact.weightsSha256,
    artifact_release: args.artifact.release,
    training_manifest_checksum: args.artifact.trainingManifestChecksum,
    artifact: args.artifact,
    weights: args.weights,
    artifact_payload: JSON.stringify(artifactPayload),
    weights_payload: JSON.stringify(args.weights),
  }).select("artifact_sha256,weights_sha256,artifact,weights,created_at");
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain resolver artifact persistence failed: ${error.message}`);
  return attestedResolverArtifactFromRow(data as PersistedResolverArtifactRow | null,
    { artifact: args.artifact, weights: args.weights });
}

export async function readNflMarketBrainResolverArtifact(args: {
  client: SupabaseClient;
  artifactSha256: string;
  signal?: AbortSignal;
}): Promise<{ artifact: NflMarketBrainAttestedResolverArtifact; weights: NflMarketBrainSerializedWeights }> {
  let query = args.client.from("nfl_market_brain_resolver_artifacts")
    .select("artifact_sha256,weights_sha256,artifact,weights,created_at")
    .eq("artifact_sha256", args.artifactSha256);
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain resolver artifact read failed: ${error.message}`);
  return attestedResolverArtifactFromRow(data as PersistedResolverArtifactRow | null);
}

export function assertNflMarketBrainAttestedResolverArtifact(
  artifact: NflMarketBrainResolverArtifact,
): asserts artifact is NflMarketBrainAttestedResolverArtifact {
  assertNflMarketBrainResolverArtifact(artifact);
  const attested = artifact as NflMarketBrainAttestedResolverArtifact;
  const receipt = attested.persistenceAttestation;
  if (!(persistedArtifactBrand in attested) || !receipt || receipt.recordId !== artifact.sha256 ||
    receipt.artifactSha256 !== artifact.sha256 || receipt.weightsSha256 !== artifact.weightsSha256 ||
    timestamp(receipt.serverCreatedAt, "artifactReceipt") < timestamp(artifact.createdAt, "artifact.createdAt")) {
    throw new Error("NFL Market Brain inference requires an append-only artifact persistence attestation.");
  }
}

function attestedResolverArtifactFromRow(
  row: PersistedResolverArtifactRow | null,
  expected?: { artifact: NflMarketBrainResolverArtifact; weights: NflMarketBrainSerializedWeights },
): { artifact: NflMarketBrainAttestedResolverArtifact; weights: NflMarketBrainSerializedWeights } {
  if (!row || typeof row.artifact !== "object" || row.artifact === null ||
    typeof row.weights !== "object" || row.weights === null) {
    throw new Error("NFL Market Brain resolver artifact persistence returned no verifiable row.");
  }
  const storedArtifact = row.artifact as NflMarketBrainResolverArtifact;
  const storedWeights = row.weights as NflMarketBrainSerializedWeights;
  assertNflMarketBrainResolverArtifact(storedArtifact);
  assertSerializedWeights(storedWeights, storedArtifact.family, storedArtifact.fittedParameterCount);
  if (row.artifact_sha256 !== storedArtifact.sha256 || row.weights_sha256 !== storedArtifact.weightsSha256 ||
    sha256(storedWeights) !== storedArtifact.weightsSha256 ||
    expected && (expected.artifact.sha256 !== storedArtifact.sha256 ||
      sha256(expected.weights) !== sha256(storedWeights))) {
    throw new Error("NFL Market Brain stored resolver artifact differs from its exact submitted bytes.");
  }
  const attested = {
    ...structuredClone(storedArtifact),
    persistenceAttestation: {
      recordId: row.artifact_sha256,
      serverCreatedAt: canonicalTime(row.created_at, "artifactReceipt"),
      artifactSha256: row.artifact_sha256,
      weightsSha256: row.weights_sha256,
    },
  } as NflMarketBrainAttestedResolverArtifact;
  Object.defineProperty(attested, persistedArtifactBrand, { value: true, enumerable: false });
  Object.freeze(attested);
  assertNflMarketBrainAttestedResolverArtifact(attested);
  return { artifact: attested, weights: structuredClone(storedWeights) };
}

export function resolverOutputAsResearchPrediction(
  output: NflMarketBrainResolverShadowOutput,
): NflMarketBrainResearchPrediction {
  return {
    release: output.release,
    trainedThrough: output.trainedThrough,
    inferredAt: output.inferredAt,
    artifactSha256: output.artifactSha256,
    trainingManifestChecksum: output.trainingManifestChecksum,
    weightsSha256: output.weightsSha256,
    fittedParameterCount: output.fittedParameterCount,
    tournamentChecksum: output.tournamentChecksum,
    family: output.family,
    featureRelease: output.featureRelease,
    featureChecksum: output.featureChecksum,
    sequenceChecksum: output.sequenceChecksum,
    awayWinProbability: output.posterior.awayWinProbability,
    homeWinProbability: output.posterior.homeWinProbability,
    tieProbability: output.posterior.tieProbability,
    marginMean: output.posterior.marginMean,
    totalMean: output.posterior.totalMean,
    marginDistribution: output.posterior.marginDistribution,
    totalDistribution: output.posterior.totalDistribution,
    jointScoreStates: output.posterior.states,
    jointPosteriorSha256: output.posterior.sha256,
  };
}

export function evaluateBehaviorScenarioDistribution(
  scenario: NflMarketBrainBehaviorScenario,
  predicted: MarketBrainActionDistribution,
) {
  const distribution = assertActionDistribution(predicted);
  const totalVariation = MARKET_BRAIN_ACTIONS.reduce((sum, action) =>
    sum + Math.abs(distribution[action] - scenario.expectedActionDistribution[action]), 0) / 2;
  const preferredProbability = distribution[scenario.preferredAction];
  const largestProbability = Math.max(...Object.values(distribution));
  const forbiddenMass = scenario.forbiddenActions.reduce((sum, action) => sum + distribution[action], 0);
  const expectedForbiddenMass = scenario.forbiddenActions.reduce((sum, action) =>
    sum + scenario.expectedActionDistribution[action], 0);
  return {
    totalVariation,
    preferredIsJointMaximum: Math.abs(preferredProbability - largestProbability) <= 1e-12,
    forbiddenMass,
    passed: totalVariation <= scenario.maximumTotalVariation &&
      Math.abs(preferredProbability - largestProbability) <= 1e-12 &&
      forbiddenMass <= Math.max(0.15, expectedForbiddenMass + 0.08),
  };
}

function assertNflMarketBrainResolverArtifact(artifact: NflMarketBrainResolverArtifact): void {
  const { checksum: frozenChecksum, ...frozenWithoutChecksum } = NFL_MARKET_BRAIN_FROZEN_TOURNAMENT;
  if (sha256(frozenWithoutChecksum) !== frozenChecksum) {
    throw new Error("NFL Market Brain frozen tournament mutated after declaration.");
  }
  if (!artifact.release.trim() || artifact.contractRelease !== NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE ||
    artifact.tournamentRelease !== NFL_MARKET_BRAIN_TOURNAMENT_RELEASE ||
    artifact.tournamentChecksum !== NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.checksum ||
    artifact.sequenceRelease !== NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE ||
    artifact.featureRelease !== NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE) {
    throw new Error("NFL Market Brain resolver artifact release identity is invalid.");
  }
  const family = NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.families.find((row) => row.family === artifact.family);
  if (!family) throw new Error("NFL Market Brain resolver artifact family was not predeclared.");
  const keys = Object.keys(artifact.hyperparameters).sort();
  const expectedKeys = Object.keys(family.hyperparameterGrid).sort();
  const grid = family.hyperparameterGrid as unknown as Record<string, readonly HyperparameterValue[]>;
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys) || keys.some((key) =>
    !grid[key]!.includes(artifact.hyperparameters[key]!))) {
    throw new Error("NFL Market Brain resolver artifact hyperparameters were not in the frozen tournament.");
  }
  if (!NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.featureAblations.includes(artifact.featureAblation) ||
    !Number.isInteger(artifact.fittedParameterCount) || artifact.fittedParameterCount < 0 ||
    artifact.fittedParameterCount > family.maximumFittedParameters ||
    artifact.effectiveTrainingGames < 2 ||
    !Number.isInteger(artifact.trainingWeekClusters) || artifact.trainingWeekClusters < 2 ||
    artifact.deterministicSeed !== NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.seed ||
    artifact.trainerRelease !== NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease ||
    !isSha256(artifact.trainingManifestChecksum) || !isSha256(artifact.weightsSha256) ||
    artifact.featureSchemaSha256 !== sha256(NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES) ||
    !isSha256(artifact.trainingRowsSha256) ||
    !Number.isInteger(artifact.trainingManifestByteLength) || artifact.trainingManifestByteLength <= 0 ||
    !Number.isInteger(artifact.weightsByteLength) || artifact.weightsByteLength <= 0 ||
    timestamp(artifact.createdAt, "createdAt") < timestamp(artifact.trainedThrough, "trainedThrough")) {
    throw new Error("NFL Market Brain resolver artifact provenance is invalid.");
  }
  const { sha256: artifactSha256, persistenceAttestation: _persistenceAttestation, ...withoutHash } =
    artifact as NflMarketBrainResolverArtifact & Partial<Pick<NflMarketBrainAttestedResolverArtifact,
      "persistenceAttestation">>;
  if (!isSha256(artifactSha256) || sha256(withoutHash) !== artifactSha256) {
    throw new Error("NFL Market Brain resolver artifact checksum mismatch.");
  }
}

function inferJointPosterior(
  sequence: NflMarketBrainSequence,
  features: NflMarketBrainResolverFeatures,
  weights: NflMarketBrainSerializedWeights,
): NflMarketBrainJointPosterior {
  const vector = vectorizeNflMarketBrainTrainerInput(nflMarketBrainTrainerInput(features));
  const standardized = vector.values.map((value, index) => {
    const preprocessing = weights.preprocessing[index]!;
    if (preprocessing.feature !== vector.names[index]) {
      throw new Error("NFL Market Brain resolver preprocessing order diverges from the fixed vectorizer.");
    }
    return (value - preprocessing.mean) / preprocessing.standardDeviation;
  });
  const featureCount = vector.values.length;
  const marginTilt = dot(weights.coefficients.slice(0, featureCount), standardized);
  const totalTilt = dot(weights.coefficients.slice(featureCount), standardized);
  const candidates = nflMarketBrainJointLogBasis(sequence).map((state) => ({
    ...state,
    probability: 0,
    logWeight: state.baseLogMass + marginTilt * state.marginTiltBasis + totalTilt * state.totalTiltBasis,
  }));
  const maximumLogWeight = Math.max(...candidates.map((state) => state.logWeight));
  const normalizer = candidates.reduce((sum, state) => sum + Math.exp(state.logWeight - maximumLogWeight), 0);
  if (!Number.isFinite(normalizer) || normalizer <= 0) {
    throw new Error("NFL Market Brain executable resolver could not normalize its score-state posterior.");
  }
  return bindJointPosterior(candidates.map(({ margin, total, logWeight }) => ({
    margin,
    total,
    probability: Math.exp(logWeight - maximumLogWeight) / normalizer,
  })));
}

export type NflMarketBrainJointLogBasisState = {
  margin: number;
  total: number;
  baseLogMass: number;
  marginTiltBasis: number;
  totalTiltBasis: number;
};

export type NflMarketBrainMarginalLogBasisState = {
  value: number;
  baseLogMass: number;
  tiltBasis: number;
};

export function nflMarketBrainMarginalLogBases(sequence: NflMarketBrainSequence): {
  margin: NflMarketBrainMarginalLogBasisState[];
  total: NflMarketBrainMarginalLogBasisState[];
} {
  const prior = sequence.prior;
  if (prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain executable resolver requires a Margin/Total prior.");
  }
  const runtime = NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime;
  const build = (minimum: number, maximum: number, distribution: MarketBrainDiscreteDistribution,
    center: number, scale: number) => Array.from({ length: maximum - minimum + 1 }, (_, index) => {
      const value = minimum + index;
      return {
        value,
        baseLogMass: logSmoothedMass(value, distribution, runtime.priorSmoothingStandardDeviation),
        tiltBasis: (value - center) / scale,
      };
    });
  return {
    margin: build(runtime.jointSupport.minimumMargin, runtime.jointSupport.maximumMargin,
      prior.artifact.marginDistribution, prior.marginMean, runtime.marginTiltScale),
    total: build(runtime.jointSupport.minimumTotal, runtime.jointSupport.maximumTotal,
      prior.artifact.totalDistribution, prior.totalMean, runtime.totalTiltScale),
  };
}

/** Exact frozen score-state basis shared by fitting and artifact inference. */
export function nflMarketBrainJointLogBasis(
  sequence: NflMarketBrainSequence,
): NflMarketBrainJointLogBasisState[] {
  const prior = sequence.prior;
  if (prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain executable resolver requires a Margin/Total prior.");
  }
  const runtime = NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime;
  const states: NflMarketBrainJointLogBasisState[] = [];
  for (let total = runtime.jointSupport.minimumTotal; total <= runtime.jointSupport.maximumTotal; total += 1) {
    for (let margin = runtime.jointSupport.minimumMargin; margin <= runtime.jointSupport.maximumMargin; margin += 1) {
      if (Math.abs(margin) > total || !feasibleNflFinalScoreState(margin, total)) continue;
      states.push({
        margin,
        total,
        baseLogMass: logSmoothedMass(margin, prior.artifact.marginDistribution,
          runtime.priorSmoothingStandardDeviation) +
          logSmoothedMass(total, prior.artifact.totalDistribution, runtime.priorSmoothingStandardDeviation),
        marginTiltBasis: (margin - prior.marginMean) / runtime.marginTiltScale,
        totalTiltBasis: (total - prior.totalMean) / runtime.totalTiltScale,
      });
    }
  }
  if (states.length === 0) throw new Error("NFL Market Brain frozen score support is empty.");
  return states;
}

function logSmoothedMass(
  value: number,
  distribution: MarketBrainDiscreteDistribution,
  standardDeviation: number,
): number {
  const terms = distribution.values.map((priorValue, index) =>
    Math.log(distribution.probabilities[index]!) - ((value - priorValue) ** 2) /
      (2 * standardDeviation ** 2));
  const maximum = Math.max(...terms);
  return maximum + Math.log(terms.reduce((sum, term) => sum + Math.exp(term - maximum), 0));
}

function dot(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error("NFL Market Brain coefficient vector has the wrong length.");
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

function bindJointPosterior(inputStates: NflMarketBrainJointScoreState[]): NflMarketBrainJointPosterior {
  if (inputStates.length === 0) throw new Error("NFL Market Brain joint posterior has no score states.");
  const seen = new Set<string>();
  const states = inputStates.map((state) => {
    if (!Number.isInteger(state.margin) || !Number.isInteger(state.total) || state.total < 0 ||
      Math.abs(state.margin) > state.total || Math.abs(state.total - state.margin) % 2 !== 0 ||
      !feasibleNflFinalScoreState(state.margin, state.total) ||
      !Number.isFinite(state.probability) || state.probability < 0) {
      throw new Error("NFL Market Brain joint posterior contains an impossible NFL score state.");
    }
    const key = `${state.margin}|${state.total}`;
    if (seen.has(key)) throw new Error("NFL Market Brain joint posterior contains a duplicate score state.");
    seen.add(key);
    return { ...state };
  }).sort((a, b) => a.total - b.total || a.margin - b.margin);
  assertUnitMass(states.map((state) => state.probability), "joint posterior");
  const marginDistribution = marginal(states, "margin");
  const totalDistribution = marginal(states, "total");
  const marginMean = mean(marginDistribution);
  const totalMean = mean(totalDistribution);
  const probabilities = {
    away: states.filter((state) => state.margin < 0).reduce((sum, state) => sum + state.probability, 0),
    home: states.filter((state) => state.margin > 0).reduce((sum, state) => sum + state.probability, 0),
    tie: states.filter((state) => state.margin === 0).reduce((sum, state) => sum + state.probability, 0),
  };
  const withoutHash = {
    schema: "nfl_market_brain_joint_score_posterior_v1" as const,
    states,
    marginDistribution,
    totalDistribution,
    marginMean,
    totalMean,
    awayWinProbability: probabilities.away,
    homeWinProbability: probabilities.home,
    tieProbability: probabilities.tie,
    awayScoreMean: (totalMean - marginMean) / 2,
    homeScoreMean: (totalMean + marginMean) / 2,
  };
  return { ...withoutHash, sha256: sha256(withoutHash) };
}

function marginal(states: NflMarketBrainJointScoreState[], key: "margin" | "total"): MarketBrainDiscreteDistribution {
  const mass = new Map<number, number>();
  for (const state of states) mass.set(state[key], (mass.get(state[key]) ?? 0) + state.probability);
  const entries = [...mass.entries()].sort((a, b) => a[0] - b[0]);
  return { values: entries.map(([value]) => value), probabilities: entries.map(([, probability]) => probability) };
}

function assertActionDistribution(input: MarketBrainActionDistribution): MarketBrainActionDistribution {
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...MARKET_BRAIN_ACTIONS].sort())) {
    throw new Error("NFL Market Brain action distribution must contain every action exactly once.");
  }
  const result = Object.fromEntries(MARKET_BRAIN_ACTIONS.map((action) => [action, input[action]])) as MarketBrainActionDistribution;
  assertUnitMass(Object.values(result), "action distribution");
  return result;
}

function assertUnitMass(probabilities: number[], name: string): void {
  if (probabilities.some((probability) => !Number.isFinite(probability) || probability < 0 || probability > 1) ||
    Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-9) {
    throw new Error(`NFL Market Brain ${name} probability mass is invalid.`);
  }
}

function mean(distribution: MarketBrainDiscreteDistribution): number {
  return distribution.values.reduce((sum, value, index) => sum + value * distribution.probabilities[index]!, 0);
}

function entropyNats(probabilities: number[]): number {
  return -probabilities.reduce((sum, probability) =>
    probability > 0 ? sum + probability * Math.log(probability) : sum, 0);
}

function normalizedEntropy(probabilities: number[]): number {
  if (probabilities.length <= 1) return 0;
  return entropyNats(probabilities) / Math.log(probabilities.length);
}

function feasibleNflFinalScoreState(margin: number, total: number): boolean {
  const home = (total + margin) / 2;
  const away = (total - margin) / 2;
  if (![home, away].every((score) => Number.isInteger(score) && score >= 0)) return false;
  // A one-point conversion safety can produce a team score of one only after
  // the opponent has scored a touchdown; 1-0 and 0-1 are impossible finals.
  return !((home === 1 && away < 6) || (away === 1 && home < 6));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function assertSerializedWeights(
  weights: NflMarketBrainSerializedWeights,
  family: NflMarketBrainResolverFamily,
  fittedParameterCount: number,
): void {
  const featureNames = new Set(weights.orderedFeatureNames);
  const preprocessingNames = new Set(weights.preprocessing.map((row) => row.feature));
  if (weights.schema !== "nfl_market_brain_serialized_weights_v1" ||
    weights.trainerRelease !== NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease ||
    weights.family !== family || weights.converged !== true ||
    weights.featureSchemaSha256 !== sha256(NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES) ||
    !isSha256(weights.trainingRowsSha256) || !isSha256(weights.trainingManifestChecksum) ||
    !Number.isFinite(timestamp(weights.trainedThrough, "weights.trainedThrough")) ||
    !Number.isFinite(weights.finalLoss) ||
    !Number.isFinite(weights.finalGradientInfinityNorm) ||
    weights.finalGradientInfinityNorm >
      NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.convergence.gradientInfinityNorm ||
    !Number.isInteger(weights.optimizerIterations) || weights.optimizerIterations < 1 ||
    weights.optimizerIterations > NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.convergence.maximumIterations ||
    JSON.stringify(weights.orderedFeatureNames) !== JSON.stringify(NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES) ||
    featureNames.size !== weights.orderedFeatureNames.length ||
    preprocessingNames.size !== weights.preprocessing.length ||
    weights.preprocessing.length !== weights.orderedFeatureNames.length ||
    weights.preprocessing.some((row) => !featureNames.has(row.feature) || !Number.isFinite(row.mean) ||
      !Number.isFinite(row.standardDeviation) || row.standardDeviation <= 0) ||
    weights.orderedFeatureNames.some((name) => !name.trim() ||
      /event|artifact|checksum|sha|player.?id|provider.?event/i.test(name)) ||
    [...weights.coefficients, ...weights.calibrationParameters].some((value) => !Number.isFinite(value)) ||
    weights.calibrationParameters.length !== 0 ||
    weights.coefficients.length !== weights.orderedFeatureNames.length * 2 ||
    weights.coefficients.length !== fittedParameterCount) {
    throw new Error("NFL Market Brain serialized weights do not match the frozen deterministic trainer contract.");
  }
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function canonicalTime(value: string, name: string): string {
  return new Date(timestamp(value, name)).toISOString();
}

function timestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid NFL Market Brain ${name}.`);
  return parsed;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
