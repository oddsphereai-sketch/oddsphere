import { SharpApiClient, type SharpApiRequestOptions, type SharpApiResponse } from "@/lib/providers/real_api/_sharpApiClient";
import type { NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_SHARP_API_SPLITS_RELEASE =
  "cfb_sharpapi_splits_2026_08_30_r2_full_week_capacity" as const;
export const CFB_SHARP_API_SPLITS_MAX_GAMES = 128 as const;
export const CFB_SHARP_API_SPLITS_MAX_ROWS = 200 as const;

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
  requests: 1;
  rawRows: number;
  attemptedGames: number;
  matchedGames: number;
  recordsByGame: Record<string, CfbSharpApiSplitRecord[]>;
};

export async function fetchCfbSharpApiSplits(args: {
  games: NcaafGame[];
  apiKey?: string;
  client?: SharpClient;
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
  return {
    release: CFB_SHARP_API_SPLITS_RELEASE,
    requests: 1,
    rawRows: rows.length,
    attemptedGames: games.length,
    matchedGames: Object.values(recordsByGame).filter((records) => records.length > 0).length,
    recordsByGame,
  };
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
  const awayLine = finite(slot.away_odds);
  const homeLine = finite(slot.home_odds);
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
  const value = normalizeTeam(raw);
  const full = normalizeTeam(expectedName);
  const abbr = normalizeTeam(abbreviation);
  if (!value || !full || !abbr) return false;
  if (value === full || value === abbr) return true;
  return value.length >= 5 && (full.startsWith(value) || value.startsWith(full));
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

function normalizeTeam(value: unknown): string {
  return text(value)?.replace(/^\s*\(\d+\)\s*/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

export const __TEST__ = { strictSplitIdentity, teamMatches, normalizeSplitRow };
