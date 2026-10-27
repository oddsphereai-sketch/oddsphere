import { createHash } from "node:crypto";

import type { MarketBrainDiscreteDistribution } from "./marketBrainContract";
import {
  MARKET_BRAIN_ACTIONS,
  type MarketBrainAction,
  type MarketBrainActionDistribution,
  type NflMarketBrainBehaviorScenario,
} from "./nflMarketBrainBehaviorScenarios";
import type { NflMarketBrainResearchPrediction } from "./nflMarketBrainResearchEvaluator";
import {
  NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE,
  type NflMarketBrainResolverFeatures,
} from "./nflMarketBrainResolverFeatures";
import {
  NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE =
  "nfl_market_brain_resolver_contract_2026_10_27_r1_shadow_only" as const;
export const NFL_MARKET_BRAIN_TOURNAMENT_RELEASE =
  "nfl_market_brain_tournament_2026_10_27_r1_pre_outcome_freeze" as const;

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
};

const tournamentWithoutChecksum = {
  release: NFL_MARKET_BRAIN_TOURNAMENT_RELEASE,
  frozenAt: "2026-10-27T00:00:00.000Z",
  sequenceRelease: NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  featureRelease: NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE,
  splitMethod: "rolling_origin_purged_no_random_split" as const,
  selectionObjective: {
    primary: "margin_total_distribution_log_score" as const,
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
  families: [
    {
      family: "regularized_joint_residual",
      purpose: "Learn a shrunken correction to the independent Margin/Total prior.",
      hyperparameterGrid: { l2: [0.1, 1, 10], timeDecayHalfLifeDays: [30, 90], maximumInteractions: [0, 4] },
      maximumFittedParameters: 256,
    },
    {
      family: "regularized_mixture_of_experts",
      purpose: "Learn context-dependent weights over coherent prior and market-conditioned experts.",
      hyperparameterGrid: { l2: [0.1, 1, 10], temperature: [0.75, 1, 1.25], maximumExperts: [2, 3] },
      maximumFittedParameters: 384,
    },
    {
      family: "calibrated_heads_coherent_projection",
      purpose: "Calibrate market heads, then project them onto one feasible NFL score-state distribution.",
      hyperparameterGrid: { l2: [0.1, 1, 10], calibration: ["temperature", "beta"], projectionPenalty: [1, 10] },
      maximumFittedParameters: 512,
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

export const NFL_MARKET_BRAIN_FROZEN_TOURNAMENT = Object.freeze({
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
  trainedThrough: string;
  trainingManifestChecksum: string;
  weightsSha256: string;
  createdAt: string;
  sha256: string;
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
  family: NflMarketBrainResolverFamily;
  eventId: string;
  sequenceRelease: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  sequenceChecksum: string;
  featureRelease: typeof NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE;
  featureChecksum: string;
  featureCutoffAt: string;
  trainedThrough: string;
  inferredAt: string;
  actionProbabilities: MarketBrainActionDistribution;
  posterior: NflMarketBrainJointPosterior;
  uncertainty: {
    actionEntropy: number;
    posteriorEntropy: number;
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
  trainedThrough: string;
  trainingManifestChecksum: string;
  weightsSha256: string;
  createdAt: string;
}): NflMarketBrainResolverArtifact {
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
    trainedThrough: canonicalTime(args.trainedThrough, "trainedThrough"),
    trainingManifestChecksum: args.trainingManifestChecksum,
    weightsSha256: args.weightsSha256,
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
  actionProbabilities: MarketBrainActionDistribution;
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
  if (trainedThrough >= cutoff || trainedThrough >= starts) {
    throw new Error("NFL Market Brain resolver artifact training reaches the evaluated case.");
  }
  const inferredAt = canonicalTime(args.inferredAt, "inferredAt");
  const actionProbabilities = assertActionDistribution(args.actionProbabilities);
  const posterior = bindJointPosterior(args.jointScoreStates);
  const withoutChecksum = {
    release: args.artifact.release,
    contractRelease: NFL_MARKET_BRAIN_RESOLVER_CONTRACT_RELEASE,
    tournamentRelease: NFL_MARKET_BRAIN_TOURNAMENT_RELEASE,
    tournamentChecksum: NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.checksum,
    artifactSha256: args.artifact.sha256,
    family: args.artifact.family,
    eventId: args.sequence.eventId,
    sequenceRelease: args.sequence.release,
    sequenceChecksum: args.sequence.checksum,
    featureRelease: args.features.release,
    featureChecksum: args.features.checksum,
    featureCutoffAt: args.sequence.cutoffAt,
    trainedThrough: args.artifact.trainedThrough,
    inferredAt,
    actionProbabilities,
    posterior,
    uncertainty: {
      actionEntropy: normalizedEntropy(Object.values(actionProbabilities)),
      posteriorEntropy: normalizedEntropy(posterior.states.map((state) => state.probability)),
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
    sequenceChecksum: output.sequenceChecksum,
    awayWinProbability: output.posterior.awayWinProbability,
    homeWinProbability: output.posterior.homeWinProbability,
    tieProbability: output.posterior.tieProbability,
    marginMean: output.posterior.marginMean,
    totalMean: output.posterior.totalMean,
    marginDistribution: output.posterior.marginDistribution,
    totalDistribution: output.posterior.totalDistribution,
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
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys) || keys.some((key) =>
    !family.hyperparameterGrid[key]!.includes(artifact.hyperparameters[key] as never))) {
    throw new Error("NFL Market Brain resolver artifact hyperparameters were not in the frozen tournament.");
  }
  if (!NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.featureAblations.includes(artifact.featureAblation) ||
    !isSha256(artifact.trainingManifestChecksum) || !isSha256(artifact.weightsSha256) ||
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

function normalizedEntropy(probabilities: number[]): number {
  if (probabilities.length <= 1) return 0;
  return -probabilities.reduce((sum, probability) =>
    probability > 0 ? sum + probability * Math.log(probability) : sum, 0) / Math.log(probabilities.length);
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
