import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://api.balldontlie.io/nhl/v1";
const SEASONS = [2023, 2024, 2025] as const;
const MAX_GAME_PAGES = 20;
const MAX_ODDS_PAGES_PER_BATCH = 10;
const GAME_ID_BATCH_SIZE = 40;

type Page<T> = { data?: T[]; meta?: { next_cursor?: number | string | null } };
type Game = {
  id: number; season: number; game_date: string; start_time_utc: string;
  home_team: { id: number; tricode: string }; away_team: { id: number; tricode: string };
  home_score: number; away_score: number; postseason: boolean; status_state?: string;
};
type Opening = {
  id: number; game_id: number; vendor: string;
  spread_home_value: string | number | null; spread_home_odds: number | null;
  spread_away_value: string | number | null; spread_away_odds: number | null;
  moneyline_home_odds: number | null; moneyline_away_odds: number | null;
  total_value: string | number | null; total_over_odds: number | null; total_under_odds: number | null;
  opened_at: string | null;
};

async function readPage<T>(url: URL, apiKey: string): Promise<Page<T>> {
  const response = await fetch(url, { headers: { Authorization: apiKey } });
  if (!response.ok) throw new Error(`BALLDONTLIE ${url.pathname} failed with HTTP ${response.status}`);
  const body = await response.json() as Page<T>;
  if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE ${url.pathname} returned malformed data`);
  return body;
}

async function fetchGames(season: number, apiKey: string): Promise<Game[]> {
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

async function fetchOpenings(gameIds: number[], apiKey: string): Promise<Opening[]> {
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
  throw new Error("BALLDONTLIE NHL opening-odds batch exceeded page guard");
}

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const games: Game[] = [];
  const openingOdds: Opening[] = [];
  for (const season of SEASONS) {
    const seasonGames = await fetchGames(season, apiKey);
    if (seasonGames.length !== 1312) throw new Error(`Expected 1,312 games for ${season}; received ${seasonGames.length}`);
    games.push(...seasonGames);
    for (let index = 0; index < seasonGames.length; index += GAME_ID_BATCH_SIZE) {
      openingOdds.push(...await fetchOpenings(seasonGames.slice(index, index + GAME_ID_BATCH_SIZE).map((game) => game.id), apiKey));
    }
    console.log(`season ${season}: games=${seasonGames.length}, cumulative openings=${openingOdds.length}`);
  }
  const cache = { provider: "BALLDONTLIE NHL", fetched_at: new Date().toISOString(), seasons: [...SEASONS], odds_seasons: [...SEASONS], games, opening_odds: openingOdds };
  const manifest = {
    release: "bdl_nhl_multiseason_openings_2026_09_29_r1",
    game_count: games.length,
    opening_row_count: openingOdds.length,
    opening_game_count: new Set(openingOdds.map((row) => row.game_id)).size,
    sha256: createHash("sha256").update(JSON.stringify(cache)).digest("hex"),
    fetched_at: cache.fetched_at,
  };
  const root = process.argv.find((arg) => arg.startsWith("--output-root="))?.slice("--output-root=".length) ?? process.cwd();
  const output = path.resolve(root, "nhl-research/cache/balldontlie");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "nhl_regular_history_2023_2025_multiseason_openings.json"), `${JSON.stringify(cache)}\n`);
  await writeFile(path.join(output, "nhl_regular_history_2023_2025_multiseason_openings.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
