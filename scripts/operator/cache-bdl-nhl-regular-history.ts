import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://api.balldontlie.io/nhl/v1";
const SEASONS = [2023, 2024, 2025] as const;
const ODDS_SEASON = 2025;
const MAX_GAME_PAGES = 20;
const MAX_ODDS_PAGES_PER_BATCH = 10;
const GAME_ID_BATCH_SIZE = 40;

type Page<T> = {
  data?: T[];
  meta?: { next_cursor?: number | string | null; per_page?: number };
};

type Game = {
  id: number;
  season: number;
  game_date: string;
  start_time_utc: string;
  home_team: { id: number; tricode: string };
  away_team: { id: number; tricode: string };
  home_score: number;
  away_score: number;
  postseason: boolean;
  status_state?: string;
};

type Opening = {
  id: number;
  game_id: number;
  vendor: string;
  spread_home_value: string | number | null;
  spread_home_odds: number | null;
  spread_away_value: string | number | null;
  spread_away_odds: number | null;
  moneyline_home_odds: number | null;
  moneyline_away_odds: number | null;
  total_value: string | number | null;
  total_over_odds: number | null;
  total_under_odds: number | null;
  opened_at: string | null;
};

async function readPage<T>(url: URL, apiKey: string): Promise<Page<T>> {
  const response = await fetch(url, { headers: { Authorization: apiKey } });
  if (!response.ok) {
    throw new Error(`BALLDONTLIE ${url.pathname} failed with HTTP ${response.status}`);
  }
  const body = await response.json() as Page<T>;
  if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE ${url.pathname} returned malformed data`);
  return body;
}

async function fetchRegularGames(season: number, apiKey: string): Promise<Game[]> {
  const rows: Game[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_GAME_PAGES; page += 1) {
    const url = new URL(`${BASE_URL}/games`);
    url.searchParams.append("seasons[]", String(season));
    url.searchParams.set("postseason", "false");
    url.searchParams.set("per_page", "100");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const body = await readPage<Game>(url, apiKey);
    rows.push(...(body.data ?? []));
    cursor = body.meta?.next_cursor == null ? null : String(body.meta.next_cursor);
    if (cursor === null) return rows;
  }
  throw new Error(`BALLDONTLIE NHL ${season} games exceeded ${MAX_GAME_PAGES} pages`);
}

async function fetchOpeningBatch(gameIds: number[], apiKey: string): Promise<Opening[]> {
  const rows: Opening[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ODDS_PAGES_PER_BATCH; page += 1) {
    const url = new URL(`${BASE_URL}/odds/opening`);
    for (const id of gameIds) url.searchParams.append("game_ids[]", String(id));
    url.searchParams.set("per_page", "100");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const body = await readPage<Opening>(url, apiKey);
    rows.push(...(body.data ?? []));
    cursor = body.meta?.next_cursor == null ? null : String(body.meta.next_cursor);
    if (cursor === null) return rows;
  }
  throw new Error(`BALLDONTLIE NHL opening odds batch exceeded ${MAX_ODDS_PAGES_PER_BATCH} pages`);
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");

  const games: Game[] = [];
  for (const season of SEASONS) {
    const seasonRows = await fetchRegularGames(season, apiKey);
    if (seasonRows.length !== 1312) {
      throw new Error(`Expected 1,312 regular-season games for ${season}; received ${seasonRows.length}`);
    }
    games.push(...seasonRows);
    console.log(`games ${season}: ${seasonRows.length}`);
  }

  const oddsGameIds = games.filter((game) => game.season === ODDS_SEASON).map((game) => game.id);
  const openings: Opening[] = [];
  for (let i = 0; i < oddsGameIds.length; i += GAME_ID_BATCH_SIZE) {
    openings.push(...await fetchOpeningBatch(oddsGameIds.slice(i, i + GAME_ID_BATCH_SIZE), apiKey));
    console.log(`opening odds: ${Math.min(i + GAME_ID_BATCH_SIZE, oddsGameIds.length)}/${oddsGameIds.length} games`);
  }

  const gameIds = new Set(oddsGameIds);
  const validOpenings = openings.filter((row) => gameIds.has(row.game_id));
  const cache = {
    provider: "BALLDONTLIE NHL",
    fetched_at: new Date().toISOString(),
    seasons: [...SEASONS],
    odds_season: ODDS_SEASON,
    games,
    opening_odds: validOpenings,
  };
  const manifest = {
    release: "bdl_nhl_regular_history_2026_09_23_r1",
    provider: cache.provider,
    seasons: cache.seasons,
    odds_season: cache.odds_season,
    game_count: games.length,
    opening_row_count: validOpenings.length,
    opening_game_count: new Set(validOpenings.map((row) => row.game_id)).size,
    game_counts_by_season: Object.fromEntries(SEASONS.map((season) => [season, games.filter((game) => game.season === season).length])),
    sha256: checksum(cache),
    fetched_at: cache.fetched_at,
  };

  const outputRootArg = process.argv.find((arg) => arg.startsWith("--output-root="));
  const outputRoot = outputRootArg?.slice("--output-root=".length) || process.cwd();
  const outputDir = path.resolve(outputRoot, "nhl-research/cache/balldontlie");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "nhl_regular_history_2023_2025.json"), `${JSON.stringify(cache)}\n`, "utf8");
  await writeFile(path.join(outputDir, "nhl_regular_history_2023_2025.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
