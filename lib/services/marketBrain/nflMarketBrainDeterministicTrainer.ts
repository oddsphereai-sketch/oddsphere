import { createHash } from "node:crypto";

import {
  NFL_MARKET_BRAIN_FROZEN_TOURNAMENT,
  nflMarketBrainMarginalLogBases,
  type NflMarketBrainSerializedWeights,
} from "./nflMarketBrainResolverContract";
import {
  NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES,
  buildNflMarketBrainResolverFeatures,
  nflMarketBrainTrainerInput,
  vectorizeNflMarketBrainTrainerInput,
  type NflMarketBrainResolverFeatures,
} from "./nflMarketBrainResolverFeatures";
import {
  assertNflMarketBrainAttestedResearchManifest,
  type NflMarketBrainAttestedResearchManifest,
} from "./nflMarketBrainResearchEvaluator";
import {
  assertNflMarketBrainSequence,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export type NflMarketBrainDevelopmentExample = {
  sequence: NflMarketBrainSequence;
  features: NflMarketBrainResolverFeatures;
  outcome: {
    eventId: string;
    awayScore: number;
    homeScore: number;
    labelAvailableAt: string;
  };
};

export type NflMarketBrainTrainingResult = {
  weights: NflMarketBrainSerializedWeights;
  trainedThrough: string;
};

type PreparedRow = {
  x: number[];
  bases: ReturnType<typeof nflMarketBrainMarginalLogBases>;
  actualMargin: number;
  actualTotal: number;
};

/**
 * Deterministic development-only fitter for the first executable NFL resolver.
 * Selection, confirmation, and prospective labels are structurally absent.
 */
export function trainNflMarketBrainRegularizedJointResidual(args: {
  manifest: NflMarketBrainAttestedResearchManifest;
  examples: NflMarketBrainDevelopmentExample[];
  l2: 0.1 | 1 | 10;
}): NflMarketBrainTrainingResult {
  assertNflMarketBrainAttestedResearchManifest(args.manifest);
  const runtime = NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime;
  const development = args.manifest.partitions.find((partition) => partition.role === "development")!;
  const developmentFolds = new Set(development.events.map((event) => event.foldId));
  if (args.examples.length !== development.events.length || args.examples.length < 2 || developmentFolds.size < 2) {
    throw new Error("NFL Market Brain trainer requires the complete declared development partition across two time folds.");
  }
  const manifestEvents = new Map(development.events.map((event) => [event.eventId, event]));
  const seen = new Set<string>();
  const raw = [...args.examples].sort((a, b) => a.sequence.eventId.localeCompare(b.sequence.eventId)).map((example) => {
    assertNflMarketBrainSequence(example.sequence);
    const declared = manifestEvents.get(example.sequence.eventId);
    const rebuiltFeatures = buildNflMarketBrainResolverFeatures(example.sequence);
    if (!declared || seen.has(example.sequence.eventId) || example.outcome.eventId !== example.sequence.eventId ||
      example.sequence.startsAt !== declared.startsAt || example.sequence.cutoffAt !== declared.cutoffAt ||
      example.sequence.captureWindow.firstCapturedAt !== declared.firstCaptureAt ||
      example.sequence.captureWindow.lastCapturedAt !== declared.lastCaptureAt ||
      example.outcome.labelAvailableAt !== declared.outcomeOpenedAt ||
      example.features.eventId !== example.sequence.eventId ||
      example.features.inputSequenceChecksum !== example.sequence.checksum ||
      JSON.stringify(rebuiltFeatures) !== JSON.stringify(example.features)) {
      throw new Error("NFL Market Brain trainer row does not exactly match the attested development manifest.");
    }
    seen.add(example.sequence.eventId);
    if (![example.outcome.awayScore, example.outcome.homeScore].every((score) =>
      Number.isInteger(score) && score >= 0) || Date.parse(example.outcome.labelAvailableAt) <=
        Date.parse(example.sequence.startsAt)) {
      throw new Error("NFL Market Brain trainer outcome is invalid or was not available after kickoff.");
    }
    const vector = vectorizeNflMarketBrainTrainerInput(nflMarketBrainTrainerInput(example.features));
    return { example, values: vector.values };
  });
  if (seen.size !== manifestEvents.size) {
    throw new Error("NFL Market Brain trainer omitted a declared development event.");
  }

  const preprocessing = NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.map((feature, index) => {
    if (index === 0) return { feature, mean: 0, standardDeviation: 1 };
    const values = raw.map((row) => row.values[index]!);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return { feature, mean, standardDeviation: variance > 0 ? Math.sqrt(variance) : 1 };
  });
  const rows: PreparedRow[] = raw.map(({ example, values }) => ({
    x: values.map((value, index) => (value - preprocessing[index]!.mean) /
      preprocessing[index]!.standardDeviation),
    bases: nflMarketBrainMarginalLogBases(example.sequence),
    actualMargin: example.outcome.homeScore - example.outcome.awayScore,
    actualTotal: example.outcome.homeScore + example.outcome.awayScore,
  }));
  const trainingRowsSha256 = sha256(raw.map(({ example }) => ({
    eventId: example.sequence.eventId,
    sequenceChecksum: example.sequence.checksum,
    featureChecksum: example.features.checksum,
    labelAvailableAt: example.outcome.labelAvailableAt,
    awayScore: example.outcome.awayScore,
    homeScore: example.outcome.homeScore,
  })));
  const parameterCount = NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length * 2;
  let coefficients = Array.from({ length: parameterCount }, () => 0);
  let current = objectiveAndGradient(rows, coefficients, args.l2);
  let converged = current.gradientInfinityNorm <= runtime.convergence.gradientInfinityNorm;
  let iteration = 0;
  for (; !converged && iteration < runtime.convergence.maximumIterations; iteration += 1) {
    let step = 1;
    let accepted: ReturnType<typeof objectiveAndGradient> | null = null;
    let candidate = coefficients;
    const squaredGradient = current.gradient.reduce((sum, value) => sum + value * value, 0);
    for (let search = 0; search < 40; search += 1) {
      candidate = coefficients.map((value, index) => value - step * current.gradient[index]!);
      const scored = objectiveAndGradient(rows, candidate, args.l2);
      if (scored.loss <= current.loss - 1e-4 * step * squaredGradient) {
        accepted = scored;
        break;
      }
      step /= 2;
    }
    if (!accepted) throw new Error("NFL Market Brain deterministic optimizer could not find a descending step.");
    coefficients = candidate;
    current = accepted;
    converged = current.gradientInfinityNorm <= runtime.convergence.gradientInfinityNorm;
  }
  if (!converged) throw new Error("NFL Market Brain deterministic optimizer did not converge within its frozen budget.");
  const weights: NflMarketBrainSerializedWeights = {
    schema: "nfl_market_brain_serialized_weights_v1",
    trainerRelease: runtime.trainerRelease,
    family: "regularized_joint_residual",
    orderedFeatureNames: [...NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES],
    coefficients,
    preprocessing,
    calibrationParameters: [],
    featureSchemaSha256: sha256(NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES),
    trainingRowsSha256,
    trainingManifestChecksum: args.manifest.checksum,
    trainedThrough: new Date(Math.max(...raw.map(({ example }) =>
      Date.parse(example.outcome.labelAvailableAt)))).toISOString(),
    finalLoss: current.loss,
    finalGradientInfinityNorm: current.gradientInfinityNorm,
    optimizerIterations: Math.max(1, iteration),
    converged: true,
  };
  return {
    weights,
    trainedThrough: weights.trainedThrough,
  };
}

function objectiveAndGradient(rows: PreparedRow[], coefficients: number[], l2: number) {
  const featureCount = NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length;
  const gradient = Array.from({ length: coefficients.length }, () => 0);
  let loss = 0;
  for (const row of rows) {
    const marginTilt = dot(coefficients.slice(0, featureCount), row.x);
    const totalTilt = dot(coefficients.slice(featureCount), row.x);
    const margin = scoreMarginal(row.bases.margin, marginTilt, row.actualMargin);
    const total = scoreMarginal(row.bases.total, totalTilt, row.actualTotal);
    loss += margin.negativeLogLikelihood + total.negativeLogLikelihood;
    for (let feature = 0; feature < featureCount; feature += 1) {
      gradient[feature] += row.x[feature]! * margin.gradient;
      gradient[featureCount + feature] += row.x[feature]! * total.gradient;
    }
  }
  loss /= rows.length;
  for (let index = 0; index < coefficients.length; index += 1) {
    gradient[index] /= rows.length;
    if (index % featureCount !== 0) {
      loss += 0.5 * l2 * coefficients[index]! ** 2;
      gradient[index] += l2 * coefficients[index]!;
    }
  }
  return {
    loss,
    gradient,
    gradientInfinityNorm: Math.max(...gradient.map((value) => Math.abs(value))),
  };
}

function scoreMarginal(
  states: Array<{ value: number; baseLogMass: number; tiltBasis: number }>,
  tilt: number,
  actualValue: number,
) {
  const logits = states.map((state) => state.baseLogMass + tilt * state.tiltBasis);
  const maximum = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - maximum));
  const normalizer = exponentials.reduce((sum, value) => sum + value, 0);
  const actualIndex = states.findIndex((state) => state.value === actualValue);
  if (actualIndex < 0) throw new Error("NFL Market Brain outcome lies outside the frozen score support.");
  const expectedBasis = states.reduce((sum, state, index) =>
    sum + state.tiltBasis * exponentials[index]! / normalizer, 0);
  return {
    negativeLogLikelihood: maximum + Math.log(normalizer) - logits[actualIndex]!,
    gradient: expectedBasis - states[actualIndex]!.tiltBasis,
  };
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
