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
  "nfl_market_brain_resolver_features_2026_10_27_r6_fixed_executable_vector" as const;

const nflMarketBrainTrainerInputBrand: unique symbol = Symbol("nflMarketBrainTrainerInput");
export type NflMarketBrainTrainerInput = Readonly<{
  schema: "nfl_market_brain_trainer_input_v1";
  [nflMarketBrainTrainerInputBrand]: true;
} & ReturnType<typeof trainerPayload>>;

const QUOTE_PATH_METRICS = [
  "line_delta_mean", "probability_delta_mean", "hold_delta_mean", "move_count_mean",
  "reversal_mean", "line_buyback_mean", "probability_buyback_mean", "conflict_rate",
  "conflict_count_mean", "first_move_hours", "last_move_hours", "key_crossing_count_mean",
  "first_mover_rate", "professional_source_rate", "leader_rate", "resistor_rate",
  "role_reversal_rate", "line_delta_dispersion", "probability_delta_dispersion",
] as const;

export const NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES = [
  "intercept",
  "prior_margin_mean",
  "prior_total_mean",
  ...(["moneyline", "spread", "total"] as const).flatMap((market) =>
    QUOTE_PATH_METRICS.map((metric) => `${market}_${metric}`)),
  "side_markets_aligned",
  "side_markets_opposed",
  "cross_market_conflicted",
  "source_failure_rate",
  "source_observed_rate",
  "moneyline_identified_split_imbalance",
  "spread_identified_split_imbalance",
  "total_identified_split_imbalance",
  "unpaired_quote_rate",
  "context_unavailable_rate",
  "away_quarterback_observed", "home_quarterback_observed",
  "away_quarterback_unavailable", "home_quarterback_unavailable",
  "away_out_player_count", "home_out_player_count",
  "away_questionable_player_count", "home_questionable_player_count",
  "reportable_player_count", "injury_report_unavailable",
  "temperature_f", "wind_speed_mph", "precipitation_probability", "precipitation_mm",
  "weather_unavailable",
  "aligned_moneyline_probability_delta", "aligned_spread_probability_delta",
  "opposed_moneyline_probability_delta", "opposed_spread_probability_delta",
  "conflicted_moneyline_probability_delta", "conflicted_spread_probability_delta",
  "failure_moneyline_probability_delta", "failure_spread_probability_delta",
  "moneyline_split_price_interaction", "spread_split_price_interaction", "total_split_price_interaction",
] as readonly string[];

export type NflMarketBrainFeatureVector = {
  names: typeof NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES;
  values: number[];
};

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
    sourcePrior: path.sourcePrior,
    directionConflict: path.directionConflict,
    directionConflictCount: path.directionConflictCount,
    firstDirectionConflictSecondsBeforeCutoff: secondsBefore(cutoff, path.firstDirectionConflictAt),
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
    feed: contextFeed(observation.source.feed),
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

export function vectorizeNflMarketBrainTrainerInput(input: NflMarketBrainTrainerInput): NflMarketBrainFeatureVector {
  if (!(nflMarketBrainTrainerInputBrand in input) || input.schema !== "nfl_market_brain_trainer_input_v1") {
    throw new Error("NFL Market Brain vectorizer requires the branded target-safe trainer input.");
  }
  const mean = (values: number[]) => values.length === 0 ? 0 :
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const dispersion = (values: number[]) => {
    if (values.length === 0) return 0;
    const center = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length);
  };
  const pathFeatures = (market: "moneyline" | "spread" | "total") => {
    const rows = input.quotePathTokens.filter((row) => row.market === market);
    const lineDeltas = rows.flatMap((row) => row.lineDelta === null ? [] : [row.lineDelta]);
    const probabilityDeltas = rows.map((row) => row.firstFairProbabilityDelta);
    return [
      mean(lineDeltas),
      mean(probabilityDeltas),
      mean(rows.map((row) => row.holdDelta)),
      mean(rows.map((row) => row.moveCount)),
      mean(rows.map((row) => row.reversalCount)),
      mean(rows.map((row) => row.lineBuybackDistance)),
      mean(rows.map((row) => row.fairProbabilityBuybackDistance)),
      rows.length === 0 ? 0 : rows.filter((row) => row.directionConflict).length / rows.length,
      mean(rows.map((row) => row.directionConflictCount)),
      mean(rows.flatMap((row) => row.firstEconomicChangeSecondsBeforeCutoff === null
        ? [] : [row.firstEconomicChangeSecondsBeforeCutoff / 3_600])),
      mean(rows.flatMap((row) => row.lastEconomicChangeSecondsBeforeCutoff === null
        ? [] : [row.lastEconomicChangeSecondsBeforeCutoff / 3_600])),
      mean(rows.map((row) => row.crossedNflKeyNumbers.length)),
      rows.length === 0 ? 0 : rows.filter((row) => row.wasFirstMover).length / rows.length,
      rows.length === 0 ? 0 : rows.filter((row) => row.sourcePrior === "professional_book").length / rows.length,
      rows.length === 0 ? 0 : rows.filter((row) => row.observedRole === "leader").length / rows.length,
      rows.length === 0 ? 0 : rows.filter((row) => row.observedRole === "resistor").length / rows.length,
      rows.length === 0 ? 0 : rows.filter((row) => row.observedRole === "reversal").length / rows.length,
      dispersion(lineDeltas),
      dispersion(probabilityDeltas),
    ];
  };
  const splitImbalance = (market: "moneyline" | "spread" | "total") => mean(input.contextTokens
    .filter((row) => row.market === market && row.modality === "identified_book_split")
    .flatMap((row) => {
      const value = row.values.first_money_minus_bets_pp;
      return value?.observed === 1 && value.value !== null ? [value.value] : [];
    }));
  const latestAvailability = input.sourceAvailability.snapshots.at(-1);
  const expected = latestAvailability?.targetSafeExpectedInputs ?? input.sourceAvailability.targetSafeExpectedInputs;
  const failures = latestAvailability?.failed ?? input.sourceAvailability.failed;
  const observed = latestAvailability?.observed ?? 0;
  const unpaired = input.contextTokens.filter((row) => row.quotePairStatus === "unpaired_observed_quote").length;
  const contextAvailability = input.contextTokens.filter((row) =>
    row.modality === "availability" || row.modality === "weather");
  const unavailableContext = contextAvailability.filter((row) => row.availability !== "observed").length;
  const latestContext = (feed: string, participant?: string) => input.contextTokens
    .filter((row) => row.feed === feed && (participant === undefined || row.participant === participant))
    .sort((a, b) => (a.availableSecondsBeforeCutoff ?? Number.POSITIVE_INFINITY) -
      (b.availableSecondsBeforeCutoff ?? Number.POSITIVE_INFINITY))[0];
  const qb = (side: "away" | "home") => latestContext("depth_chart", side);
  const injuries = (side: "away" | "home") => input.contextTokens.filter((row) =>
    row.feed === "injury_report_player" && row.participant === side && row.availability === "observed");
  const injuryCount = (side: "away" | "home", pattern: RegExp) => injuries(side).filter((row) =>
    pattern.test(String(row.categorical.status ?? "").toLowerCase())).length;
  const report = latestContext("injury_report");
  const weather = latestContext("venue_forecast");
  const numericValue = (row: typeof weather, key: string) => {
    const value = row?.values[key];
    return value?.observed === 1 && value.value !== null ? value.value : 0;
  };
  const marketPath = (market: "moneyline" | "spread" | "total") => pathFeatures(market);
  const moneylinePath = marketPath("moneyline");
  const spreadPath = marketPath("spread");
  const totalPath = marketPath("total");
  const mlProbability = moneylinePath[1]!;
  const spreadProbability = spreadPath[1]!;
  const totalProbability = totalPath[1]!;
  const aligned = Number(input.crossMarket.sideRelationship === "aligned");
  const opposed = Number(input.crossMarket.sideRelationship === "opposed");
  const conflicted = Number(input.crossMarket.sideRelationship === "conflicted" ||
    Object.values(input.crossMarket.marketDirection).includes("conflicted"));
  const failureRate = expected === 0 ? 1 : failures / expected;
  const mlSplit = splitImbalance("moneyline");
  const spreadSplit = splitImbalance("spread");
  const totalSplit = splitImbalance("total");
  const values = [
    1,
    input.independentPrior.marginMean,
    input.independentPrior.totalMean,
    ...moneylinePath,
    ...spreadPath,
    ...totalPath,
    aligned,
    opposed,
    conflicted,
    failureRate,
    expected === 0 ? 0 : observed / expected,
    mlSplit,
    spreadSplit,
    totalSplit,
    input.contextTokens.length === 0 ? 0 : unpaired / input.contextTokens.length,
    contextAvailability.length === 0 ? 1 : unavailableContext / contextAvailability.length,
    Number(qb("away")?.availability === "observed"), Number(qb("home")?.availability === "observed"),
    Number(!qb("away") || qb("away")?.availability !== "observed"),
    Number(!qb("home") || qb("home")?.availability !== "observed"),
    injuryCount("away", /^(?:out|injured reserve|ir)$/), injuryCount("home", /^(?:out|injured reserve|ir)$/),
    injuryCount("away", /question|doubt/), injuryCount("home", /question|doubt/),
    numericValue(report, "reportable_players"), Number(!report || report.availability !== "observed"),
    numericValue(weather, "temperature_f"), numericValue(weather, "wind_speed_mph"),
    numericValue(weather, "precipitation_probability"), numericValue(weather, "precipitation_mm"),
    Number(!weather || weather.availability !== "observed"),
    aligned * mlProbability, aligned * spreadProbability,
    opposed * mlProbability, opposed * spreadProbability,
    conflicted * mlProbability, conflicted * spreadProbability,
    failureRate * mlProbability, failureRate * spreadProbability,
    mlSplit * mlProbability, spreadSplit * spreadProbability, totalSplit * totalProbability,
  ];
  if (values.length !== NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error("NFL Market Brain fixed vectorizer emitted an invalid design row.");
  }
  return { names: NFL_MARKET_BRAIN_ORDERED_FEATURE_NAMES, values };
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

function contextFeed(value: string): string {
  return ["depth_chart", "injury_report", "injury_report_player", "venue_forecast", "splits"]
    .includes(value) ? value : "other";
}

function secondsBefore(cutoff: number, value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? (cutoff - parsed) / 1_000 : null;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
