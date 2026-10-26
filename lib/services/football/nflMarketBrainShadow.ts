import {
  MARKET_BRAIN_BLIND_SPOTS,
  buildMarketBrainCaptureOnlyDecision,
  buildMarketBrainCase,
  numericFeature,
  type MarketBrainAvailability,
  type MarketBrainCase,
  type MarketBrainExpectedInput,
  type MarketBrainMarket,
  type MarketBrainObservation,
  type MarketBrainShadowDecision,
  type MarketBrainSourcePrior,
} from "@/lib/services/marketBrain/marketBrainContract";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";
import type { NflForwardContextCapture, NflForwardContextFamily } from "./nflForwardEvidenceCapture";
import {
  NFL_SHARP_API_SPLITS_RELEASE,
  type NflRegularSharpMarket,
  type NflSharpApiSplitSource,
} from "./sharpApiNflSplits";

export const NFL_MARKET_BRAIN_SHADOW_RELEASE =
  "nfl_market_brain_shadow_2026_10_26_r2_observable_tape" as const;

export type NflMarketBrainShadow = {
  release: typeof NFL_MARKET_BRAIN_SHADOW_RELEASE;
  case: MarketBrainCase;
  decision: MarketBrainShadowDecision;
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
 * Builds a point-in-time, raw observable tape. It intentionally performs no
 * directional arbitration and has no production authority.
 */
export function buildNflMarketBrainShadow(args: {
  game: NflPreviewGame;
  capture: NflForwardContextCapture;
  sharpSplitSources: NflSharpApiSplitSource[];
}): NflMarketBrainShadow {
  const observations: MarketBrainObservation[] = [];
  const expectedInputs: MarketBrainExpectedInput[] = [];

  addPrior(args, observations, expectedInputs);
  addContext(args, observations, expectedInputs);
  for (const market of ["moneyline", "spread", "total"] as const) {
    const captured = args.capture.markets[market];
    for (const family of captured.families) addFamily(args, market, family, observations);
    for (const family of unique([...captured.families.map((row) => row[0]), "circa", "pinnacle"])) {
      const rows = observations.filter((row) => row.modality === "price_quote" && row.market === market && row.source.participant === family);
      const ids = rows.map((row) => row.id);
      const current = rows.find((row) => row.categorical.phase === "current");
      expectedInputs.push({
        id: `price:${market}:${family}`,
        modality: "price_quote",
        provider: ["circa", "pinnacle"].includes(family) || captured.families.find((row) => row[0] === family)?.[1] === "s"
          ? "sharpapi" : "balldontlie",
        participant: family,
        expectation: ["circa", "pinnacle"].includes(family) ? "required" : "opportunistic",
        availability: current?.availability ?? "unavailable",
        observationIds: ids,
        reason: ids.length > 0 ? null : "no_complete_quote_pair",
      });
    }
    addPublicSplit(args, market, observations, expectedInputs);
    addSharpSplits(args, market, observations, expectedInputs);
  }

  const marketBrainCase = buildMarketBrainCase({
    sport: "nfl",
    eventId: args.game.providerGameId,
    evaluatedAt: args.capture.capturedAt,
    subject: {
      kind: "two_team_game",
      awayId: args.game.away.abbreviation,
      homeId: args.game.home.abbreviation,
      startsAt: args.game.scheduledStart,
    },
    prior: args.capture.prior.status === "available" && args.capture.prior.outcome
      ? {
          kind: "margin_total_distribution",
          release: args.capture.prior.release,
          marginMean: args.capture.prior.outcome.pmf.margin.mean,
          totalMean: args.capture.prior.outcome.pmf.total.mean,
          marginDistributionSha256: args.capture.prior.outcome.pmf.margin.sha256,
          totalDistributionSha256: args.capture.prior.outcome.pmf.total.sha256,
        }
      : { kind: "unavailable", release: args.capture.prior.release, reason: args.capture.prior.reason },
    observations,
    expectedInputs,
    blindSpots: MARKET_BRAIN_BLIND_SPOTS,
  });
  return {
    release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
    case: marketBrainCase,
    decision: buildMarketBrainCaptureOnlyDecision(marketBrainCase),
  };
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
    const id = `availability:quarterback:${side}`;
    observations.push({
      id, eventId: args.game.providerGameId, sport: "nfl", market: "other", modality: "availability",
      source: { provider: "balldontlie", feed: "depth_chart", participant: side },
      sourcePrior: "context_provider", observedRole: "unknown", observedAt,
      availability, targetRelation: "not_applicable", values: {},
      categorical: { playerId, name, status },
      audit: { sourceRelease: args.capture.release, sourceObservationId: id, notes: [] },
    });
    expectedInputs.push({
      id: `availability:quarterback:${side}`, modality: "availability", provider: "balldontlie", participant: side,
      expectation: "required", availability, observationIds: [id], reason: availability === "observed" ? null : `quarterback_${status}`,
    });
  }

  const [injurySource, reportUpdatedAt, freshness, playerCount] = args.capture.context.injury;
  const injuryObserved = injurySource !== null && reportUpdatedAt !== null;
  const injuryAvailability: MarketBrainAvailability = !injuryObserved ? "unavailable"
    : freshness?.includes("stale") ? "stale" : "observed";
  const injuryId = "availability:injury_report";
  if (injuryObserved) observations.push({
    id: injuryId, eventId: args.game.providerGameId, sport: "nfl", market: "other", modality: "availability",
    source: { provider: injurySource!, feed: "injury_report", participant: null },
    sourcePrior: "context_provider", observedRole: "unknown", observedAt: reportUpdatedAt,
    availability: injuryAvailability, targetRelation: "not_applicable",
    values: { reportable_players: numericFeature(playerCount) },
    categorical: { freshness, rawPayloadSha256: args.capture.context.injurySha256 },
    audit: { sourceRelease: args.capture.release, sourceObservationId: injuryId, notes: ["raw injury payload remains in the sibling forward-evidence field"] },
  });
  expectedInputs.push({
    id: injuryId, modality: "availability", provider: injurySource ?? "balldontlie", participant: null,
    expectation: "required", availability: injuryAvailability,
    observationIds: injuryObserved ? [injuryId] : [], reason: injuryObserved ? null : "injury_report_unavailable",
  });

  const [weatherStatus, weatherObservedAt, weatherHash] = args.capture.context.weather;
  const weatherAvailability: MarketBrainAvailability = weatherStatus === "provider_unavailable" ? "unavailable"
    : weatherStatus === "outside_forecast_window" || weatherStatus === "not_captured_for_unlocked" ? "unsupported"
    : "observed";
  const weatherId = "weather:game";
  if (weatherAvailability !== "unavailable") observations.push({
    id: weatherId, eventId: args.game.providerGameId, sport: "nfl", market: "other", modality: "weather",
    source: { provider: "weather_provider", feed: "venue_forecast", participant: args.game.home.abbreviation },
    sourcePrior: "context_provider", observedRole: "unknown", observedAt: weatherObservedAt,
    availability: weatherAvailability, targetRelation: "not_applicable", values: {},
    categorical: { status: weatherStatus, rawPayloadSha256: weatherHash },
    audit: { sourceRelease: args.capture.release, sourceObservationId: weatherId, notes: ["raw weather payload remains in the sibling forward-evidence field"] },
  });
  expectedInputs.push({
    id: weatherId, modality: "weather", provider: "weather_provider", participant: args.game.home.abbreviation,
    expectation: weatherAvailability === "unsupported" ? "unsupported" : "required",
    availability: weatherAvailability,
    observationIds: weatherAvailability === "unavailable" ? [] : [weatherId],
    reason: weatherAvailability === "observed" ? null : weatherStatus,
  });
}

function addPrior(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  observations: MarketBrainObservation[],
  expectedInputs: MarketBrainExpectedInput[],
) {
  const observed = args.capture.prior.status === "available" && args.capture.prior.outcome !== null;
  const id = `prior:${args.capture.prior.release}`;
  if (observed) observations.push({
    id,
    eventId: args.game.providerGameId,
    sport: "nfl",
    market: "other",
    modality: "model_prior",
    source: { provider: "oddsphere", feed: args.capture.prior.release, participant: null },
    sourcePrior: "independent_model",
    observedRole: "unknown",
    observedAt: args.capture.capturedAt,
    availability: "observed",
    targetRelation: "not_applicable",
    values: {
      margin_mean: numericFeature(args.capture.prior.outcome!.pmf.margin.mean),
      total_mean: numericFeature(args.capture.prior.outcome!.pmf.total.mean),
    },
    categorical: { targetFree: true },
    audit: { sourceRelease: args.capture.prior.release, sourceObservationId: id, notes: [] },
  });
  expectedInputs.push({
    id: "model_prior:target_free",
    modality: "model_prior",
    provider: "oddsphere",
    participant: null,
    expectation: "required",
    availability: observed ? "observed" : "unavailable",
    observationIds: observed ? [id] : [],
    reason: observed ? null : args.capture.prior.reason,
  });
}

function addFamily(
  args: Parameters<typeof buildNflMarketBrainShadow>[0],
  market: NflRegularSharpMarket,
  family: NflForwardContextFamily,
  observations: MarketBrainObservation[],
) {
  const [participant, providerCode, sourceClass, , opening, current] = family;
  const targetRelation = args.capture.markets[market].evaluated?.family === participant ? "evaluated" as const : "target_excluded" as const;
  const sourcePrior: MarketBrainSourcePrior = ["c", "p", "b"].includes(sourceClass) ? "professional_book" : "retail_book";
  const push = (phase: "opening" | "current", point: NonNullable<NflForwardContextFamily[4]>) => {
    const [observedAt, ageMinutes, freshness, line, firstPrice, secondPrice] = point;
    const id = `quote:${market}:${participant}:${phase}:${observedAt}`;
    observations.push({
      id,
      eventId: args.game.providerGameId,
      sport: "nfl",
      market,
      modality: "price_quote",
      source: { provider: providerCode === "s" ? "sharpapi" : "balldontlie", feed: "price", participant },
      sourcePrior,
      observedRole: opening && current[0] !== opening[0] && sameEconomicQuote(opening, current) ? "static" : "unknown",
      observedAt,
      availability: freshness === "f" ? "observed" : freshness === "s" ? "stale" : "future",
      targetRelation,
      values: {
        age_minutes: numericFeature(ageMinutes),
        line: numericFeature(line),
        first_price: numericFeature(firstPrice),
        second_price: numericFeature(secondPrice),
      },
      categorical: {
        phase,
        firstSelection: market === "total" ? "over" : "away",
        secondSelection: market === "total" ? "under" : "home",
        lineConvention: market === "spread" ? "home_line_first_away_line_is_negation" : market === "total" ? "shared_total" : "none",
      },
      audit: { sourceRelease: args.capture.release, sourceObservationId: id, notes: [] },
    });
  };
  if (opening) push("opening", opening);
  push("current", current);
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
    observedAt: split[1],
    availability: "observed",
    targetRelation: "unknown",
    values: splitValues(split[2], split[3], split[4], split[5], split[6]),
    categorical: { denominatorKnown: false, exactLineMatched: false },
    audit: { sourceRelease: args.capture.release, sourceObservationId: id, notes: ["aggregate denominator and exact-line composition are unavailable"] },
  });
  expectedInputs.push({
    id: `public_split:${market}:playbook`, modality: "public_split", provider: "playbook", participant: "aggregate",
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
        observedAt: split.providerFetchedAt ?? split.capturedAt,
        availability: source.status,
        targetRelation: "unknown",
        values: splitValues(null, firstMoney, firstBets, secondMoney, secondBets),
        categorical: {
          firstSelection: market === "total" ? "over" : "away",
          secondSelection: market === "total" ? "under" : "home",
          denominatorKnown: false,
          exactLineMatched: false,
        },
        audit: { sourceRelease: NFL_SHARP_API_SPLITS_RELEASE, sourceObservationId: split.sourceEventId ?? id, notes: source.status === "duplicate" ? ["multiple exact-identity provider rows retained"] : [] },
      });
    });
    expectedInputs.push({
      id: `identified_book_split:${market}:${source.sportsbook}`,
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

function sameEconomicQuote(first: NonNullable<NflForwardContextFamily[4]>, second: NflForwardContextFamily[5]) {
  return first[3] === second[3] && first[4] === second[4] && first[5] === second[5];
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
