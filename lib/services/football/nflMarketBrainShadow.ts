import {
  MARKET_BRAIN_BLIND_SPOTS,
  bindMarketBrainMarginTotalPrior,
  buildMarketBrainCase,
  marketBrainPriorArtifactSha256,
  numericFeature,
  referenceMarketBrainMarginTotalPrior,
  type MarketBrainAvailability,
  type MarketBrainCase,
  type MarketBrainDiscreteDistribution,
  type MarketBrainExpectedInput,
  type MarketBrainMarket,
  type MarketBrainObservation,
  type MarketBrainPrior,
  type MarketBrainSourceManifest,
  type MarketBrainSourcePrior,
} from "@/lib/services/marketBrain/marketBrainContract";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";
import type {
  FootballRawPriceObservation,
  FootballRawPriceResponseManifest,
} from "./footballRawPriceManifest";
import type { NflForwardContextCapture } from "./nflForwardEvidenceCapture";
import type { DailyEdgeGameAvailability } from "@/lib/services/dailyEdge/gameAvailability";
import { marketBrainSha256 } from "@/lib/services/marketBrain/marketBrainCanonical";
import type { NflForwardWeatherSnapshot } from "./nflForwardEvidence";
import {
  NFL_SHARP_API_SPLITS_RELEASE,
  type NflRegularSharpMarket,
  type NflSharpApiSplitCaptureManifest,
  type NflSharpApiSplitSource,
} from "./sharpApiNflSplits";

export const NFL_MARKET_BRAIN_SHADOW_RELEASE =
  "nfl_market_brain_shadow_2026_10_27_r11_full_incumbent_distribution" as const;
export const NFL_MARKET_BRAIN_SHADOW_MAX_BYTES = 96 * 1024;
export const NFL_MARKET_BRAIN_SHADOW_MAX_WEEK_RAW_BYTES = 256 * 1024 * 1024;
export const NFL_MARKET_BRAIN_SHADOW_MAX_REGULAR_SEASON_RAW_BYTES = 5 * 1024 * 1024 * 1024;

export type NflMarketBrainShadow = {
  release: typeof NFL_MARKET_BRAIN_SHADOW_RELEASE;
  case: MarketBrainCase;
  bytes: number;
};

export type NflMarketBrainCaptureFailure = {
  release: typeof NFL_MARKET_BRAIN_SHADOW_RELEASE;
  status: "capture_failed";
  productionApplied: false;
  eventId: string;
  capturedAt: string;
  reason: string;
};

export type NflMarketBrainCaptureResult = NflMarketBrainShadow | NflMarketBrainCaptureFailure;

export function nflMarketBrainCaptureFailure(args: {
  eventId: string;
  capturedAt: string;
  error: unknown;
}): NflMarketBrainCaptureFailure {
  return {
    release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
    status: "capture_failed",
    productionApplied: false,
    eventId: args.eventId,
    capturedAt: args.capturedAt,
    reason: (args.error instanceof Error ? args.error.message : "unknown_market_brain_capture_failure").slice(0, 512),
  };
}

/**
 * Builds a point-in-time tape from raw provider response manifests before the
 * incumbent market-state filters. It intentionally performs no directional
 * arbitration and has no production authority.
 */
export function buildNflMarketBrainShadow(args: {
  game: NflPreviewGame;
  capture: NflForwardContextCapture;
  injuries: DailyEdgeGameAvailability | null;
  weather: NflForwardWeatherSnapshot;
  independentForecast: {
    marginDistribution: MarketBrainDiscreteDistribution;
    totalDistribution: MarketBrainDiscreteDistribution;
  } | null;
  authoritativeForecast: {
    marginDistribution: MarketBrainDiscreteDistribution;
    totalDistribution: MarketBrainDiscreteDistribution;
  };
  /** Intrinsic availability of the independent input, retained across cache reuse. */
  independentForecastAvailableAt: string | null;
  independentForecastProvenance: "fresh" | "stored_cache" | "stored_after_failed_refresh" | "static_artifact" | "unavailable";
  /** Captured after every provider promise used by this tape has settled. */
  retrievalCompletedAt: string;
  knownPriorArtifactSha256: string[];
  rawPriceResponseManifests: FootballRawPriceResponseManifest[];
  sharpSplitSources: NflSharpApiSplitSource[];
  sharpSplitCaptureManifest: NflSharpApiSplitCaptureManifest;
}): NflMarketBrainShadow {
  const observations: MarketBrainObservation[] = [];
  const expectedInputs: MarketBrainExpectedInput[] = [];
  const prior = capturedPrior(args);

  addPrior(args, prior, observations, expectedInputs);
  addContext(args, observations, expectedInputs);
  const sourceManifests = addRawPrices(args, observations);
  for (const market of ["moneyline", "spread", "total"] as const) {
    const sources = unique([
      ...args.rawPriceResponseManifests.flatMap((manifest) =>
        (manifest.observationsByGame[args.game.providerGameId] ?? []).map((row) =>
          `${row.provider}:${canonical(row.sportsbook)}`)),
      "sharpapi:circa",
      "sharpapi:pinnacle",
    ]);
    for (const source of sources) {
      const [sourceProvider, family] = source.split(":") as [string, string];
      const rows = observations.filter((row) => row.modality === "price_quote" && row.market === market &&
        row.source.provider === sourceProvider && row.source.participant === family);
      const ids = rows.map((row) => row.id);
      const current = rows.filter((row) => row.categorical.phase === "current");
      const availability = current.some((row) => row.availability === "observed") ? "observed" as const
        : current.some((row) => row.availability === "future") ? "future" as const
        : current.some((row) => row.availability === "stale") ? "stale" as const
        : current.length > 0 ? "incomplete" as const : "unavailable" as const;
      expectedInputs.push({
        id: `price:${market}:${sourceProvider}:${family}`,
        market,
        modality: "price_quote",
        provider: sourceProvider,
        participant: family,
        expectation: ["circa", "pinnacle"].includes(family) ? "required" : "opportunistic",
        availability,
        observationIds: ids,
        reason: ids.length > 0 ? null : "provider_source_unavailable",
      });
    }
    addPublicSplit(args, market, observations, expectedInputs);
    addSharpSplits(args, market, observations, expectedInputs);
  }
  sourceManifests.push(sharpSplitManifest(args, observations));

  const marketBrainCase = buildMarketBrainCase({
    sport: "nfl",
    eventId: args.game.providerGameId,
    evaluatedAt: tapeIngestedAt(args),
    captureBoundary: "raw_provider_response",
    captureLimitations: [
      "provider_responses_are_bounded_to_the_rows_and_pagination_exposed_by_each_feed",
      "provider_suspension_transitions_and_private_order_flow_are_not_exposed",
    ],
    subject: {
      kind: "two_team_game",
      awayId: args.game.away.abbreviation,
      homeId: args.game.home.abbreviation,
      startsAt: args.game.scheduledStart,
    },
    prior,
    incumbentComparator: {
      kind: "released_semantic_reader",
      availableAt: tapeIngestedAt(args),
      releases: {
        model: args.capture.releases.model,
        calibration: args.capture.releases.calibration,
        decision: args.capture.releases.decision,
      },
      awayWinProbability: args.capture.authoritative.win[0],
      homeWinProbability: args.capture.authoritative.win[1],
      tieProbability: args.capture.authoritative.win[2],
      marginMean: args.capture.authoritative.expected[1] - args.capture.authoritative.expected[0],
      totalMean: args.capture.authoritative.expected[1] + args.capture.authoritative.expected[0],
      marginDistribution: structuredClone(args.authoritativeForecast.marginDistribution),
      totalDistribution: structuredClone(args.authoritativeForecast.totalDistribution),
      marginDistributionSha256: marketBrainSha256(args.authoritativeForecast.marginDistribution),
      totalDistributionSha256: marketBrainSha256(args.authoritativeForecast.totalDistribution),
    },
    evaluatedTargets: Object.fromEntries(
      (["moneyline", "spread", "total"] as const).flatMap((market) => {
        const target = args.capture.markets[market].evaluated;
        return target ? [[market, {
          identity: target.identity,
          family: target.family,
          selection: target.side === "a" ? "away" : target.side === "h" ? "home" : target.side === "o" ? "over" : "under",
          line: target.line,
          price: target.price,
          observedAt: target.observedAt,
        }]] : [];
      }),
    ),
    observations,
    sourceManifests,
    expectedInputs,
    blindSpots: MARKET_BRAIN_BLIND_SPOTS,
  });
  const result: NflMarketBrainShadow = {
    release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
    case: marketBrainCase,
    bytes: 0,
  };
  for (let prior = -1; prior !== result.bytes;) {
    prior = result.bytes;
    result.bytes = byteLength(result);
  }
  if (result.bytes > NFL_MARKET_BRAIN_SHADOW_MAX_BYTES) {
    throw new Error(`NFL Market Brain tape exceeded ${NFL_MARKET_BRAIN_SHADOW_MAX_BYTES} bytes.`);
  }
  return result;
}

function sharpSplitManifest(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  observations: MarketBrainObservation[],
): MarketBrainSourceManifest {
  const manifest = args.sharpSplitCaptureManifest;
  const eventRows = manifest.rows.filter((row) => row.providerGameId === args.game.providerGameId);
  const retainedObservationIds = observations
    .filter((row) => row.source.provider === "sharpapi" && row.source.feed === "splits")
    .map((row) => row.id);
  return {
    id: "source:sharpapi:splits:all_books",
    provider: "sharpapi",
    feed: "splits",
    participant: null,
    providerFetchedAt: args.capture.capturedAt,
    receivedAt: manifest.responseReceivedAt,
    rawResponseSha256: manifest.rawResponseSha256,
    returnedRows: manifest.returnedRows,
    matchedRows: manifest.matchedRows,
    unmatchedRows: manifest.unmatchedRows,
    ambiguousRows: manifest.ambiguousRows,
    ledgerScope: "event_rows_with_response_digest",
    ledgerRows: eventRows.length,
    omittedRows: manifest.returnedRows - eventRows.length,
    rows: eventRows.map((row, index) => ({
      ...row,
      retainedObservationIds: index === 0 ? retainedObservationIds : [],
    })),
    retainedObservationIds,
    status: manifest.status,
    failureReason: manifest.failureReason,
  };
}

function capturedPrior(args: Parameters<typeof buildNflMarketBrainShadow>[0]) {
  if (args.capture.prior.status === "unavailable") {
    return { kind: "unavailable" as const, release: args.capture.prior.release, reason: args.capture.prior.reason };
  }
  if (!args.capture.prior.outcome || !args.independentForecast) {
    throw new Error("NFL Market Brain available prior is missing its exact distribution artifact.");
  }
  const exact = exactPrior(args);
  return args.knownPriorArtifactSha256.includes(exact.artifact.sha256)
    ? referenceMarketBrainMarginTotalPrior(exact)
    : exact;
}

function exactPrior(args: Parameters<typeof buildNflMarketBrainShadow>[0]) {
  const expected = args.capture.prior.outcome;
  if (!expected || !args.independentForecast) throw new Error("NFL Market Brain exact prior artifact is unavailable.");
  const prior = bindMarketBrainMarginTotalPrior({
    eventId: args.game.providerGameId,
    release: args.capture.prior.release,
    availableAt: requiredPriorAvailableAt(args),
    marginDistribution: args.independentForecast.marginDistribution,
    totalDistribution: args.independentForecast.totalDistribution,
  });
  // The authoritative forward-context summary predates Market Brain and uses
  // its frozen JSON serialization. Verify compatibility at that boundary,
  // while the research artifact itself uses canonical content addresses.
  if (legacyDistributionSha256(prior.artifact.marginDistribution) !== expected.pmf.margin.sha256 ||
    legacyDistributionSha256(prior.artifact.totalDistribution) !== expected.pmf.total.sha256 ||
    Math.abs(prior.marginMean - expected.pmf.margin.mean) > 1e-9 ||
    Math.abs(prior.totalMean - expected.pmf.total.mean) > 1e-9) {
    throw new Error("NFL Market Brain exact prior diverged from the captured prior summary.");
  }
  return prior;
}

function legacyDistributionSha256(distribution: MarketBrainDiscreteDistribution): string {
  return createHash("sha256").update(JSON.stringify(distribution)).digest("hex");
}

function addContext(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  observations: MarketBrainObservation[],
  expectedInputs: MarketBrainExpectedInput[],
) {
  for (const side of ["away", "home"] as const) {
    const [playerId, name, status, observedAt] = args.capture.context.quarterbacks[side];
    const availability: MarketBrainAvailability = playerId || name
      ? status === "unknown" ? "incomplete" : "observed"
      : "unavailable";
    const id = `availability:quarterback:${side}:${observedAt ?? tapeIngestedAt(args)}:${status}:${playerId ?? "unknown"}`;
    observations.push({
      id, eventId: args.game.providerGameId, sport: "nfl", market: "other", modality: "availability",
      source: { provider: "balldontlie", feed: "depth_chart", participant: side },
      sourcePrior: "context_provider", observedRole: "unknown", observedAt,
      timing: timing(observedAt, observedAt, tapeIngestedAt(args)),
      availability, targetRelation: "not_applicable", values: {},
      categorical: { playerId, name, status },
      audit: {
        sourceRelease: args.capture.release,
        sourceObservationId: `${id}:${observedAt}:${playerId ?? "unknown"}:${status}`,
        notes: [],
      },
    });
    expectedInputs.push({
      id: `availability:quarterback:${side}`, market: "other", modality: "availability", provider: "balldontlie", participant: side,
      expectation: "required", availability, observationIds: [id], reason: availability === "observed" ? null : `quarterback_${status}`,
    });
  }

  const [injurySource, reportUpdatedAt, freshness, playerCount] = args.capture.context.injury;
  const injuryObserved = injurySource !== null && reportUpdatedAt !== null;
  const injuryAvailability: MarketBrainAvailability = !injuryObserved ? "unavailable"
    : freshness?.includes("stale") ? "stale" : "observed";
  const injuryId = `availability:injury_report:${reportUpdatedAt ?? tapeIngestedAt(args)}:${
    args.capture.context.injurySha256 ?? "no_hash"}`;
  if (injuryObserved) observations.push({
    id: injuryId, eventId: args.game.providerGameId, sport: "nfl", market: "other", modality: "availability",
    source: { provider: injurySource!, feed: "injury_report", participant: null },
    sourcePrior: "context_provider", observedRole: "unknown", observedAt: reportUpdatedAt,
    timing: timing(reportUpdatedAt, null, tapeIngestedAt(args)),
    availability: injuryAvailability, targetRelation: "not_applicable",
    values: { reportable_players: numericFeature(playerCount) },
    categorical: { freshness, rawPayloadSha256: args.capture.context.injurySha256 },
    audit: {
      sourceRelease: args.capture.release,
      sourceObservationId: `${injuryId}:${reportUpdatedAt}:${args.capture.context.injurySha256 ?? "no_hash"}`,
      notes: [],
    },
  });
  expectedInputs.push({
    id: "availability:injury_report", market: "other", modality: "availability", provider: injurySource ?? "balldontlie", participant: null,
    expectation: "required", availability: injuryAvailability,
    observationIds: injuryObserved ? [injuryId] : [], reason: injuryObserved ? null : "injury_report_unavailable",
  });
  for (const [teamIndex, team] of (args.injuries?.teams ?? []).entries()) {
    const side = team.abbreviation === args.game.away.abbreviation ? "away"
      : team.abbreviation === args.game.home.abbreviation ? "home" : "unknown";
    for (const [playerIndex, player] of team.players.entries()) {
      const observedAt = player.reportedAt ?? reportUpdatedAt;
      const availability: MarketBrainAvailability = observedAt !== null &&
        Date.parse(observedAt) > Date.parse(tapeIngestedAt(args)) ? "future" : injuryAvailability;
      const playerId = `availability:injury:${canonical(team.abbreviation)}:${canonical(player.name)}:${teamIndex}:${playerIndex}:${
        observedAt ?? tapeIngestedAt(args)}:${canonical(player.status)}`;
      observations.push({
        id: playerId,
        eventId: args.game.providerGameId,
        sport: "nfl",
        market: "other",
        modality: "availability",
        source: { provider: args.injuries!.source, feed: "injury_report_player", participant: side },
        sourcePrior: "context_provider",
        observedRole: "unknown",
        observedAt,
        timing: timing(observedAt, null, tapeIngestedAt(args)),
        availability,
        targetRelation: "not_applicable",
        values: {},
        categorical: {
          teamSide: side,
          playerName: player.name,
          status: player.status,
          position: player.position,
          detail: player.detail,
        },
        audit: {
          sourceRelease: args.capture.release,
          sourceObservationId: `${playerId}:${observedAt ?? "unknown"}:${player.status}`,
          notes: [],
        },
      });
    }
  }

  const [weatherStatus, weatherObservedAt, weatherHash] = args.capture.context.weather;
  const weatherFetchedAt = args.weather.forecast?.fetched_at ?? weatherObservedAt;
  const weatherAvailability: MarketBrainAvailability = weatherStatus === "provider_unavailable" ? "unavailable"
    : weatherStatus === "outside_forecast_window" || weatherStatus === "not_captured_for_unlocked" ? "unsupported"
    : "observed";
  const weatherId = `weather:game:${weatherFetchedAt ?? tapeIngestedAt(args)}:${weatherHash ?? "no_hash"}`;
  if (weatherAvailability !== "unavailable") observations.push({
    id: weatherId, eventId: args.game.providerGameId, sport: "nfl", market: "other", modality: "weather",
    source: { provider: "weather_provider", feed: "venue_forecast", participant: "home" },
    sourcePrior: "context_provider", observedRole: "unknown", observedAt: weatherFetchedAt,
    timing: timing(weatherFetchedAt, weatherFetchedAt, tapeIngestedAt(args)),
    availability: weatherAvailability, targetRelation: "not_applicable",
    values: {
      temperature_f: numericFeature(args.weather.forecast?.temperature_f),
      feels_like_f: numericFeature(args.weather.forecast?.feels_like_f),
      humidity_pct: numericFeature(args.weather.forecast?.humidity_pct),
      precipitation_mm: numericFeature(args.weather.forecast?.precipitation_mm),
      precipitation_probability: numericFeature(args.weather.forecast?.precipitation_probability),
      wind_speed_mph: numericFeature(args.weather.forecast?.wind_speed_mph),
      wind_direction_degrees: numericFeature(args.weather.forecast?.wind_direction_degrees),
    },
    categorical: {
      status: weatherStatus,
      roofType: args.weather.roofType,
      conditions: args.weather.forecast?.conditions ?? null,
      forecastFor: args.weather.forecast?.forecast_for ?? null,
      rawPayloadSha256: weatherHash,
    },
    audit: {
      sourceRelease: args.capture.release,
      sourceObservationId: `${weatherId}:${weatherFetchedAt}:${weatherHash}`,
      notes: [],
    },
  });
  expectedInputs.push({
    id: "weather:game", market: "other", modality: "weather", provider: "weather_provider", participant: "home",
    expectation: weatherAvailability === "unsupported" ? "unsupported" : "required",
    availability: weatherAvailability,
    observationIds: weatherAvailability === "unavailable" ? [] : [weatherId],
    reason: weatherAvailability === "observed" ? null : weatherStatus,
  });
}

function addPrior(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  prior: MarketBrainPrior,
  observations: MarketBrainObservation[],
  expectedInputs: MarketBrainExpectedInput[],
) {
  const artifactSha256 = marketBrainPriorArtifactSha256(prior);
  const observed = artifactSha256 !== null;
  const id = `prior:${args.capture.prior.release}:${artifactSha256 ?? "unavailable"}`;
  if (observed) observations.push({
    id,
    eventId: args.game.providerGameId,
    sport: "nfl",
    market: "other",
    modality: "model_prior",
    source: { provider: "oddsphere", feed: args.capture.prior.release, participant: null },
    sourcePrior: "independent_model",
    observedRole: "unknown",
    observedAt: null,
    timing: timing(null, null, tapeIngestedAt(args)),
    availability: "observed",
    targetRelation: "not_applicable",
    values: {
      margin_mean: numericFeature(prior.kind === "margin_total_distribution" || prior.kind === "margin_total_distribution_ref" ? prior.marginMean : null),
      total_mean: numericFeature(prior.kind === "margin_total_distribution" || prior.kind === "margin_total_distribution_ref" ? prior.totalMean : null),
    },
    categorical: {
      targetFree: true,
      artifactSha256,
      provenance: args.independentForecastProvenance,
    },
    audit: {
      sourceRelease: args.capture.prior.release,
      sourceObservationId: `${id}:${tapeIngestedAt(args)}:${args.independentForecastProvenance}`,
      notes: [],
    },
  });
  expectedInputs.push({
    id: "model_prior:target_free",
    market: "other",
    modality: "model_prior",
    provider: "oddsphere",
    participant: null,
    expectation: "required",
    availability: observed ? "observed" : "unavailable",
    observationIds: observed ? [id] : [],
    reason: observed ? null : args.capture.prior.reason,
  });
}

function addRawPrices(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  observations: MarketBrainObservation[],
): MarketBrainSourceManifest[] {
  return args.rawPriceResponseManifests.map((manifest, manifestIndex) => {
    const retainedObservationIds: string[] = [];
    const caseIdBySourceId = new Map<string, string>();
    for (const raw of manifest.observationsByGame[args.game.providerGameId] ?? []) {
      const id = `quote:${raw.provider}:${raw.feed}:${raw.sourceObservationId}`;
      retainedObservationIds.push(id);
      caseIdBySourceId.set(raw.sourceObservationId, id);
      observations.push(rawPriceObservation(args, raw, id));
    }
    const eventRows = manifest.rows.filter((row) => row.providerGameId === args.game.providerGameId);
    return {
      id: `source:${manifest.provider}:${manifest.feed}:${canonical(manifest.participant)}:${manifestIndex}`,
      provider: manifest.provider,
      feed: manifest.feed,
      participant: manifest.participant === null ? null : canonical(manifest.participant),
      providerFetchedAt: manifest.providerFetchedAt,
      receivedAt: args.retrievalCompletedAt,
      rawResponseSha256: manifest.rawResponseSha256,
      returnedRows: manifest.returnedRows,
      matchedRows: manifest.matchedRows,
      unmatchedRows: manifest.unmatchedRows,
      ambiguousRows: manifest.ambiguousRows,
      ledgerScope: "event_rows_with_response_digest",
      ledgerRows: eventRows.length,
      omittedRows: manifest.returnedRows - eventRows.length,
      rows: eventRows.map((row) => ({
        rowIndex: row.rowIndex,
        rawRowSha256: row.rawRowSha256,
        disposition: row.disposition,
        providerGameId: row.providerGameId,
        retainedObservationIds: row.sourceObservationIds.flatMap((sourceId) => {
          const caseId = caseIdBySourceId.get(sourceId);
          return caseId ? [caseId] : [];
        }),
      })),
      retainedObservationIds,
      status: manifest.failed ? "failed" : "observed",
      failureReason: manifest.failureReason,
    };
  });
}

function rawPriceObservation(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  raw: FootballRawPriceObservation,
  id: string,
): MarketBrainObservation {
  const participant = canonical(raw.sportsbook);
  const evaluated = args.capture.markets[raw.market].evaluated;
  const sameFamily = evaluated !== null && evaluated.family === participant;
  const exactEvaluated = sameFamily && evaluated !== null &&
    evaluated.side === canonicalSide(raw.selection) &&
    lineEqual(evaluated.line, raw.line) &&
    evaluated.price === raw.price &&
    evaluated.observedAt === raw.providerObservedAt;
  const availability: MarketBrainAvailability = raw.providerObservedAt !== null &&
    Date.parse(raw.providerObservedAt) > Date.parse(tapeIngestedAt(args))
    ? "future"
    : raw.status;
  const sourcePrior: MarketBrainSourcePrior = ["circa", "pinnacle", "bookmaker"].includes(participant)
    ? "professional_book" : "retail_book";
  return {
    id,
    eventId: args.game.providerGameId,
    sport: "nfl",
    market: raw.market,
    modality: "price_quote",
    source: { provider: raw.provider, feed: raw.feed, participant },
    sourcePrior,
    observedRole: "unknown",
    observedAt: raw.providerObservedAt,
    timing: timing(raw.providerObservedAt, raw.providerFetchedAt, tapeIngestedAt(args)),
    availability,
    targetRelation: exactEvaluated ? "evaluated" : sameFamily ? "same_family_as_evaluated" : "target_excluded",
    values: {
      line: numericFeature(raw.line),
      price: numericFeature(raw.price),
    },
    categorical: {
      phase: raw.phase,
      providerEventId: raw.providerEventId,
      selection: raw.selection,
      rawRowSha256: raw.rawRowSha256,
      rawStatus: raw.status,
    },
    audit: {
      sourceRelease: raw.provider === "sharpapi" ? "sharpapi_raw_response" : "balldontlie_raw_response",
      sourceObservationId: raw.sourceObservationId,
      notes: [...raw.notes],
    },
  };
}

function addPublicSplit(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  market: NflRegularSharpMarket,
  observations: MarketBrainObservation[],
  expectedInputs: MarketBrainExpectedInput[],
) {
  const split = args.capture.markets[market].public;
  const id = `split:playbook:${market}`;
  if (split) observations.push({
    id,
    eventId: args.game.providerGameId,
    sport: "nfl",
    market,
    modality: "public_split",
    source: { provider: "playbook", feed: "aggregate_splits", participant: "aggregate" },
    sourcePrior: "public_aggregate",
    observedRole: "unknown",
    observedAt: null,
    timing: timing(null, split[1], tapeIngestedAt(args)),
    availability: "observed",
    targetRelation: "unknown",
    values: splitValues(split[2], split[3], split[4], split[5], split[6]),
    categorical: { denominatorKnown: false, exactLineMatched: null },
    audit: {
      sourceRelease: args.capture.release,
      sourceObservationId: `${id}:${split[1]}:${split.slice(2).join(":")}`,
      notes: ["aggregate denominator and exact-line composition are unavailable"],
    },
  });
  expectedInputs.push({
    id: `public_split:${market}:playbook`, market, modality: "public_split", provider: "playbook", participant: "aggregate",
    expectation: "opportunistic", availability: split ? "observed" : "unavailable",
    observationIds: split ? [id] : [], reason: split ? null : "provider_row_unavailable",
  });
}

function addSharpSplits(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  market: NflRegularSharpMarket,
  observations: MarketBrainObservation[],
  expectedInputs: MarketBrainExpectedInput[],
) {
  for (const source of args.sharpSplitSources) {
    const ids: string[] = [];
    source.observations.forEach((set, index) => {
      const split = set[market];
      const id = `split:sharpapi:${source.sportsbook}:${market}:${index}`;
      ids.push(id);
      const firstMoney = market === "total" ? split.overMoneyPct : split.awayMoneyPct;
      const firstBets = market === "total" ? split.overBetsPct : split.awayBetsPct;
      const secondMoney = market === "total" ? split.underMoneyPct : split.homeMoneyPct;
      const secondBets = market === "total" ? split.underBetsPct : split.homeBetsPct;
      observations.push({
        id,
        eventId: args.game.providerGameId,
        sport: "nfl",
        market,
        modality: "identified_book_split",
        source: { provider: "sharpapi", feed: "splits", participant: source.sportsbook },
        sourcePrior: source.sportsbook === "circa" ? "professional_book" : "retail_book",
        observedRole: "unknown",
        observedAt: null,
        timing: timing(null, split.providerFetchedAt, tapeIngestedAt(args)),
        availability: source.status,
        targetRelation: "unknown",
        values: splitValues(null, firstMoney, firstBets, secondMoney, secondBets),
        categorical: {
          firstSelection: market === "total" ? "over" : "away",
          secondSelection: market === "total" ? "under" : "home",
          denominatorKnown: false,
          exactLineMatched: null,
        },
        audit: {
          sourceRelease: NFL_SHARP_API_SPLITS_RELEASE,
          sourceObservationId: `${split.sourceEventId ?? id}:${market}:${split.providerFetchedAt}:${split.capturedAt}:${index}`,
          notes: source.status === "duplicate" ? ["multiple exact-identity provider rows retained"] : [],
        },
      });
    });
    expectedInputs.push({
      id: `identified_book_split:${market}:${source.sportsbook}`,
      market,
      modality: "identified_book_split",
      provider: "sharpapi",
      participant: source.sportsbook,
      expectation: "opportunistic",
      availability: source.status,
      observationIds: ids,
      reason: source.status === "observed" ? null : `source_${source.status}`,
    });
  }
}

function splitValues(booksUsed: number | null, firstMoney: number | null, firstBets: number | null, secondMoney: number | null, secondBets: number | null) {
  return {
    books_used: numericFeature(booksUsed),
    first_money_pct: numericFeature(firstMoney),
    first_bets_pct: numericFeature(firstBets),
    second_money_pct: numericFeature(secondMoney),
    second_bets_pct: numericFeature(secondBets),
    first_money_minus_bets_pp: numericFeature(firstMoney !== null && firstBets !== null ? firstMoney - firstBets : null),
  };
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function canonical(value: string | null) { return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") || "unknown"; }
function canonicalSide(selection: FootballRawPriceObservation["selection"]): "a" | "h" | "o" | "u" {
  return selection === "away" ? "a" : selection === "home" ? "h" : selection === "over" ? "o" : "u";
}
function lineEqual(first: number | null, second: number | null) {
  return first === null || second === null ? first === second : Math.abs(first - second) < 0.001;
}
function timing(providerObservedAt: string | null, providerFetchedAt: string | null, ingestedAt: string) {
  return { providerObservedAt, providerFetchedAt, ingestedAt, availableAt: ingestedAt };
}
function tapeIngestedAt(args: Parameters<typeof buildNflMarketBrainShadow>[0]): string {
  return [args.capture.capturedAt, args.retrievalCompletedAt,
    ...args.rawPriceResponseManifests.map((manifest) => manifest.providerFetchedAt)]
    .reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}
function requiredPriorAvailableAt(args: Parameters<typeof buildNflMarketBrainShadow>[0]): string {
  const value = args.independentForecastAvailableAt;
  if (value === null || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.parse(tapeIngestedAt(args))) {
    throw new Error("NFL Market Brain independent prior availability is invalid.");
  }
  return new Date(Date.parse(value)).toISOString();
}
function byteLength(value: unknown) { return Buffer.byteLength(JSON.stringify(value)); }
import { createHash } from "node:crypto";
