import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const SHARPAPI_DIAGNOSTIC_MARKET_KEYS = [
  "pitcher_strikeouts",
  "pitcher_outs",
  "pitcher_hits_allowed",
  "pitcher_earned_runs",
  "hits",
  "total_bases",
  "home_runs",
  "rbis",
  "runs",
  "hits_runs_rbis",
  "singles",
  "doubles",
  "triples",
  "walks",
  "stolen_bases",
  "strikeouts",
  "player_runs",
] as const;

type DiagnosticFetch = typeof fetch;

type ResponseShapeSummary = {
  topLevelType: string;
  topLevelKeys: string[];
  dataType: string;
  dataCount: number | null;
  firstNonSensitiveKeys: string[];
};

type SafeHeaderSummary = Record<string, string>;

type SharpApiDiscoveryProbe = {
  label: string;
  endpointPath: string;
  query: Record<string, string>;
  method: "GET" | "POST";
  httpStatus: number;
  ok: boolean;
  rowCount: number;
  payloadState: SharpApiMarketProbe["payloadState"];
  responseShapeSummary: ResponseShapeSummary;
  safeValueSamples: {
    sports: string[];
    leagues: string[];
    markets: string[];
    books: string[];
    eventIds: string[];
    nextCursor: string | null;
  };
  safeHeaders: SafeHeaderSummary;
  errorDiagnostic: {
    code: string | null;
    details: string | null;
    didYouMean: string | null;
    message: string | null;
  } | null;
};

type SharpApiMarketDiscovery = {
  rawMarket: string;
  normalizedMarket: string;
  source: string;
  category: "team_game" | "pitcher_prop" | "batter_prop" | "alternate_line" | "unknown" | "unsupported";
  rowCount: number;
};

type SharpApiDeepDiscoveryReport = {
  enabled: true;
  maxPages: number;
  maxEvents: number;
  maxMarkets: number;
  referenceEndpoints: SharpApiDiscoveryProbe[];
  accountAndBookFacts: {
    accountEndpointAvailable: boolean;
    usageEndpointAvailable: boolean;
    sportsbookEndpointAvailable: boolean;
    booksFound: string[];
    hardRockFound: boolean;
    selectedOrAvailableBooks: string[];
  };
  sportsDiscovered: string[];
  leaguesDiscovered: string[];
  eventsByFilterVariant: SharpApiDiscoveryProbe[];
  discoveredEventIds: string[];
  eventDetailProbes: SharpApiDiscoveryProbe[];
  eventMarketProbes: SharpApiDiscoveryProbe[];
  eventOddsProbes: SharpApiDiscoveryProbe[];
  globalOddsProbes: SharpApiDiscoveryProbe[];
  bestOddsProbes: SharpApiDiscoveryProbe[];
  comparisonOddsProbes: SharpApiDiscoveryProbe[];
  batchOddsProbes: SharpApiDiscoveryProbe[];
  paginationProbes: SharpApiDiscoveryProbe[];
  marketDiscovery: SharpApiMarketDiscovery[];
  discoveredMarketKeys: {
    all: string[];
    teamGame: string[];
    pitcherProps: string[];
    batterProps: string[];
    alternateLines: string[];
    unknown: string[];
  };
  endpointComparison: {
    oddsEventIdRows: number;
    oddsEventRows: number;
    eventOddsRows: number;
    eventMarketsRows: number;
    eventIdParamLikelyWrong: boolean;
    eventParamLikelyCorrect: boolean;
    eventOddsEndpointLikelyRequired: boolean;
    eventMarketsEndpointLikelyRequired: boolean;
  };
  paginationResult: {
    pagesScanned: number;
    totalRows: number;
    nextCursorSeen: boolean;
    stoppedByRowLimit: boolean;
  };
  playerPropsFound: boolean;
  pitcherStrikeoutsFound: boolean;
  pitcherOutsFound: boolean;
  hardRockFound: boolean;
  preciseBlockerClassification:
    | "WRONG_EVENT_FILTER_PARAM_CONFIRMED"
    | "EVENT_ODDS_ENDPOINT_REQUIRED"
    | "EVENT_MARKETS_ENDPOINT_REQUIRED"
    | "PAGINATION_MISSED_ROWS"
    | "MARKET_DISCOVERY_REQUIRED"
    | "MARKET_KEYS_DIFFER_FROM_ASSUMED"
    | "SPORT_LEAGUE_FILTER_MISMATCH"
    | "ACCOUNT_BOOK_SELECTION_LIMITATION"
    | "ACCOUNT_TIER_LIMITATION"
    | "PROPS_NOT_IN_CURRENT_WINDOW"
    | "PROVIDER_PROPS_EMPTY_AFTER_DEEP_DISCOVERY"
    | "UNKNOWN";
  recommendedAction: string;
};

export type SharpApiMarketProbe = {
  eventId: string;
  eventStartTime: string | null;
  eventHomeTeam: string | null;
  eventAwayTeam: string | null;
  leagueFieldPresent: boolean;
  leagueValue: string | null;
  eventStatus: string | null;
  eventMarketsDetected: string[];
  endpointPath: "/odds";
  sportParameter: "mlb";
  marketKey: string;
  httpStatus: number;
  ok: boolean;
  rowCount: number;
  payloadState: "non_empty" | "empty_array" | "missing_data" | "error";
  responseShapeSummary: ResponseShapeSummary;
  booksFound: string[];
  rateLimitHeaders: Record<string, string>;
  errorBodySummary: string | null;
  timestamp: string;
};

export type SharpApiEndpointVariantProbe = {
  variant: "event_id_only" | "event_id_market" | "event_id_market_sport";
  endpointPath: "/odds";
  eventId: string;
  marketKey: string | null;
  httpStatus: number;
  ok: boolean;
  rowCount: number;
  payloadState: SharpApiMarketProbe["payloadState"];
  responseShapeSummary: ResponseShapeSummary;
  rateLimitHeaders: Record<string, string>;
  errorBodySummary: string | null;
  supportStatus: "supported_non_empty" | "supported_empty" | "unsupported_or_error";
};

export type SharpApiEventDiagnosticSummary = {
  eventId: string;
  scheduledStart: string | null;
  eventDate: string | null;
  minutesUntilScheduledStart: number | null;
  timingWindowBucket: string;
  homeTeam: string | null;
  awayTeam: string | null;
  leagueFieldPresent: boolean;
  leagueValue: string | null;
  eventStatus: string | null;
  marketsAdvertised: string[];
  propMarketsAdvertised: string[];
  teamGameMarketsAdvertised: string[];
  onlyTeamGameMarketsAdvertised: boolean;
  marketsQueried: string[];
  marketsWithRows: string[];
  marketsEmpty: string[];
  propsExist: boolean;
  propRowsFound: number;
  pitcherStrikeoutRowsFound: number;
  pitcherOutsRowsFound: number;
  booksFound: string[];
  hardRockFound: boolean;
  rowCountByMarket: Record<string, number>;
  rowCountByBook: Record<string, number>;
  httpStatuses: Record<string, number>;
  firstNonSensitiveResponseKeys: string[];
  payloadStates: Record<string, number>;
};

export type SharpApiAvailabilityReport = {
  provider: "sharpapi";
  date: string;
  outputPath: string;
  discoverMarkets: boolean;
  sweep: boolean;
  datesTested: string[];
  endpointBase: string;
  eventsEndpoint: {
    endpointPath: "/events";
    sportParameter: "mlb";
    httpStatus: number;
    ok: boolean;
    eventCount: number;
    dateMatchedEventCount: number;
    responseShapeSummary: ResponseShapeSummary;
    rateLimitHeaders: Record<string, string>;
    errorBodySummary: string | null;
  };
  eventIdsTested: string[];
  eventCount: number;
  eventsFoundByDate: Record<string, number>;
  marketsFromEvents: string[];
  marketsTested: string[];
  eventSummaries: SharpApiEventDiagnosticSummary[];
  probes: SharpApiMarketProbe[];
  endpointVariantProbes: SharpApiEndpointVariantProbe[];
  summary: {
    providerAvailabilityStatus: "available" | "unavailable" | "request_error" | "no_events";
    eventsFound: number;
    propRowsFound: number;
    totalRequests: number;
    nonEmptyResponses: number;
    emptyResponses: number;
    errorResponses: number;
    propRowsFoundByMarket: Record<string, number>;
    nonEmptyMarkets: string[];
    emptyMarkets: string[];
    marketsWithRows: string[];
    marketsAllEmpty: string[];
    booksFound: string[];
    hardRockFound: boolean;
    likelyCause:
      | "NO_EVENTS"
      | "EVENTS_FOUND_PROPS_EMPTY"
      | "PLAN_ACCESS_POSSIBLE"
      | "TIMING_WINDOW_POSSIBLE"
      | "PROVIDER_COVERAGE_GAP_POSSIBLE"
      | SharpApiDeepDiscoveryReport["preciseBlockerClassification"]
      | "UNKNOWN";
    recommendedAction: string;
    timingGuidance: string[];
    timingWindowReport: {
      generatedAt: string;
      propAvailabilityByPregameWindow: Record<string, { eventCount: number; eventsWithProps: number; propRowsFound: number }>;
      propRowsFoundByBook: Record<string, number>;
      propsFoundOnlyForBooks: string[];
      propsFoundOnlyWithinPregameWindow: string | null;
    };
    blockerReason: "NO_MLB_EVENTS_FOUND" | "PROVIDER_PROP_ODDS_UNAVAILABLE" | "PROPS_AVAILABLE" | "PROVIDER_REQUEST_ERRORS";
  };
  supportSummary: {
    accountKeyOmitted: true;
    generatedAt: string;
    dateTested: string;
    datesTested: string[];
    mlbEventsFound: number;
    eventIdsTested: string[];
    marketsTested: string[];
    endpointUsed: string;
    httpStatuses: Record<string, number>;
    rowCounts: {
      byMarket: Record<string, number>;
      byDate: Record<string, number>;
      total: number;
    };
    emptyMarkets: string[];
    nonEmptyMarkets: string[];
    endpointVariantsTested: Array<Pick<SharpApiEndpointVariantProbe, "variant" | "httpStatus" | "rowCount" | "supportStatus">>;
    emptyPayloadExamples: Array<Pick<SharpApiMarketProbe, "eventId" | "marketKey" | "httpStatus" | "payloadState" | "responseShapeSummary">>;
    exampleRedactedRequestPath: string | null;
    expectedMarketsBasedOnPriorContract: string[];
    currentBlocker: string;
    questionListForSharpApi: string[];
  };
  deepDiscovery: SharpApiDeepDiscoveryReport | null;
  writesToSupabase: false;
};

export async function diagnoseSharpApiMlbPropsAvailability(args: {
  date: string;
  discoverMarkets?: boolean;
  sweep?: boolean;
  maxEvents?: number;
  deep?: boolean;
  maxPages?: number;
  maxMarkets?: number;
  outputDir?: string;
  fetchImpl?: DiagnosticFetch;
  baseUrl?: string;
  apiKey?: string;
}): Promise<SharpApiAvailabilityReport> {
  const apiKey = args.apiKey ?? process.env.SHARPAPI_KEY;
  if (!apiKey) throw new Error("SHARPAPI_KEY is required for SharpAPI diagnostics");
  const baseUrl = stripTrailingSlash(args.baseUrl ?? process.env.ODDSPHERE_SHARPAPI_BASE_URL ?? "https://api.sharpapi.io/api/v1");
  const fetchImpl = args.fetchImpl ?? fetch;
  const outputDir = args.outputDir ?? path.join(process.cwd(), "tmp/mlb-props/reports");
  await mkdir(outputDir, { recursive: true });

  const eventsUrl = new URL(`${baseUrl}/events`);
  eventsUrl.searchParams.set("sport", "mlb");
  const eventsResponse = await fetchImpl(eventsUrl, requestHeaders(apiKey));
  const eventsText = await eventsResponse.text();
  const eventsPayload = parseJson(eventsText);
  const allEvents = rowsFromPayload(eventsPayload);
  const mlbEvents = allEvents.filter((event) => !event.league || String(event.league).toLowerCase() === "mlb");
  const dateWindow = args.sweep ? buildDateWindow(args.date) : [args.date];
  const dateEvents = args.sweep
    ? mlbEvents
    : mlbEvents.filter((event) => dateWindow.includes(eventDate(event) ?? ""));
  const selectedEvents = dateEvents.slice(0, args.maxEvents ?? dateEvents.length);
  const datesTested = args.sweep ? sortedUnique([...dateWindow, ...selectedEvents.map((event) => eventDate(event) ?? "").filter(Boolean)]) : [args.date];
  const marketsFromEvents = sortedUnique(dateEvents.flatMap((event) => eventMarkets(event)));
  const marketsToTest = sortedUnique([
    ...SHARPAPI_DIAGNOSTIC_MARKET_KEYS,
    ...(args.discoverMarkets ? marketsFromEvents.filter(isLikelyPlayerMarket) : []),
  ]);

  const probes: SharpApiMarketProbe[] = [];
  for (const event of selectedEvents) {
    const eventId = String(event.id ?? "");
    if (!eventId) continue;
    for (const marketKey of marketsToTest) {
      const oddsUrl = new URL(`${baseUrl}/odds`);
      oddsUrl.searchParams.set("event_id", eventId);
      oddsUrl.searchParams.set("market", marketKey);
      const timestamp = new Date().toISOString();
      const response = await fetchImpl(oddsUrl, requestHeaders(apiKey));
      const text = await response.text();
      const payload = parseJson(text);
      const shape = summarizeShape(payload);
      const rowCount = countRows(payload);
      const booksFound = extractBooks(payload);
      probes.push({
        eventId,
        eventStartTime: stringOrNull(event.start_time ?? event.commence_time ?? event.scheduled),
        eventHomeTeam: eventTeamName(event, "home"),
        eventAwayTeam: eventTeamName(event, "away"),
        leagueFieldPresent: Object.prototype.hasOwnProperty.call(event, "league"),
        leagueValue: stringOrNull(event.league),
        eventStatus: eventStatus(event),
        eventMarketsDetected: eventMarkets(event),
        endpointPath: "/odds",
        sportParameter: "mlb",
        marketKey,
        httpStatus: response.status,
        ok: response.ok,
        rowCount,
        payloadState: response.ok ? payloadState(payload, rowCount) : "error",
        responseShapeSummary: shape,
        booksFound,
        rateLimitHeaders: rateLimitHeaders(response.headers),
        errorBodySummary: response.ok ? null : summarizeErrorBody(text),
        timestamp,
      });
    }
  }
  const endpointVariantProbes = await runEndpointVariantProbes({
    baseUrl,
    apiKey,
    fetchImpl,
    events: selectedEvents.slice(0, Math.min(3, selectedEvents.length)),
    marketsToTest,
  });
  const deepDiscovery = args.deep === true
    ? await runDeepDiscovery({
      baseUrl,
      apiKey,
      fetchImpl,
      date: args.date,
      selectedEvents,
      marketsToTest,
      propRowsFoundInMainProbes: probes.reduce((sum, probe) => sum + probe.rowCount, 0),
      maxPages: args.maxPages ?? 3,
      maxEvents: args.maxEvents ?? 3,
      maxMarkets: args.maxMarkets ?? 12,
    })
    : null;

  const report = buildReport({
    date: args.date,
    outputDir,
    baseUrl,
    discoverMarkets: args.discoverMarkets === true,
    sweep: args.sweep === true,
    datesTested,
    eventsResponse,
    eventsPayload,
    eventsText,
    selectedEvents,
    dateEvents,
    marketsFromEvents,
    marketsToTest,
    probes,
    endpointVariantProbes,
    deepDiscovery,
  });
  await writeFile(report.outputPath, JSON.stringify(report, null, 2));
  return report;
}

export function classifySharpApiAvailability(args: {
  eventCount: number;
  probes: Array<{ ok: boolean; rowCount: number }>;
}): SharpApiAvailabilityReport["summary"]["blockerReason"] {
  if (args.eventCount === 0) return "NO_MLB_EVENTS_FOUND";
  if (args.probes.some((probe) => probe.rowCount > 0)) return "PROPS_AVAILABLE";
  if (args.probes.length > 0 && args.probes.every((probe) => probe.ok)) return "PROVIDER_PROP_ODDS_UNAVAILABLE";
  return "PROVIDER_REQUEST_ERRORS";
}

function buildReport(args: {
  date: string;
  outputDir: string;
  baseUrl: string;
  discoverMarkets: boolean;
  sweep: boolean;
  datesTested: string[];
  eventsResponse: Response;
  eventsPayload: unknown;
  eventsText: string;
  selectedEvents: Array<Record<string, unknown>>;
  dateEvents: Array<Record<string, unknown>>;
  marketsFromEvents: string[];
  marketsToTest: string[];
  probes: SharpApiMarketProbe[];
  endpointVariantProbes: SharpApiEndpointVariantProbe[];
  deepDiscovery: SharpApiDeepDiscoveryReport | null;
}): SharpApiAvailabilityReport {
  const generatedAt = new Date().toISOString();
  const propRowsFoundByMarket: Record<string, number> = {};
  const propRowsFoundByDate: Record<string, number> = {};
  const httpStatuses: Record<string, number> = {};
  const books = new Set<string>();
  for (const probe of args.probes) {
    propRowsFoundByMarket[probe.marketKey] = (propRowsFoundByMarket[probe.marketKey] ?? 0) + probe.rowCount;
    const date = probe.eventStartTime?.slice(0, 10) ?? "unknown";
    propRowsFoundByDate[date] = (propRowsFoundByDate[date] ?? 0) + probe.rowCount;
    httpStatuses[String(probe.httpStatus)] = (httpStatuses[String(probe.httpStatus)] ?? 0) + 1;
    for (const book of probe.booksFound) books.add(book);
  }
  const nonEmptyMarkets = Object.entries(propRowsFoundByMarket).filter(([, count]) => count > 0).map(([market]) => market).sort();
  const emptyMarkets = args.marketsToTest.filter((market) => (propRowsFoundByMarket[market] ?? 0) === 0).sort();
  const blockerReason = classifySharpApiAvailability({ eventCount: args.dateEvents.length, probes: args.probes });
  const outputPath = path.join(args.outputDir, `${args.date}-sharpapi-prop-availability${args.sweep ? "-sweep" : ""}${args.deepDiscovery ? "-deep" : ""}.json`);
  const currentBlocker = blockerMessage(blockerReason);
  const propRowsFound = args.probes.reduce((sum, probe) => sum + probe.rowCount, 0);
  const likelyCause = inferLikelyCause({
    blockerReason,
    marketsFromEvents: args.marketsFromEvents,
    endpointVariantProbes: args.endpointVariantProbes,
    datesTested: args.datesTested,
    propRowsFound,
    deepDiscovery: args.deepDiscovery,
  });

  const eventSummaries = buildEventSummaries(args.selectedEvents, args.probes, args.marketsToTest, generatedAt);
  const timingWindowReport = buildTimingWindowReport(eventSummaries, generatedAt);

  return {
    provider: "sharpapi",
    date: args.date,
    outputPath,
    discoverMarkets: args.discoverMarkets,
    sweep: args.sweep,
    datesTested: args.datesTested,
    endpointBase: args.baseUrl,
    eventsEndpoint: {
      endpointPath: "/events",
      sportParameter: "mlb",
      httpStatus: args.eventsResponse.status,
      ok: args.eventsResponse.ok,
      eventCount: rowsFromPayload(args.eventsPayload).length,
      dateMatchedEventCount: args.dateEvents.length,
      responseShapeSummary: summarizeShape(args.eventsPayload),
      rateLimitHeaders: rateLimitHeaders(args.eventsResponse.headers),
      errorBodySummary: args.eventsResponse.ok ? null : summarizeErrorBody(args.eventsText),
    },
    eventIdsTested: args.selectedEvents.map((event) => String(event.id ?? "")).filter(Boolean),
    eventCount: args.dateEvents.length,
    eventsFoundByDate: countEventsByDate(args.dateEvents),
    marketsFromEvents: args.marketsFromEvents,
    marketsTested: args.marketsToTest,
    eventSummaries,
    probes: args.probes,
    endpointVariantProbes: args.endpointVariantProbes,
    deepDiscovery: args.deepDiscovery,
    summary: {
      providerAvailabilityStatus: providerAvailabilityStatus(blockerReason),
      eventsFound: args.dateEvents.length,
      propRowsFound,
      totalRequests: args.probes.length,
      nonEmptyResponses: args.probes.filter((probe) => probe.rowCount > 0).length,
      emptyResponses: args.probes.filter((probe) => probe.ok && probe.rowCount === 0).length,
      errorResponses: args.probes.filter((probe) => !probe.ok).length,
      propRowsFoundByMarket,
      nonEmptyMarkets,
      emptyMarkets,
      marketsWithRows: nonEmptyMarkets,
      marketsAllEmpty: emptyMarkets,
      booksFound: [...books].sort(),
      hardRockFound: [...books].some((book) => normalizeBook(book) === "hardrock"),
      likelyCause,
      recommendedAction: recommendedAction(likelyCause, blockerReason),
      timingGuidance: timingGuidance({ eventCount: args.dateEvents.length, marketsFromEvents: args.marketsFromEvents, nonEmptyMarkets, probes: args.probes }),
      timingWindowReport,
      blockerReason,
    },
    supportSummary: {
      accountKeyOmitted: true,
      generatedAt,
      dateTested: args.date,
      datesTested: args.datesTested,
      mlbEventsFound: args.dateEvents.length,
      eventIdsTested: args.selectedEvents.map((event) => String(event.id ?? "")).filter(Boolean),
      marketsTested: args.marketsToTest,
      endpointUsed: `${args.baseUrl}/events and ${args.baseUrl}/odds`,
      httpStatuses,
      rowCounts: {
        byMarket: propRowsFoundByMarket,
        byDate: propRowsFoundByDate,
        total: propRowsFound,
      },
      emptyMarkets,
      nonEmptyMarkets,
      endpointVariantsTested: args.endpointVariantProbes.map((probe) => ({
        variant: probe.variant,
        httpStatus: probe.httpStatus,
        rowCount: probe.rowCount,
        supportStatus: probe.supportStatus,
      })),
      emptyPayloadExamples: args.probes
        .filter((probe) => probe.ok && probe.rowCount === 0)
        .slice(0, 5)
        .map((probe) => ({
          eventId: probe.eventId,
          marketKey: probe.marketKey,
          httpStatus: probe.httpStatus,
          payloadState: probe.payloadState,
          responseShapeSummary: probe.responseShapeSummary,
        })),
      exampleRedactedRequestPath: args.selectedEvents[0]?.id ? `/odds?event_id=${String(args.selectedEvents[0].id)}&market=${args.marketsToTest[0] ?? "pitcher_strikeouts"}` : null,
      expectedMarketsBasedOnPriorContract: [...SHARPAPI_DIAGNOSTIC_MARKET_KEYS],
      currentBlocker,
      questionListForSharpApi: [
        "Does this account/plan include MLB player prop odds on /odds?",
        "Are pitcher strikeouts and pitcher outs exposed through these market keys or different keys?",
        "Should /odds be queried with event, event_id, market, sport, or another parameter combination?",
        "Should event odds be fetched from /events/:eventId/odds or another event-scoped endpoint?",
        "Which /markets keys correspond to MLB pitcher strikeouts and pitcher outs?",
        "Are historical MLB events/prop odds available through /events and /odds?",
        "What timing window should we expect for MLB player props before game start?",
        "Should Hard Rock player prop odds appear in this endpoint for MLB when available?",
      ],
    },
    writesToSupabase: false,
  };
}

async function runEndpointVariantProbes(args: {
  baseUrl: string;
  apiKey: string;
  fetchImpl: DiagnosticFetch;
  events: Array<Record<string, unknown>>;
  marketsToTest: string[];
}): Promise<SharpApiEndpointVariantProbe[]> {
  const probes: SharpApiEndpointVariantProbe[] = [];
  const marketKey = args.marketsToTest[0] ?? "pitcher_strikeouts";
  for (const event of args.events) {
    const eventId = String(event.id ?? "");
    if (!eventId) continue;
    const variants: Array<{ variant: SharpApiEndpointVariantProbe["variant"]; marketKey: string | null; params: Record<string, string> }> = [
      { variant: "event_id_only", marketKey: null, params: { event_id: eventId } },
      { variant: "event_id_market", marketKey, params: { event_id: eventId, market: marketKey } },
      { variant: "event_id_market_sport", marketKey, params: { event_id: eventId, market: marketKey, sport: "mlb" } },
    ];
    for (const variant of variants) {
      const url = new URL(`${args.baseUrl}/odds`);
      for (const [key, value] of Object.entries(variant.params)) url.searchParams.set(key, value);
      const response = await args.fetchImpl(url, requestHeaders(args.apiKey));
      const text = await response.text();
      const payload = parseJson(text);
      const rowCount = countRows(payload);
      probes.push({
        variant: variant.variant,
        endpointPath: "/odds",
        eventId,
        marketKey: variant.marketKey,
        httpStatus: response.status,
        ok: response.ok,
        rowCount,
        payloadState: response.ok ? payloadState(payload, rowCount) : "error",
        responseShapeSummary: summarizeShape(payload),
        rateLimitHeaders: rateLimitHeaders(response.headers),
        errorBodySummary: response.ok ? null : summarizeErrorBody(text),
        supportStatus: response.ok && rowCount > 0 ? "supported_non_empty" : response.ok ? "supported_empty" : "unsupported_or_error",
      });
    }
  }
  return probes;
}

async function runDeepDiscovery(args: {
  baseUrl: string;
  apiKey: string;
  fetchImpl: DiagnosticFetch;
  date: string;
  selectedEvents: Array<Record<string, unknown>>;
  marketsToTest: string[];
  maxPages: number;
  maxEvents: number;
  maxMarkets: number;
  propRowsFoundInMainProbes: number;
}): Promise<SharpApiDeepDiscoveryReport> {
  const referenceEndpoints = await probeMany(args, [
    { label: "sports", endpointPath: "/sports", query: {} },
    { label: "leagues", endpointPath: "/leagues", query: {} },
    { label: "markets", endpointPath: "/markets", query: {} },
    { label: "sportsbooks", endpointPath: "/sportsbooks", query: {} },
    { label: "account", endpointPath: "/account", query: {} },
    { label: "account_usage", endpointPath: "/account/usage", query: {} },
  ]);
  const sportsDiscovered = sortedUnique(referenceEndpoints.flatMap((probe) => extractValuesFromProbe(probe, ["sport", "sport_key", "sport_slug", "key", "slug", "name"])));
  const leaguesDiscovered = sortedUnique(referenceEndpoints.flatMap((probe) => extractValuesFromProbe(probe, ["league", "league_key", "league_slug", "key", "slug", "name"])));
  const referenceMarkets = discoverMarketsFromProbes(referenceEndpoints);
  const sportsBooksProbe = referenceEndpoints.find((probe) => probe.endpointPath === "/sportsbooks");
  const accountProbe = referenceEndpoints.find((probe) => probe.endpointPath === "/account");
  const usageProbe = referenceEndpoints.find((probe) => probe.endpointPath === "/account/usage");
  const booksFound = sortedUnique(referenceEndpoints.flatMap((probe) => extractBookLikeValues(probe)));

  const eventFilterVariants: Array<{ label: string; endpointPath: string; query: Record<string, string> }> = [
    { label: "events_sport_mlb", endpointPath: "/events", query: { sport: "mlb" } },
    { label: "events_sport_baseball", endpointPath: "/events", query: { sport: "baseball" } },
    { label: "events_league_mlb", endpointPath: "/events", query: { league: "mlb" } },
    { label: "events_league_MLB", endpointPath: "/events", query: { league: "MLB" } },
    { label: "events_sport_baseball_league_mlb", endpointPath: "/events", query: { sport: "baseball", league: "mlb" } },
    { label: "events_sport_baseball_league_MLB", endpointPath: "/events", query: { sport: "baseball", league: "MLB" } },
    { label: "events_date_only", endpointPath: "/events", query: { date: args.date } },
  ];
  const eventsByFilterVariant = await probeMany(args, eventFilterVariants);
  const discoveredEvents = sortedUnique([
    ...args.selectedEvents.map((event) => String(event.id ?? "")).filter(Boolean),
    ...eventsByFilterVariant.flatMap((probe) => extractEventIdsFromProbe(probe)),
  ]).slice(0, args.maxEvents);
  const eventDetailProbes = await probeMany(args, discoveredEvents.map((eventId) => ({
    label: `event_detail:${eventId}`,
    endpointPath: `/events/${encodeURIComponent(eventId)}`,
    query: {},
  })));
  const eventMarketProbes = await probeMany(args, discoveredEvents.map((eventId) => ({
    label: `event_markets:${eventId}`,
    endpointPath: `/events/${encodeURIComponent(eventId)}/markets`,
    query: {},
  })));
  const eventOddsProbes = await probeMany(args, discoveredEvents.map((eventId) => ({
    label: `event_odds:${eventId}`,
    endpointPath: `/events/${encodeURIComponent(eventId)}/odds`,
    query: {},
  })));

  const discoveredMarkets = sortedUnique([
    ...referenceMarkets.map((market) => market.normalizedMarket),
    ...discoverMarketsFromProbes(eventMarketProbes).map((market) => market.normalizedMarket),
    ...discoverMarketsFromProbes(eventOddsProbes).map((market) => market.normalizedMarket),
    ...args.marketsToTest,
  ]).slice(0, args.maxMarkets);
  const sampleEvent = discoveredEvents[0] ?? "";
  const sampleMarket = discoveredMarkets.find(isLikelyPlayerMarket) ?? args.marketsToTest[0] ?? "pitcher_strikeouts";
  const discoveredPlayerMarkets = discoveredMarkets
    .filter((market) => {
      const category = classifyDiscoveredMarket(market);
      return category === "pitcher_prop" || category === "batter_prop";
    })
    .slice(0, Math.min(args.maxMarkets, 8));
  const globalOddsVariants: Array<{ label: string; endpointPath: string; query: Record<string, string> }> = [
    { label: "odds_event_id", endpointPath: "/odds", query: sampleEvent ? recordQuery({ event_id: sampleEvent }) : {} },
    { label: "odds_event", endpointPath: "/odds", query: sampleEvent ? recordQuery({ event: sampleEvent }) : {} },
    { label: "odds_event_market", endpointPath: "/odds", query: sampleEvent ? recordQuery({ event: sampleEvent, market: sampleMarket }) : recordQuery({ market: sampleMarket }) },
    { label: "odds_event_market_sport_baseball", endpointPath: "/odds", query: sampleEvent ? recordQuery({ event: sampleEvent, market: sampleMarket, sport: "baseball" }) : recordQuery({ market: sampleMarket, sport: "baseball" }) },
    { label: "odds_league_mlb", endpointPath: "/odds", query: { league: "mlb" } },
    { label: "odds_league_MLB", endpointPath: "/odds", query: { league: "MLB" } },
    { label: "odds_sport_baseball", endpointPath: "/odds", query: { sport: "baseball" } },
    { label: "odds_sport_mlb", endpointPath: "/odds", query: { sport: "mlb" } },
    { label: "odds_sport_baseball_league_mlb", endpointPath: "/odds", query: { sport: "baseball", league: "mlb" } },
    { label: "odds_sport_baseball_league_MLB", endpointPath: "/odds", query: { sport: "baseball", league: "MLB" } },
    { label: "odds_market", endpointPath: "/odds", query: { market: sampleMarket } },
    { label: "odds_market_league_mlb", endpointPath: "/odds", query: { market: sampleMarket, league: "mlb" } },
    { label: "odds_sportsbook_hardrock", endpointPath: "/odds", query: { sportsbook: "hardrock" } },
    { label: "odds_sportsbook_hard_rock", endpointPath: "/odds", query: { sportsbook: "hard_rock" } },
    { label: "odds_sportsbook_hardrockbet", endpointPath: "/odds", query: { sportsbook: "hardrockbet" } },
    { label: "odds_sportsbook_hard-rock-bet", endpointPath: "/odds", query: { sportsbook: "hard-rock-bet" } },
    ...discoveredPlayerMarkets.flatMap((market) => sampleEvent ? [
      { label: `odds_event_id_discovered_market:${market}`, endpointPath: "/odds", query: recordQuery({ event_id: sampleEvent, market }) },
      { label: `odds_event_discovered_market:${market}`, endpointPath: "/odds", query: recordQuery({ event: sampleEvent, market }) },
    ] : [
      { label: `odds_discovered_market:${market}`, endpointPath: "/odds", query: recordQuery({ market }) },
    ]),
  ].filter((variant) => Object.keys(variant.query).length > 0);
  const globalOddsProbes = await probeMany(args, globalOddsVariants);
  const bestOddsVariants: Array<{ label: string; endpointPath: string; query: Record<string, string> }> = [
    { label: "odds_best_event", endpointPath: "/odds/best", query: sampleEvent ? recordQuery({ event: sampleEvent }) : {} },
    { label: "odds_best_event_market", endpointPath: "/odds/best", query: sampleEvent ? recordQuery({ event: sampleEvent, market: sampleMarket }) : recordQuery({ market: sampleMarket }) },
  ];
  const bestOddsProbes = await probeMany(args, bestOddsVariants.filter((variant) => Object.keys(variant.query).length > 0));
  const comparisonOddsVariants: Array<{ label: string; endpointPath: string; query: Record<string, string> }> = [
    { label: "odds_comparison_event", endpointPath: "/odds/comparison", query: sampleEvent ? recordQuery({ event: sampleEvent }) : {} },
    { label: "odds_comparison_event_market", endpointPath: "/odds/comparison", query: sampleEvent ? recordQuery({ event: sampleEvent, market: sampleMarket }) : recordQuery({ market: sampleMarket }) },
  ];
  const comparisonOddsProbes = await probeMany(args, comparisonOddsVariants.filter((variant) => Object.keys(variant.query).length > 0));
  const batchOddsProbes = await probeMany(args, sampleEvent ? [{
    label: "odds_batch_event_market",
    endpointPath: "/odds/batch",
    query: {},
    method: "POST" as const,
    body: { events: discoveredEvents.slice(0, args.maxEvents), markets: discoveredMarkets.slice(0, Math.min(args.maxMarkets, 5)) },
  }] : []);
  const paginationProbes = await scanPagination(args, "/odds", sampleEvent ? { event: sampleEvent } : { sport: "baseball" });
  const marketDiscovery = mergeMarketDiscoveries([
    ...referenceMarkets,
    ...discoverMarketsFromProbes(eventsByFilterVariant),
    ...discoverMarketsFromProbes(eventMarketProbes),
    ...discoverMarketsFromProbes(eventOddsProbes),
    ...discoverMarketsFromProbes(globalOddsProbes),
    ...discoverMarketsFromProbes(bestOddsProbes),
    ...discoverMarketsFromProbes(comparisonOddsProbes),
    ...discoverMarketsFromProbes(batchOddsProbes),
    ...discoverMarketsFromProbes(paginationProbes),
  ]);
  const playerPropsFound = marketDiscovery.some((market) => market.category === "pitcher_prop" || market.category === "batter_prop");
  const pitcherStrikeoutsFound = marketDiscovery.some((market) => /pitcher.*strikeout|pitching.*strikeout|pitcher.*k|pitcher.*ks/i.test(market.normalizedMarket));
  const pitcherOutsFound = marketDiscovery.some((market) => /pitcher.*out|pitching.*out|outs_recorded/i.test(market.normalizedMarket));
  const eventIdRows = globalOddsProbes.find((probe) => probe.label === "odds_event_id")?.rowCount ?? 0;
  const eventRows = globalOddsProbes.find((probe) => probe.label === "odds_event")?.rowCount ?? 0;
  const eventOddsRows = eventOddsProbes.reduce((sum, probe) => sum + probe.rowCount, 0);
  const eventMarketsRows = eventMarketProbes.reduce((sum, probe) => sum + probe.rowCount, 0);
  const paginationRows = paginationProbes.reduce((sum, probe) => sum + probe.rowCount, 0);
  const endpointComparison = {
    oddsEventIdRows: eventIdRows,
    oddsEventRows: eventRows,
    eventOddsRows,
    eventMarketsRows,
    eventIdParamLikelyWrong: eventRows > 0 && eventIdRows === 0,
    eventParamLikelyCorrect: eventRows > 0,
    eventOddsEndpointLikelyRequired: eventOddsRows > 0 && eventRows === 0,
    eventMarketsEndpointLikelyRequired: eventMarketsRows > 0 && marketDiscovery.length > 0,
  };
  const paginationResult = {
    pagesScanned: paginationProbes.length,
    totalRows: paginationRows,
    nextCursorSeen: paginationProbes.some((probe) => Boolean((probe as SharpApiDiscoveryProbe & { nextCursorSeen?: boolean }).nextCursorSeen)),
    stoppedByRowLimit: paginationRows >= args.maxPages * 200,
  };
  const hardRockFound = booksFound.some((book) => normalizeBook(book) === "hardrock");
  const preciseBlockerClassification = classifyDeepBlocker({
    playerPropsFound,
    pitcherStrikeoutsFound,
    eventIdRows,
    eventRows,
    eventOddsRows,
    eventMarketsRows,
    paginationRows,
    marketDiscovery,
    referenceEndpoints,
    eventsByFilterVariant,
    hardRockFound,
    propRowsFoundInMainProbes: args.propRowsFoundInMainProbes,
  });
  return {
    enabled: true,
    maxPages: args.maxPages,
    maxEvents: args.maxEvents,
    maxMarkets: args.maxMarkets,
    referenceEndpoints,
    accountAndBookFacts: {
      accountEndpointAvailable: accountProbe?.ok === true,
      usageEndpointAvailable: usageProbe?.ok === true,
      sportsbookEndpointAvailable: sportsBooksProbe?.ok === true,
      booksFound,
      hardRockFound,
      selectedOrAvailableBooks: booksFound,
    },
    sportsDiscovered,
    leaguesDiscovered,
    eventsByFilterVariant,
    discoveredEventIds: discoveredEvents,
    eventDetailProbes,
    eventMarketProbes,
    eventOddsProbes,
    globalOddsProbes,
    bestOddsProbes,
    comparisonOddsProbes,
    batchOddsProbes,
    paginationProbes,
    marketDiscovery,
    discoveredMarketKeys: {
      all: sortedUnique(marketDiscovery.map((market) => market.normalizedMarket)),
      teamGame: sortedUnique(marketDiscovery.filter((market) => market.category === "team_game").map((market) => market.normalizedMarket)),
      pitcherProps: sortedUnique(marketDiscovery.filter((market) => market.category === "pitcher_prop").map((market) => market.normalizedMarket)),
      batterProps: sortedUnique(marketDiscovery.filter((market) => market.category === "batter_prop").map((market) => market.normalizedMarket)),
      alternateLines: sortedUnique(marketDiscovery.filter((market) => market.category === "alternate_line").map((market) => market.normalizedMarket)),
      unknown: sortedUnique(marketDiscovery.filter((market) => market.category === "unknown").map((market) => market.normalizedMarket)),
    },
    endpointComparison,
    paginationResult,
    playerPropsFound,
    pitcherStrikeoutsFound,
    pitcherOutsFound,
    hardRockFound,
    preciseBlockerClassification,
    recommendedAction: recommendedDeepAction(preciseBlockerClassification),
  };
}

async function probeMany(
  args: {
    baseUrl: string;
    apiKey: string;
    fetchImpl: DiagnosticFetch;
  },
  probes: Array<{ label: string; endpointPath: string; query: Record<string, string>; method?: "GET" | "POST"; body?: unknown }>,
): Promise<SharpApiDiscoveryProbe[]> {
  const out: SharpApiDiscoveryProbe[] = [];
  for (const probe of probes) {
    out.push(await runDiscoveryProbe(args, probe));
  }
  return out;
}

async function runDiscoveryProbe(
  args: {
    baseUrl: string;
    apiKey: string;
    fetchImpl: DiagnosticFetch;
  },
  probe: { label: string; endpointPath: string; query: Record<string, string>; method?: "GET" | "POST"; body?: unknown },
): Promise<SharpApiDiscoveryProbe> {
  const url = new URL(`${args.baseUrl}${probe.endpointPath}`);
  for (const [key, value] of Object.entries(probe.query)) url.searchParams.set(key, value);
  const method = probe.method ?? "GET";
  const response = await args.fetchImpl(url, {
    ...requestHeaders(args.apiKey),
    method,
    body: method === "POST" ? JSON.stringify(probe.body ?? {}) : undefined,
  });
  const text = await response.text();
  const payload = parseJson(text);
  const rowCount = countRowsDeep(payload);
  return {
    label: probe.label,
    endpointPath: probe.endpointPath,
    query: probe.query,
    method,
    httpStatus: response.status,
    ok: response.ok,
    rowCount,
    payloadState: response.ok ? payloadState(payload, rowCount) : "error",
    responseShapeSummary: summarizeShape(payload),
    safeValueSamples: safeValueSamples(payload),
    safeHeaders: safeHeaders(response.headers),
    errorDiagnostic: response.ok ? extractErrorDiagnostic(payload) : extractErrorDiagnostic(payload) ?? {
      code: null,
      details: summarizeErrorBody(text),
      didYouMean: null,
      message: null,
    },
  };
}

async function scanPagination(
  args: {
    baseUrl: string;
    apiKey: string;
    fetchImpl: DiagnosticFetch;
    maxPages: number;
  },
  endpointPath: string,
  query: Record<string, string>,
): Promise<SharpApiDiscoveryProbe[]> {
  const probes: SharpApiDiscoveryProbe[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= args.maxPages; page++) {
    const pageQuery = { ...query };
    if (cursor) pageQuery.cursor = cursor;
    const probe = await runDiscoveryProbe(args, {
      label: `${endpointPath}_pagination_page_${page}`,
      endpointPath,
      query: pageQuery,
    });
    cursor = extractNextCursorFromProbe(probe);
    probes.push({ ...probe, ...(cursor ? { nextCursorSeen: true } : {}) });
    if (!cursor) break;
  }
  return probes;
}

function requestHeaders(apiKey: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function rowsFromPayload(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  return [];
}

function countRows(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.length;
  return 0;
}

function countRowsDeep(payload: unknown): number {
  const direct = countRows(payload);
  if (direct > 0) return direct;
  let nestedCount = 0;
  const visit = (value: unknown) => {
    if (nestedCount > 1000) return;
    if (Array.isArray(value)) {
      if (value.some(isRecord)) nestedCount += value.filter(isRecord).length;
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(payload);
  return nestedCount;
}

function payloadState(payload: unknown, rowCount: number): SharpApiMarketProbe["payloadState"] {
  if (rowCount > 0) return "non_empty";
  if (Array.isArray(payload)) return "empty_array";
  if (isRecord(payload) && Array.isArray(payload.data)) return "empty_array";
  return "missing_data";
}

function summarizeShape(payload: unknown): SharpApiMarketProbe["responseShapeSummary"] {
  const topLevelType = Array.isArray(payload) ? "array" : payload === null ? "null" : typeof payload;
  const topLevelKeys = isRecord(payload) ? Object.keys(payload).filter((key) => !isSensitiveKey(key)).slice(0, 40) : [];
  const data = isRecord(payload) ? payload.data : undefined;
  const dataType = Array.isArray(data) ? "array" : data === null ? "null" : typeof data;
  const dataCount = Array.isArray(data) ? data.length : Array.isArray(payload) ? payload.length : null;
  const first = Array.isArray(data) ? data.find(isRecord) : Array.isArray(payload) ? payload.find(isRecord) : null;
  return {
    topLevelType,
    topLevelKeys,
    dataType,
    dataCount,
    firstNonSensitiveKeys: first ? Object.keys(first).filter((key) => !isSensitiveKey(key)).slice(0, 80) : [],
  };
}

function rateLimitHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (/rate|limit|remaining|reset|retry/i.test(key)) out[key] = value;
  }
  return out;
}

function safeHeaders(headers: Headers): SafeHeaderSummary {
  const out: SafeHeaderSummary = {};
  for (const [key, value] of headers.entries()) {
    if (/^x-request-id$/i.test(key)) out[key] = value;
    if (/^x-ratelimit-(limit|remaining|reset)$/i.test(key)) out[key] = value;
    if (/^x-data-delay$/i.test(key)) out[key] = value;
    if (/^x-response-cache$/i.test(key)) out[key] = value;
    if (/rate|limit|remaining|reset|retry/i.test(key)) out[key] = value;
  }
  return out;
}

function summarizeErrorBody(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 500);
}

function extractErrorDiagnostic(payload: unknown): SharpApiDiscoveryProbe["errorDiagnostic"] {
  if (!isRecord(payload)) return null;
  const error = isRecord(payload.error) ? payload.error : payload;
  const code = stringOrNull(error.code ?? error.error_code ?? payload.code);
  const message = stringOrNull(error.message ?? error.error ?? payload.message);
  const details = stringOrNull(error.details ?? error.detail ?? payload.details);
  const didYouMean = stringOrNull(error.did_you_mean ?? error.didYouMean ?? payload.did_you_mean);
  if (!code && !message && !details && !didYouMean) return null;
  return { code, details, didYouMean, message };
}

function eventMarkets(event: Record<string, unknown>): string[] {
  return Array.isArray(event.markets) ? event.markets.map(String).filter(Boolean).sort() : [];
}

function eventTeamName(event: Record<string, unknown>, side: "home" | "away"): string | null {
  const direct = event[`${side}_team`] ?? event[`${side}Team`] ?? event[`${side}_team_name`];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = event[side];
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (isRecord(nested)) {
    const name = nested.name ?? nested.full_name ?? nested.display_name ?? nested.abbreviation;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

function eventDate(event: Record<string, unknown>): string | null {
  return stringOrNull(event.start_time ?? event.commence_time ?? event.scheduled)?.slice(0, 10) ?? null;
}

function eventStatus(event: Record<string, unknown>): string | null {
  return stringOrNull(event.status ?? event.state ?? event.event_status ?? event.game_status);
}

function buildDateWindow(anchorDate: string): string[] {
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  if (!Number.isFinite(anchor.getTime())) return [anchorDate];
  const dates: string[] = [];
  for (let offset = 0; offset <= 3; offset++) {
    const next = new Date(anchor.getTime() + offset * 24 * 60 * 60 * 1000);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

function countEventsByDate(events: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) {
    const date = eventDate(event) ?? "unknown";
    out[date] = (out[date] ?? 0) + 1;
  }
  return out;
}

function buildEventSummaries(
  events: Array<Record<string, unknown>>,
  probes: SharpApiMarketProbe[],
  marketsToTest: string[],
  generatedAt: string,
): SharpApiEventDiagnosticSummary[] {
  return events.map((event) => {
    const eventId = String(event.id ?? "");
    const eventProbes = probes.filter((probe) => probe.eventId === eventId);
    const marketsWithRows = sortedUnique(eventProbes.filter((probe) => probe.rowCount > 0).map((probe) => probe.marketKey));
    const marketsEmpty = sortedUnique(eventProbes.filter((probe) => probe.ok && probe.rowCount === 0).map((probe) => probe.marketKey));
    const advertisedMarkets = eventMarkets(event);
    const propMarketsAdvertised = advertisedMarkets.filter(isLikelyPlayerMarket);
    const teamGameMarketsAdvertised = advertisedMarkets.filter((market) => classifyDiscoveredMarket(market) === "team_game");
    const rowCountByMarket: Record<string, number> = {};
    const rowCountByBook: Record<string, number> = {};
    const httpStatuses: Record<string, number> = {};
    const payloadStates: Record<string, number> = {};
    const responseKeys = new Set<string>();
    const books = new Set<string>();
    for (const probe of eventProbes) {
      rowCountByMarket[probe.marketKey] = (rowCountByMarket[probe.marketKey] ?? 0) + probe.rowCount;
      for (const book of probe.booksFound) {
        books.add(book);
        if (probe.rowCount > 0) rowCountByBook[book] = (rowCountByBook[book] ?? 0) + probe.rowCount;
      }
      httpStatuses[String(probe.httpStatus)] = (httpStatuses[String(probe.httpStatus)] ?? 0) + 1;
      payloadStates[probe.payloadState] = (payloadStates[probe.payloadState] ?? 0) + 1;
      for (const key of probe.responseShapeSummary.firstNonSensitiveKeys) responseKeys.add(key);
    }
    const scheduledStart = stringOrNull(event.start_time ?? event.commence_time ?? event.scheduled);
    const minutesUntilScheduledStart = minutesUntil(scheduledStart, generatedAt);
    const propRowsFound = eventProbes
      .filter((probe) => isLikelyPlayerMarket(probe.marketKey))
      .reduce((sum, probe) => sum + probe.rowCount, 0);
    return {
      eventId,
      scheduledStart,
      eventDate: eventDate(event),
      minutesUntilScheduledStart,
      timingWindowBucket: timingWindowBucket(minutesUntilScheduledStart),
      homeTeam: eventTeamName(event, "home"),
      awayTeam: eventTeamName(event, "away"),
      leagueFieldPresent: Object.prototype.hasOwnProperty.call(event, "league"),
      leagueValue: stringOrNull(event.league),
      eventStatus: eventStatus(event),
      marketsAdvertised: advertisedMarkets,
      propMarketsAdvertised,
      teamGameMarketsAdvertised,
      onlyTeamGameMarketsAdvertised: advertisedMarkets.length > 0 && propMarketsAdvertised.length === 0 && teamGameMarketsAdvertised.length === advertisedMarkets.length,
      marketsQueried: marketsToTest,
      marketsWithRows,
      marketsEmpty,
      propsExist: propRowsFound > 0,
      propRowsFound,
      pitcherStrikeoutRowsFound: rowCountByMarket.pitcher_strikeouts ?? 0,
      pitcherOutsRowsFound: rowCountByMarket.pitcher_outs ?? 0,
      booksFound: [...books].sort(),
      hardRockFound: [...books].some((book) => normalizeBook(book) === "hardrock"),
      rowCountByMarket,
      rowCountByBook,
      httpStatuses,
      firstNonSensitiveResponseKeys: [...responseKeys].sort().slice(0, 80),
      payloadStates,
    };
  });
}

function buildTimingWindowReport(
  eventSummaries: SharpApiEventDiagnosticSummary[],
  generatedAt: string,
): SharpApiAvailabilityReport["summary"]["timingWindowReport"] {
  const propAvailabilityByPregameWindow: Record<string, { eventCount: number; eventsWithProps: number; propRowsFound: number }> = {};
  const propRowsFoundByBook: Record<string, number> = {};
  for (const event of eventSummaries) {
    const bucket = event.timingWindowBucket;
    const bucketSummary = propAvailabilityByPregameWindow[bucket] ?? { eventCount: 0, eventsWithProps: 0, propRowsFound: 0 };
    bucketSummary.eventCount += 1;
    if (event.propsExist) bucketSummary.eventsWithProps += 1;
    bucketSummary.propRowsFound += event.propRowsFound;
    propAvailabilityByPregameWindow[bucket] = bucketSummary;
    for (const [book, count] of Object.entries(event.rowCountByBook)) {
      propRowsFoundByBook[book] = (propRowsFoundByBook[book] ?? 0) + count;
    }
  }
  const bucketsWithProps = Object.entries(propAvailabilityByPregameWindow)
    .filter(([, summary]) => summary.propRowsFound > 0)
    .map(([bucket]) => bucket);
  const booksWithProps = Object.entries(propRowsFoundByBook)
    .filter(([, count]) => count > 0)
    .map(([book]) => book)
    .sort();
  return {
    generatedAt,
    propAvailabilityByPregameWindow,
    propRowsFoundByBook,
    propsFoundOnlyForBooks: booksWithProps.length > 0 ? booksWithProps : [],
    propsFoundOnlyWithinPregameWindow: bucketsWithProps.length === 1 ? bucketsWithProps[0] : null,
  };
}

function minutesUntil(scheduledStart: string | null, generatedAt: string): number | null {
  if (!scheduledStart) return null;
  const start = new Date(scheduledStart).getTime();
  const now = new Date(generatedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  return Math.round((start - now) / 60000);
}

function timingWindowBucket(minutesUntilScheduledStart: number | null): string {
  if (minutesUntilScheduledStart === null) return "unknown_start_time";
  if (minutesUntilScheduledStart < 0) return "started_or_past";
  if (minutesUntilScheduledStart <= 30) return "0_30m";
  if (minutesUntilScheduledStart <= 60) return "31_60m";
  if (minutesUntilScheduledStart <= 120) return "61_120m";
  if (minutesUntilScheduledStart <= 240) return "121_240m";
  if (minutesUntilScheduledStart <= 480) return "241_480m";
  if (minutesUntilScheduledStart <= 1440) return "481_1440m";
  return "more_than_24h";
}

function providerAvailabilityStatus(
  blockerReason: SharpApiAvailabilityReport["summary"]["blockerReason"],
): SharpApiAvailabilityReport["summary"]["providerAvailabilityStatus"] {
  if (blockerReason === "PROPS_AVAILABLE") return "available";
  if (blockerReason === "PROVIDER_REQUEST_ERRORS") return "request_error";
  if (blockerReason === "NO_MLB_EVENTS_FOUND") return "no_events";
  return "unavailable";
}

function inferLikelyCause(args: {
  blockerReason: SharpApiAvailabilityReport["summary"]["blockerReason"];
  marketsFromEvents: string[];
  endpointVariantProbes: SharpApiEndpointVariantProbe[];
  datesTested: string[];
  propRowsFound: number;
  deepDiscovery: SharpApiDeepDiscoveryReport | null;
}): SharpApiAvailabilityReport["summary"]["likelyCause"] {
  if (args.deepDiscovery) return args.deepDiscovery.preciseBlockerClassification;
  if (args.blockerReason === "NO_MLB_EVENTS_FOUND") return "NO_EVENTS";
  if (args.blockerReason === "PROVIDER_REQUEST_ERRORS") return "UNKNOWN";
  if (args.propRowsFound > 0) return "UNKNOWN";
  const eventMarketsIncludeProps = args.marketsFromEvents.some(isLikelyPlayerMarket);
  const variantsOkButEmpty = args.endpointVariantProbes.length > 0 && args.endpointVariantProbes.every((probe) => probe.ok && probe.rowCount === 0);
  if (eventMarketsIncludeProps && variantsOkButEmpty) return "PLAN_ACCESS_POSSIBLE";
  if (!eventMarketsIncludeProps && variantsOkButEmpty) return "PROVIDER_COVERAGE_GAP_POSSIBLE";
  if (args.endpointVariantProbes.some((probe) => probe.variant === "event_id_only" && probe.ok && probe.rowCount > 0)) return "MARKET_DISCOVERY_REQUIRED";
  if (args.datesTested.length > 1) return "TIMING_WINDOW_POSSIBLE";
  return "EVENTS_FOUND_PROPS_EMPTY";
}

function recommendedAction(
  likelyCause: SharpApiAvailabilityReport["summary"]["likelyCause"],
  blockerReason: SharpApiAvailabilityReport["summary"]["blockerReason"],
): string {
  if (blockerReason === "PROPS_AVAILABLE") return "Proceed with no-write scoring review for promoted pitcher markets only.";
  if (blockerReason === "NO_MLB_EVENTS_FOUND") return "Ask SharpAPI whether historical/current MLB events are available for this date and endpoint.";
  if (blockerReason === "PROVIDER_REQUEST_ERRORS") return "Inspect HTTP errors and rate-limit headers before retrying provider diagnostics.";
  switch (likelyCause) {
    case "PLAN_ACCESS_POSSIBLE":
      return "Send supportSummary to SharpAPI and confirm the account includes MLB player prop odds access.";
    case "MARKET_DISCOVERY_REQUIRED":
    case "MARKET_KEYS_DIFFER_FROM_ASSUMED":
      return "Use deep discovery output to map actual SharpAPI prop market keys before patching the provider.";
    case "WRONG_EVENT_FILTER_PARAM_CONFIRMED":
      return "Patch event filtering only after deep diagnostics confirm player prop rows with the singular event parameter.";
    case "EVENT_ODDS_ENDPOINT_REQUIRED":
      return "Patch the provider to use event-scoped odds only after /events/:eventId/odds returns player prop rows.";
    case "EVENT_MARKETS_ENDPOINT_REQUIRED":
      return "Use event-scoped market discovery before odds queries.";
    case "PAGINATION_MISSED_ROWS":
      return "Add cursor pagination to provider ingestion before scoring real props.";
    case "SPORT_LEAGUE_FILTER_MISMATCH":
      return "Patch sport/league filters only after the working SharpAPI slug/casing is proven.";
    case "ACCOUNT_BOOK_SELECTION_LIMITATION":
      return "Do not require Hard Rock; confirm selected books and score available books only after two-way prop markets exist.";
    case "ACCOUNT_TIER_LIMITATION":
      return "Keep paper trading blocked until account/tier includes MLB player prop odds.";
    case "PROPS_NOT_IN_CURRENT_WINDOW":
      return "Repeat deep diagnostics closer to game windows before changing provider logic.";
    case "PROVIDER_PROPS_EMPTY_AFTER_DEEP_DISCOVERY":
      return "Keep paper trading blocked; all documented discovery paths returned no player props.";
    case "TIMING_WINDOW_POSSIBLE":
      return "Repeat the sweep closer to MLB game start times and ask SharpAPI for the normal player-prop release window.";
    case "PROVIDER_COVERAGE_GAP_POSSIBLE":
      return "Ask SharpAPI whether MLB player props are currently covered for these events/books.";
    case "EVENTS_FOUND_PROPS_EMPTY":
      return "Keep paper trading blocked and send the support packet to SharpAPI for endpoint/account/timing confirmation.";
    case "NO_EVENTS":
      return "No provider events were available; retry for a current/upcoming slate or confirm historical access with SharpAPI.";
    case "UNKNOWN":
      return "Review supportSummary with SharpAPI before changing endpoint logic.";
  }
}

function timingGuidance(args: {
  eventCount: number;
  marketsFromEvents: string[];
  nonEmptyMarkets: string[];
  probes: SharpApiMarketProbe[];
}): string[] {
  const guidance: string[] = [];
  if (args.eventCount === 0) guidance.push("No MLB events were found for the requested date.");
  if (args.eventCount > 0 && args.marketsFromEvents.length === 0) guidance.push("MLB events were found, but events did not advertise available markets.");
  if (args.marketsFromEvents.length > 0 && !args.marketsFromEvents.some(isLikelyPlayerMarket)) guidance.push("Only team/game markets were advertised by events; no player prop market keys appeared.");
  if (args.marketsFromEvents.some(isLikelyPlayerMarket) && args.nonEmptyMarkets.length === 0) guidance.push("Player prop market keys appeared on events, but every odds query returned empty or errored.");
  if (args.nonEmptyMarkets.length > 0) guidance.push(`Prop odds were available for: ${args.nonEmptyMarkets.join(", ")}.`);
  if (args.probes.length > 0 && args.probes.every((probe) => probe.ok && probe.rowCount === 0)) guidance.push("All market queries returned successful empty payloads.");
  if (args.probes.some((probe) => !probe.ok)) guidance.push("At least one market query returned an HTTP error; inspect supportSummary.httpStatuses.");
  return guidance;
}

function blockerMessage(reason: SharpApiAvailabilityReport["summary"]["blockerReason"]): string {
  switch (reason) {
    case "NO_MLB_EVENTS_FOUND":
      return "No MLB events were found for the requested date.";
    case "PROPS_AVAILABLE":
      return "SharpAPI returned non-empty prop odds rows; provider availability is not the current blocker.";
    case "PROVIDER_REQUEST_ERRORS":
      return "SharpAPI prop diagnostics hit request errors before confirming availability.";
    case "PROVIDER_PROP_ODDS_UNAVAILABLE":
      return "MLB events exist and market queries succeeded, but SharpAPI returned no prop odds rows.";
  }
}

function isLikelyPlayerMarket(market: string): boolean {
  const normalized = market.toLowerCase();
  if (normalized.startsWith("player_") || normalized.startsWith("pitcher_") || normalized.startsWith("batter_")) return true;
  return new Set<string>([
    "hits",
    "total_bases",
    "home_runs",
    "rbis",
    "runs",
    "hits_runs_rbis",
    "singles",
    "doubles",
    "triples",
    "walks",
    "stolen_bases",
    "strikeouts",
  ]).has(normalized);
}

function classifyDiscoveredMarket(rawMarket: string): SharpApiMarketDiscovery["category"] {
  const normalized = normalizeMarket(rawMarket);
  if (!normalized) return "unknown";
  if (/alternate|alt_/.test(normalized)) return "alternate_line";
  if (normalized === "player_strikeouts") return "pitcher_prop";
  if (/pitcher|pitching|outs_recorded|earned_runs|hits_allowed|pitcher_k|pitcher_ks/.test(normalized)) return "pitcher_prop";
  if (/player_|batter_|batting_|total_bases|home_runs|rbis|hits_runs_rbis|stolen_bases|singles|doubles|triples/.test(normalized)) return "batter_prop";
  if (/moneyline|spread|total_runs|binary|run_line|game|match|team_total/.test(normalized)) return "team_game";
  if (isLikelyPlayerMarket(normalized)) return "batter_prop";
  return "unknown";
}

function discoverMarketsFromProbes(probes: SharpApiDiscoveryProbe[]): SharpApiMarketDiscovery[] {
  const out: SharpApiMarketDiscovery[] = [];
  for (const probe of probes) {
    for (const rawMarket of extractMarketLikeValuesFromProbe(probe)) {
      const normalizedMarket = normalizeMarket(rawMarket);
      if (!normalizedMarket) continue;
      out.push({
        rawMarket,
        normalizedMarket,
        source: probe.label,
        category: classifyDiscoveredMarket(normalizedMarket),
        rowCount: probe.rowCount,
      });
    }
  }
  return out;
}

function mergeMarketDiscoveries(markets: SharpApiMarketDiscovery[]): SharpApiMarketDiscovery[] {
  const byKey = new Map<string, SharpApiMarketDiscovery>();
  for (const market of markets) {
    const existing = byKey.get(market.normalizedMarket);
    if (!existing) {
      byKey.set(market.normalizedMarket, market);
      continue;
    }
    byKey.set(market.normalizedMarket, {
      ...existing,
      source: sortedUnique([...existing.source.split(","), market.source]).join(","),
      rowCount: existing.rowCount + market.rowCount,
      category: existing.category === "unknown" ? market.category : existing.category,
    });
  }
  return [...byKey.values()].sort((a, b) => a.normalizedMarket.localeCompare(b.normalizedMarket));
}

function normalizeMarket(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_+]+/g, "");
}

function extractValuesFromProbe(probe: SharpApiDiscoveryProbe, keys: string[]): string[] {
  return sortedUnique([
    ...probe.safeValueSamples.sports,
    ...probe.safeValueSamples.leagues,
    ...extractValuesFromStoredProbe(probe, (key) => keys.some((wanted) => key.toLowerCase() === wanted.toLowerCase())),
  ]);
}

function extractMarketLikeValuesFromProbe(probe: SharpApiDiscoveryProbe): string[] {
  return sortedUnique(probe.safeValueSamples.markets);
}

function extractBookLikeValues(probe: SharpApiDiscoveryProbe): string[] {
  return sortedUnique([
    ...probe.safeValueSamples.books,
    ...extractValuesFromStoredProbe(probe, (key) => /sportsbook|book|bookmaker/i.test(key)),
  ]).filter((value) => /[a-z]/i.test(value));
}

function extractEventIdsFromProbe(probe: SharpApiDiscoveryProbe): string[] {
  return sortedUnique([
    ...probe.safeValueSamples.eventIds,
    ...extractValuesFromStoredProbe(probe, (key) => /^id$|event_id|eventId/i.test(key)),
  ])
    .filter((value) => /^mlb[_-]|[_-]mlb[_-]|kxmlb/i.test(value));
}

function extractValuesFromStoredProbe(probe: SharpApiDiscoveryProbe, keyMatcher: (key: string) => boolean): string[] {
  const values: string[] = [];
  for (const key of probe.responseShapeSummary.firstNonSensitiveKeys) {
    if (keyMatcher(key)) values.push(key);
  }
  for (const [key, value] of Object.entries(probe.query)) {
    if (keyMatcher(key)) values.push(value);
  }
  return sortedUnique(values);
}

function safeValueSamples(payload: unknown): SharpApiDiscoveryProbe["safeValueSamples"] {
  const sports = new Set<string>();
  const leagues = new Set<string>();
  const markets = new Set<string>();
  const books = new Set<string>();
  const eventIds = new Set<string>();
  let nextCursor: string | null = null;
  const add = (set: Set<string>, value: unknown) => {
    if (typeof value === "string" && value.trim() && value.length <= 120) set.add(value.trim());
    if (typeof value === "number" && Number.isFinite(value)) set.add(String(value));
  };
  const visit = (value: unknown, keyHint = "", depth = 0) => {
    if (depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) visit(item, keyHint, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, raw] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      if (/next_cursor|nextCursor/i.test(key) && typeof raw === "string") nextCursor = raw;
      if (/^sport$|sport_key|sport_slug/i.test(key)) add(sports, raw);
      if (/^league$|league_key|league_slug/i.test(key)) add(leagues, raw);
      if (/market|market_type|market_key|prop|slug|key/i.test(key)) {
        if (Array.isArray(raw)) {
          for (const item of raw.slice(0, 80)) add(markets, item);
        } else {
          add(markets, raw);
        }
      }
      if (/sportsbook|book|bookmaker/i.test(key)) add(books, raw);
      if (/^id$|event_id|eventId/i.test(key)) add(eventIds, raw);
      if (isRecord(raw) || Array.isArray(raw)) visit(raw, key, depth + 1);
    }
    void keyHint;
  };
  visit(payload);
  return {
    sports: [...sports].sort().slice(0, 40),
    leagues: [...leagues].sort().slice(0, 40),
    markets: [...markets].sort().slice(0, 120),
    books: [...books].sort().slice(0, 80),
    eventIds: [...eventIds].sort().slice(0, 80),
    nextCursor,
  };
}

function extractNextCursorFromProbe(probe: SharpApiDiscoveryProbe): string | null {
  return probe.safeValueSamples.nextCursor;
}

function classifyDeepBlocker(args: {
  playerPropsFound: boolean;
  pitcherStrikeoutsFound: boolean;
  eventIdRows: number;
  eventRows: number;
  eventOddsRows: number;
  eventMarketsRows: number;
  paginationRows: number;
  marketDiscovery: SharpApiMarketDiscovery[];
  referenceEndpoints: SharpApiDiscoveryProbe[];
  eventsByFilterVariant: SharpApiDiscoveryProbe[];
  hardRockFound: boolean;
  propRowsFoundInMainProbes: number;
}): SharpApiDeepDiscoveryReport["preciseBlockerClassification"] {
  if (args.propRowsFoundInMainProbes > 0 && args.playerPropsFound) return "UNKNOWN";
  if (args.eventRows > 0 && args.eventIdRows === 0) return "WRONG_EVENT_FILTER_PARAM_CONFIRMED";
  if (args.eventOddsRows > 0 && args.eventRows === 0 && args.eventIdRows === 0) return "EVENT_ODDS_ENDPOINT_REQUIRED";
  if (args.eventMarketsRows > 0 && args.marketDiscovery.some((market) => market.category === "pitcher_prop" || market.category === "batter_prop")) return "EVENT_MARKETS_ENDPOINT_REQUIRED";
  if (args.paginationRows > args.eventRows && args.playerPropsFound) return "PAGINATION_MISSED_ROWS";
  if (args.playerPropsFound && !args.pitcherStrikeoutsFound) return "MARKET_KEYS_DIFFER_FROM_ASSUMED";
  if (!args.playerPropsFound && args.marketDiscovery.length > 0) return "MARKET_DISCOVERY_REQUIRED";
  if (args.eventsByFilterVariant.some((probe) => probe.label.includes("baseball") && probe.rowCount > 0) && args.eventsByFilterVariant.every((probe) => !probe.label.includes("baseball") || probe.rowCount === 0)) return "SPORT_LEAGUE_FILTER_MISMATCH";
  if (args.referenceEndpoints.some((probe) => /account/i.test(probe.label) && probe.httpStatus === 403)) return "ACCOUNT_TIER_LIMITATION";
  if (!args.hardRockFound && args.referenceEndpoints.some((probe) => probe.endpointPath === "/sportsbooks" && probe.ok)) return "ACCOUNT_BOOK_SELECTION_LIMITATION";
  if (args.eventIdRows === 0 && args.eventRows === 0 && args.eventOddsRows === 0) return "PROPS_NOT_IN_CURRENT_WINDOW";
  if (!args.playerPropsFound) return "PROVIDER_PROPS_EMPTY_AFTER_DEEP_DISCOVERY";
  return "UNKNOWN";
}

function recommendedDeepAction(classification: SharpApiDeepDiscoveryReport["preciseBlockerClassification"]): string {
  switch (classification) {
    case "WRONG_EVENT_FILTER_PARAM_CONFIRMED":
      return "Patch provider only after confirming /odds?event returns player prop rows in live diagnostics.";
    case "EVENT_ODDS_ENDPOINT_REQUIRED":
      return "Patch provider only after confirming /events/:eventId/odds returns player prop rows.";
    case "EVENT_MARKETS_ENDPOINT_REQUIRED":
      return "Use /events/:eventId/markets for market discovery before querying odds.";
    case "PAGINATION_MISSED_ROWS":
      return "Add cursor pagination to provider ingestion before scoring real props.";
    case "MARKET_DISCOVERY_REQUIRED":
      return "Continue using discovered market keys; do not rely on assumed prop keys.";
    case "MARKET_KEYS_DIFFER_FROM_ASSUMED":
      return "Map discovered SharpAPI prop market keys to internal prop market keys using sanitized fixtures.";
    case "SPORT_LEAGUE_FILTER_MISMATCH":
      return "Patch sport/league filters only after live diagnostics identify the working casing/slug.";
    case "ACCOUNT_BOOK_SELECTION_LIMITATION":
      return "Do not require Hard Rock; score preferred books when real two-way prop markets are available.";
    case "ACCOUNT_TIER_LIMITATION":
      return "Keep paper trading blocked until account access confirms MLB player prop odds.";
    case "PROPS_NOT_IN_CURRENT_WINDOW":
      return "Repeat deep diagnostics closer to game windows before changing provider logic.";
    case "PROVIDER_PROPS_EMPTY_AFTER_DEEP_DISCOVERY":
      return "Keep paper trading blocked; all documented discovery paths returned no player props.";
    case "UNKNOWN":
      return "Review the deep report before changing provider logic.";
  }
}

function extractBooks(payload: unknown): string[] {
  const books = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, raw] of Object.entries(value)) {
      if (/sportsbook|book|bookmaker/i.test(key) && typeof raw === "string" && raw.trim()) {
        books.add(raw.trim().toLowerCase());
      }
      visit(raw);
    }
  };
  visit(payload);
  return [...books].sort();
}

function isSensitiveKey(key: string): boolean {
  return /key|token|secret|authorization|password/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function recordQuery(query: Record<string, string>): Record<string, string> {
  return query;
}
