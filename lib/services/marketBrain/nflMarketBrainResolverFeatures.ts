import { createHash } from "node:crypto";

import type {
  MarketBrainExpectedInput,
  MarketBrainNumericFeature,
  MarketBrainObservation,
} from "./marketBrainContract";
import {
  NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  type NflMarketBrainQuotePath,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE =
  "nfl_market_brain_resolver_features_2026_10_27_r5_lossless_availability_timeline" as const;

const nflMarketBrainTrainerInputBrand: unique symbol = Symbol("nflMarketBrainTrainerInput");
export type NflMarketBrainTrainerInput = Readonly<{
  schema: "nfl_market_brain_trainer_input_v1";
  [nflMarketBrainTrainerInputBrand]: true;
} & ReturnType<typeof trainerPayload>>;

export type NflMarketBrainResolverFeatures = {
  release: typeof NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE;
  eventId: string;
  cutoffAt: string;
  inputSequenceRelease: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  inputSequenceChecksum: string;
  independentPrior: {
    release: string;
    artifactSha256: string;
    availableSecondsBeforeCutoff: number;
    marginMean: number;
    totalMean: number;
    marginDistribution: { values: number[]; probabilities: number[] };
    totalDistribution: { values: number[]; probabilities: number[] };
  };
  quotePathTokens: Array<ReturnType<typeof quotePathToken>>;
  contextTokens: Array<ReturnType<typeof contextToken>>;
  expectedInputTokens: Array<ReturnType<typeof expectedInputToken>>;
  crossMarket: NflMarketBrainSequence["crossMarket"];
  sourceAvailability: {
    regime: NflMarketBrainSequence["sourceAvailability"]["regime"];
    targetSafeExpectedInputs: number;
    failed: number;
    snapshots: Array<{
      capturedSecondsBeforeCutoff: number | null;
      regime: NflMarketBrainSequence["sourceAvailability"]["regime"];
      targetSafeExpectedInputs: number;
      observed: number;
      failed: number;
      incomplete: number;
      duplicate: number;
      stale: number;
    }>;
  };
  invariants: {
    outcomesUnavailable: true;
    onlyTargetSafeObservationsExported: true;
    evaluatedTargetFamilyAbsent: true;
    missingnessExplicit: true;
    independentPriorPreserved: true;
    productionInfluenceAllowed: false;
  };
  featurePayloadSha256: string;
  checksum: string;
};

export function buildNflMarketBrainResolverFeatures(
  sequence: NflMarketBrainSequence,
): NflMarketBrainResolverFeatures {
  if (sequence.release !== NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE) {
    throw new Error("NFL Market Brain feature exporter refuses a superseded sequence release.");
  }
  if (sequence.prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain feature exporter requires an exact independent Margin/Total prior.");
  }
  if (sequence.observations.some((row) => row.eligible &&
    (row.exclusionReasons.includes("evaluated_target") || row.exclusionReasons.includes("same_target_family")))) {
    throw new Error("NFL Market Brain feature exporter found target-family evidence marked eligible.");
  }
  if (sequence.expectedInputs.some((row) => row.eligible && row.exclusionReasons.includes("same_target_family"))) {
    throw new Error("NFL Market Brain feature exporter found target-family missingness marked eligible.");
  }
  const pairedObservationIds = new Set(sequence.quotePaths.flatMap((path) =>
    path.points.flatMap((point) => point.observationIds)));
  const eligibleContext = sequence.observations
    .filter((row) => row.eligible && row.observation.modality !== "model_prior" &&
      (row.observation.modality !== "price_quote" || row.observation.availability !== "observed" ||
        !pairedObservationIds.has(row.observation.id)))
    .map((row) => contextToken(row.observation, sequence.cutoffAt,
      row.observation.modality === "price_quote" && row.observation.availability === "observed"
        ? "unpaired_observed_quote" : null));
  const payload = {
    independentPrior: {
      release: sequence.prior.release,
      artifactSha256: sequence.prior.artifact.sha256,
      availableSecondsBeforeCutoff:
        (Date.parse(sequence.cutoffAt) - Date.parse(sequence.prior.artifact.availableAt)) / 1_000,
      marginMean: sequence.prior.marginMean,
      totalMean: sequence.prior.totalMean,
      marginDistribution: structuredClone(sequence.prior.artifact.marginDistribution),
      totalDistribution: structuredClone(sequence.prior.artifact.totalDistribution),
    },
    quotePathTokens: sequence.quotePaths.map((path) => quotePathToken(path, sequence.cutoffAt)),
    contextTokens: eligibleContext,
    expectedInputTokens: sequence.expectedInputs.filter((row) => row.eligible)
      .map((row) => expectedInputToken(row.input, row.capturedAt, sequence.cutoffAt)),
    crossMarket: structuredClone(sequence.crossMarket),
    sourceAvailability: {
      regime: sequence.sourceAvailability.regime,
      targetSafeExpectedInputs: sequence.sourceAvailability.targetSafeExpectedInputs,
      failed: sequence.sourceAvailability.failed,
      snapshots: sequence.sourceAvailability.snapshots.map((snapshot) => ({
        capturedSecondsBeforeCutoff: secondsBefore(Date.parse(sequence.cutoffAt), snapshot.capturedAt),
        regime: snapshot.regime,
        targetSafeExpectedInputs: snapshot.targetSafeExpectedInputs,
        observed: snapshot.observed,
        failed: snapshot.failed,
        incomplete: snapshot.incomplete,
        duplicate: snapshot.duplicate,
        stale: snapshot.stale,
      })),
    },
  };
  const featurePayloadSha256 = sha256(payload);
  const withoutChecksum = {
    release: NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE,
    eventId: sequence.eventId,
    cutoffAt: sequence.cutoffAt,
    inputSequenceRelease: sequence.release,
    inputSequenceChecksum: sequence.checksum,
    ...payload,
    invariants: {
      outcomesUnavailable: true as const,
      onlyTargetSafeObservationsExported: true as const,
      evaluatedTargetFamilyAbsent: true as const,
      missingnessExplicit: true as const,
      independentPriorPreserved: true as const,
      productionInfluenceAllowed: false as const,
    },
    featurePayloadSha256,
  };
  return { ...withoutChecksum, checksum: sha256(withoutChecksum) };
}

function quotePathToken(path: NflMarketBrainQuotePath, cutoffAt: string) {
  const cutoff = Date.parse(cutoffAt);
  return {
    provider: path.provider,
    participant: path.participant,
    market: path.market,
    observedRole: path.observedRole,
    wasFirstMover: path.wasFirstMover,
    directionConflict: path.directionConflict,
    lineDelta: path.lineDelta,
    firstFairProbabilityDelta: path.firstFairProbabilityDelta,
    holdDelta: path.holdDelta,
    moveCount: path.moveCount,
    reversalCount: path.reversalCount,
    buybackDistance: path.buybackDistance,
    lineBuybackDistance: path.lineBuybackDistance,
    fairProbabilityBuybackDistance: path.fairProbabilityBuybackDistance,
    firstEconomicChangeSecondsBeforeCutoff: secondsBefore(cutoff, path.firstEconomicChangeAt),
    lastEconomicChangeSecondsBeforeCutoff: secondsBefore(cutoff, path.lastEconomicChangeAt),
    crossedNflKeyNumbers: [...path.crossedNflKeyNumbers],
    points: path.points.map((point) => ({
      observedSecondsBeforeCutoff: secondsBefore(cutoff, point.observedAt),
      availableSecondsBeforeCutoff: secondsBefore(cutoff, point.availableAt),
      fetchedSecondsBeforeCutoff: point.providerFetchedAt.map((value) => secondsBefore(cutoff, value)),
      ingestedSecondsBeforeCutoff: point.ingestedAt.map((value) => secondsBefore(cutoff, value)),
      phase: point.phase,
      line: point.line,
      firstPrice: point.firstPrice,
      secondPrice: point.secondPrice,
      firstFairProbability: point.firstFairProbability,
      hold: point.hold,
    })),
  };
}

function contextToken(
  observation: MarketBrainObservation,
  cutoffAt: string,
  quotePairStatus: "unpaired_observed_quote" | null,
) {
  return {
    market: observation.market,
    modality: observation.modality,
    provider: observation.source.provider,
    participant: observation.source.participant,
    sourcePrior: observation.sourcePrior,
    observedRole: observation.observedRole,
    observedSecondsBeforeCutoff: secondsBefore(Date.parse(cutoffAt), observation.timing.providerObservedAt),
    fetchedSecondsBeforeCutoff: secondsBefore(Date.parse(cutoffAt), observation.timing.providerFetchedAt),
    ingestedSecondsBeforeCutoff: secondsBefore(Date.parse(cutoffAt), observation.timing.ingestedAt),
    availableSecondsBeforeCutoff: secondsBefore(Date.parse(cutoffAt), observation.timing.availableAt),
    availability: observation.availability,
    quotePairStatus,
    values: Object.fromEntries(Object.entries(observation.values).map(([key, value]) =>
      [key, numericToken(value)])),
    categorical: Object.fromEntries(Object.entries(observation.categorical)
      .filter(([key]) => key.toLowerCase() !== "name" &&
        !/(?:sha|hash|payload|providerEventId|rawRow|playerName|playerId|detail|identity|forecastFor)/i.test(key))),
  };
}

function expectedInputToken(input: MarketBrainExpectedInput, capturedAt: string, cutoffAt: string) {
  return {
    capturedSecondsBeforeCutoff: secondsBefore(Date.parse(cutoffAt), capturedAt),
    market: input.market,
    modality: input.modality,
    provider: input.provider,
    participant: input.participant,
    expectation: input.expectation,
    availability: input.availability,
    observed: input.observationIds.length > 0,
    reason: input.reason,
  };
}

/**
 * The only object a fitter may consume. Event/artifact/checksum identities stay
 * outside this payload so a high-cardinality provenance token cannot become a
 * predictive shortcut.
 */
export function nflMarketBrainTrainerInput(features: NflMarketBrainResolverFeatures) {
  const payload = trainerPayload(features);
  const result = {
    schema: "nfl_market_brain_trainer_input_v1" as const,
    ...payload,
  } as NflMarketBrainTrainerInput;
  Object.defineProperty(result, nflMarketBrainTrainerInputBrand, { value: true, enumerable: false });
  return Object.freeze(result);
}

function trainerPayload(features: NflMarketBrainResolverFeatures) {
  return structuredClone({
    independentPrior: {
      availableSecondsBeforeCutoff: features.independentPrior.availableSecondsBeforeCutoff,
      marginMean: features.independentPrior.marginMean,
      totalMean: features.independentPrior.totalMean,
      marginDistribution: features.independentPrior.marginDistribution,
      totalDistribution: features.independentPrior.totalDistribution,
    },
    quotePathTokens: features.quotePathTokens,
    contextTokens: features.contextTokens,
    expectedInputTokens: features.expectedInputTokens,
    crossMarket: features.crossMarket,
    sourceAvailability: features.sourceAvailability,
  });
}

function numericToken(value: MarketBrainNumericFeature) {
  return value.observed === 1 ? { value: value.value, observed: 1 as const } : { value: null, observed: 0 as const };
}

function secondsBefore(cutoff: number, value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? (cutoff - parsed) / 1_000 : null;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
