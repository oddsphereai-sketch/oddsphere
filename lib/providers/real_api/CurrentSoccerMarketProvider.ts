import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import type { RawOwlsOddsEvent, RawOwlsOddsResponse } from "@/lib/providers/owls/owlsSharpBookOdds";
import {
  normalizeBttsSelection,
  normalizeDoubleChanceSelection,
  normalizeMatchResultSelection,
  normalizeTotalSelection,
  validateNormalizedRecord,
  type NormalizedSoccerOddsRecord,
  type OfficialSoccerMarket,
} from "./_soccerMarketNormalizer";
import { eplClubNamesMatch, uclClubNamesMatch } from "./soccerClubIdentity";
import type { EplSharpFixtureMarket, EplSharpOddsRecord } from "./SharpApiEplMarketProvider";

export const CURRENT_SOCCER_MARKET_PROVIDER_RELEASE =
  "soccer_current_market_provider_2026_10_28_r1_owls_the_odds" as const;

export const THE_ODDS_API_SOCCER_CREDIT_RESERVE = 1_000 as const;
export const THE_ODDS_API_SOCCER_MAX_PAID_REQUESTS_PER_CYCLE = 20 as const;

type Competition = "epl" | "ucl";
type Selection = NormalizedSoccerOddsRecord["selection"];
type TeamsMatch = (left: string, right: string) => boolean;

export type StoredSoccerPriceObservation = {
  providerId: number;
  market: OfficialSoccerMarket;
  side: string;
  line: number | null;
  american: number;
  sportsbook: string | null;
  recordedAt: string;
  isOpener: boolean;
};

export type CurrentSoccerProviderTelemetry = {
  release: typeof CURRENT_SOCCER_MARKET_PROVIDER_RELEASE;
  owlsRequests: number;
  theOddsApiCatalogRequests: number;
  theOddsApiPaidRequests: number;
  theOddsApiCreditsUsed: number;
  theOddsApiCreditsRemaining: number | null;
  paidRequestHolds: string[];
};

type TheOddsEvent = {
  id?: string | null;
  commence_time?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  bookmakers?: Array<{
    key?: string | null;
    title?: string | null;
    last_update?: string | null;
    markets?: Array<{
      key?: string | null;
      last_update?: string | null;
      outcomes?: Array<{ name?: string | null; price?: number | string | null; point?: number | string | null }> | null;
    }> | null;
  }> | null;
};

const THE_ODDS_API_BASE_URL = "https://api.the-odds-api.com/v4";
const THE_ODDS_API_BOOKMAKERS = "pinnacle,draftkings,fanduel,betmgm,caesars";
const PROVIDER_TIMESTAMP_MAX_AGE_MS = 30 * 60_000;
const KICKOFF_MATCH_TOLERANCE_MS = 90 * 60_000;

const COMPETITION: Record<Competition, {
  theOddsSportKey: string;
  teamsMatch: TeamsMatch;
  owlsLeague: (value: string) => boolean;
}> = {
  epl: {
    theOddsSportKey: "soccer_epl",
    teamsMatch: eplClubNamesMatch,
    owlsLeague: (value) => {
      const league = token(value);
      return league === "englandpremierleague" || league === "englishpremierleague";
    },
  },
  ucl: {
    theOddsSportKey: "soccer_uefa_champs_league",
    teamsMatch: uclClubNamesMatch,
    owlsLeague: (value) => {
      const league = token(value);
      return league === "uefachampionsleague" || league === "europechampionsleague";
    },
  },
};

const REQUIRED_SIDES: Record<OfficialSoccerMarket, readonly Selection[]> = {
  match_result: ["home", "draw", "away"],
  double_chance: ["home_or_draw", "away_or_draw", "home_or_away"],
  total: ["over", "under"],
  btts: ["yes", "no"],
};

function token(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  const parsed = text(value);
  return parsed && Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : null;
}

function americanToDecimal(price: number): number | null {
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function fixtureMatches(
  event: { home_team?: string | null; away_team?: string | null; commence_time?: string | null },
  fixture: { home: string; away: string; kickoff: string },
  teamsMatch: TeamsMatch,
): boolean {
  const home = text(event.home_team);
  const away = text(event.away_team);
  const start = Date.parse(event.commence_time ?? "");
  const kickoff = Date.parse(fixture.kickoff);
  return Boolean(home && away && Number.isFinite(start) && Number.isFinite(kickoff)
    && teamsMatch(home, fixture.home) && teamsMatch(away, fixture.away)
    && Math.abs(start - kickoff) <= KICKOFF_MATCH_TOLERANCE_MS);
}

function owlsEvents(response: RawOwlsOddsResponse): RawOwlsOddsEvent[] {
  if (Array.isArray(response.data)) return response.data;
  if (!response.data || typeof response.data !== "object") return [];
  return Object.values(response.data).flatMap((rows) => Array.isArray(rows) ? rows : []);
}

function marketSelection(
  market: OfficialSoccerMarket,
  raw: string,
  home: string,
  away: string,
): Selection | null {
  if (market === "match_result") return normalizeMatchResultSelection(raw, { home_team: home, away_team: away });
  if (market === "double_chance") return normalizeDoubleChanceSelection(raw, { home_team: home, away_team: away });
  if (market === "total") return normalizeTotalSelection(raw);
  return normalizeBttsSelection(raw);
}

function normalizedRow(args: {
  market: OfficialSoccerMarket;
  selection: Selection;
  line: number | null;
  american: number;
  sportsbook: string;
  provider: "owls" | "the_odds_api" | "stored_quote";
  endpoint: string;
  observedAt: string;
  eventId: string | null;
  observedAtSource: "provider" | "oddsphere_capture";
  persistable?: boolean;
}): EplSharpOddsRecord | null {
  const decimal = americanToDecimal(args.american);
  if (decimal === null) return null;
  const record = validateNormalizedRecord({
    market: args.market,
    selection: args.selection,
    line: args.market === "total" ? args.line : null,
    odds_american: args.american,
    odds_decimal: decimal,
    sportsbook: args.sportsbook,
    provider: args.provider,
    provider_endpoint: args.endpoint,
    fetched_at: args.observedAt,
    provider_event_id: args.eventId,
  });
  return record ? { ...record, fetched_at_source: args.observedAtSource, persistable: args.persistable } : null;
}

function normalizeOwlsFixture(
  response: RawOwlsOddsResponse,
  competition: Competition,
  fixture: { home: string; away: string; kickoff: string },
  nowMs: number,
): { eventId: string | null; rows: EplSharpOddsRecord[] } {
  const config = COMPETITION[competition];
  const matched = owlsEvents(response).filter((event) =>
    config.owlsLeague(event.league ?? "") && fixtureMatches(event, fixture, config.teamsMatch));
  const rows: EplSharpOddsRecord[] = [];
  for (const event of matched) {
    const eventId = text(event.eventId) ?? (event.id === null || event.id === undefined ? null : String(event.id));
    const home = text(event.home_team) ?? fixture.home;
    const away = text(event.away_team) ?? fixture.away;
    for (const bookmaker of event.bookmakers ?? []) {
      const sportsbook = token(bookmaker.key ?? bookmaker.title);
      const observedAt = iso(bookmaker.last_update);
      if (!sportsbook || !observedAt || nowMs - Date.parse(observedAt) > PROVIDER_TIMESTAMP_MAX_AGE_MS) continue;
      for (const rawMarket of bookmaker.markets ?? []) {
        const key = token(rawMarket.key);
        const market: OfficialSoccerMarket | null = key === "h2h" ? "match_result" : key === "totals" ? "total" : null;
        if (!market) continue;
        for (const outcome of rawMarket.outcomes ?? []) {
          const rawName = text(outcome.name);
          const american = finite(outcome.price);
          const selection = rawName ? marketSelection(market, rawName, home, away) : null;
          const line = market === "total" ? finite(outcome.point) : null;
          if (!selection || american === null || (market === "total" && line === null)) continue;
          const row = normalizedRow({ market, selection, line, american, sportsbook, provider: "owls", endpoint: "/api/v1/soccer/odds", observedAt, eventId, observedAtSource: "provider" });
          if (row) rows.push(row);
        }
      }
    }
  }
  const eventIds = [...new Set(rows.map((row) => row.provider_event_id).filter((value): value is string => Boolean(value)))];
  return { eventId: eventIds.length === 1 ? eventIds[0]! : null, rows };
}

function completeMarket(rows: readonly EplSharpOddsRecord[], market: OfficialSoccerMarket): boolean {
  const relevant = rows.filter((row) => row.market === market && (market !== "total" || row.line === 2.5));
  const groups = new Map<string, Set<string>>();
  for (const row of relevant) {
    const key = `${token(row.sportsbook)}:${market === "total" ? row.line : "main"}`;
    const sides = groups.get(key) ?? new Set<string>();
    sides.add(row.selection);
    groups.set(key, sides);
  }
  return [...groups.values()].some((sides) => REQUIRED_SIDES[market].every((side) => sides.has(side)));
}

function freshnessCadenceMs(kickoff: string, nowMs: number): number {
  const untilKickoff = Date.parse(kickoff) - nowMs;
  if (untilKickoff <= 6 * 3_600_000) return 30 * 60_000;
  if (untilKickoff <= 48 * 3_600_000) return 60 * 60_000;
  return 6 * 3_600_000;
}

function freshStoredRows(args: {
  history: readonly StoredSoccerPriceObservation[];
  providerId: number | null;
  market: OfficialSoccerMarket;
  kickoff: string;
  nowMs: number;
}): EplSharpOddsRecord[] {
  if (args.providerId === null) return [];
  const cadence = freshnessCadenceMs(args.kickoff, args.nowMs);
  const latestByGroupSide = new Map<string, StoredSoccerPriceObservation>();
  for (const row of args.history) {
    if (row.providerId !== args.providerId || row.market !== args.market || !row.sportsbook || row.isOpener) continue;
    if (args.market === "total" && row.line !== 2.5) continue;
    const recorded = Date.parse(row.recordedAt);
    if (!Number.isFinite(recorded) || args.nowMs - recorded > cadence) continue;
    const key = `${token(row.sportsbook)}:${row.line ?? "main"}:${row.side}`;
    const prior = latestByGroupSide.get(key);
    if (!prior || Date.parse(prior.recordedAt) < recorded) latestByGroupSide.set(key, row);
  }
  const byGroup = new Map<string, StoredSoccerPriceObservation[]>();
  for (const row of latestByGroupSide.values()) {
    const key = `${token(row.sportsbook)}:${row.line ?? "main"}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }
  const complete = [...byGroup.values()]
    .filter((rows) => REQUIRED_SIDES[args.market].every((side) => rows.some((row) => row.side === side)))
    .sort((left, right) => Math.max(...right.map((row) => Date.parse(row.recordedAt))) - Math.max(...left.map((row) => Date.parse(row.recordedAt))))[0] ?? [];
  return complete.flatMap((row) => {
    const selection = REQUIRED_SIDES[args.market].find((side) => side === row.side) ?? null;
    if (!selection || !row.sportsbook) return [];
    const normalized = normalizedRow({
      market: args.market,
      selection,
      line: row.line,
      american: row.american,
      sportsbook: token(row.sportsbook),
      provider: "stored_quote",
      endpoint: "/line_history",
      observedAt: new Date(row.recordedAt).toISOString(),
      eventId: null,
      observedAtSource: "oddsphere_capture",
      persistable: false,
    });
    return normalized ? [normalized] : [];
  });
}

function theOddsMarketKey(market: OfficialSoccerMarket): string {
  if (market === "double_chance") return "double_chance";
  if (market === "btts") return "btts";
  if (market === "total") return "alternate_totals";
  return "h2h";
}

function normalizeTheOddsFixture(
  event: TheOddsEvent,
  requestedMarkets: readonly OfficialSoccerMarket[],
): EplSharpOddsRecord[] {
  const home = text(event.home_team);
  const away = text(event.away_team);
  const eventId = text(event.id);
  if (!home || !away || !eventId) return [];
  const rows: EplSharpOddsRecord[] = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const sportsbook = token(bookmaker.key ?? bookmaker.title);
    if (!sportsbook) continue;
    for (const rawMarket of bookmaker.markets ?? []) {
      const key = token(rawMarket.key);
      const market = requestedMarkets.find((candidate) => token(theOddsMarketKey(candidate)) === key) ?? null;
      const observedAt = iso(rawMarket.last_update ?? bookmaker.last_update);
      if (!market || !observedAt) continue;
      for (const outcome of rawMarket.outcomes ?? []) {
        const rawName = text(outcome.name);
        const american = finite(outcome.price);
        const selection = rawName ? marketSelection(market, rawName, home, away) : null;
        const line = market === "total" ? finite(outcome.point) : null;
        if (!selection || american === null || (market === "total" && line !== 2.5)) continue;
        const row = normalizedRow({ market, selection, line, american, sportsbook, provider: "the_odds_api", endpoint: `/v4/events/${eventId}/odds`, observedAt, eventId, observedAtSource: "provider" });
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

function headerInteger(headers: Headers, name: string): number | null {
  const parsed = Number(headers.get(name));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export class CurrentSoccerMarketProvider {
  private readonly config: typeof COMPETITION[Competition];
  private readonly owls: OwlsInsightClient | null;
  private readonly fixtureCache = new Map<string, Promise<EplSharpFixtureMarket>>();
  private owlsResponse: Promise<RawOwlsOddsResponse> | null = null;
  private theOddsEventsResponse: Promise<TheOddsEvent[]> | null = null;
  private paidRequests = 0;
  private creditsUsed = 0;
  private creditsRemaining: number | null = null;
  private owlsRequests = 0;
  private catalogRequests = 0;
  private readonly holds = new Set<string>();

  constructor(private readonly options: {
    competition: Competition;
    owlsApiKey?: string | null;
    theOddsApiKey?: string | null;
    storedPriceHistory?: readonly StoredSoccerPriceObservation[];
    now?: () => Date;
    fetchImpl?: typeof fetch;
    maxPaidRequests?: number;
  }) {
    this.config = COMPETITION[options.competition];
    this.owls = options.owlsApiKey ? new OwlsInsightClient(options.owlsApiKey, { fetchImpl: options.fetchImpl }) : null;
  }

  telemetry(): CurrentSoccerProviderTelemetry {
    return {
      release: CURRENT_SOCCER_MARKET_PROVIDER_RELEASE,
      owlsRequests: this.owlsRequests,
      theOddsApiCatalogRequests: this.catalogRequests,
      theOddsApiPaidRequests: this.paidRequests,
      theOddsApiCreditsUsed: this.creditsUsed,
      theOddsApiCreditsRemaining: this.creditsRemaining,
      paidRequestHolds: [...this.holds].sort(),
    };
  }

  loadFixture(fixture: { home: string; away: string; kickoff: string; providerId?: number }): Promise<EplSharpFixtureMarket> {
    const key = `${fixture.providerId ?? "none"}:${fixture.away}@${fixture.home}:${fixture.kickoff}`;
    const cached = this.fixtureCache.get(key);
    if (cached) return cached;
    const request = this.loadFixtureUncached(fixture);
    this.fixtureCache.set(key, request);
    return request;
  }

  private nowMs(): number {
    return (this.options.now ?? (() => new Date()))().getTime();
  }

  private owlsOdds(): Promise<RawOwlsOddsResponse> {
    if (!this.owls) return Promise.resolve({ success: false, data: [] });
    if (!this.owlsResponse) {
      this.owlsRequests += 1;
      this.owlsResponse = this.owls.odds<RawOwlsOddsResponse>("soccer").then((result) => result.body);
    }
    return this.owlsResponse;
  }

  private theOddsEvents(): Promise<TheOddsEvent[]> {
    if (this.theOddsEventsResponse) return this.theOddsEventsResponse;
    const apiKey = this.options.theOddsApiKey;
    if (!apiKey) return Promise.resolve([]);
    this.catalogRequests += 1;
    this.theOddsEventsResponse = (async () => {
      const url = new URL(`${THE_ODDS_API_BASE_URL}/sports/${this.config.theOddsSportKey}/events`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("dateFormat", "iso");
      const response = await (this.options.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      this.creditsRemaining = headerInteger(response.headers, "x-requests-remaining");
      if (!response.ok) throw new Error(`The Odds API soccer event catalog failed (${response.status}).`);
      const body = await response.json() as unknown;
      if (!Array.isArray(body)) throw new Error("The Odds API soccer event catalog was malformed.");
      return body as TheOddsEvent[];
    })();
    return this.theOddsEventsResponse;
  }

  private async paidEventOdds(eventId: string, markets: readonly OfficialSoccerMarket[]): Promise<TheOddsEvent | null> {
    const apiKey = this.options.theOddsApiKey;
    if (!apiKey || markets.length === 0) return null;
    const maxPaidRequests = this.options.maxPaidRequests ?? THE_ODDS_API_SOCCER_MAX_PAID_REQUESTS_PER_CYCLE;
    if (this.paidRequests >= maxPaidRequests) {
      this.holds.add("paid_request_ceiling");
      return null;
    }
    if (this.creditsRemaining === null || this.creditsRemaining - markets.length < THE_ODDS_API_SOCCER_CREDIT_RESERVE) {
      this.holds.add(this.creditsRemaining === null ? "credit_balance_unavailable" : "credit_reserve");
      return null;
    }
    const url = new URL(`${THE_ODDS_API_BASE_URL}/sports/${this.config.theOddsSportKey}/events/${eventId}/odds`);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("bookmakers", THE_ODDS_API_BOOKMAKERS);
    url.searchParams.set("markets", [...new Set(markets.map(theOddsMarketKey))].join(","));
    url.searchParams.set("oddsFormat", "american");
    url.searchParams.set("dateFormat", "iso");
    const response = await (this.options.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    this.paidRequests += 1;
    this.creditsUsed += headerInteger(response.headers, "x-requests-last") ?? markets.length;
    this.creditsRemaining = headerInteger(response.headers, "x-requests-remaining") ?? this.creditsRemaining;
    if (!response.ok) return null;
    const body = await response.json() as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? body as TheOddsEvent : null;
  }

  private async loadFixtureUncached(fixture: { home: string; away: string; kickoff: string; providerId?: number }): Promise<EplSharpFixtureMarket> {
    const nowMs = this.nowMs();
    const owls = normalizeOwlsFixture(await this.owlsOdds().catch(() => ({ success: false, data: [] })), this.options.competition, fixture, nowMs);
    const rows = [...owls.rows];
    for (const market of ["match_result", "double_chance", "total", "btts"] as const) {
      if (completeMarket(rows, market)) continue;
      rows.push(...freshStoredRows({
        history: this.options.storedPriceHistory ?? [],
        providerId: fixture.providerId ?? null,
        market,
        kickoff: fixture.kickoff,
        nowMs,
      }));
    }
    const missing = (["match_result", "double_chance", "total", "btts"] as const)
      .filter((market) => !completeMarket(rows, market));
    let theOddsEvent: TheOddsEvent | null = null;
    if (missing.length > 0 && Date.parse(fixture.kickoff) > nowMs) {
      if (!this.options.theOddsApiKey) {
        this.holds.add("api_key_unavailable");
      } else {
        const candidates = await this.theOddsEvents().catch(() => []);
        const matches = candidates.filter((event) => fixtureMatches(event, fixture, this.config.teamsMatch));
        if (matches.length === 1 && matches[0]?.id) {
          theOddsEvent = await this.paidEventOdds(matches[0].id, missing);
          if (theOddsEvent) rows.push(...normalizeTheOddsFixture(theOddsEvent, missing));
        } else if (matches.length > 1) {
          this.holds.add("ambiguous_event_identity");
        } else {
          this.holds.add("event_not_published");
        }
      }
    }
    const eventId = owls.eventId ?? text(theOddsEvent?.id);
    return { eventId, odds: rows, splits: [], splitsState: "unavailable" };
  }
}

export const __TEST__ = {
  completeMarket,
  freshStoredRows,
  normalizeOwlsFixture,
  normalizeTheOddsFixture,
};
