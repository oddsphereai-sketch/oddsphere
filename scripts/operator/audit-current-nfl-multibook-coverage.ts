/**
 * Bounded, read-only audit of current BALLDONTLIE sportsbook depth for one
 * regular-season NFL week. Raw provider rows and credentials are never logged.
 */

export {};

type Envelope = { data?: unknown[]; meta?: { next_cursor?: unknown } | null };
type RecordRow = Record<string, unknown>;

const BASE_URL = "https://api.balldontlie.io/nfl/v1";
const MAX_ODDS_PAGES = 3;

function record(value: unknown): RecordRow {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordRow
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : null;
}

function finite(value: unknown): boolean {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed);
}

function complete(row: RecordRow): boolean {
  return finite(row.moneyline_home_odds) && finite(row.moneyline_away_odds) &&
    finite(row.spread_home_value) && finite(row.spread_home_odds) &&
    finite(row.spread_away_value) && finite(row.spread_away_odds) &&
    finite(row.total_value) && finite(row.total_over_odds) && finite(row.total_under_odds);
}

async function read(args: {
  apiKey: string;
  path: string;
  query: Array<[string, string]>;
  cursor?: string;
}): Promise<{ rows: unknown[]; nextCursor: string | null }> {
  const url = new URL(`${BASE_URL}${args.path}`);
  for (const [key, value] of args.query) url.searchParams.append(key, value);
  if (args.cursor) url.searchParams.set("cursor", args.cursor);
  const response = await fetch(url, {
    headers: { Authorization: args.apiKey, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BALLDONTLIE ${args.path} returned HTTP ${response.status}.`);
  const body = await response.json() as Envelope;
  if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE ${args.path} returned a malformed payload.`);
  const next = body.meta?.next_cursor;
  return {
    rows: body.data,
    nextCursor: typeof next === "string" || typeof next === "number" ? String(next) : null,
  };
}

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const season = Number(process.argv.find((value) => value.startsWith("--season="))?.split("=")[1] ?? "2026");
  const week = Number(process.argv.find((value) => value.startsWith("--week="))?.split("=")[1] ?? "1");
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error("--season and --week must identify a valid regular-season NFL week.");
  }

  const gamesRead = await read({
    apiKey,
    path: "/games",
    query: [
      ["seasons[]", String(season)],
      ["weeks[]", String(week)],
      ["season_type[]", "2"],
      ["per_page", "100"],
    ],
  });
  if (gamesRead.nextCursor !== null) throw new Error("NFL schedule exceeded the one-page audit budget.");
  const games = gamesRead.rows.map(record).map((row) => ({
    id: identifier(row.id),
    home: text(record(row.home_team).abbreviation)?.toUpperCase() ?? null,
    away: text(record(row.visitor_team).abbreviation)?.toUpperCase() ?? null,
  })).filter((game): game is { id: string; home: string; away: string } => Boolean(game.id && game.home && game.away));
  if (games.length === 0) throw new Error("No verified NFL games returned for the requested week.");

  const gameIds = new Set(games.map((game) => game.id));
  const query = [...gameIds].map((id) => ["game_ids[]", id] as [string, string]);
  query.push(["per_page", "100"]);
  const oddsRows: unknown[] = [];
  let cursor: string | null = null;
  let oddsPages = 0;
  for (; oddsPages < MAX_ODDS_PAGES; oddsPages += 1) {
    const page = await read({ apiKey, path: "/odds", query, ...(cursor ? { cursor } : {}) });
    oddsRows.push(...page.rows);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  if (cursor !== null) throw new Error("NFL odds exceeded the three-page audit budget.");

  const normalized = oddsRows.map(record).map((row) => ({
    gameId: identifier(row.game_id),
    vendor: text(row.vendor)?.toLowerCase() ?? null,
    complete: complete(row),
    updatedAt: text(row.updated_at),
  })).filter((row): row is { gameId: string; vendor: string; complete: boolean; updatedAt: string | null } =>
    row.gameId !== null && row.vendor !== null && gameIds.has(row.gameId));

  const byGame = games.map((game) => {
    const rows = normalized.filter((row) => row.gameId === game.id);
    const completeVendors = [...new Set(rows.filter((row) => row.complete).map((row) => row.vendor))].sort();
    return {
      gameId: game.id,
      matchup: `${game.away}@${game.home}`,
      rows: rows.length,
      completeBooks: completeVendors.length,
      vendors: completeVendors,
      latestObservedAt: rows.map((row) => row.updatedAt).filter((value): value is string => value !== null).sort().at(-1) ?? null,
    };
  });

  console.log(JSON.stringify({
    auditRelease: "nfl_current_multibook_coverage_audit_2026_08_22_r1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    season,
    week,
    requests: 1 + oddsPages + 1,
    games: games.length,
    rawOddsRows: oddsRows.length,
    matchedOddsRows: normalized.length,
    completeRows: normalized.filter((row) => row.complete).length,
    distinctCompleteVendors: [...new Set(normalized.filter((row) => row.complete).map((row) => row.vendor))].sort(),
    gamesWithAtLeastTwoCompleteBooks: byGame.filter((game) => game.completeBooks >= 2).length,
    minimumCompleteBooksPerGame: Math.min(...byGame.map((game) => game.completeBooks)),
    byGame,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
