import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_RELEASE = "bdl_nfl_preseason_games_2019_2025_2026_08_19_r2" as const;
const BASE_URL = "https://api.balldontlie.io/nfl/v1/games";
const START_SEASON = 2019;
const END_SEASON = 2025;
const MAX_PAGES = 10;

type Envelope = {
  data?: unknown;
  meta?: { next_cursor?: unknown } | null;
};

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const rows: unknown[] = [];
  let cursor: string | null = null;
  let requests = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(BASE_URL);
    for (let season = START_SEASON; season <= END_SEASON; season += 1) {
      url.searchParams.append("seasons[]", String(season));
    }
    url.searchParams.append("season_type[]", "1");
    url.searchParams.set("per_page", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    requests += 1;
    const response = await fetch(url, {
      headers: { Authorization: apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`BALLDONTLIE preseason games failed with HTTP ${response.status}.`);
    const body = await response.json() as Envelope;
    if (!Array.isArray(body.data)) throw new Error("BALLDONTLIE preseason games returned malformed data.");
    rows.push(...body.data);
    const next = body.meta?.next_cursor;
    cursor = typeof next === "string" || typeof next === "number" ? String(next) : null;
    if (!cursor) break;
    if (page === MAX_PAGES - 1) throw new Error("BALLDONTLIE preseason history exceeded the pagination budget.");
  }

  const normalized = rows.map(normalizeGame).filter((row): row is NonNullable<ReturnType<typeof normalizeGame>> => row !== null)
    .filter((row) => row.season >= START_SEASON && row.season <= END_SEASON)
    .sort((first, second) => first.season - second.season || first.week - second.week || Date.parse(first.date) - Date.parse(second.date));
  const identities = new Set(normalized.map((row) => row.id));
  if (identities.size !== normalized.length) throw new Error("BALLDONTLIE preseason history contains duplicate game IDs.");
  const seasonCounts = Object.fromEntries(Array.from({ length: END_SEASON - START_SEASON + 1 }, (_, index) => {
    const season = START_SEASON + index;
    return [season, normalized.filter((row) => row.season === season).length];
  }));
  const expectedCounts: Record<number, number> = {
    2019: 65,
    2020: 0, // COVID-19 cancellation: no preseason was played.
    2021: 48,
    2022: 49,
    2023: 49,
    2024: 49,
    2025: 49,
  };
  if (Object.entries(expectedCounts).some(([season, count]) => seasonCounts[Number(season)] !== count)) {
    throw new Error(`BALLDONTLIE preseason history is incomplete: ${JSON.stringify(seasonCounts)}`);
  }

  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  const checksum = createHash("sha256").update(payload).digest("hex");
  const root = path.resolve(process.cwd(), "football-research/cache/balldontlie");
  await mkdir(root, { recursive: true });
  const filename = `nfl_preseason_games_2019_2025_${checksum.slice(0, 16)}.json`;
  await writeFile(path.join(root, filename), payload, "utf8");
  const manifest = {
    cacheRelease: CACHE_RELEASE,
    source: "BALLDONTLIE NFL games",
    sourceUrl: BASE_URL,
    fetchedAt: new Date().toISOString(),
    seasonType: "preseason",
    seasonRange: [START_SEASON, END_SEASON],
    providerRequests: requests,
    rows: normalized.length,
    seasonCounts,
    filename,
    sha256: checksum,
  };
  await writeFile(path.join(root, "nfl_preseason_games_2019_2025.latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

function normalizeGame(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const home = normalizeTeam(row.home_team);
  const away = normalizeTeam(row.visitor_team);
  const id = textOrNumber(row.id);
  const season = integer(row.season);
  const week = integer(row.week);
  const date = iso(row.date);
  const homeScore = number(row.home_team_score);
  const awayScore = number(row.visitor_team_score);
  if (!id || season === null || week === null || !date || !home || !away || homeScore === null || awayScore === null) return null;
  return {
    id,
    season,
    week,
    date,
    status: text(row.status) ?? text(row.status_state) ?? "Final",
    home,
    away,
    homeScore,
    awayScore,
  };
}

function normalizeTeam(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = integer(row.id);
  const abbreviation = text(row.abbreviation)?.toUpperCase() ?? null;
  const name = text(row.full_name);
  return id === null || !abbreviation || !name ? null : { id, abbreviation, name };
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textOrNumber(value: unknown) {
  return text(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown) {
  const parsed = number(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function iso(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
