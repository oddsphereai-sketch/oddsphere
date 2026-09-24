import {
  SharpApiClient,
  type SharpApiRequestOptions,
  type SharpApiResponse,
} from "@/lib/providers/real_api/_sharpApiClient";
import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";
import type { NflPreviewBookOdds, NflPreviewGame } from "./balldontlieNflPreviewSlate";

export const FOOTBALL_SHARP_PRICE_CAPTURE_RELEASE =
  "football_sharp_price_capture_2026_09_24_r1" as const;
export const FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK = 12 as const;
export const FOOTBALL_SHARP_PRICE_CAPTURE_PAGE_SIZE = 200 as const;
export const FOOTBALL_SHARP_PRICE_CAPTURE_TIMEOUT_MS = 20_000 as const;
export const FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS = ["circa", "pinnacle"] as const;

type Json = Record<string, unknown>;
type SharpClient = {
  fetch<T>(opts: SharpApiRequestOptions): Promise<SharpApiResponse<T>>;
};
type FootballGame = Pick<NflPreviewGame, "providerGameId" | "scheduledStart" | "home" | "away">;
type Market = "moneyline" | "spread" | "total";
type Side = "home" | "away" | "over" | "under";
type Quote = { side: Side; line: number | null; price: number; observedAt: string };
type SharpBook = typeof FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS[number];

export type FootballSharpOddsResult<TBook> = {
  release: typeof FOOTBALL_SHARP_PRICE_CAPTURE_RELEASE;
  requests: number;
  rows: number;
  matchedGames: number;
  failedBooks: SharpBook[];
  failures: Array<{ sportsbook: SharpBook; reason: string }>;
  booksByGame: Record<string, TBook[]>;
};

/**
 * Produces an evidence-only book set. Each verified SharpAPI sharp-book tuple
 * replaces only its same-family incumbent inside the capture. This array must
 * never be threaded into the production quote or consensus inputs.
 */
export function captureBooksWithSharpBooks<T extends { sportsbook: string }>(
  productionBooks: readonly T[],
  sharpBooks: readonly T[],
): T[] {
  const capturedFamilies = new Set(sharpBooks.map((book) => normalize(book.sportsbook)));
  return [
    ...sharpBooks,
    ...productionBooks.filter((book) => !capturedFamilies.has(normalize(book.sportsbook))),
  ];
}

export async function fetchSharpApiNflSharpOdds(args: {
  games: NflPreviewGame[];
  apiKey?: string;
  client?: SharpClient;
}): Promise<FootballSharpOddsResult<NflPreviewBookOdds>> {
  const result = await fetchFootballSharpOdds({ league: "nfl", games: args.games, apiKey: args.apiKey, client: args.client });
  return {
    ...result,
    booksByGame: Object.fromEntries(Object.entries(result.booksByGame).map(([gameId, books]) => [
      gameId,
      books.map(toNflBook),
    ])),
  };
}

export async function fetchSharpApiNcaafSharpOdds(args: {
  games: NcaafGame[];
  apiKey?: string;
  client?: SharpClient;
}): Promise<FootballSharpOddsResult<NcaafBookOdds>> {
  const result = await fetchFootballSharpOdds({ league: "ncaaf", games: args.games, apiKey: args.apiKey, client: args.client });
  return {
    ...result,
    booksByGame: Object.fromEntries(Object.entries(result.booksByGame).map(([gameId, books]) => [
      gameId,
      books.map(toNcaafBook),
    ])),
  };
}

type CapturedBook = {
  providerGameId: string;
  providerEventId: string;
  sportsbook: SharpBook;
  observedAt: string;
  moneyline: NflPreviewBookOdds["moneyline"];
  spread: NflPreviewBookOdds["spread"];
  total: NflPreviewBookOdds["total"];
  marketObservedAt: Partial<Record<Market, string>>;
};

async function fetchFootballSharpOdds(args: {
  league: "nfl" | "ncaaf";
  games: FootballGame[];
  apiKey?: string;
  client?: SharpClient;
}): Promise<FootballSharpOddsResult<CapturedBook>> {
  const key = args.apiKey ?? process.env.SHARPAPI_KEY;
  if (!key && !args.client) throw new Error("SHARPAPI_KEY is required for sharp-book football price capture.");
  const client = args.client ?? new SharpApiClient(key!);
  const attempts = await Promise.allSettled(FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS.map((sportsbook) =>
    fetchBookPages({ client, league: args.league, sportsbook })));
  const rows = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? attempt.value.rows : []);
  const failedBooks = attempts.flatMap((attempt, index) => attempt.status === "rejected"
    ? [FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS[index]!]
    : []);
  const failures = attempts.flatMap((attempt, index) => attempt.status === "rejected"
    ? [{
      sportsbook: FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS[index]!,
      reason: attempt.reason instanceof Error ? attempt.reason.message : "unknown_sharp_book_capture_error",
    }]
    : []);
  const requests = attempts.reduce((sum, attempt) => sum + (attempt.status === "fulfilled"
    ? attempt.value.requests
    : FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK), 0);

  const booksByGame: Record<string, CapturedBook[]> = {};
  const claimedEvents = new Set<string>();
  for (const game of args.games) {
    booksByGame[game.providerGameId] = [];
    for (const sportsbook of FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS) {
      const matchingEventIds = [...new Set(rows
        .filter((row) => normalize(text(row.sportsbook) ?? "") === sportsbook && strictGameIdentity(game, row))
        .map((row) => identifier(row.event_id))
        .filter((value): value is string => value !== null))];
      if (matchingEventIds.length !== 1) continue;
      const eventId = matchingEventIds[0]!;
      const claim = `${sportsbook}:${eventId}`;
      if (claimedEvents.has(claim)) throw new Error(`${args.league} ${sportsbook} event ${eventId} matched multiple games.`);
      claimedEvents.add(claim);
      const book = buildBook(game, eventId, sportsbook, rows);
      if (book) booksByGame[game.providerGameId]!.push(book);
    }
  }
  return {
    release: FOOTBALL_SHARP_PRICE_CAPTURE_RELEASE,
    requests,
    rows: rows.length,
    matchedGames: Object.values(booksByGame).filter((books) => books.length > 0).length,
    failedBooks,
    failures,
    booksByGame,
  };
}

async function fetchBookPages(args: {
  client: SharpClient;
  league: "nfl" | "ncaaf";
  sportsbook: SharpBook;
}): Promise<{ rows: Json[]; requests: number }> {
  const signal = AbortSignal.timeout(FOOTBALL_SHARP_PRICE_CAPTURE_TIMEOUT_MS);
  const rows: Json[] = [];
  const fingerprints = new Set<string>();
  let offset = 0;
  let cursor: string | null = null;
  let requests = 0;
  let complete = false;
  for (let page = 0; page < FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK; page += 1) {
    requests += 1;
    const response = await args.client.fetch<unknown[]>({
      path: "/odds",
      query: {
        league: args.league,
        sportsbook: args.sportsbook,
        market: "main",
        is_live: false,
        limit: FOOTBALL_SHARP_PRICE_CAPTURE_PAGE_SIZE,
        ...(cursor ? { cursor } : offset > 0 ? { offset } : {}),
      },
      signal,
      retryRateLimitInternally: false,
    });
    if (!Array.isArray(response.data)) throw new Error(`${args.league} ${args.sportsbook} odds returned malformed data.`);
    const fingerprint = JSON.stringify(response.data);
    if (response.data.length > 0 && fingerprints.has(fingerprint)) {
      throw new Error(`${args.league} ${args.sportsbook} odds pagination repeated a prior page.`);
    }
    if (response.data.length > 0) fingerprints.add(fingerprint);
    rows.push(...response.data.map(record));
    if (response.pagination?.has_more !== true) {
      complete = true;
      break;
    }
    const nextCursor = paginationCursor(response.pagination);
    if (cursor !== null) {
      if (!nextCursor || nextCursor === cursor) {
        throw new Error(`${args.league} ${args.sportsbook} odds cursor pagination did not advance.`);
      }
      cursor = nextCursor;
      continue;
    }
    const next = nextOffset(response.pagination, offset, response.data.length);
    if (next !== null && next <= 500) {
      offset = next;
      continue;
    }
    if (!nextCursor) throw new Error(`${args.league} ${args.sportsbook} odds pagination did not advance.`);
    cursor = nextCursor;
  }
  if (!complete) throw new Error(`${args.league} ${args.sportsbook} odds exceeded the bounded pagination cap.`);
  return { rows, requests };
}

function buildBook(game: FootballGame, eventId: string, sportsbook: SharpBook, rows: Json[]): CapturedBook | null {
  const latest = new Map<string, Quote>();
  for (const row of rows) {
    if (identifier(row.event_id) !== eventId || !strictGameIdentity(game, row)) continue;
    if (normalize(text(row.sportsbook) ?? "") !== sportsbook) continue;
    if (row.is_live === true || row.is_active === false || row.is_stale_pregame_price === true || row.is_player_prop === true) continue;
    if (row.is_main_line !== true || row.is_alternate_line === true) continue;
    const market = marketType(row.market_type);
    const side = sideType(row.selection_type);
    const price = americanPrice(row.odds_american);
    const observedAt = iso(row.timestamp);
    const line = market === "moneyline" ? null : finite(row.line);
    if (!market || !side || !validSide(market, side) || price === null || !observedAt) continue;
    if (market !== "moneyline" && line === null) continue;
    const key = `${market}:${side}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(observedAt) > Date.parse(prior.observedAt)) latest.set(key, { side, line, price, observedAt });
  }
  const mlHome = latest.get("moneyline:home");
  const mlAway = latest.get("moneyline:away");
  const spHome = latest.get("spread:home");
  const spAway = latest.get("spread:away");
  const totalOver = latest.get("total:over");
  const totalUnder = latest.get("total:under");
  const moneyline = mlHome && mlAway ? { homePrice: mlHome.price, awayPrice: mlAway.price } : null;
  const spread = spHome && spAway && spHome.line !== null && spAway.line !== null && Math.abs(spHome.line + spAway.line) < 0.001
    ? { homeLine: spHome.line, homePrice: spHome.price, awayLine: spAway.line, awayPrice: spAway.price }
    : null;
  const total = totalOver && totalUnder && totalOver.line !== null && totalUnder.line !== null && Math.abs(totalOver.line - totalUnder.line) < 0.001
    ? { line: totalOver.line, overPrice: totalOver.price, underPrice: totalUnder.price }
    : null;
  const observations: Partial<Record<Market, string>> = {};
  if (moneyline) observations.moneyline = newest(mlHome!.observedAt, mlAway!.observedAt);
  if (spread) observations.spread = newest(spHome!.observedAt, spAway!.observedAt);
  if (total) observations.total = newest(totalOver!.observedAt, totalUnder!.observedAt);
  const observedAt = Object.values(observations).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  if (!observedAt) return null;
  return { providerGameId: game.providerGameId, providerEventId: eventId, sportsbook, observedAt, moneyline, spread, total, marketObservedAt: observations };
}

function toNflBook(book: CapturedBook): NflPreviewBookOdds {
  return {
    providerGameId: book.providerGameId,
    sportsbook: book.sportsbook,
    observedAt: book.observedAt,
    provider: "sharpapi",
    providerEventId: book.providerEventId,
    targetEligible: false,
    marketSelection: Object.fromEntries(Object.keys(book.marketObservedAt).map((market) => [market, "main_line"])),
    marketObservedAt: book.marketObservedAt,
    moneyline: book.moneyline,
    spread: book.spread,
    total: book.total,
  };
}

function toNcaafBook(book: CapturedBook): NcaafBookOdds {
  return {
    ...toNflBook(book),
    provider: "sharpapi",
    marketQuotes: [],
  };
}

function strictGameIdentity(game: FootballGame, row: Json): boolean {
  const startsAt = iso(row.event_start_time);
  if (!startsAt) return false;
  const expected = Date.parse(game.scheduledStart);
  const actual = Date.parse(startsAt);
  if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) > 15 * 60_000) return false;
  return teamMatches(row.home_team, game.home.name, game.home.abbreviation) && teamMatches(row.away_team, game.away.name, game.away.abbreviation);
}

function teamMatches(raw: unknown, expectedName: string, abbreviation: string): boolean {
  const value = normalizeTeam(raw);
  const full = normalizeTeam(expectedName);
  const abbr = normalizeTeam(abbreviation);
  if (!value || !full || !abbr) return false;
  if (value === full || value === abbr) return true;
  return value.length >= 5 && (full.startsWith(value) || value.startsWith(full));
}

function nextOffset(pagination: SharpApiResponse<unknown>["pagination"], requested: number, returned: number): number | null {
  const direct = pagination?.next_offset;
  if (typeof direct === "number" && Number.isInteger(direct) && direct > requested) return direct;
  if (!Number.isInteger(returned) || returned < 1) return null;
  const reported = pagination?.offset;
  if (reported !== undefined && (!Number.isInteger(reported) || reported !== requested)) return null;
  const limit = pagination?.limit;
  const advance = typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : returned;
  const derived = requested + advance;
  return Number.isSafeInteger(derived) && derived > requested ? derived : null;
}

function paginationCursor(pagination: SharpApiResponse<unknown>["pagination"]): string | null {
  return text((pagination as unknown as Json | null)?.next_cursor);
}

function marketType(value: unknown): Market | null {
  const normalized = text(value)?.toLowerCase();
  if (normalized === "moneyline") return "moneyline";
  if (normalized === "point_spread") return "spread";
  if (normalized === "total_points") return "total";
  return null;
}
function sideType(value: unknown): Side | null { const side = text(value)?.toLowerCase(); return side === "home" || side === "away" || side === "over" || side === "under" ? side : null; }
function validSide(market: Market, side: Side): boolean { return market === "total" ? side === "over" || side === "under" : side === "home" || side === "away"; }
function record(value: unknown): Json { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function identifier(value: unknown): string | null { return text(value) ?? (typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null); }
function finite(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
function americanPrice(value: unknown): number | null { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed !== 0 && Math.abs(parsed) >= 100 && Math.abs(parsed) <= 100_000 ? parsed : null; }
function iso(value: unknown): string | null { const parsed = text(value); return parsed && Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : null; }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function normalizeTeam(value: unknown): string { return text(value)?.replace(/^\s*\(\d+\)\s*/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "") ?? ""; }
function newest(first: string, second: string): string { return Date.parse(first) >= Date.parse(second) ? first : second; }

export const __TEST__ = { strictGameIdentity, buildBook, nextOffset, paginationCursor };
