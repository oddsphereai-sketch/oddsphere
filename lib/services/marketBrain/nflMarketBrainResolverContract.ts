import { createHash } from "node:crypto";

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
  NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE,
  type NflMarketBrainResolverFeatures,
} from "./nflMarketBrainResolverFeatures";
import {
  NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE =
  "nfl_market_brain_resolver_contract_2026_10_27_r5_reproducible_manifest_bound" as const;
export const NFL_MARKET_BRAIN_TOURNAMENT_RELEASE =
  "nfl_market_brain_tournament_2026_10_27_r5_reproducible_manifest_bound" as const;

export type NflMarketBrainResolverFamily =
  | "regularized_joint_residual"
  | "regularized_mixture_of_experts"
  | "calibrated_heads_coherent_projection";

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
  featureAblations: [
    "released_semantic_baseline",
    "collapsed_preferred_split",
    "all_source_split_manifest",
    "continuous_price_paths",
    "chronology_roles",
    "availability_news_sequence",
    "complete_joint_candidate",
  ] as const,
  deterministicRuntime: {
    trainerRelease: "nfl_market_brain_deterministic_trainer_2026_10_27_r1" as const,
    trainerInputSchema: "nfl_market_brain_trainer_input_v1" as const,
    optimizer: "deterministic_lbfgs_fixed_order_exact_gradient" as const,
    convergence: { maximumIterations: 500, gradientInfinityNorm: 1e-8, relativeLossTolerance: 1e-10 },
    seed: 20261027,
    serialization: "canonical_sorted_json_float64_v1" as const,
    standardization: "training_fold_only_mean_sd_with_missing_mask" as const,
    categoricalPolicy: "frozen_vocabulary_no_identity_hashing" as const,
    jointSupport: { minimumTotal: 0, maximumTotal: 100, minimumMargin: -70, maximumMargin: 70,
      integerParityAndNflScoreFeasibilityRequired: true as const, minimumStateProbability: 1e-12 },
    uncertainty: "week_clustered_block_bootstrap_2000_replicates" as const,
    familyComparison: "holm_bonferroni_against_incumbent_alpha_0_05" as const,
    minimumEffectiveGames: 400,
    minimumGamesPerFittedParameter: 12,
  },
  families: [
    {
      family: "regularized_joint_residual",
      purpose: "Learn a shrunken correction to the independent Margin/Total prior.",
      hyperparameterGrid: { l2: [0.1, 1, 10], timeDecayHalfLifeDays: [30, 90], maximumInteractions: [0, 4] },
      maximumFittedParameters: 64,
      implementation: {
        basis: ["frozen_continuous_main_effects", "predeclared_cross_market_interactions_maximum_four"],
        preprocessing: "fold_only_standardization; masks remain separate binary features; no event/source hash features",
        loss: "margin_nll_plus_total_nll_plus_l2; prior log-mass offset retained",
        calibration: "selection-fold scalar temperature per marginal",
        coherence: "maximum-entropy coupling on frozen feasible score support matching calibrated marginals",
      },
    },
    {
      family: "regularized_mixture_of_experts",
      purpose: "Learn context-dependent weights over coherent prior and market-conditioned experts.",
      hyperparameterGrid: { l2: [0.1, 1, 10], temperature: [0.75, 1, 1.25], maximumExperts: [2, 3] },
      maximumFittedParameters: 96,
      implementation: {
        basis: ["prior_expert", "price_path_expert", "availability_context_expert", "linear_softmax_gate"],
        preprocessing: "fold_only_standardization; deterministic frozen expert order; missing experts masked before softmax",
        loss: "joint_available_case_nll_else_marginal_composite_nll_plus_l2",
        calibration: "selection-fold shared temperature on gate logits",
        coherence: "convex mixture of feasible expert score-state distributions",
      },
    },
    {
      family: "calibrated_heads_coherent_projection",
      purpose: "Calibrate market heads, then project them onto one feasible NFL score-state distribution.",
      hyperparameterGrid: { l2: [0.1, 1, 10], calibration: ["temperature", "beta"], projectionPenalty: [1, 10] },
      maximumFittedParameters: 128,
      implementation: {
        basis: ["regularized_margin_head", "regularized_total_head", "winner_calibration_head"],
        preprocessing: "fold_only_standardization; frozen basis order; no data-selected interactions",
        loss: "margin_nll_plus_total_nll_plus_winner_brier_plus_l2",
        calibration: "selection-fold predeclared temperature_or_beta_grid_only",
        coherence: "deterministic_kl_projection_to_frozen_feasible_score_support",
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
  createdAt: string;
  sha256: string;
};

export type NflMarketBrainSerializedWeights = {
  schema: "nfl_market_brain_serialized_weights_v1";
  trainerRelease: typeof NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease;
  family: NflMarketBrainResolverFamily;
  orderedFeatureNames: string[];
  coefficients: number[];
  preprocessing: Array<{ feature: string; mean: number; standardDeviation: number }>;
  calibrationParameters: number[];
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
    createdAt: canonicalTime(args.createdAt, "createdAt"),
  };
  const artifact = { ...withoutHash, sha256: sha256(withoutHash) };
  assertNflMarketBrainResolverArtifact(artifact);
  return artifact;
}

export function buildNflMarketBrainResolverShadowOutput(args: {
  sequence: NflMarketBrainSequence;
  features: NflMarketBrainResolverFeatures;
  artifact: NflMarketBrainResolverArtifact;
  inferredAt: string;
  jointScoreStates: NflMarketBrainJointScoreState[];
}): NflMarketBrainResolverShadowOutput {
  assertNflMarketBrainResolverArtifact(args.artifact);
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
  const trainedThrough = timestamp(args.artifact.trainedThrough, "trainedThrough");
  const cutoff = timestamp(args.sequence.cutoffAt, "featureCutoffAt");
  const starts = timestamp(args.sequence.startsAt, "startsAt");
  if (cutoff >= starts || trainedThrough >= cutoff || trainedThrough >= starts) {
    throw new Error("NFL Market Brain resolver artifact training reaches the evaluated case.");
  }
  const inferredAt = canonicalTime(args.inferredAt, "inferredAt");
  const inferred = timestamp(inferredAt, "inferredAt");
  if (inferred < cutoff || inferred >= starts) {
    throw new Error("NFL Market Brain inference must occur after its feature cutoff and before kickoff.");
  }
  const posterior = bindJointPosterior(args.jointScoreStates);
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
    artifact.effectiveTrainingGames < NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.minimumEffectiveGames ||
    artifact.effectiveTrainingGames < artifact.fittedParameterCount *
      NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.minimumGamesPerFittedParameter ||
    !Number.isInteger(artifact.trainingWeekClusters) || artifact.trainingWeekClusters < 2 ||
    artifact.deterministicSeed !== NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.seed ||
    artifact.trainerRelease !== NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.trainerRelease ||
    !isSha256(artifact.trainingManifestChecksum) || !isSha256(artifact.weightsSha256) ||
    !Number.isInteger(artifact.trainingManifestByteLength) || artifact.trainingManifestByteLength <= 0 ||
    !Number.isInteger(artifact.weightsByteLength) || artifact.weightsByteLength <= 0 ||
    timestamp(artifact.createdAt, "createdAt") < timestamp(artifact.trainedThrough, "trainedThrough")) {
    throw new Error("NFL Market Brain resolver artifact provenance is invalid.");
  }
  const { sha256: artifactSha256, ...withoutHash } = artifact;
  if (!isSha256(artifactSha256) || sha256(withoutHash) !== artifactSha256) {
    throw new Error("NFL Market Brain resolver artifact checksum mismatch.");
  }
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
    !Number.isInteger(weights.optimizerIterations) || weights.optimizerIterations < 1 ||
    weights.optimizerIterations > NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime.convergence.maximumIterations ||
    featureNames.size !== weights.orderedFeatureNames.length ||
    preprocessingNames.size !== weights.preprocessing.length ||
    weights.preprocessing.some((row) => !featureNames.has(row.feature) || !Number.isFinite(row.mean) ||
      !Number.isFinite(row.standardDeviation) || row.standardDeviation <= 0) ||
    weights.orderedFeatureNames.some((name) => !name.trim() ||
      /event|artifact|checksum|sha|player.?id|provider.?event/i.test(name)) ||
    [...weights.coefficients, ...weights.calibrationParameters].some((value) => !Number.isFinite(value)) ||
    weights.coefficients.length + weights.calibrationParameters.length !== fittedParameterCount) {
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
