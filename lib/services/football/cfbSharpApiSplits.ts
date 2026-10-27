import { SharpApiClient, type SharpApiRequestOptions, type SharpApiResponse } from "@/lib/providers/real_api/_sharpApiClient";
import type { NcaafGame } from "./balldontlieNcaafSlate";
import { cfbProviderTeamMatches } from "./cfbProviderTeamIdentity";

export const CFB_SHARP_API_SPLITS_RELEASE =
  "cfb_sharpapi_splits_2026_10_27_r7_exact_event_history_continuity" as const;
export const CFB_SHARP_API_SPLITS_MAX_GAMES = 128 as const;
export const CFB_SHARP_API_SPLITS_MAX_ROWS = 200 as const;
export const CFB_SHARP_API_SPLITS_HISTORY_MAX_GAMES = 8 as const;
const CFB_SHARP_API_SPLITS_HISTORY_LOOKAHEAD_MS = 36 * 60 * 60 * 1_000;
const CFB_SHARP_API_SPLITS_HISTORY_LOOKBACK_MS = 36 * 60 * 60 * 1_000;
const CFB_SHARP_API_SPLITS_HISTORY_MAX_ROWS = 1_000;

type Json = Record<string, unknown>;
type SharpClient = {
  fetch<T>(opts: SharpApiRequestOptions): Promise<SharpApiResponse<T>>;
};

export type CfbSharpApiSplitSide = {
  ticketsPct: number;
  moneyPct: number;
};

export type CfbSharpApiSplitRecord = {
  release: typeof CFB_SHARP_API_SPLITS_RELEASE;
  providerGameId: string;
  providerEventId: string;
  sportsbook: "draftkings" | "circa";
  sourceSemantics: "public_recreational" | "sharp_adjacent";
  capturedAt: string;
  moneyline: { away: CfbSharpApiSplitSide; home: CfbSharpApiSplitSide } | null;
  spread: {
    awayLine: number;
    homeLine: number;
    away: CfbSharpApiSplitSide;
    home: CfbSharpApiSplitSide;
  } | null;
  total: {
    line: number;
    over: CfbSharpApiSplitSide;
    under: CfbSharpApiSplitSide;
  } | null;
};

export type CfbSharpApiSplitResult = {
  release: typeof CFB_SHARP_API_SPLITS_RELEASE;
  requests: number;
  rawRows: number;
  attemptedGames: number;
  matchedGames: number;
  historyRecoveredGames: number;
  recordsByGame: Record<string, CfbSharpApiSplitRecord[]>;
};

export async function fetchCfbSharpApiSplits(args: {
  games: NcaafGame[];
  apiKey?: string;
  client?: SharpClient;
  historyRecoveryNow?: Date;
}): Promise<CfbSharpApiSplitResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()];
  if (games.length > CFB_SHARP_API_SPLITS_MAX_GAMES) {
    throw new Error(`CFB SharpAPI splits cannot exceed ${CFB_SHARP_API_SPLITS_MAX_GAMES} exact games per run.`);
  }
  const key = args.apiKey ?? process.env.SHARPAPI_KEY;
  if (!key && !args.client) throw new Error("SHARPAPI_KEY is required for CFB splits.");
  const client = args.client ?? new SharpApiClient(key!);
  const response = await client.fetch<unknown[]>({
    path: "/splits",
    query: { league: "ncaaf", sportsbook: "draftkings,circa", limit: CFB_SHARP_API_SPLITS_MAX_ROWS },
    retryRateLimitInternally: false,
  });
  if (!Array.isArray(response.data)) throw new Error("SharpAPI NCAAF splits returned malformed data.");
  if (response.pagination?.has_more === true) {
    throw new Error(`SharpAPI NCAAF splits exceeded the bounded ${CFB_SHARP_API_SPLITS_MAX_ROWS}-row slate request.`);
  }
  const rows = response.data.map(record);
  let requests = 1;
  let historyRows = 0;
  const recordsByGame: Record<string, CfbSharpApiSplitRecord[]> = {};
  for (const game of games) {
    const matches = rows.filter((row) => strictSplitIdentity(game, row));
    const byBook = new Map<string, Json[]>();
    for (const row of matches) {
      const sportsbook = normalize(text(row.sportsbook) ?? "");
      if (sportsbook !== "draftkings" && sportsbook !== "circa") continue;
      byBook.set(sportsbook, [...(byBook.get(sportsbook) ?? []), row]);
    }
    const records: CfbSharpApiSplitRecord[] = [];
    for (const [sportsbook, bookRows] of byBook) {
      if (bookRows.length !== 1) {
        throw new Error(`Ambiguous SharpAPI ${sportsbook} split identity for CFB game ${game.providerGameId}.`);
      }
      const normalized = normalizeSplitRow(game, bookRows[0]!);
      if (normalized) records.push(normalized);
    }
    recordsByGame[game.providerGameId] = records.sort((first, second) => first.sportsbook.localeCompare(second.sportsbook));
  }
  let historyRecoveredGames = 0;
  if (args.historyRecoveryNow) {
    const recovery = await recoverExactEventHistory({
      client,
      games: games.filter((game) => !hasUsableRecord(recordsByGame[game.providerGameId] ?? [])),
      now: args.historyRecoveryNow,
    });
    requests += recovery.requests;
    historyRows += recovery.rawRows;
    for (const [providerGameId, records] of Object.entries(recovery.recordsByGame)) {
      if (records.length === 0 || hasUsableRecord(recordsByGame[providerGameId] ?? [])) continue;
      recordsByGame[providerGameId] = records;
      historyRecoveredGames += 1;
    }
  }
  return {
    release: CFB_SHARP_API_SPLITS_RELEASE,
    requests,
    rawRows: rows.length + historyRows,
    attemptedGames: games.length,
    matchedGames: Object.values(recordsByGame).filter((records) => records.length > 0).length,
    historyRecoveredGames,
    recordsByGame,
  };
}

type SharpEventCatalogRow = Json & {
  id?: unknown;
  away_team?: unknown;
  home_team?: unknown;
  books?: unknown;
};

async function recoverExactEventHistory(args: {
  client: SharpClient;
  games: NcaafGame[];
  now: Date;
}): Promise<{
  requests: number;
  rawRows: number;
  recordsByGame: Record<string, CfbSharpApiSplitRecord[]>;
}> {
  const nowMs = args.now.getTime();
  const eligible = args.games
    .filter((game) => {
      const startMs = Date.parse(game.scheduledStart);
      return Number.isFinite(startMs) && startMs > nowMs && startMs - nowMs <= CFB_SHARP_API_SPLITS_HISTORY_LOOKAHEAD_MS;
    })
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart))
    .slice(0, CFB_SHARP_API_SPLITS_HISTORY_MAX_GAMES);
  const recordsByGame = Object.fromEntries(eligible.map((game) => [game.providerGameId, [] as CfbSharpApiSplitRecord[]]));
  if (eligible.length === 0) return { requests: 0, rawRows: 0, recordsByGame };

  let requests = 0;
  let rawRows = 0;
  const catalogByDate = new Map<string, SharpEventCatalogRow[]>();
  const dates = [...new Set(eligible.flatMap((game) => [...acceptedGameDates(game.scheduledStart)]))].sort();
  for (const date of dates) {
    const response = await args.client.fetch<unknown[]>({
      path: "/events",
      query: { league: "ncaaf", date, limit: CFB_SHARP_API_SPLITS_MAX_ROWS },
      retryRateLimitInternally: false,
    });
    requests += 1;
    if (!Array.isArray(response.data)) throw new Error("SharpAPI NCAAF event catalog returned malformed data.");
    if (response.pagination?.has_more === true) {
      throw new Error(`SharpAPI NCAAF event catalog exceeded the bounded ${CFB_SHARP_API_SPLITS_MAX_ROWS}-row request.`);
    }
    catalogByDate.set(date, response.data.map(record));
  }

  const historyStart = new Date(nowMs - CFB_SHARP_API_SPLITS_HISTORY_LOOKBACK_MS).toISOString();
  for (const game of eligible) {
    const candidates = [...acceptedGameDates(game.scheduledStart)]
      .flatMap((date) => catalogByDate.get(date) ?? [])
      .filter((event) => eventCatalogMatchesGame(game, event))
      .sort((first, second) => eventCatalogRank(game, second) - eventCatalogRank(game, first));
    const seenIds = new Set<string>();
    for (const event of candidates) {
      const eventId = text(event.id);
      if (!eventId || seenIds.has(eventId)) continue;
      seenIds.add(eventId);
      const response = await args.client.fetch<unknown[]>({
        path: "/splits/history",
        query: {
          event_id: eventId,
          start_time: historyStart,
          limit: CFB_SHARP_API_SPLITS_HISTORY_MAX_ROWS,
        },
        retryRateLimitInternally: false,
      });
      requests += 1;
      if (!Array.isArray(response.data)) throw new Error("SharpAPI NCAAF split history returned malformed data.");
      rawRows += response.data.length;
      const recovered = newestUsableHistoryRecords(game, event, eventId, response.data.map(record));
      if (recovered.length > 0) {
        recordsByGame[game.providerGameId] = recovered;
        break;
      }
      // Some providers publish a duplicate abbreviated event identity. Bound
      // the exact-game probe to two catalog candidates rather than scanning
      // every sportsbook/futures object returned for the date.
      if (seenIds.size >= 2) break;
    }
  }
  return { requests, rawRows, recordsByGame };
}

function newestUsableHistoryRecords(
  game: NcaafGame,
  event: SharpEventCatalogRow,
  eventId: string,
  rows: Json[],
): CfbSharpApiSplitRecord[] {
  const newest = new Map<"draftkings" | "circa", CfbSharpApiSplitRecord>();
  for (const historyRow of rows) {
    const sportsbook = normalize(text(historyRow.book) ?? text(historyRow.sportsbook) ?? "");
    if (sportsbook !== "draftkings" && sportsbook !== "circa") continue;
    const normalized = normalizeSplitRow(game, {
      ...historyRow,
      event_id: eventId,
      league: "ncaaf",
      sportsbook,
      away_team: event.away_team,
      home_team: event.home_team,
      fetched_at: historyTimestamp(historyRow),
    });
    if (!normalized || !hasUsableRecord([normalized])) continue;
    const prior = newest.get(sportsbook);
    if (!prior || Date.parse(normalized.capturedAt) > Date.parse(prior.capturedAt)) {
      newest.set(sportsbook, normalized);
    }
  }
  return [...newest.values()].sort((first, second) => first.sportsbook.localeCompare(second.sportsbook));
}

function historyTimestamp(row: Json): string | null {
  const direct = iso(row.fetched_at) ?? iso(row.observed_at);
  if (direct) return direct;
  const raw = finite(row.timestamp) ?? finite(row.ts);
  if (raw === null) return null;
  const milliseconds = raw < 10_000_000_000 ? raw * 1_000 : raw;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function eventCatalogMatchesGame(game: NcaafGame, event: SharpEventCatalogRow): boolean {
  const eventId = text(event.id);
  const eventDate = eventId?.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  if (!eventId || !eventDate || !acceptedGameDates(game.scheduledStart).has(eventDate)) return false;
  return teamMatches(event.away_team, game.away.name, game.away.abbreviation) &&
    teamMatches(event.home_team, game.home.name, game.home.abbreviation);
}

function eventCatalogRank(game: NcaafGame, event: SharpEventCatalogRow): number {
  const books = Array.isArray(event.books) ? event.books.map((book) => normalize(String(book))) : [];
  const exactNames = normalize(text(event.away_team) ?? "") === normalize(game.away.name) &&
    normalize(text(event.home_team) ?? "") === normalize(game.home.name);
  return (exactNames ? 4 : 0) + (books.includes("circa") ? 2 : 0) + (books.includes("draftkings") ? 1 : 0);
}

function hasUsableRecord(records: CfbSharpApiSplitRecord[]): boolean {
  return records.some((record) => record.moneyline !== null || record.spread !== null || record.total !== null);
}

function normalizeSplitRow(game: NcaafGame, row: Json): CfbSharpApiSplitRecord | null {
  const providerEventId = text(row.event_id);
  const sportsbook = normalize(text(row.sportsbook) ?? "");
  const capturedAt = iso(row.fetched_at);
  if (!providerEventId || !capturedAt || (sportsbook !== "draftkings" && sportsbook !== "circa")) return null;
  const book = sportsbook as "draftkings" | "circa";
  return {
    release: CFB_SHARP_API_SPLITS_RELEASE,
    providerGameId: game.providerGameId,
    providerEventId,
    sportsbook: book,
    sourceSemantics: book === "circa" ? "sharp_adjacent" : "public_recreational",
    capturedAt,
    moneyline: opposingSplit(record(row.moneyline), "away", "home"),
    spread: spreadSplit(record(row.spread)),
    total: totalSplit(record(row.total)),
  };
}

function opposingSplit(slot: Json, first: "away", second: "home"): CfbSharpApiSplitRecord["moneyline"];
function opposingSplit(slot: Json, first: "over", second: "under"): { over: CfbSharpApiSplitSide; under: CfbSharpApiSplitSide } | null;
function opposingSplit(slot: Json, first: "away" | "over", second: "home" | "under") {
  const bets = record(slot.bets_pct);
  const handle = record(slot.handle_pct);
  const firstSide = side(bets[first], handle[first]);
  const secondSide = side(bets[second], handle[second]);
  if (!firstSide || !secondSide || !complementary(firstSide.ticketsPct, secondSide.ticketsPct) ||
    !complementary(firstSide.moneyPct, secondSide.moneyPct)) return null;
  return { [first]: firstSide, [second]: secondSide };
}

function spreadSplit(slot: Json): CfbSharpApiSplitRecord["spread"] {
  const values = opposingSplit(slot, "away", "home");
  const awayLine = finite(slot.away_odds) ?? finite(slot.away_line);
  const homeLine = finite(slot.home_odds) ?? finite(slot.home_line);
  return values && awayLine !== null && homeLine !== null && Math.abs(awayLine + homeLine) < 0.001
    ? { awayLine, homeLine, away: values.away, home: values.home }
    : null;
}

function totalSplit(slot: Json): CfbSharpApiSplitRecord["total"] {
  const values = opposingSplit(slot, "over", "under");
  const line = finite(slot.line);
  return values && line !== null ? { line, over: values.over, under: values.under } : null;
}

function side(tickets: unknown, money: unknown): CfbSharpApiSplitSide | null {
  const ticketsPct = percentage(tickets);
  const moneyPct = percentage(money);
  return ticketsPct === null || moneyPct === null ? null : { ticketsPct, moneyPct };
}

function strictSplitIdentity(game: NcaafGame, row: Json): boolean {
  if (normalize(text(row.league) ?? "") !== "ncaaf") return false;
  const eventId = text(row.event_id);
  const eventDate = eventId?.match(/_(\d{4}-\d{2}-\d{2})(?:_|$)/)?.[1] ?? null;
  if (!eventDate || !acceptedGameDates(game.scheduledStart).has(eventDate)) return false;
  return teamMatches(row.away_team, game.away.name, game.away.abbreviation) &&
    teamMatches(row.home_team, game.home.name, game.home.abbreviation);
}

function acceptedGameDates(scheduledStart: string): Set<string> {
  return new Set([
    scheduledStart.slice(0, 10),
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(scheduledStart)),
  ]);
}

function teamMatches(raw: unknown, expectedName: string, abbreviation: string): boolean {
  return cfbProviderTeamMatches({ observed: raw, expectedName, abbreviation });
}

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function percentage(value: unknown): number | null {
  const parsed = finite(value);
  if (parsed === null || parsed < 0 || parsed > 100) return null;
  const normalized = parsed <= 1 ? 100 * parsed : parsed;
  return normalized >= 0 && normalized <= 100 ? Math.round(normalized * 1_000_000) / 1_000_000 : null;
}

function complementary(first: number, second: number): boolean {
  return Math.abs(first + second - 100) <= 1;
}

function iso(value: unknown): string | null {
  const parsed = text(value);
  return parsed && Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const __TEST__ = {
  strictSplitIdentity,
  teamMatches,
  normalizeSplitRow,
  historyTimestamp,
  eventCatalogMatchesGame,
  newestUsableHistoryRecords,
};
