export const BALLDONTLIE_NFL_PREVIEW_SLATE_RELEASE =
  "balldontlie_nfl_preview_slate_2026_08_19_r1" as const;
export const BALLDONTLIE_NFL_REGULAR_SLATE_RELEASE =
  "balldontlie_nfl_regular_slate_2026_08_22_r2_multibook" as const;

export type NflPreviewTeam = {
  id: number;
  abbreviation: string;
  name: string;
};

export type NflPreviewGame = {
  providerGameId: string;
  providerWeek: number;
  season: number;
  scheduledStart: string;
  status: string;
  away: NflPreviewTeam;
  home: NflPreviewTeam;
};

export type NflPreviewBookOdds = {
  providerGameId: string;
  sportsbook: string;
  observedAt: string;
  moneyline: {
    awayPrice: number;
    homePrice: number;
  } | null;
  spread: {
    awayLine: number;
    awayPrice: number;
    homeLine: number;
    homePrice: number;
  } | null;
  total: {
    line: number;
    overPrice: number;
    underPrice: number;
  } | null;
};

export type NflPreviewProviderSlate = {
  release: typeof BALLDONTLIE_NFL_PREVIEW_SLATE_RELEASE;
  fetchedAt: string;
  season: number;
  productWeek: number;
  providerWeek: number;
  games: NflPreviewGame[];
  currentOddsByGame: Record<string, NflPreviewBookOdds>;
  openingOddsByGame: Record<string, NflPreviewBookOdds>;
  providerRequests: number;
};

export type NflRegularProviderSlate = Omit<NflPreviewProviderSlate, "release"> & {
  release: typeof BALLDONTLIE_NFL_REGULAR_SLATE_RELEASE;
  currentOddsAllBooksByGame: Record<string, NflPreviewBookOdds[]>;
  currentOddsComparableBooksByGame: Record<string, NflPreviewBookOdds[]>;
  openingOddsAllBooksByGame: Record<string, NflPreviewBookOdds[]>;
  openingOddsComparableBooksByGame: Record<string, NflPreviewBookOdds[]>;
};

type JsonRecord = Record<string, unknown>;
type BdlEnvelope = {
  data?: unknown;
  meta?: { next_cursor?: unknown } | null;
};

const BASE_URL = "https://api.balldontlie.io/nfl/v1";
const MAX_ODDS_PAGES = 3;
const SPORTSBOOK_PRIORITY = [
  "fanduel",
  "draftkings",
  "caesars",
  "betmgm",
  "fanatics",
  "betrivers",
] as const;

export const NFL_COMPARABLE_SPORTSBOOKS = [
  "fanduel",
  "draftkings",
  "caesars",
  "betmgm",
  "fanatics",
  "betrivers",
] as const;
const NFL_COMPARABLE_SPORTSBOOK_SET = new Set<string>(NFL_COMPARABLE_SPORTSBOOKS);

export function isComparableNflSportsbook(sportsbook: string): boolean {
  return NFL_COMPARABLE_SPORTSBOOK_SET.has(sportsbook.trim().toLowerCase());
}

/**
 * BALLDONTLIE counts the Hall of Fame Game as its first preseason week.
 * NFL's public schedule does not. Keep the mapping explicit and auditable.
 */
export function providerWeekForNflPreseason(productWeek: number): number {
  if (!Number.isInteger(productWeek) || productWeek < 1 || productWeek > 3) {
    throw new Error("NFL preseason product week must be 1, 2, or 3.");
  }
  return productWeek + 1;
}

export async function fetchBalldontlieNflPreviewSlate(args: {
  season: number;
  productWeek: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<NflPreviewProviderSlate> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for the NFL preview slate.");
  const providerWeek = providerWeekForNflPreseason(args.productWeek);
  let providerRequests = 0;

  const gamesRead = await readPages({
    path: "/games",
    query: {
      "seasons[]": [args.season],
      "weeks[]": [providerWeek],
      "season_type[]": [1],
      per_page: 100,
    },
    maxPages: 1,
    apiKey,
    fetchImpl,
    onRequest: () => { providerRequests += 1; },
  });
  const games = gamesRead.rows.map(normalizeGame).filter((game): game is NflPreviewGame => game !== null)
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart));
  if (gamesRead.nextCursor !== null) throw new Error("BALLDONTLIE NFL schedule exceeded the one-page safety budget.");
  if (games.length === 0) throw new Error("BALLDONTLIE returned no verified NFL games for the requested preseason week.");
  if (games.some((game) => game.season !== args.season || game.providerWeek !== providerWeek)) {
    throw new Error("BALLDONTLIE returned a game outside the requested NFL season/week identity.");
  }

  const gameIds = games.map((game) => game.providerGameId);
  const currentRead = await readPages({
    path: "/odds",
    query: { "game_ids[]": gameIds, per_page: 100 },
    maxPages: MAX_ODDS_PAGES,
    apiKey,
    fetchImpl,
    onRequest: () => { providerRequests += 1; },
  });
  if (currentRead.nextCursor !== null) throw new Error("BALLDONTLIE current odds exceeded the pagination safety budget.");

  // Opening prices are optional evidence. An empty provider response stays
  // empty; it is never replaced with a current price or a made-up opener.
  const openingRead = await readPages({
    path: "/odds/opening",
    query: { "game_ids[]": gameIds, per_page: 100 },
    maxPages: MAX_ODDS_PAGES,
    apiKey,
    fetchImpl,
    onRequest: () => { providerRequests += 1; },
    optional: true,
  });
  if (openingRead.nextCursor !== null) throw new Error("BALLDONTLIE opening odds exceeded the pagination safety budget.");

  const currentOddsByGame = selectRepresentativeBookByGame(currentRead.rows, new Set(gameIds));
  const openingOddsByGame = selectRepresentativeBookByGame(
    openingRead.rows,
    new Set(gameIds),
    currentOddsByGame,
  );
  const missingCurrent = gameIds.filter((gameId) => !currentOddsByGame[gameId]);
  if (missingCurrent.length > 0) {
    throw new Error(`BALLDONTLIE current odds missing for ${missingCurrent.length} NFL games.`);
  }

  return {
    release: BALLDONTLIE_NFL_PREVIEW_SLATE_RELEASE,
    fetchedAt: new Date().toISOString(),
    season: args.season,
    productWeek: args.productWeek,
    providerWeek,
    games,
    currentOddsByGame,
    openingOddsByGame,
    providerRequests,
  };
}

export async function fetchBalldontlieNflRegularSlate(args: {
  season: number;
  week: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<NflRegularProviderSlate> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for the NFL regular-season slate.");
  if (!Number.isInteger(args.week) || args.week < 1 || args.week > 18) throw new Error("NFL regular-season week must be 1 through 18.");
  let providerRequests = 0;
  const gamesRead = await readPages({
    path: "/games",
    query: {
      "seasons[]": [args.season],
      "weeks[]": [args.week],
      "season_type[]": [2],
      per_page: 100,
    },
    maxPages: 1,
    apiKey,
    fetchImpl,
    onRequest: () => { providerRequests += 1; },
  });
  if (gamesRead.nextCursor !== null) throw new Error("BALLDONTLIE regular schedule exceeded the one-page safety budget.");
  const games = gamesRead.rows.map(normalizeGame).filter((game): game is NflPreviewGame => game !== null)
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart));
  if (games.length === 0 || games.some((game) => game.season !== args.season || game.providerWeek !== args.week)) {
    throw new Error("BALLDONTLIE returned no complete verified NFL regular-season week.");
  }
  const gameIds = games.map((game) => game.providerGameId);
  const currentRead = await readPages({
    path: "/odds",
    query: { "game_ids[]": gameIds, per_page: 100 },
    maxPages: MAX_ODDS_PAGES,
    apiKey,
    fetchImpl,
    onRequest: () => { providerRequests += 1; },
  });
  if (currentRead.nextCursor !== null) throw new Error("BALLDONTLIE regular current odds exceeded the pagination safety budget.");
  const openingRead = await readPages({
    path: "/odds/opening",
    query: { "game_ids[]": gameIds, per_page: 100 },
    maxPages: MAX_ODDS_PAGES,
    apiKey,
    fetchImpl,
    onRequest: () => { providerRequests += 1; },
    optional: true,
  });
  if (openingRead.nextCursor !== null) throw new Error("BALLDONTLIE regular opening odds exceeded the pagination safety budget.");
  const requestedGameIds = new Set(gameIds);
  const currentOddsAllBooksByGame = groupBooksByGame(currentRead.rows, requestedGameIds);
  const currentOddsComparableBooksByGame = comparableBooksByGame(currentOddsAllBooksByGame);
  const openingOddsAllBooksByGame = groupBooksByGame(openingRead.rows, requestedGameIds);
  const openingOddsComparableBooksByGame = comparableBooksByGame(openingOddsAllBooksByGame);
  const currentOddsByGame = selectRepresentativeNormalizedBooks(
    Object.values(currentOddsComparableBooksByGame).flat(),
    requestedGameIds,
  );
  const openingOddsByGame = selectRepresentativeNormalizedBooks(
    Object.values(openingOddsComparableBooksByGame).flat(),
    requestedGameIds,
    currentOddsByGame,
  );
  const missingCurrent = gameIds.filter((gameId) => !currentOddsByGame[gameId]);
  if (missingCurrent.length > 0) throw new Error(`BALLDONTLIE regular odds missing for ${missingCurrent.length} games.`);
  return {
    release: BALLDONTLIE_NFL_REGULAR_SLATE_RELEASE,
    fetchedAt: new Date().toISOString(),
    season: args.season,
    productWeek: args.week,
    providerWeek: args.week,
    games,
    currentOddsByGame,
    openingOddsByGame,
    currentOddsAllBooksByGame,
    currentOddsComparableBooksByGame,
    openingOddsAllBooksByGame,
    openingOddsComparableBooksByGame,
    providerRequests,
  };
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
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    if (cursor) url.searchParams.set("cursor", cursor);
    args.onRequest();
    const response = await args.fetchImpl(url, {
      headers: { Authorization: args.apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (args.optional && (response.status === 404 || response.status === 422)) {
        return { rows: [], nextCursor: null };
      }
      throw new Error(`BALLDONTLIE ${args.path} failed with HTTP ${response.status}.`);
    }
    const body = await response.json() as BdlEnvelope;
    if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE ${args.path} returned a malformed payload.`);
    rows.push(...body.data);
    const next = body.meta?.next_cursor;
    cursor = typeof next === "string" || typeof next === "number" ? String(next) : null;
    if (!cursor) break;
  }
  return { rows, nextCursor: cursor };
}

function normalizeGame(value: unknown): NflPreviewGame | null {
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
    away,
    home,
  };
}

function normalizeTeam(value: unknown): NflPreviewTeam | null {
  const row = record(value);
  const id = integer(row.id);
  const abbreviation = text(row.abbreviation)?.toUpperCase() ?? null;
  const name = text(row.full_name) ?? [text(row.location), text(row.name)].filter(Boolean).join(" ");
  return id === null || !abbreviation || !name ? null : { id, abbreviation, name };
}

function selectRepresentativeBookByGame(
  values: unknown[],
  requestedGameIds: ReadonlySet<string>,
  currentSelection: Record<string, NflPreviewBookOdds> = {},
): Record<string, NflPreviewBookOdds> {
  const rows = values.map(normalizeOdds).filter((row): row is NflPreviewBookOdds => row !== null && requestedGameIds.has(row.providerGameId));
  return selectRepresentativeNormalizedBooks(rows, requestedGameIds, currentSelection);
}

function selectRepresentativeNormalizedBooks(
  rows: NflPreviewBookOdds[],
  requestedGameIds: ReadonlySet<string>,
  currentSelection: Record<string, NflPreviewBookOdds> = {},
): Record<string, NflPreviewBookOdds> {
  const grouped = new Map<string, NflPreviewBookOdds[]>();
  for (const row of rows) grouped.set(row.providerGameId, [...(grouped.get(row.providerGameId) ?? []), row]);
  const selected: Record<string, NflPreviewBookOdds> = {};
  for (const gameId of requestedGameIds) {
    const candidates = grouped.get(gameId) ?? [];
    const currentBook = currentSelection[gameId]?.sportsbook.toLowerCase() ?? null;
    const chosen = candidates
      .filter((row) => !currentBook || row.sportsbook.toLowerCase() === currentBook)
      .sort(compareOddsRows)[0] ?? candidates.sort(compareOddsRows)[0];
    if (chosen) selected[gameId] = chosen;
  }
  return selected;
}

function groupBooksByGame(
  values: unknown[],
  requestedGameIds: ReadonlySet<string>,
): Record<string, NflPreviewBookOdds[]> {
  const grouped = new Map<string, Map<string, NflPreviewBookOdds[]>>();
  for (const value of values) {
    const row = normalizeOdds(value);
    if (!row || !requestedGameIds.has(row.providerGameId)) continue;
    const vendor = row.sportsbook.toLowerCase();
    const byVendor = grouped.get(row.providerGameId) ?? new Map<string, NflPreviewBookOdds[]>();
    byVendor.set(vendor, [...(byVendor.get(vendor) ?? []), row]);
    grouped.set(row.providerGameId, byVendor);
  }
  return Object.fromEntries([...requestedGameIds].map((gameId) => {
    const books = [...(grouped.get(gameId)?.values() ?? [])]
      .map((rows) => [...rows].sort(compareOddsRows)[0]!)
      .sort(compareOddsRows);
    return [gameId, books];
  }));
}

function comparableBooksByGame(
  booksByGame: Record<string, NflPreviewBookOdds[]>,
): Record<string, NflPreviewBookOdds[]> {
  return Object.fromEntries(Object.entries(booksByGame).map(([gameId, books]) => [
    gameId,
    books.filter((book) => isComparableNflSportsbook(book.sportsbook)),
  ]));
}

function compareOddsRows(first: NflPreviewBookOdds, second: NflPreviewBookOdds): number {
  const completeness = (row: NflPreviewBookOdds) => Number(row.moneyline !== null) + Number(row.spread !== null) + Number(row.total !== null);
  const firstPriority = SPORTSBOOK_PRIORITY.indexOf(first.sportsbook.toLowerCase() as typeof SPORTSBOOK_PRIORITY[number]);
  const secondPriority = SPORTSBOOK_PRIORITY.indexOf(second.sportsbook.toLowerCase() as typeof SPORTSBOOK_PRIORITY[number]);
  return completeness(second) - completeness(first) ||
    (firstPriority < 0 ? 99 : firstPriority) - (secondPriority < 0 ? 99 : secondPriority) ||
    Date.parse(second.observedAt) - Date.parse(first.observedAt);
}

function normalizeOdds(value: unknown): NflPreviewBookOdds | null {
  const row = record(value);
  const providerGameId = stringOrNumber(row.game_id);
  const sportsbook = text(row.vendor);
  const observedAt = iso(row.updated_at);
  if (!providerGameId || !sportsbook || !observedAt) return null;
  const moneylineHome = price(row.moneyline_home_odds);
  const moneylineAway = price(row.moneyline_away_odds);
  const spreadHomeLine = number(row.spread_home_value);
  const spreadHomePrice = price(row.spread_home_odds);
  const spreadAwayLine = number(row.spread_away_value);
  const spreadAwayPrice = price(row.spread_away_odds);
  const totalLine = number(row.total_value);
  const totalOverPrice = price(row.total_over_odds);
  const totalUnderPrice = price(row.total_under_odds);
  return {
    providerGameId,
    sportsbook,
    observedAt,
    moneyline: moneylineHome === null || moneylineAway === null ? null : { homePrice: moneylineHome, awayPrice: moneylineAway },
    spread: spreadHomeLine === null || spreadHomePrice === null || spreadAwayLine === null || spreadAwayPrice === null
      ? null
      : { homeLine: spreadHomeLine, homePrice: spreadHomePrice, awayLine: spreadAwayLine, awayPrice: spreadAwayPrice },
    total: totalLine === null || totalOverPrice === null || totalUnderPrice === null
      ? null
      : { line: totalLine, overPrice: totalOverPrice, underPrice: totalUnderPrice },
  };
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringOrNumber(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function price(value: unknown): number | null {
  const parsed = number(value);
  return parsed === 0 ? null : parsed;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export const __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__ = {
  normalizeGame,
  normalizeOdds,
  selectRepresentativeBookByGame,
  groupBooksByGame,
  comparableBooksByGame,
};
