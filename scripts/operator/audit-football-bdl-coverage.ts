/**
 * Bounded, read-only BALLDONTLIE coverage audit for the local NFL/NCAAF model
 * program. No database, cache, prediction, grade, or publication writes.
 *
 * Budget: at most eight requests (one games page and up to three odds pages
 * per league), no automatic retry. API keys and raw payloads are never logged.
 */

export {};

type League = "nfl" | "ncaaf";
type QueryValue = string | number | ReadonlyArray<string | number> | undefined;
type Envelope = {
  data?: unknown[];
  meta?: { next_cursor?: string | number | null; per_page?: number };
  error?: string;
};

type GameRow = {
  id?: unknown;
  season?: unknown;
  week?: unknown;
  date?: unknown;
  status?: unknown;
  status_state?: unknown;
  home_team?: { id?: unknown; full_name?: unknown };
  visitor_team?: { id?: unknown; full_name?: unknown };
};

type OddsRow = {
  game_id?: unknown;
  vendor?: unknown;
  spread_home_value?: unknown;
  spread_home_odds?: unknown;
  spread_away_value?: unknown;
  spread_away_odds?: unknown;
  moneyline_home_odds?: unknown;
  moneyline_away_odds?: unknown;
  total_value?: unknown;
  total_over_odds?: unknown;
  total_under_odds?: unknown;
  updated_at?: unknown;
};

type EndpointRead = {
  endpoint: string;
  status: number;
  ok: boolean;
  rows: unknown[];
  nextCursor: string | number | null;
  quota: { limit: number | null; remaining: number | null; reset: number | null };
  error: string | null;
  pages: number;
};

const BASE_URL = "https://api.balldontlie.io";
const MAX_REQUESTS = 8;
let requestCount = 0;

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(startDate: string, days: number): string[] {
  return Array.from({ length: days + 1 }, (_, index) => addDays(startDate, index));
}

function numberOrNull(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildUrl(league: League, path: string, query: Record<string, QueryValue>): string {
  const url = new URL(`${BASE_URL}/${league}/v1${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
      for (const item of value) url.searchParams.append(arrayKey, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readEndpoint(
  key: string,
  league: League,
  path: string,
  query: Record<string, QueryValue>,
): Promise<EndpointRead> {
  if (requestCount >= MAX_REQUESTS) throw new Error(`Request budget ${MAX_REQUESTS} exhausted`);
  requestCount++;
  const endpoint = `/${league}/v1${path}`;
  const response = await fetch(buildUrl(league, path, query), {
    headers: { Authorization: key, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => null)) as Envelope | null;
  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    rows: Array.isArray(body?.data) ? body.data : [],
    nextCursor: body?.meta?.next_cursor ?? null,
    quota: {
      limit: numberOrNull(response.headers.get("x-ratelimit-limit") ?? response.headers.get("ratelimit-limit")),
      remaining: numberOrNull(response.headers.get("x-ratelimit-remaining") ?? response.headers.get("ratelimit-remaining")),
      reset: numberOrNull(response.headers.get("x-ratelimit-reset") ?? response.headers.get("ratelimit-reset")),
    },
    error: response.ok ? null : body?.error ?? `HTTP ${response.status}`,
    pages: 1,
  };
}

async function readEndpointPages(
  key: string,
  league: League,
  path: string,
  query: Record<string, QueryValue>,
  maxPages: number,
): Promise<EndpointRead> {
  let cursor: string | number | null = null;
  let last: EndpointRead | null = null;
  const rows: unknown[] = [];
  let pagesRead = 0;
  for (let page = 0; page < maxPages; page++) {
    const read = await readEndpoint(key, league, path, { ...query, ...(cursor === null ? {} : { cursor }) });
    pagesRead++;
    rows.push(...read.rows);
    last = read;
    if (!read.ok || read.nextCursor === null) break;
    cursor = read.nextCursor;
  }
  if (!last) throw new Error(`No request made for /${league}/v1${path}`);
  return { ...last, rows, pages: pagesRead };
}

function finite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

function gameSummary(read: EndpointRead, requestedDates: string[]) {
  const rows = read.rows as GameRow[];
  const requested = new Set(requestedDates);
  return {
    endpoint: read.endpoint,
    status: read.status,
    error: read.error,
    rows: rows.length,
    nextCursorPresent: read.nextCursor !== null,
    truncatedByPageBudget: read.nextCursor !== null,
    pages: read.pages,
    validIds: rows.filter((row) => typeof row.id === "number" || typeof row.id === "string").length,
    validStartTimes: rows.filter((row) => typeof row.date === "string" && Number.isFinite(Date.parse(row.date))).length,
    gamesOutsideRequestedDates: rows.filter((row) => typeof row.date !== "string" || !requested.has(row.date.slice(0, 10))).length,
    seasons: [...new Set(rows.map((row) => row.season).filter((value) => finite(value)))].sort(),
    weeks: [...new Set(rows.map((row) => row.week).filter((value) => finite(value)))].sort(),
    statuses: [...new Set(rows.map((row) => String(row.status_state ?? row.status ?? "unknown")))].sort(),
    quota: read.quota,
  };
}

function oddsSummary(read: EndpointRead, gameIds: string[]) {
  const rows = read.rows as OddsRow[];
  const covered = new Set(rows.map((row) => String(row.game_id)).filter((id) => gameIds.includes(id)));
  const vendors = [...new Set(rows.map((row) => typeof row.vendor === "string" ? row.vendor.toLowerCase() : null).filter((value): value is string => value !== null))].sort();
  const complete = {
    moneyline: rows.filter((row) => finite(row.moneyline_home_odds) && finite(row.moneyline_away_odds)).length,
    spread: rows.filter((row) => finite(row.spread_home_value) && finite(row.spread_home_odds) && finite(row.spread_away_value) && finite(row.spread_away_odds)).length,
    total: rows.filter((row) => finite(row.total_value) && finite(row.total_over_odds) && finite(row.total_under_odds)).length,
  };
  return {
    endpoint: read.endpoint,
    status: read.status,
    error: read.error,
    rows: rows.length,
    requestedGames: gameIds.length,
    coveredGames: covered.size,
    gameCoveragePct: gameIds.length === 0 ? null : +(100 * covered.size / gameIds.length).toFixed(1),
    vendors,
    completeRows: complete,
    validUpdatedAt: rows.filter((row) => typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at))).length,
    nextCursorPresent: read.nextCursor !== null,
    truncatedByPageBudget: read.nextCursor !== null,
    pages: read.pages,
    quota: read.quota,
  };
}

async function auditLeague(args: {
  key: string;
  league: League;
  startDate: string;
  endDate: string;
}) {
  const gameQuery: Record<string, QueryValue> = {
    "dates[]": dateRange(args.startDate, Math.round((Date.parse(`${args.endDate}T00:00:00Z`) - Date.parse(`${args.startDate}T00:00:00Z`)) / 86_400_000)),
    per_page: 100,
    ...(args.league === "nfl" ? { "season_type[]": [1] } : {}),
  };
  const games = await readEndpoint(args.key, args.league, "/games", gameQuery);
  const gameIds = (games.rows as GameRow[])
    .map((row) => row.id)
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String);
  const odds = gameIds.length === 0
    ? { endpoint: `/${args.league}/v1/odds`, status: 0, ok: true, rows: [], nextCursor: null, quota: { limit: null, remaining: null, reset: null }, error: "not_requested_no_games", pages: 0 } satisfies EndpointRead
    : await readEndpointPages(args.key, args.league, "/odds", { "game_ids[]": gameIds, per_page: 100 }, 3);
  return {
    league: args.league,
    window: { startDate: args.startDate, endDate: args.endDate },
    games: gameSummary(games, dateRange(args.startDate, Math.round((Date.parse(`${args.endDate}T00:00:00Z`) - Date.parse(`${args.startDate}T00:00:00Z`)) / 86_400_000))),
    odds: oddsSummary(odds, gameIds),
  };
}

async function main() {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("BALLDONTLIE_API_KEY is required");
  const startDate = arg("date") ?? new Date().toISOString().slice(0, 10);
  const days = Number(arg("days") ?? "10");
  if (!validDate(startDate)) throw new Error("--date must use YYYY-MM-DD");
  if (!Number.isInteger(days) || days < 0 || days > 21) throw new Error("--days must be an integer from 0 through 21");
  const endDate = addDays(startDate, days);
  const leagueArg = arg("league") ?? "both";
  if (!new Set(["nfl", "ncaaf", "both"]).has(leagueArg)) throw new Error("--league must be nfl, ncaaf, or both");
  const leagues = [];
  const selectedLeagues: League[] = leagueArg === "both" ? ["nfl", "ncaaf"] : [leagueArg as League];
  for (const league of selectedLeagues) {
    try {
      leagues.push(await auditLeague({ key, league, startDate, endDate }));
    } catch (error) {
      leagues.push({ league, window: { startDate, endDate }, fatalError: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({
    auditRelease: "football_bdl_coverage_audit_2026_08_19_r1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    requestBudget: MAX_REQUESTS,
    requestsUsed: requestCount,
    leagues,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
