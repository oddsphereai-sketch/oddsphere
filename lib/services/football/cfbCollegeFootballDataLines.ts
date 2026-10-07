import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_COLLEGE_FOOTBALL_DATA_LINES_RELEASE =
  "cfb_college_football_data_lines_2026_10_07_r1_strict_week_named_book" as const;
export const CFB_COLLEGE_FOOTBALL_DATA_REFRESH_MINUTES = 360 as const;
export const CFB_COLLEGE_FOOTBALL_DATA_MAX_REQUESTS_PER_RUN = 1 as const;
export const CFB_COLLEGE_FOOTBALL_DATA_TIMEOUT_MS = 8_000 as const;
export const CFB_COLLEGE_FOOTBALL_DATA_MAX_RESPONSE_BYTES = 4_000_000 as const;

type JsonRecord = Record<string, unknown>;

export type CfbCollegeFootballDataContextLine = {
  provider: "collegefootballdata";
  sportsbook: "DraftKings" | "Bovada";
  providerEventId: string;
  capturedAt: string;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  total: number | null;
  homeSpreadOpen: number | null;
  awaySpreadOpen: number | null;
  totalOpen: number | null;
};

export type CfbCollegeFootballDataLinesResult = {
  release: typeof CFB_COLLEGE_FOOTBALL_DATA_LINES_RELEASE;
  requests: number;
  attemptedGames: number;
  matchedGames: number;
  moneylineBooksByGame: Record<string, NcaafBookOdds[]>;
  contextLineByGame: Record<string, CfbCollegeFootballDataContextLine>;
  failuresByGame: Record<string, string>;
};

export async function fetchCfbCollegeFootballDataLines(args: {
  games: NcaafGame[];
  capturedAt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<CfbCollegeFootballDataLinesResult> {
  const capturedAt = new Date(args.capturedAt).toISOString();
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()]
    .filter((game) => Date.parse(game.scheduledStart) > Date.parse(capturedAt))
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart));
  if (games.length === 0) return emptyResult();
  const seasonWeeks = [...new Set(games.map((game) => `${game.season}:${game.providerWeek}`))];
  if (seasonWeeks.length !== 1) throw new Error("CFBD CFB lines require one season/week per bounded request.");
  const [season, week] = seasonWeeks[0]!.split(":").map(Number);
  if (!Number.isInteger(season) || !Number.isInteger(week)) throw new Error("CFBD CFB lines require a valid season/week.");

  const url = new URL("https://api.collegefootballdata.com/lines");
  url.searchParams.set("year", String(season));
  url.searchParams.set("week", String(week));
  url.searchParams.set("seasonType", "regular");
  const response = await (args.fetchImpl ?? fetch)(url, {
    headers: { accept: "application/json", authorization: `Bearer ${args.apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(CFB_COLLEGE_FOOTBALL_DATA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`CFBD CFB lines request failed (${response.status}).`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > CFB_COLLEGE_FOOTBALL_DATA_MAX_RESPONSE_BYTES) {
    throw new Error("CFBD CFB lines response exceeds the byte ceiling.");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > CFB_COLLEGE_FOOTBALL_DATA_MAX_RESPONSE_BYTES) {
    throw new Error("CFBD CFB lines response exceeds the byte ceiling.");
  }
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error("CFBD CFB lines response must be an array.");

  const moneylineBooksByGame: Record<string, NcaafBookOdds[]> = {};
  const contextLineByGame: Record<string, CfbCollegeFootballDataContextLine> = {};
  const failuresByGame: Record<string, string> = {};
  for (const game of games) {
    const matches = parsed.map(record).filter((row) => strictGameMatch(game, row));
    if (matches.length !== 1) {
      failuresByGame[game.providerGameId] = matches.length === 0 ? "strict_event_not_found" : "strict_event_ambiguous";
      continue;
    }
    const event = matches[0]!;
    const eventId = integer(event.id);
    if (eventId === null) {
      failuresByGame[game.providerGameId] = "event_id_unavailable";
      continue;
    }
    const lines = array(event.lines).map(record).flatMap(normalizeLine);
    const selected = lines.find((line) => line.sportsbook === "DraftKings") ?? lines.find((line) => line.sportsbook === "Bovada") ?? null;
    if (!selected) {
      failuresByGame[game.providerGameId] = "supported_named_book_unavailable";
      continue;
    }
    contextLineByGame[game.providerGameId] = {
      provider: "collegefootballdata",
      sportsbook: selected.sportsbook,
      providerEventId: String(eventId),
      capturedAt,
      homeMoneyline: selected.homeMoneyline,
      awayMoneyline: selected.awayMoneyline,
      homeSpread: selected.homeSpread,
      awaySpread: selected.awaySpread,
      total: selected.total,
      homeSpreadOpen: selected.homeSpreadOpen,
      awaySpreadOpen: selected.awaySpreadOpen,
      totalOpen: selected.totalOpen,
    };
    const books = lines.flatMap((line): NcaafBookOdds[] => {
      if (line.homeMoneyline === null || line.awayMoneyline === null) return [];
      const moneyline = { awayPrice: line.awayMoneyline, homePrice: line.homeMoneyline };
      return [{
        providerGameId: game.providerGameId,
        sportsbook: line.sportsbook,
        observedAt: capturedAt,
        provider: "collegefootballdata",
        providerEventId: String(eventId),
        targetEligible: line.sportsbook === "DraftKings",
        marketSelection: { moneyline: "main_line" },
        marketObservedAt: { moneyline: capturedAt },
        marketQuotes: [
          { market: "moneyline", side: "away", line: null, price: moneyline.awayPrice, observedAt: capturedAt, marketSelection: "main_line" },
          { market: "moneyline", side: "home", line: null, price: moneyline.homePrice, observedAt: capturedAt, marketSelection: "main_line" },
        ],
        moneyline,
        spread: null,
        total: null,
      }];
    });
    if (books.length > 0) moneylineBooksByGame[game.providerGameId] = books;
  }
  return {
    release: CFB_COLLEGE_FOOTBALL_DATA_LINES_RELEASE,
    requests: 1,
    attemptedGames: games.length,
    matchedGames: Object.keys(contextLineByGame).length,
    moneylineBooksByGame,
    contextLineByGame,
    failuresByGame,
  };
}

type NormalizedLine = {
  sportsbook: "DraftKings" | "Bovada";
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  total: number | null;
  homeSpreadOpen: number | null;
  awaySpreadOpen: number | null;
  totalOpen: number | null;
};

function normalizeLine(row: JsonRecord): NormalizedLine[] {
  const provider = text(row.provider);
  if (provider !== "DraftKings" && provider !== "Bovada") return [];
  const homeSpread = finite(row.spread);
  const homeSpreadOpen = finite(row.spreadOpen);
  return [{
    sportsbook: provider,
    homeMoneyline: american(row.homeMoneyline),
    awayMoneyline: american(row.awayMoneyline),
    homeSpread,
    awaySpread: homeSpread === null ? null : -homeSpread,
    total: finite(row.overUnder),
    homeSpreadOpen,
    awaySpreadOpen: homeSpreadOpen === null ? null : -homeSpreadOpen,
    totalOpen: finite(row.overUnderOpen),
  }];
}

function strictGameMatch(game: NcaafGame, row: JsonRecord): boolean {
  const season = integer(row.season);
  const week = integer(row.week);
  const startAt = Date.parse(text(row.startDate) ?? "");
  return season === game.season && week === game.providerWeek &&
    teamMatches(game.away.name, text(row.awayTeam)) && teamMatches(game.home.name, text(row.homeTeam)) &&
    Number.isFinite(startAt) && Math.abs(startAt - Date.parse(game.scheduledStart)) <= 3 * 60 * 60_000;
}

function teamMatches(providerName: string, cfbdName: string | null): boolean {
  if (!cfbdName) return false;
  const provider = normalize(providerName);
  const cfbd = normalize(cfbdName);
  return provider === cfbd || (cfbd.length >= 3 && provider.startsWith(cfbd));
}

function record(value: unknown): JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finite(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
function integer(value: unknown): number | null { const parsed = finite(value); return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null; }
function american(value: unknown): number | null { const parsed = integer(value); return parsed !== null && parsed !== 0 ? parsed : null; }
function normalize(value: string): string { return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, ""); }
function emptyResult(): CfbCollegeFootballDataLinesResult { return { release: CFB_COLLEGE_FOOTBALL_DATA_LINES_RELEASE, requests: 0, attemptedGames: 0, matchedGames: 0, moneylineBooksByGame: {}, contextLineByGame: {}, failuresByGame: {} }; }
