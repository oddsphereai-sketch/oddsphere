import { marketBrainCanonicalJson, marketBrainSha256 } from "./marketBrainCanonical";

import {
  NFL_MARKET_BRAIN_NATURAL_PARAMETER_HEADS,
  NFL_MARKET_BRAIN_FROZEN_TOURNAMENT,
  nflMarketBrainJointLogBasis,
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

const attestedTrainingResults = new WeakSet<object>();
export type NflMarketBrainAttestedTrainingResult = NflMarketBrainTrainingResult;

export function assertNflMarketBrainAttestedTrainingResult(
  result: NflMarketBrainTrainingResult,
): asserts result is NflMarketBrainAttestedTrainingResult {
  if (!attestedTrainingResults.has(result) || result.trainedThrough !== result.weights.trainedThrough ||
    result.weights.tournamentTranscriptSha256 !== sha256(result.weights.tournamentTranscript)) {
    throw new Error("NFL Market Brain artifact requires an in-process deterministic trainer attestation.");
  }
}

type PreparedRow = {
  x: number[];
  states: ReturnType<typeof nflMarketBrainJointLogBasis>;
  actualMargin: number;
  actualTotal: number;
};

type RawRow = Omit<PreparedRow, "x"> & {
  values: number[];
  foldId: string;
  eventId: string;
  sequenceChecksum: string;
  featureChecksum: string;
  labelAvailableAt: string;
  awayScore: number;
  homeScore: number;
};

/**
 * Deterministic development-only fitter for the first executable NFL resolver.
 * Selection, confirmation, and prospective labels are structurally absent.
 */
export function trainNflMarketBrainRegularizedJointResidual(args: {
  manifest: NflMarketBrainAttestedResearchManifest;
  examples: NflMarketBrainDevelopmentExample[];
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
      Date.parse(example.sequence.captureWindow.firstCapturedAt) < Date.parse(declared.captureWindowOpensAt) ||
      Date.parse(example.sequence.captureWindow.lastCapturedAt) > Date.parse(declared.captureWindowClosesAt) ||
      example.outcome.labelAvailableAt !== declared.outcomeOpenedAt ||
      example.features.eventId !== example.sequence.eventId ||
      example.features.inputSequenceChecksum !== example.sequence.checksum ||
      marketBrainCanonicalJson(rebuiltFeatures) !== marketBrainCanonicalJson(example.features)) {
      throw new Error("NFL Market Brain trainer row does not exactly match the attested development manifest.");
    }
    seen.add(example.sequence.eventId);
    if (![example.outcome.awayScore, example.outcome.homeScore].every((score) =>
      Number.isInteger(score) && score >= 0) || Date.parse(example.outcome.labelAvailableAt) <=
        Date.parse(example.sequence.startsAt)) {
      throw new Error("NFL Market Brain trainer outcome is invalid or was not available after kickoff.");
    }
    const vector = vectorizeNflMarketBrainTrainerInput(nflMarketBrainTrainerInput(example.features));
    return {
      values: vector.values,
      states: nflMarketBrainJointLogBasis(example.sequence),
      actualMargin: example.outcome.homeScore - example.outcome.awayScore,
      actualTotal: example.outcome.homeScore + example.outcome.awayScore,
      foldId: declared.foldId,
      eventId: example.sequence.eventId,
      sequenceChecksum: example.sequence.checksum,
      featureChecksum: example.features.checksum,
      labelAvailableAt: example.outcome.labelAvailableAt,
      awayScore: example.outcome.awayScore,
      homeScore: example.outcome.homeScore,
    } satisfies RawRow;
  });
  if (seen.size !== manifestEvents.size) {
    throw new Error("NFL Market Brain trainer omitted a declared development event.");
  }

  const trainingRowsSha256 = sha256(raw.map((row) => ({
    eventId: row.eventId,
    sequenceChecksum: row.sequenceChecksum,
    featureChecksum: row.featureChecksum,
    labelAvailableAt: row.labelAvailableAt,
    awayScore: row.awayScore,
    homeScore: row.homeScore,
  })));
  const foldIds = development.events.reduce<string[]>((ids, event) =>
    ids.includes(event.foldId) ? ids : [...ids, event.foldId], []);
  const l2Grid = [...NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.families[0]!.hyperparameterGrid.l2] as
    Array<0.1 | 1 | 10>;
  const tournamentFolds = foldIds.slice(1).map((validationFoldId, index) => {
    const trainingFoldIds = foldIds.slice(0, index + 1);
    const trainingRaw = raw.filter((row) => trainingFoldIds.includes(row.foldId));
    const validationRaw = raw.filter((row) => row.foldId === validationFoldId);
    if (trainingRaw.length === 0 || validationRaw.length === 0) {
      throw new Error("NFL Market Brain rolling tournament contains an empty chronological fold.");
    }
    const foldPreprocessing = preprocessingFor(trainingRaw);
    const trainingRows = prepareRows(trainingRaw, foldPreprocessing);
    const validationRows = prepareRows(validationRaw, foldPreprocessing);
    return {
      validationFoldId,
      trainingFoldIds,
      scores: l2Grid.map((l2) => {
        const fitted = fitRows(trainingRows, l2);
        return { l2, validationJointLogLoss: jointLogLoss(validationRows, fitted.coefficients) };
      }),
    };
  });
  const aggregateScores = l2Grid.map((l2) => ({
    l2,
    meanValidationJointLogLoss: tournamentFolds.reduce((sum, fold) =>
      sum + fold.scores.find((score) => score.l2 === l2)!.validationJointLogLoss, 0) /
      tournamentFolds.length,
  }));
  const selectedL2 = [...aggregateScores].sort((a, b) =>
    a.meanValidationJointLogLoss - b.meanValidationJointLogLoss || a.l2 - b.l2)[0]!.l2;
  const tournamentTranscript = {
    mode: "rolling_origin_development_only" as const,
    folds: tournamentFolds,
    aggregateScores,
    selectedL2,
    trainingRowsSha256,
    manifestChecksum: args.manifest.checksum,
  };
  const preprocessing = preprocessingFor(raw);
  const fitted = fitRows(prepareRows(raw, preprocessing), selectedL2);
  const { coefficients, current, iteration } = fitted;
  const weights: NflMarketBrainSerializedWeights = {
    schema: "nfl_market_brain_serialized_weights_v1",
    trainerRelease: runtime.trainerRelease,
    family: "regularized_joint_residual",
    orderedFeatureNames: [...NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES],
    orderedHeadNames: [...NFL_MARKET_BRAIN_NATURAL_PARAMETER_HEADS],
    coefficients,
    preprocessing,
    calibrationParameters: [],
    featureSchemaSha256: sha256(NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES),
    trainingRowsSha256,
    trainingManifestChecksum: args.manifest.checksum,
    selectedL2,
    tournamentTranscript,
    tournamentTranscriptSha256: sha256(tournamentTranscript),
    trainedThrough: new Date(Math.max(...raw.map((row) => Date.parse(row.labelAvailableAt)))).toISOString(),
    finalLoss: current.loss,
    finalGradientInfinityNorm: current.gradientInfinityNorm,
    optimizerIterations: Math.max(1, iteration),
    converged: true,
  };
  const result = {
    weights,
    trainedThrough: weights.trainedThrough,
  };
  deepFreeze(result);
  attestedTrainingResults.add(result);
  return result;
}

function preprocessingFor(rows: RawRow[]): NflMarketBrainSerializedWeights["preprocessing"] {
  return NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.map((feature, index) => {
    if (index === 0) return { feature, mean: 0, standardDeviation: 1 };
    const values = rows.map((row) => row.values[index]!);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return { feature, mean, standardDeviation: variance > 0 ? Math.sqrt(variance) : 1 };
  });
}

function prepareRows(
  rows: RawRow[],
  preprocessing: NflMarketBrainSerializedWeights["preprocessing"],
): PreparedRow[] {
  return rows.map((row) => ({
    x: row.values.map((value, index) =>
      (value - preprocessing[index]!.mean) / preprocessing[index]!.standardDeviation),
    states: row.states,
    actualMargin: row.actualMargin,
    actualTotal: row.actualTotal,
  }));
}

function fitRows(rows: PreparedRow[], l2: 0.1 | 1 | 10) {
  const runtime = NFL_MARKET_BRAIN_FROZEN_TOURNAMENT.deterministicRuntime;
  const parameterCount = NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length *
    NFL_MARKET_BRAIN_NATURAL_PARAMETER_HEADS.length;
  let coefficients = Array.from({ length: parameterCount }, () => 0);
  let current = objectiveAndGradient(rows, coefficients, l2);
  let converged = current.gradientInfinityNorm <= runtime.convergence.gradientInfinityNorm;
  let iteration = 0;
  for (; !converged && iteration < runtime.convergence.maximumIterations; iteration += 1) {
    let step = 1;
    let accepted: ReturnType<typeof objectiveAndGradient> | null = null;
    let candidate = coefficients;
    const squaredGradient = current.gradient.reduce((sum, value) => sum + value * value, 0);
    for (let search = 0; search < 40; search += 1) {
      candidate = coefficients.map((value, index) => value - step * current.gradient[index]!);
      const scored = objectiveAndGradient(rows, candidate, l2);
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
  if (!converged) {
    throw new Error(`NFL Market Brain deterministic optimizer did not converge within its frozen budget (${current.gradientInfinityNorm}).`);
  }
  return { coefficients, current, iteration: Math.max(1, iteration) };
}

function jointLogLoss(rows: PreparedRow[], coefficients: number[]): number {
  const featureCount = NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length;
  return rows.reduce((sum, row) => {
    const headTilts = NFL_MARKET_BRAIN_NATURAL_PARAMETER_HEADS.map((_, headIndex) =>
      dot(coefficients.slice(headIndex * featureCount, (headIndex + 1) * featureCount), row.x));
    return sum + scoreJoint(row.states, headTilts, row.actualMargin, row.actualTotal).negativeLogLikelihood;
  }, 0) / rows.length;
}

function objectiveAndGradient(rows: PreparedRow[], coefficients: number[], l2: number) {
  const featureCount = NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length;
  const gradient = Array.from({ length: coefficients.length }, () => 0);
  let loss = 0;
  for (const row of rows) {
    const headTilts = NFL_MARKET_BRAIN_NATURAL_PARAMETER_HEADS.map((_, headIndex) =>
      dot(coefficients.slice(headIndex * featureCount, (headIndex + 1) * featureCount), row.x));
    const scored = scoreJoint(row.states, headTilts, row.actualMargin, row.actualTotal);
    loss += scored.negativeLogLikelihood;
    for (let head = 0; head < NFL_MARKET_BRAIN_NATURAL_PARAMETER_HEADS.length; head += 1) {
      for (let feature = 0; feature < featureCount; feature += 1) {
        gradient[head * featureCount + feature] += row.x[feature]! * scored.gradient[head]!;
      }
    }
  }
  loss /= rows.length;
  for (let index = 0; index < coefficients.length; index += 1) {
    gradient[index] /= rows.length;
    // Every natural-parameter coefficient is regularized, including the five
    // head intercepts. Leaving scale/dependence intercepts unregularized lets
    // a small chronological fold collapse toward a degenerate score state.
    loss += 0.5 * l2 * coefficients[index]! ** 2;
    gradient[index] += l2 * coefficients[index]!;
  }
  return {
    loss,
    gradient,
    gradientInfinityNorm: Math.max(...gradient.map((value) => Math.abs(value))),
  };
}

function scoreJoint(
  states: Array<{ margin: number; total: number; baseLogMass: number; tiltBasis: number[] }>,
  headTilts: number[],
  actualMargin: number,
  actualTotal: number,
) {
  const logits = states.map((state) => state.baseLogMass + dot(headTilts, state.tiltBasis));
  const maximum = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - maximum));
  const normalizer = exponentials.reduce((sum, value) => sum + value, 0);
  const actualIndex = states.findIndex((state) => state.margin === actualMargin && state.total === actualTotal);
  if (actualIndex < 0) throw new Error("NFL Market Brain outcome lies outside the frozen score support.");
  const expectedBasis = NFL_MARKET_BRAIN_NATURAL_PARAMETER_HEADS.map((_, head) =>
    states.reduce((sum, state, index) =>
      sum + state.tiltBasis[head]! * exponentials[index]! / normalizer, 0));
  return {
    negativeLogLikelihood: maximum + Math.log(normalizer) - logits[actualIndex]!,
    gradient: expectedBasis.map((value, head) => value - states[actualIndex]!.tiltBasis[head]!),
  };
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

function sha256(value: unknown): string {
  return marketBrainSha256(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
