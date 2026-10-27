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
  "nfl_market_brain_resolver_features_2026_10_27_r1_target_safe_sequence" as const;

export type NflMarketBrainResolverFeatures = {
  release: typeof NFL_MARKET_BRAIN_RESOLVER_FEATURE_RELEASE;
  eventId: string;
  cutoffAt: string;
  inputSequenceRelease: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  inputSequenceChecksum: string;
  independentPrior: {
    release: string;
    artifactSha256: string;
    marginMean: number;
    totalMean: number;
    marginDistribution: { values: number[]; probabilities: number[] };
    totalDistribution: { values: number[]; probabilities: number[] };
  };
  quotePathTokens: Array<ReturnType<typeof quotePathToken>>;
  contextTokens: Array<ReturnType<typeof contextToken>>;
  expectedInputTokens: Array<ReturnType<typeof expectedInputToken>>;
  crossMarket: NflMarketBrainSequence["crossMarket"];
  sourceAvailability: Pick<NflMarketBrainSequence["sourceAvailability"],
    "regime" | "manifests" | "failed" | "unmatchedRows" | "ambiguousRows">;
  invariants: {
    outcomesUnavailable: true;
    onlyEligibleObservationsExported: true;
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
  const eligibleContext = sequence.observations
    .filter((row) => row.eligible && !["price_quote", "model_prior"].includes(row.observation.modality))
    .map((row) => contextToken(row.observation, sequence.cutoffAt));
  const payload = {
    independentPrior: {
      release: sequence.prior.release,
      artifactSha256: sequence.prior.artifact.sha256,
      marginMean: sequence.prior.marginMean,
      totalMean: sequence.prior.totalMean,
      marginDistribution: structuredClone(sequence.prior.artifact.marginDistribution),
      totalDistribution: structuredClone(sequence.prior.artifact.totalDistribution),
    },
    quotePathTokens: sequence.quotePaths.map((path) => quotePathToken(path, sequence.cutoffAt)),
    contextTokens: eligibleContext,
    expectedInputTokens: sequence.expectedInputs.filter((row) => row.eligible).map((row) => expectedInputToken(row.input)),
    crossMarket: structuredClone(sequence.crossMarket),
    sourceAvailability: {
      regime: sequence.sourceAvailability.regime,
      manifests: sequence.sourceAvailability.manifests,
      failed: sequence.sourceAvailability.failed,
      unmatchedRows: sequence.sourceAvailability.unmatchedRows,
      ambiguousRows: sequence.sourceAvailability.ambiguousRows,
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
      onlyEligibleObservationsExported: true as const,
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
    lineDelta: path.lineDelta,
    firstFairProbabilityDelta: path.firstFairProbabilityDelta,
    holdDelta: path.holdDelta,
    moveCount: path.moveCount,
    reversalCount: path.reversalCount,
    buybackDistance: path.buybackDistance,
    firstEconomicChangeSecondsBeforeCutoff: secondsBefore(cutoff, path.firstEconomicChangeAt),
    lastEconomicChangeSecondsBeforeCutoff: secondsBefore(cutoff, path.lastEconomicChangeAt),
    crossedNflKeyNumbers: [...path.crossedNflKeyNumbers],
    points: path.points.map((point) => ({
      secondsBeforeCutoff: secondsBefore(cutoff, point.availableAt),
      phase: point.phase,
      line: point.line,
      firstPrice: point.firstPrice,
      secondPrice: point.secondPrice,
      firstFairProbability: point.firstFairProbability,
      hold: point.hold,
    })),
  };
}

function contextToken(observation: MarketBrainObservation, cutoffAt: string) {
  return {
    market: observation.market,
    modality: observation.modality,
    provider: observation.source.provider,
    participant: observation.source.participant,
    sourcePrior: observation.sourcePrior,
    observedRole: observation.observedRole,
    secondsBeforeCutoff: secondsBefore(Date.parse(cutoffAt), observation.timing.availableAt),
    availability: observation.availability,
    values: Object.fromEntries(Object.entries(observation.values).map(([key, value]) =>
      [key, numericToken(value)])),
    categorical: Object.fromEntries(Object.entries(observation.categorical)
      .filter(([key]) => !/(?:sha|hash|payload|providerEventId|rawRow)/i.test(key))),
  };
}

function expectedInputToken(input: MarketBrainExpectedInput) {
  return {
    modality: input.modality,
    provider: input.provider,
    participant: input.participant,
    expectation: input.expectation,
    availability: input.availability,
    observed: input.observationIds.length > 0,
    reason: input.reason,
  };
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
