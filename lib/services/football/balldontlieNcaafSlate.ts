export const BALLDONTLIE_NCAAF_SLATE_RELEASE =
  "balldontlie_ncaaf_slate_2026_08_25_r1" as const;

export const NCAAF_FBS_CONFERENCE_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
export const NCAAF_COMPARABLE_SPORTSBOOKS = [
  "fanduel",
  "draftkings",
  "caesars",
  "betmgm",
  "fanatics",
  "betrivers",
] as const;

export type NcaafTeam = {
  id: number;
  conferenceId: number | null;
  abbreviation: string;
  name: string;
  fbs: boolean;
};

export type NcaafGame = {
  providerGameId: string;
  providerWeek: number;
  season: number;
  scheduledStart: string;
  status: string;
  awayScore: number | null;
  homeScore: number | null;
  away: NcaafTeam;
  home: NcaafTeam;
};

export type NcaafBookOdds = {
  providerGameId: string;
  sportsbook: string;
  observedAt: string;
  moneyline: { awayPrice: number; homePrice: number } | null;
  spread: {
    awayLine: number;
    awayPrice: number;
    homeLine: number;
    homePrice: number;
  } | null;
  total: { line: number; overPrice: number; underPrice: number } | null;
};

export type NcaafProviderSlate = {
  release: typeof BALLDONTLIE_NCAAF_SLATE_RELEASE;
  fetchedAt: string;
  season: number;
  startDate: string;
  endDate: string;
  games: NcaafGame[];
  marketGames: NcaafGame[];
  currentOddsByGame: Record<string, NcaafBookOdds>;
  currentOddsAllBooksByGame: Record<string, NcaafBookOdds[]>;
  currentOddsComparableBooksByGame: Record<string, NcaafBookOdds[]>;
  openingOddsByGame: Record<string, NcaafBookOdds>;
  openingOddsAllBooksByGame: Record<string, NcaafBookOdds[]>;
  openingOddsComparableBooksByGame: Record<string, NcaafBookOdds[]>;
  providerRequests: number;
};

export type NcaafProviderResults = {
  release: typeof BALLDONTLIE_NCAAF_SLATE_RELEASE;
  games: NcaafGame[];
  providerRequests: number;
};

type JsonRecord = Record<string, unknown>;
type BdlEnvelope = { data?: unknown; meta?: { next_cursor?: unknown } | null };
const BASE_URL = "https://api.balldontlie.io/ncaaf/v1";
const SPORTSBOOK_PRIORITY = NCAAF_COMPARABLE_SPORTSBOOKS;
const COMPARABLE = new Set<string>(NCAAF_COMPARABLE_SPORTSBOOKS);

export function isComparableNcaafSportsbook(value: string): boolean {
  return COMPARABLE.has(value.trim().toLowerCase());
}

export async function fetchBalldontlieNcaafSlate(args: {
  season: number;
  startDate: string;
  endDate: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  gamesPageBudget?: number;
  oddsPageBudget?: number;
}): Promise<NcaafProviderSlate> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for the NCAAF slate.");
  if (!validDate(args.startDate) || !validDate(args.endDate) || args.endDate < args.startDate) {
    throw new Error("NCAAF slate requires an ordered YYYY-MM-DD date window.");
  }
  const dates = datesBetween(args.startDate, args.endDate);
  if (dates.length > 15) throw new Error("NCAAF slate date window cannot exceed 15 days.");
  let providerRequests = 0;
  const onRequest = () => { providerRequests += 1; };
  const gamesRead = await readPages({
    path: "/games",
    query: { "dates[]": dates, per_page: 100 },
    maxPages: args.gamesPageBudget ?? 4,
    apiKey,
    fetchImpl,
    onRequest,
  });
  if (gamesRead.nextCursor !== null) throw new Error("BALLDONTLIE NCAAF games exceeded the pagination safety budget.");
  const games = gamesRead.rows.map(normalizeGame).filter((game): game is NcaafGame =>
    game !== null && game.season === args.season && game.scheduledStart.slice(0, 10) >= args.startDate && game.scheduledStart.slice(0, 10) <= args.endDate
  ).sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart));
  if (games.length === 0) throw new Error("BALLDONTLIE returned no verified NCAAF games in the requested window.");
  const gameIds = games.map((game) => game.providerGameId);
  const requestedIds = new Set(gameIds);
  const currentRead = await readPages({
    path: "/odds",
    query: { "game_ids[]": gameIds, per_page: 100 },
    maxPages: args.oddsPageBudget ?? 24,
    apiKey,
    fetchImpl,
    onRequest,
  });
  if (currentRead.nextCursor !== null) throw new Error("BALLDONTLIE NCAAF current odds exceeded the pagination safety budget.");
  const openingRead = await readPages({
    path: "/odds/opening",
    query: { "game_ids[]": gameIds, per_page: 100 },
    maxPages: args.oddsPageBudget ?? 24,
    apiKey,
    fetchImpl,
    onRequest,
    optional: true,
  });
  if (openingRead.nextCursor !== null) throw new Error("BALLDONTLIE NCAAF opening odds exceeded the pagination safety budget.");
  const currentOddsAllBooksByGame = groupBooksByGame(currentRead.rows, requestedIds);
  const currentOddsComparableBooksByGame = comparableBooksByGame(currentOddsAllBooksByGame);
  const openingOddsAllBooksByGame = groupBooksByGame(openingRead.rows, requestedIds);
  const openingOddsComparableBooksByGame = comparableBooksByGame(openingOddsAllBooksByGame);
  const currentOddsByGame = representativeBooks(currentOddsComparableBooksByGame);
  const openingOddsByGame = representativeBooks(openingOddsComparableBooksByGame, currentOddsByGame);
  const marketGames = games.filter((game) =>
    (game.home.fbs || game.away.fbs) && completeMainMarkets(currentOddsByGame[game.providerGameId])
  );
  return {
    release: BALLDONTLIE_NCAAF_SLATE_RELEASE,
    fetchedAt: new Date().toISOString(),
    season: args.season,
    startDate: args.startDate,
    endDate: args.endDate,
    games,
    marketGames,
    currentOddsByGame,
    currentOddsAllBooksByGame,
    currentOddsComparableBooksByGame,
    openingOddsByGame,
    openingOddsAllBooksByGame,
    openingOddsComparableBooksByGame,
    providerRequests,
  };
}

/** Bounded exact-id results read used only by the shared tracking settlement cycle. */
export async function fetchBalldontlieNcaafResults(args: {
  gameIds: string[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
  pageBudget?: number;
}): Promise<NcaafProviderResults> {
  const ids = [...new Set(args.gameIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) return { release: BALLDONTLIE_NCAAF_SLATE_RELEASE, games: [], providerRequests: 0 };
  if (ids.length > 200) throw new Error("BALLDONTLIE NCAAF result lookup is capped at 200 exact game IDs.");
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for NCAAF results.");
  let providerRequests = 0;
  const read = await readPages({
    path: "/games",
    query: { "game_ids[]": ids, per_page: 100 },
    maxPages: args.pageBudget ?? 4,
    apiKey,
    fetchImpl: args.fetchImpl ?? fetch,
    onRequest: () => { providerRequests += 1; },
  });
  if (read.nextCursor !== null) throw new Error("BALLDONTLIE NCAAF results exceeded the pagination safety budget.");
  const requested = new Set(ids);
  const games = read.rows.map(normalizeGame).filter((game): game is NcaafGame => game !== null && requested.has(game.providerGameId));
  if (new Set(games.map((game) => game.providerGameId)).size !== games.length) throw new Error("BALLDONTLIE NCAAF results returned duplicate exact game IDs.");
  return { release: BALLDONTLIE_NCAAF_SLATE_RELEASE, games, providerRequests };
}

function completeMainMarkets(value: NcaafBookOdds | undefined): boolean {
  return Boolean(value?.moneyline && value.spread && value.total);
}

async function readPages(args: {
  path: string;
  query: Record<string, string | number | Array<string | number>>;
  maxPages: number;
  apiKey: string;
  fetchImpl: typeof fetch;
  onRequest: () => void;
  optional?: boolean;
}): Promise<{ rows: unknown[]; nextCursor: string | null }> {
  const rows: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < args.maxPages; page += 1) {
    const url = new URL(`${BASE_URL}${args.path}`);
    for (const [key, value] of Object.entries(args.query)) {
      if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
      else url.searchParams.set(key, String(value));
    }
    if (cursor) url.searchParams.set("cursor", cursor);
    args.onRequest();
    const response = await args.fetchImpl(url, {
      headers: { Authorization: args.apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (args.optional && (response.status === 404 || response.status === 422)) return { rows: [], nextCursor: null };
      throw new Error(`BALLDONTLIE NCAAF ${args.path} failed with HTTP ${response.status}.`);
    }
    const body = await response.json() as BdlEnvelope;
    if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE NCAAF ${args.path} returned a malformed payload.`);
    rows.push(...body.data);
    const next = body.meta?.next_cursor;
    cursor = typeof next === "string" || typeof next === "number" ? String(next) : null;
    if (!cursor) break;
  }
  return { rows, nextCursor: cursor };
}

function normalizeGame(value: unknown): NcaafGame | null {
  const row = record(value);
  const id = stringOrNumber(row.id);
  const season = integer(row.season);
  const week = integer(row.week);
  const scheduledStart = iso(row.date);
  const home = normalizeTeam(row.home_team);
  const away = normalizeTeam(row.visitor_team);
  if (!id || season === null || week === null || !scheduledStart || !home || !away) return null;
  return {
    providerGameId: id,
    providerWeek: week,
    season,
    scheduledStart,
    status: text(row.status_state) ?? text(row.status) ?? "scheduled",
    awayScore: integer(row.away_score) ?? integer(row.visitor_team_score),
    homeScore: integer(row.home_score) ?? integer(row.home_team_score),
    away,
    home,
  };
}

function normalizeTeam(value: unknown): NcaafTeam | null {
  const row = record(value);
  const id = integer(row.id);
  const conferenceId = integer(row.conference);
  const abbreviation = text(row.abbreviation)?.toUpperCase() ?? null;
  const name = text(row.full_name) ?? [text(row.city), text(row.name)].filter(Boolean).join(" ");
  return id === null || !abbreviation || !name ? null : {
    id,
    conferenceId,
    abbreviation,
    name,
    fbs: conferenceId !== null && NCAAF_FBS_CONFERENCE_IDS.has(conferenceId),
  };
}

function normalizeOdds(value: unknown): NcaafBookOdds | null {
  const row = record(value);
  const providerGameId = stringOrNumber(row.game_id);
  const sportsbook = text(row.vendor);
  const observedAt = iso(row.updated_at);
  if (!providerGameId || !sportsbook || !observedAt) return null;
  const homeMoneyline = price(row.moneyline_home_odds);
  const awayMoneyline = price(row.moneyline_away_odds);
  const homeSpread = number(row.spread_home_value);
  const homeSpreadPrice = price(row.spread_home_odds);
  const awaySpread = number(row.spread_away_value);
  const awaySpreadPrice = price(row.spread_away_odds);
  const total = number(row.total_value);
  const overPrice = price(row.total_over_odds);
  const underPrice = price(row.total_under_odds);
  return {
    providerGameId,
    sportsbook,
    observedAt,
    moneyline: homeMoneyline === null || awayMoneyline === null ? null : { homePrice: homeMoneyline, awayPrice: awayMoneyline },
    spread: homeSpread === null || homeSpreadPrice === null || awaySpread === null || awaySpreadPrice === null
      ? null : { homeLine: homeSpread, homePrice: homeSpreadPrice, awayLine: awaySpread, awayPrice: awaySpreadPrice },
    total: total === null || overPrice === null || underPrice === null ? null : { line: total, overPrice, underPrice },
  };
}

function groupBooksByGame(values: unknown[], requestedIds: Set<string>): Record<string, NcaafBookOdds[]> {
  const grouped = new Map<string, Map<string, NcaafBookOdds[]>>();
  for (const value of values) {
    const row = normalizeOdds(value);
    if (!row || !requestedIds.has(row.providerGameId)) continue;
    const byBook = grouped.get(row.providerGameId) ?? new Map<string, NcaafBookOdds[]>();
    const key = row.sportsbook.toLowerCase();
    byBook.set(key, [...(byBook.get(key) ?? []), row]);
    grouped.set(row.providerGameId, byBook);
  }
  return Object.fromEntries([...requestedIds].map((gameId) => [
    gameId,
    [...(grouped.get(gameId)?.values() ?? [])].map((rows) => [...rows].sort(compareOdds)[0]!).sort(compareOdds),
  ]));
}

function comparableBooksByGame(values: Record<string, NcaafBookOdds[]>): Record<string, NcaafBookOdds[]> {
  return Object.fromEntries(Object.entries(values).map(([gameId, books]) => [gameId, books.filter((book) => isComparableNcaafSportsbook(book.sportsbook))]));
}

function representativeBooks(values: Record<string, NcaafBookOdds[]>, current: Record<string, NcaafBookOdds> = {}): Record<string, NcaafBookOdds> {
  const output: Record<string, NcaafBookOdds> = {};
  for (const [gameId, books] of Object.entries(values)) {
    const currentBook = current[gameId]?.sportsbook.toLowerCase();
    const same = currentBook ? books.filter((book) => book.sportsbook.toLowerCase() === currentBook) : [];
    const selected = [...(same.length ? same : books)].sort(compareOdds)[0];
    if (selected) output[gameId] = selected;
  }
  return output;
}

function compareOdds(first: NcaafBookOdds, second: NcaafBookOdds): number {
  const complete = (row: NcaafBookOdds) => Number(Boolean(row.moneyline)) + Number(Boolean(row.spread)) + Number(Boolean(row.total));
  const firstPriority = SPORTSBOOK_PRIORITY.indexOf(first.sportsbook.toLowerCase() as typeof SPORTSBOOK_PRIORITY[number]);
  const secondPriority = SPORTSBOOK_PRIORITY.indexOf(second.sportsbook.toLowerCase() as typeof SPORTSBOOK_PRIORITY[number]);
  return complete(second) - complete(first) ||
    (firstPriority < 0 ? 99 : firstPriority) - (secondPriority < 0 ? 99 : secondPriority) ||
    Date.parse(second.observedAt) - Date.parse(first.observedAt);
}

function datesBetween(start: string, end: string): string[] {
  const values: string[] = [];
  for (const date = new Date(`${start}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    values.push(date.toISOString().slice(0, 10));
  }
  return values;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function record(value: unknown): JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function stringOrNumber(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null; }
function number(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
function integer(value: unknown): number | null { const parsed = number(value); return parsed !== null && Number.isInteger(parsed) ? parsed : null; }
function price(value: unknown): number | null { const parsed = number(value); return parsed === 0 ? null : parsed; }
function iso(value: unknown): string | null { const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN; return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }

export const __BALLDONTLIE_NCAAF_SLATE_TEST__ = { normalizeGame, normalizeOdds, groupBooksByGame, representativeBooks };
