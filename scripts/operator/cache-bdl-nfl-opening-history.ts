/**
 * Cache a completed NFL regular season's provider-native opening prices for
 * local model research. Seasons before the 2021 schedule expansion are
 * intentionally excluded so every supported season has the same 272-game
 * completeness contract.
 *
 * Read budget: at most three schedule pages and fifteen opening pages. This
 * script never calls current odds, writes production state, or logs raw keys.
 */

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

type Envelope = { data?: unknown[]; meta?: { next_cursor?: unknown } };
type Json = Record<string, unknown>;

const season = Number(process.argv.find((value) => value.startsWith("--season="))?.split("=")[1] ?? "2025");
const CACHE_RELEASE = `bdl_nfl_opening_history_${season}_2026_08_20_r2`;
const apiKey = process.env.BALLDONTLIE_API_KEY;
const MAX_GAME_PAGES = 3;
const MAX_OPENING_PAGES = 15;
let requests = 0;

if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
if (!Number.isInteger(season) || season < 2021 || season > 2025) {
  throw new Error("Historical opening cache supports completed 2021-2025 regular seasons only");
}

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readPages(args: {
  endpoint: "/games" | "/odds/opening";
  query: Record<string, string | number | string[]>;
  maxPages: number;
}) {
  const rows: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < args.maxPages; page += 1) {
    const url = new URL(`https://api.balldontlie.io/nfl/v1${args.endpoint}`);
    for (const [name, value] of Object.entries(args.query)) {
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(name, item));
      else url.searchParams.set(name, String(value));
    }
    if (cursor) url.searchParams.set("cursor", cursor);
    requests += 1;
    const response = await fetch(url, {
      headers: { Authorization: apiKey!, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`BALLDONTLIE ${args.endpoint} failed with HTTP ${response.status}`);
    const body = await response.json() as Envelope;
    if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE ${args.endpoint} returned malformed data`);
    rows.push(...body.data);
    const next = body.meta?.next_cursor;
    cursor = typeof next === "string" || typeof next === "number" ? String(next) : null;
    if (!cursor) return rows;
  }
  throw new Error(`BALLDONTLIE ${args.endpoint} exceeded its ${args.maxPages}-page safety budget`);
}

function normalizeGame(value: unknown) {
  const row = record(value);
  const home = record(row.home_team);
  const away = record(row.visitor_team);
  const id = finite(row.id);
  const week = finite(row.week);
  const scheduledStart = text(row.date);
  const homeAbbreviation = text(home.abbreviation);
  const awayAbbreviation = text(away.abbreviation);
  if (id === null || week === null || scheduledStart === null || homeAbbreviation === null || awayAbbreviation === null) return null;
  return {
    gameId: String(id),
    season,
    week,
    scheduledStart,
    homeTeam: homeAbbreviation,
    awayTeam: awayAbbreviation,
  };
}

function normalizeOpening(value: unknown) {
  const row = record(value);
  const gameId = finite(row.game_id);
  const vendor = text(row.vendor);
  const openedAt = text(row.opened_at);
  if (gameId === null || vendor === null || openedAt === null || !Number.isFinite(Date.parse(openedAt))) return null;
  return {
    gameId: String(gameId),
    vendor: vendor.toLowerCase(),
    openedAt,
    moneylineHome: finite(row.moneyline_home_odds),
    moneylineAway: finite(row.moneyline_away_odds),
    spreadHomeLine: finite(row.spread_home_value),
    spreadHomePrice: finite(row.spread_home_odds),
    spreadAwayLine: finite(row.spread_away_value),
    spreadAwayPrice: finite(row.spread_away_odds),
    totalLine: finite(row.total_value),
    totalOverPrice: finite(row.total_over_odds),
    totalUnderPrice: finite(row.total_under_odds),
  };
}

void (async () => {
  const gameRows = await readPages({
    endpoint: "/games",
    query: { "seasons[]": [String(season)], "season_type[]": ["2"], per_page: 100 },
    maxPages: MAX_GAME_PAGES,
  });
  const games = gameRows.map(normalizeGame).filter((row): row is NonNullable<ReturnType<typeof normalizeGame>> => row !== null)
    .sort((first, second) => first.week - second.week || Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart));
  const gameIds = games.map((game) => game.gameId);
  if (games.length !== 272 || new Set(gameIds).size !== games.length) {
    throw new Error(`Expected 272 unique ${season} regular-season games; received ${games.length}`);
  }
  const openingRows = await readPages({
    endpoint: "/odds/opening",
    query: { "game_ids[]": gameIds, per_page: 100 },
    maxPages: MAX_OPENING_PAGES,
  });
  const openings = openingRows.map(normalizeOpening).filter((row): row is NonNullable<ReturnType<typeof normalizeOpening>> => row !== null)
    .filter((row) => gameIds.includes(row.gameId))
    .sort((first, second) => first.gameId.localeCompare(second.gameId) || first.vendor.localeCompare(second.vendor));
  const coveredGames = new Set(openings.map((row) => row.gameId));
  const coverageRatio = coveredGames.size / games.length;
  const missingGames = games.filter((game) => !coveredGames.has(game.gameId));
  if (coverageRatio < 0.99) {
    throw new Error(`Opening coverage below 99%: ${coveredGames.size}/${games.length} games`);
  }
  const payload = {
    cacheRelease: CACHE_RELEASE,
    fetchedAt: new Date().toISOString(),
    source: "BALLDONTLIE /nfl/v1/odds/opening",
    season,
    seasonType: "regular",
    games,
    openings,
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const sha256 = createHash("sha256").update(serialized).digest("hex");
  const cacheDirectory = path.resolve("football-research/cache/nfl-market");
  mkdirSync(cacheDirectory, { recursive: true });
  const dataPath = path.join(cacheDirectory, `${CACHE_RELEASE}.json`);
  const tempPath = `${dataPath}.tmp`;
  writeFileSync(tempPath, serialized, "utf8");
  renameSync(tempPath, dataPath);
  const vendors = [...new Set(openings.map((row) => row.vendor))].sort();
  const manifest = {
    cacheRelease: CACHE_RELEASE,
    dataFile: dataPath,
    dataSha256: sha256,
    fetchedAt: payload.fetchedAt,
    requests,
    games: games.length,
    openingRows: openings.length,
    coveredGames: coveredGames.size,
    coverageRatio,
    missingGames,
    vendors,
  };
  const manifestPath = path.join(cacheDirectory, `${CACHE_RELEASE}.manifest.json`);
  writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  renameSync(`${manifestPath}.tmp`, manifestPath);
  console.log(JSON.stringify({ ...manifest, dataFile: path.relative(process.cwd(), dataPath), manifestFile: path.relative(process.cwd(), manifestPath) }, null, 2));
})();
