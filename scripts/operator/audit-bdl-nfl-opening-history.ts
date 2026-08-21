/**
 * Bounded read-only probe for historical BALLDONTLIE NFL opening coverage.
 * Two requests maximum: one schedule page and one opening-odds page.
 * No raw rows, credentials, cache files, grades, or production state are logged.
 */

export {};

type Envelope = { data?: unknown[]; meta?: { next_cursor?: unknown } };
type Row = Record<string, unknown>;

const season = Number(process.argv.find((value) => value.startsWith("--season="))?.split("=")[1] ?? "2025");
const week = Number(process.argv.find((value) => value.startsWith("--week="))?.split("=")[1] ?? "1");
const key = process.env.BALLDONTLIE_API_KEY;
if (!key) throw new Error("BALLDONTLIE_API_KEY is required");
if (!Number.isInteger(season) || season < 2020 || season > 2026) throw new Error("--season must be 2020 through 2026");
if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error("--week must be 1 through 18");

async function read(path: string, query: Record<string, Array<string | number> | string | number>) {
  const url = new URL(`https://api.balldontlie.io/nfl/v1${path}`);
  for (const [name, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(name, String(item)));
    else url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: key!, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null) as Envelope | null;
  return {
    status: response.status,
    ok: response.ok,
    rows: Array.isArray(body?.data) ? body.data as Row[] : [],
    nextCursor: body?.meta?.next_cursor ?? null,
  };
}

void (async () => {
  const games = await read("/games", {
    "seasons[]": [season],
    "weeks[]": [week],
    "season_type[]": [2],
    per_page: 100,
  });
  const gameIds = games.rows
    .map((row) => row.id)
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String);
  const openings = gameIds.length > 0
    ? await read("/odds/opening", { "game_ids[]": gameIds, per_page: 100 })
    : { status: 0, ok: true, rows: [], nextCursor: null };
  const covered = new Set(openings.rows.map((row) => String(row.game_id)).filter((id) => gameIds.includes(id)));
  const vendors = [...new Set(openings.rows.map((row) => typeof row.vendor === "string" ? row.vendor : null).filter((value): value is string => value !== null))].sort();
  console.log(JSON.stringify({
    auditRelease: "bdl_nfl_historical_opening_probe_2026_08_20_r1",
    readOnly: true,
    requests: gameIds.length > 0 ? 2 : 1,
    season,
    week,
    games: { status: games.status, rows: gameIds.length, truncated: games.nextCursor !== null },
    openings: { status: openings.status, rows: openings.rows.length, coveredGames: covered.size, vendors, truncated: openings.nextCursor !== null },
  }, null, 2));
})();
