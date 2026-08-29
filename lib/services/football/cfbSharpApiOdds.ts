import { SharpApiClient, type SharpApiRequestOptions, type SharpApiResponse } from "@/lib/providers/real_api/_sharpApiClient";
import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_SHARP_API_ODDS_RELEASE =
  "cfb_sharpapi_named_book_fallback_2026_08_28_r11_prior_event_disambiguation" as const;
export const CFB_SHARP_FALLBACK_MAX_GAMES = 96 as const;
export const CFB_SHARP_FALLBACK_MAX_REQUESTS = 192 as const;
export const CFB_SHARP_FALLBACK_MAX_ROWS_PER_EVENT = 200 as const;
export const CFB_SHARP_FALLBACK_MAX_PAGES_PER_EVENT = 4 as const;
export const CFB_SHARP_FALLBACK_MAX_EVENT_DISCOVERY_PAGES_PER_DATE = 8 as const;

type Json = Record<string, unknown>;
type SharpClient = {
  fetch<T>(opts: SharpApiRequestOptions): Promise<SharpApiResponse<T>>;
};

type SharpRow = {
  event_id?: unknown;
  external_event_id?: unknown;
  event_start_time?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  sportsbook?: unknown;
  market_type?: unknown;
  selection_type?: unknown;
  line?: unknown;
  odds_american?: unknown;
  is_main_line?: unknown;
  is_alternate_line?: unknown;
  is_player_prop?: unknown;
  is_live?: unknown;
  is_active?: unknown;
  is_stale_pregame_price?: unknown;
  timestamp?: unknown;
};

type SharpEventRow = {
  id?: unknown;
  event_id?: unknown;
  eventId?: unknown;
  start_time?: unknown;
  event_start_time?: unknown;
  commence_time?: unknown;
  scheduled?: unknown;
  home_team?: unknown;
  homeTeam?: unknown;
  home?: unknown;
  away_team?: unknown;
  awayTeam?: unknown;
  away?: unknown;
};

type Pair = {
  sportsbook: string;
  externalEventId: string;
  market: "moneyline" | "spread" | "total";
  line: number | null;
  homeLine?: number;
  awayLine?: number;
  observedAt: string;
  homePrice?: number;
  awayPrice?: number;
  overPrice?: number;
  underPrice?: number;
  marketSelection: "main_line" | "coherent_paired_alternate";
};

type SideQuote = {
  price: number;
  line: number | null;
  observedAt: string;
  marketSelection: Pair["marketSelection"];
};

const TRUSTED_CONSENSUS_BOOKS = new Set([
  "ballybet",
  "betmgm",
  "betonline",
  "caesars",
  "draftkings",
  "fanduel",
  "fanatics",
  "betrivers",
  "goldrush",
  "onexbet",
  "pinnacle",
  "rebet",
  "sportzino",
  "thescorebet",
]);

const USER_TARGET_BOOKS = new Set([
  "betmgm",
  "caesars",
  "draftkings",
  "fanduel",
  "fanatics",
  "betrivers",
]);

const MARKET_TYPES = new Map([
  ["moneyline", "moneyline"],
  ["point_spread", "spread"],
  ["total_points", "total"],
] as const);

export type CfbSharpApiOddsResult = {
  release: typeof CFB_SHARP_API_ODDS_RELEASE;
  requests: number;
  attemptedGames: number;
  matchedGames: number;
  booksByGame: Record<string, NcaafBookOdds[]>;
  /** Includes verified one-sided named-book offers for display-only context. */
  displayBooksByGame: Record<string, NcaafBookOdds[]>;
  eventIdsByGame: Record<string, string | null>;
  eventDiscoveryStatusByGame: Record<string, "matched" | "unpublished" | "ambiguous">;
};

export async function fetchSharpApiNcaafOddsFallback(args: {
  games: NcaafGame[];
  apiKey?: string;
  client?: SharpClient;
  maximumRequests?: number;
  trustedEventIdsByGame?: Readonly<Record<string, string>>;
}): Promise<CfbSharpApiOddsResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()];
  if (games.length > CFB_SHARP_FALLBACK_MAX_GAMES) {
    throw new Error(`CFB SharpAPI fallback cannot exceed ${CFB_SHARP_FALLBACK_MAX_GAMES} exact games per run.`);
  }
  const key = args.apiKey ?? process.env.SHARPAPI_KEY;
  if (!key && !args.client) throw new Error("SHARPAPI_KEY is required for CFB named-book fallback.");
  const client = args.client ?? new SharpApiClient(key!);
  const maximumRequests = args.maximumRequests ?? CFB_SHARP_FALLBACK_MAX_REQUESTS;
  if (!Number.isInteger(maximumRequests) || maximumRequests < 1 || maximumRequests > CFB_SHARP_FALLBACK_MAX_REQUESTS) {
    throw new Error(`CFB SharpAPI maximumRequests must be 1..${CFB_SHARP_FALLBACK_MAX_REQUESTS}.`);
  }
  let requests = 0;
  const booksByGame: Record<string, NcaafBookOdds[]> = {};
  const displayBooksByGame: Record<string, NcaafBookOdds[]> = {};
  const eventIdsByGame: Record<string, string | null> = {};
  const eventDiscoveryStatusByGame: CfbSharpApiOddsResult["eventDiscoveryStatusByGame"] = {};
  const discoveryDates = [...new Set(games.flatMap((game) => sharpEventDiscoveryDates(game)))].sort();
  const discoveredEvents: SharpEventRow[] = [];
  for (const date of discoveryDates) {
    const rows: unknown[] = [];
    const pageFingerprints = new Set<string>();
    let offset = 0;
    let complete = false;
    for (let page = 0; page < CFB_SHARP_FALLBACK_MAX_EVENT_DISCOVERY_PAGES_PER_DATE; page += 1) {
      if (requests >= maximumRequests) {
        throw new Error(`CFB SharpAPI fallback exhausted its ${maximumRequests}-request hard cap during canonical event discovery.`);
      }
      requests += 1;
      const response = await client.fetch<unknown[]>({
        path: "/events",
        query: {
          league: "ncaaf",
          date,
          live: false,
          limit: CFB_SHARP_FALLBACK_MAX_ROWS_PER_EVENT,
          ...(offset > 0 ? { offset } : {}),
        },
        retryRateLimitInternally: false,
      });
      if (!Array.isArray(response.data)) throw new Error(`CFB SharpAPI event discovery for ${date} returned malformed data.`);
      const fingerprint = JSON.stringify(response.data);
      if (response.data.length > 0 && pageFingerprints.has(fingerprint)) {
        throw new Error(`CFB SharpAPI event discovery for ${date} repeated a prior page instead of advancing its offset.`);
      }
      if (response.data.length > 0) pageFingerprints.add(fingerprint);
      rows.push(...response.data);
      if (response.pagination?.has_more !== true) {
        complete = true;
        break;
      }
      const nextOffset = nextCfbSharpOddsOffset({
        pagination: response.pagination,
        requestedOffset: offset,
        returnedRows: response.data.length,
      });
      if (nextOffset === null) {
        throw new Error(`CFB SharpAPI event discovery for ${date} reported more rows without a valid forward offset.`);
      }
      offset = nextOffset;
    }
    if (!complete) {
      throw new Error(`CFB SharpAPI event discovery for ${date} exceeded the bounded ${CFB_SHARP_FALLBACK_MAX_EVENT_DISCOVERY_PAGES_PER_DATE}-page safety cap.`);
    }
    discoveredEvents.push(...rows.map((row) => record(row) as SharpEventRow));
  }
  const discoveredEventIds = new Set<string>();
  for (const game of games) {
    let accepted: NcaafBookOdds[] = [];
    let acceptedDisplay: NcaafBookOdds[] = [];
    let acceptedEventId: string | null = null;
    const eventMatches = discoveredEvents.filter((event) => strictSharpEventIdentity(game, event));
    const uniqueEventMatches = [...new Map(eventMatches.flatMap((event) => {
      const eventId = sharpEventId(event);
      return eventId ? [[eventId, event] as const] : [];
    })).entries()];
    const trustedEventId = args.trustedEventIdsByGame?.[game.providerGameId] ?? null;
    const trustedCurrentMatch = trustedEventId !== null && uniqueEventMatches.some(([eventId]) => eventId === trustedEventId)
      ? trustedEventId
      : null;
    if (uniqueEventMatches.length > 1 && trustedCurrentMatch === null) {
      booksByGame[game.providerGameId] = [];
      displayBooksByGame[game.providerGameId] = [];
      eventIdsByGame[game.providerGameId] = null;
      eventDiscoveryStatusByGame[game.providerGameId] = "ambiguous";
      continue;
    }
    const eventId = trustedCurrentMatch ?? uniqueEventMatches[0]?.[0] ?? null;
    if (eventId) {
      if (discoveredEventIds.has(eventId)) {
        throw new Error(`CFB SharpAPI canonical event ${eventId} matched more than one scheduled game.`);
      }
      discoveredEventIds.add(eventId);
      const rows: unknown[] = [];
      const pageFingerprints = new Set<string>();
      let offset = 0;
      let complete = false;
      for (let page = 0; page < CFB_SHARP_FALLBACK_MAX_PAGES_PER_EVENT; page += 1) {
        if (requests >= maximumRequests) {
          throw new Error(`CFB SharpAPI fallback exhausted its ${maximumRequests}-request hard cap before resolving every deficient game.`);
        }
        requests += 1;
        const response = await client.fetch<unknown[]>({
          path: "/odds",
          query: {
            event_id: eventId,
            market: "main",
            is_live: false,
            limit: CFB_SHARP_FALLBACK_MAX_ROWS_PER_EVENT,
            ...(offset > 0 ? { offset } : {}),
          },
          retryRateLimitInternally: false,
        });
        if (!Array.isArray(response.data)) throw new Error(`CFB SharpAPI event ${eventId} returned malformed odds data.`);
        const fingerprint = JSON.stringify(response.data);
        if (response.data.length > 0 && pageFingerprints.has(fingerprint)) {
          throw new Error(`CFB SharpAPI event ${eventId} repeated a prior page instead of advancing its offset.`);
        }
        if (response.data.length > 0) pageFingerprints.add(fingerprint);
        rows.push(...response.data);
        if (response.pagination?.has_more !== true) {
          complete = true;
          break;
        }
        const nextOffset = nextCfbSharpOddsOffset({
          pagination: response.pagination,
          requestedOffset: offset,
          returnedRows: response.data.length,
        });
        if (nextOffset === null) {
          throw new Error(`CFB SharpAPI event ${eventId} reported more rows without a valid forward offset.`);
        }
        offset = nextOffset;
      }
      if (!complete) {
        throw new Error(`CFB SharpAPI event ${eventId} exceeded the bounded ${CFB_SHARP_FALLBACK_MAX_PAGES_PER_EVENT}-page safety cap.`);
      }
      const books = normalizeSharpRows({ game, eventId, rows });
      acceptedDisplay = books;
      accepted = books.filter((book) => bookCompleteness(book) > 0);
      acceptedEventId = eventId;
    }
    booksByGame[game.providerGameId] = accepted;
    displayBooksByGame[game.providerGameId] = acceptedDisplay;
    eventIdsByGame[game.providerGameId] = acceptedEventId;
    eventDiscoveryStatusByGame[game.providerGameId] = acceptedEventId ? "matched" : "unpublished";
  }
  return {
    release: CFB_SHARP_API_ODDS_RELEASE,
    requests,
    attemptedGames: games.length,
    matchedGames: Object.values(booksByGame).filter((books) => books.length > 0).length,
    booksByGame,
    displayBooksByGame,
    eventIdsByGame,
    eventDiscoveryStatusByGame,
  };
}

export function nextCfbSharpOddsOffset(args: {
  pagination: SharpApiResponse<unknown>["pagination"];
  requestedOffset: number;
  returnedRows: number;
}): number | null {
  const direct = args.pagination?.next_offset;
  if (typeof direct === "number" && Number.isInteger(direct) && direct > args.requestedOffset) return direct;
  if (!Number.isInteger(args.returnedRows) || args.returnedRows < 1) return null;
  const reportedOffset = args.pagination?.offset;
  if (reportedOffset !== undefined && (!Number.isInteger(reportedOffset) || reportedOffset !== args.requestedOffset)) return null;
  const reportedLimit = args.pagination?.limit;
  const advance = typeof reportedLimit === "number" && Number.isInteger(reportedLimit) && reportedLimit > 0
    ? reportedLimit
    : args.returnedRows;
  const derived = args.requestedOffset + advance;
  return Number.isSafeInteger(derived) && derived > args.requestedOffset ? derived : null;
}

export function cfbBooksNeedSharpFallback(books: NcaafBookOdds[]): boolean {
  return !marketHasThreeSameLineBooks(books, "moneyline") ||
    !marketHasThreeSameLineBooks(books, "spread") ||
    !marketHasThreeSameLineBooks(books, "total");
}

export function mergeCfbNamedBooks(primary: NcaafBookOdds[], fallback: NcaafBookOdds[]): NcaafBookOdds[] {
  const merged = new Map<string, NcaafBookOdds>();
  for (const book of [...primary, ...fallback]) {
    const key = normalize(book.sportsbook);
    const current = merged.get(key);
    const selected = !current || bookCompleteness(book) > bookCompleteness(current) ||
      (bookCompleteness(book) === bookCompleteness(current) && Date.parse(book.observedAt) > Date.parse(current.observedAt))
      ? book
      : current;
    merged.set(key, {
      ...selected,
      marketQuotes: mergeMarketQuotes(current?.marketQuotes ?? [], book.marketQuotes ?? []),
    });
  }
  return [...merged.values()].sort((first, second) =>
    Number(second.targetEligible !== false) - Number(first.targetEligible !== false) ||
    bookCompleteness(second) - bookCompleteness(first) ||
    Date.parse(second.observedAt) - Date.parse(first.observedAt) ||
    first.sportsbook.localeCompare(second.sportsbook));
}

export function preferredCfbTargetBook(books: NcaafBookOdds[]): NcaafBookOdds | null {
  return [...books].filter((book) => book.targetEligible !== false).sort((first, second) =>
    bookCompleteness(second) - bookCompleteness(first) ||
    Date.parse(second.observedAt) - Date.parse(first.observedAt) ||
    first.sportsbook.localeCompare(second.sportsbook))[0] ?? null;
}

export function sharpEventDiscoveryDates(game: NcaafGame): string[] {
  return [...new Set([easternDate(game.scheduledStart), game.scheduledStart.slice(0, 10)])];
}

export function normalizeSharpRows(args: { game: NcaafGame; eventId: string; rows: unknown[] }): NcaafBookOdds[] {
  const grouped = new Map<string, Map<string, Partial<Record<"home" | "away" | "over" | "under", SideQuote>>>>();
  const displayQuotes = new Map<string, NonNullable<NcaafBookOdds["marketQuotes"]>>();
  for (const value of args.rows) {
    const row = value as SharpRow;
    if (identifier(row.event_id) !== args.eventId || row.is_live === true || row.is_active === false || row.is_stale_pregame_price === true || row.is_player_prop === true) continue;
    const market = MARKET_TYPES.get((text(row.market_type) ?? "") as "moneyline" | "point_spread" | "total_points");
    const sportsbook = normalize(text(row.sportsbook) ?? "");
    const side = text(row.selection_type)?.toLowerCase();
    const price = americanPrice(row.odds_american);
    const observedAt = iso(row.timestamp);
    const startsAt = iso(row.event_start_time);
    const externalEventId = identifier(row.external_event_id) ?? args.eventId;
    const marketSelection = row.is_main_line === true && row.is_alternate_line !== true
      ? "main_line" as const
      : row.is_alternate_line === true && row.is_main_line !== true && market !== "moneyline"
        ? "coherent_paired_alternate" as const
        : null;
    if (!market || !marketSelection || !TRUSTED_CONSENSUS_BOOKS.has(sportsbook) || !side || price === null || !observedAt || !startsAt) continue;
    if (!strictGameIdentity(args.game, row, startsAt)) continue;
    if (!validSide(market, side)) continue;
    const rawLine = market === "moneyline" ? null : finite(row.line);
    if (market !== "moneyline" && rawLine === null) continue;
    if (marketSelection === "main_line") {
      const quotes = displayQuotes.get(sportsbook) ?? [];
      quotes.push({ market, side: side as "home" | "away" | "over" | "under", line: rawLine, price, observedAt, marketSelection });
      displayQuotes.set(sportsbook, quotes);
    }
    const normalizedLine = market === "spread" ? Math.abs(rawLine!) : rawLine;
    const key = `${sportsbook}|${externalEventId}`;
    const pairKey = `${market}|${normalizedLine ?? "ml"}`;
    const markets = grouped.get(key) ?? new Map();
    const pair = markets.get(pairKey) ?? {};
    const current = pair[side as keyof typeof pair];
    if (!current || pairSelectionRank(marketSelection) > pairSelectionRank(current.marketSelection) ||
      (marketSelection === current.marketSelection && Date.parse(observedAt) > Date.parse(current.observedAt))) {
      pair[side as keyof typeof pair] = { price, line: rawLine, observedAt, marketSelection };
    }
    markets.set(pairKey, pair);
    grouped.set(key, markets);
  }
  const allPairs: Pair[] = [];
  for (const [groupKey, markets] of grouped) {
    const [sportsbook, externalEventId] = groupKey.split("|") as [string, string];
    const pairs = [...markets.entries()].flatMap(([key, sides]): Pair[] => {
      const [marketRaw, lineRaw] = key.split("|") as [Pair["market"], string];
      const line = lineRaw === "ml" ? null : Number(lineRaw);
      if (marketRaw === "moneyline" && sides.home && sides.away && sameMarketSelection(sides.home, sides.away, "main_line")) return [{ sportsbook, externalEventId, market: marketRaw, line, observedAt: latest(sides.home.observedAt, sides.away.observedAt), homePrice: sides.home.price, awayPrice: sides.away.price, marketSelection: "main_line" }];
      if (marketRaw === "spread" && sides.home && sides.away && sides.home.line !== null && sides.away.line !== null && Math.abs(sides.home.line + sides.away.line) < 0.001) {
        const marketSelection = pairedMarketSelection(sides.home, sides.away);
        return marketSelection ? [{ sportsbook, externalEventId, market: marketRaw, line, homeLine: sides.home.line, awayLine: sides.away.line, observedAt: latest(sides.home.observedAt, sides.away.observedAt), homePrice: sides.home.price, awayPrice: sides.away.price, marketSelection }] : [];
      }
      if (marketRaw === "total" && sides.over && sides.under) {
        const marketSelection = pairedMarketSelection(sides.over, sides.under);
        return marketSelection ? [{ sportsbook, externalEventId, market: marketRaw, line, observedAt: latest(sides.over.observedAt, sides.under.observedAt), overPrice: sides.over.price, underPrice: sides.under.price, marketSelection }] : [];
      }
      return [];
    });
    allPairs.push(...pairs);
  }
  const bySportsbook = new Map<string, Pair[]>();
  const selectedAlternateLines = selectQualifiedAlternateLines(allPairs);
  for (const pair of allPairs) {
    const values = bySportsbook.get(pair.sportsbook) ?? [];
    values.push(pair);
    bySportsbook.set(pair.sportsbook, values);
  }
  const books: NcaafBookOdds[] = [];
  const sportsbooks = new Set([...bySportsbook.keys(), ...displayQuotes.keys()]);
  for (const sportsbook of sportsbooks) {
    const pairs = bySportsbook.get(sportsbook) ?? [];
    const selected = selectPairs(pairs, selectedAlternateLines);
    const quotes = mergeMarketQuotes([], displayQuotes.get(sportsbook) ?? []);
    const observedAt = [...selected.map((pair) => pair.observedAt), ...quotes.map((quote) => quote.observedAt)]
      .reduce<string | null>((value, timestamp) => value === null ? timestamp : latest(value, timestamp), null);
    if (!observedAt) continue;
    const book: NcaafBookOdds = {
      providerGameId: args.game.providerGameId,
      sportsbook,
      observedAt,
      provider: "sharpapi",
      providerEventId: args.eventId,
      targetEligible: USER_TARGET_BOOKS.has(sportsbook),
      marketSelection: Object.fromEntries(selected.map((pair) => [pair.market, pair.marketSelection])),
      marketObservedAt: Object.fromEntries(selected.map((pair) => [pair.market, pair.observedAt])),
      marketQuotes: quotes,
      moneyline: selected.find((pair) => pair.market === "moneyline") ? {
        homePrice: selected.find((pair) => pair.market === "moneyline")!.homePrice!,
        awayPrice: selected.find((pair) => pair.market === "moneyline")!.awayPrice!,
      } : null,
      spread: selected.find((pair) => pair.market === "spread") ? {
        homeLine: selected.find((pair) => pair.market === "spread")!.homeLine!,
        homePrice: selected.find((pair) => pair.market === "spread")!.homePrice!,
        awayLine: selected.find((pair) => pair.market === "spread")!.awayLine!,
        awayPrice: selected.find((pair) => pair.market === "spread")!.awayPrice!,
      } : null,
      total: selected.find((pair) => pair.market === "total") ? {
        line: selected.find((pair) => pair.market === "total")!.line!,
        overPrice: selected.find((pair) => pair.market === "total")!.overPrice!,
        underPrice: selected.find((pair) => pair.market === "total")!.underPrice!,
      } : null,
    };
    books.push(book);
  }
  return books.sort((first, second) => first.sportsbook.localeCompare(second.sportsbook));
}

function mergeMarketQuotes(
  first: NonNullable<NcaafBookOdds["marketQuotes"]>,
  second: NonNullable<NcaafBookOdds["marketQuotes"]>,
): NonNullable<NcaafBookOdds["marketQuotes"]> {
  const values = new Map<string, NonNullable<NcaafBookOdds["marketQuotes"]>[number]>();
  for (const quote of [...first, ...second]) {
    const key = `${quote.market}|${quote.side}|${quote.line ?? "null"}`;
    const current = values.get(key);
    if (!current || Date.parse(quote.observedAt) > Date.parse(current.observedAt)) values.set(key, quote);
  }
  return [...values.values()].sort((a, b) =>
    a.market.localeCompare(b.market) || a.side.localeCompare(b.side) ||
    Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

function selectPairs(
  pairs: Pair[],
  selectedAlternateLines: Partial<Record<"spread" | "total", number>> = {},
): Pair[] {
  return ["moneyline", "spread", "total"].flatMap((market) => {
    const alternateLine = market === "spread" || market === "total" ? selectedAlternateLines[market] : undefined;
    const alternates = alternateLine === undefined ? [] : pairs.filter((pair) =>
      pair.market === market && pair.marketSelection === "coherent_paired_alternate" && pair.line === alternateLine
    );
    const pool = alternates.length > 0 ? alternates : pairs.filter((pair) => pair.market === market && pair.marketSelection === "main_line");
    const values = pool.sort((first, second) => Date.parse(second.observedAt) - Date.parse(first.observedAt) || Math.abs((second.line ?? 0)) - Math.abs((first.line ?? 0)));
    return values[0] ? [values[0]] : [];
  });
}

function selectQualifiedAlternateLines(pairs: Pair[]): Partial<Record<"spread" | "total", number>> {
  return Object.fromEntries((["spread", "total"] as const).flatMap((market) => {
    const selected = selectQualifiedAlternateLine(pairs, market, market === "spread" ? 1 : 2);
    return selected === undefined ? [] : [[market, selected]];
  }));
}

function selectQualifiedAlternateLine(pairs: Pair[], market: "spread" | "total", maximumDistance: number): number | undefined {
  // Keep the established main-line path unchanged whenever it can produce a
  // target quote plus two distinct exact-line comparison books. The fallback
  // is deliberately market-scoped: it admits only a fully paired alternate
  // cohort near the dominant main market and never applies to Moneyline.
  const values = pairs.filter((pair) => pair.market === market && pair.line !== null);
  const mainValues = values.filter((pair) => pair.marketSelection === "main_line");
  if (targetMainCohortReady(mainValues)) return undefined;
  const referenceLine = dominantLine(mainValues);
  if (referenceLine === undefined) return undefined;
  const cohorts = new Map<number, Map<string, Pair>>();
  for (const pair of values.filter((value) => value.marketSelection === "coherent_paired_alternate")) {
    const line = pair.line!;
    const books = cohorts.get(line) ?? new Map<string, Pair>();
    const current = books.get(pair.sportsbook);
    if (!current || Date.parse(pair.observedAt) > Date.parse(current.observedAt)) books.set(pair.sportsbook, pair);
    cohorts.set(line, books);
  }
  const ranked = [...cohorts.entries()].map(([line, books]) => {
    const rows = [...books.values()];
    return {
      line,
      rows,
      targetCount: rows.filter((pair) => USER_TARGET_BOOKS.has(pair.sportsbook)).length,
      nonTargetCount: rows.filter((pair) => !USER_TARGET_BOOKS.has(pair.sportsbook)).length,
      latestAt: Math.max(...rows.map((pair) => Date.parse(pair.observedAt))),
    };
  });
  const eligible = ranked.filter((cohort) =>
    cohort.rows.length >= 3 &&
    cohort.targetCount >= 1 &&
    cohort.nonTargetCount >= 2 &&
    Math.abs(cohort.line - referenceLine) <= maximumDistance
  ).sort((first, second) =>
    second.targetCount - first.targetCount ||
    second.rows.length - first.rows.length ||
    Math.abs(first.line - referenceLine) - Math.abs(second.line - referenceLine) ||
    second.latestAt - first.latestAt ||
    first.line - second.line
  )[0];
  return eligible?.line;
}

function targetMainCohortReady(pairs: Pair[]): boolean {
  return pairs.some((target) => USER_TARGET_BOOKS.has(target.sportsbook) && new Set(pairs.filter((candidate) =>
    !USER_TARGET_BOOKS.has(candidate.sportsbook) && candidate.line === target.line
  ).map((candidate) => candidate.sportsbook)).size >= 2);
}

function dominantLine(pairs: Pair[]): number | undefined {
  const cohorts = new Map<number, { books: Set<string>; latestAt: number }>();
  for (const pair of pairs) {
    const line = pair.line!;
    const cohort = cohorts.get(line) ?? { books: new Set<string>(), latestAt: 0 };
    cohort.books.add(pair.sportsbook);
    cohort.latestAt = Math.max(cohort.latestAt, Date.parse(pair.observedAt));
    cohorts.set(line, cohort);
  }
  return [...cohorts.entries()].sort((first, second) => second[1].books.size - first[1].books.size || second[1].latestAt - first[1].latestAt || first[0] - second[0])[0]?.[0];
}

function pairedMarketSelection(first: SideQuote, second: SideQuote): Pair["marketSelection"] | null {
  if (sameMarketSelection(first, second, "main_line")) return "main_line";
  if (sameMarketSelection(first, second, "coherent_paired_alternate")) return "coherent_paired_alternate";
  return null;
}

function sameMarketSelection(first: SideQuote, second: SideQuote, expected: Pair["marketSelection"]): boolean {
  return first.marketSelection === expected && second.marketSelection === expected;
}

function pairSelectionRank(value: Pair["marketSelection"]): number { return value === "main_line" ? 2 : 1; }

function strictGameIdentity(game: NcaafGame, row: SharpRow, startsAt: string): boolean {
  const expected = Date.parse(game.scheduledStart);
  const actual = Date.parse(startsAt);
  if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) > 15 * 60_000) return false;
  return teamMatches(row.home_team, game.home.name, game.home.abbreviation) && teamMatches(row.away_team, game.away.name, game.away.abbreviation);
}

function strictSharpEventIdentity(game: NcaafGame, event: SharpEventRow): boolean {
  const startsAt = iso(event.start_time ?? event.event_start_time ?? event.commence_time ?? event.scheduled);
  if (!startsAt || !sharpEventId(event)) return false;
  const expected = Date.parse(game.scheduledStart);
  const actual = Date.parse(startsAt);
  if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) > 15 * 60_000) return false;
  return teamMatches(eventTeam(event, "home"), game.home.name, game.home.abbreviation) &&
    teamMatches(eventTeam(event, "away"), game.away.name, game.away.abbreviation);
}

function sharpEventId(event: SharpEventRow): string | null {
  return identifier(event.id) ?? identifier(event.event_id) ?? identifier(event.eventId);
}

function eventTeam(event: SharpEventRow, side: "home" | "away"): unknown {
  const direct = side === "home"
    ? event.home_team ?? event.homeTeam ?? event.home
    : event.away_team ?? event.awayTeam ?? event.away;
  if (typeof direct === "string") return direct;
  const nested = record(direct);
  return nested.name ?? nested.full_name ?? nested.display_name ?? nested.abbreviation ?? null;
}

function teamMatches(raw: unknown, expectedName: string, abbreviation: string): boolean {
  const value = normalizeTeam(raw);
  const full = normalizeTeam(expectedName);
  const abbr = normalizeTeam(abbreviation);
  if (!value || !full || !abbr) return false;
  if (value === full || value === abbr) return true;
  return value.length >= 5 && (full.startsWith(value) || value.startsWith(full));
}

function marketHasThreeSameLineBooks(books: NcaafBookOdds[], market: "moneyline" | "spread" | "total"): boolean {
  const counts = new Map<string, Set<string>>();
  for (const book of books) {
    const slot = book[market];
    if (!slot) continue;
    const line = market === "moneyline" ? "ml" : market === "spread" ? String(Math.abs(book.spread!.homeLine)) : String(book.total!.line);
    const values = counts.get(line) ?? new Set<string>();
    values.add(normalize(book.sportsbook));
    counts.set(line, values);
  }
  return [...counts.values()].some((values) => values.size >= 3);
}

function validSide(market: Pair["market"], side: string): boolean {
  return market === "total" ? side === "over" || side === "under" : side === "home" || side === "away";
}

function bookCompleteness(book: NcaafBookOdds): number {
  return Number(Boolean(book.moneyline)) + Number(Boolean(book.spread)) + Number(Boolean(book.total));
}

function normalizeTeam(value: unknown): string {
  return text(value)?.replace(/^\s*\(\d+\)\s*/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function easternDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function record(value: unknown): Json { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function identifier(value: unknown): string | null { return text(value) ?? (typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null); }
function finite(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
function americanPrice(value: unknown): number | null { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed !== 0 && Math.abs(parsed) >= 100 && Math.abs(parsed) <= 100_000 ? parsed : null; }
function iso(value: unknown): string | null { const parsed = text(value); return parsed && Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : null; }
function latest(first: string, second: string): string { return Date.parse(first) >= Date.parse(second) ? first : second; }

export const __TEST__ = { TRUSTED_CONSENSUS_BOOKS, USER_TARGET_BOOKS, strictGameIdentity, strictSharpEventIdentity, teamMatches, marketHasThreeSameLineBooks, record };
