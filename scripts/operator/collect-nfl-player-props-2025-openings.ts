import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  normalizeBalldontlieNflPlayerProps,
} from "../../lib/services/football/nflPlayerPropsProviders";
import type { NflPlayerPropPriceObservation } from "../../lib/services/football/nflPlayerPropsContract";

const RELEASE = "nfl_player_props_2025_opening_prices_2026_08_25_r1";
const BASE = "https://api.balldontlie.io/nfl/v1";
const CONCURRENCY = 3;
const MAX_GAMES = 285;

type Json = Record<string, unknown>;
type Game = { id: string; scheduledStart: string; homeTeam: string; awayTeam: string };

async function main(): Promise<void> {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("BALLDONTLIE_API_KEY is required.");
  const fetchedAt = new Date().toISOString();
  let requests = 0;
  const games: Game[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4; page += 1) {
    const url = new URL(`${BASE}/games`);
    url.searchParams.append("seasons[]", "2025");
    url.searchParams.append("season_type[]", "2");
    url.searchParams.set("per_page", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = await get(url, key); requests += 1;
    for (const value of data(body)) {
      const game = normalizeGame(value);
      if (game) games.push(game);
    }
    cursor = nextCursor(body);
    if (!cursor) break;
    if (page === 3) throw new Error("2025 NFL schedule exceeded pagination budget.");
  }
  if (games.length < 260 || games.length > MAX_GAMES || new Set(games.map((game) => game.id)).size !== games.length) {
    throw new Error(`2025 NFL schedule coverage is invalid: ${games.length}`);
  }
  const raw: unknown[] = [];
  for (let index = 0; index < games.length; index += CONCURRENCY) {
    const chunks = await Promise.all(games.slice(index, index + CONCURRENCY).map(async (game) => {
      const url = new URL(`${BASE}/odds/player_props/opening`);
      url.searchParams.set("game_id", game.id);
      const body = await get(url, key); requests += 1;
      return data(body);
    }));
    raw.push(...chunks.flat());
    if (index % 30 === 0) console.error(`2025 props openings ${Math.min(index + CONCURRENCY, games.length)}/${games.length}`);
  }
  const normalized = normalizeBalldontlieNflPlayerProps({ values: raw, fetchedAt, opening: true });
  const playerIds = [...new Set(normalized.rows.map((row) => row.providerPlayerId).filter((value): value is string => value !== null))];
  if (playerIds.length > 1_200) throw new Error(`2025 NFL props player identity budget exceeded: ${playerIds.length}`);
  const identities = new Map<string, { name: string; team: string | null }>();
  for (let index = 0; index < playerIds.length; index += 100) {
    let playerCursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const url = new URL(`${BASE}/players`);
      for (const id of playerIds.slice(index, index + 100)) url.searchParams.append("player_ids[]", id);
      url.searchParams.set("per_page", "100");
      if (playerCursor) url.searchParams.set("cursor", playerCursor);
      const body = await get(url, key); requests += 1;
      for (const value of data(body)) {
        const identity = normalizePlayer(value);
        if (identity) identities.set(identity.id, { name: identity.name, team: identity.team });
      }
      playerCursor = nextCursor(body);
      if (!playerCursor) break;
      if (page === 2) throw new Error("2025 NFL props player identity exceeded pagination budget.");
    }
  }
  const rows = normalized.rows.map((row): NflPlayerPropPriceObservation => {
    const identity = row.providerPlayerId ? identities.get(row.providerPlayerId) : null;
    return identity ? { ...row, playerName: identity.name, playerTeam: identity.team } : row;
  });
  const unresolved = rows.filter((row) => !row.playerName).length;
  const payload = {
    release: RELEASE,
    fetchedAt,
    season: 2025,
    games,
    observations: rows,
    coverage: {
      games: games.length,
      rawRows: raw.length,
      normalizedRows: rows.length,
      rejectedRows: normalized.rejectedRows,
      players: playerIds.length,
      resolvedPlayers: identities.size,
      unresolvedRows: unresolved,
      requests,
      unknownMarkets: normalized.unknownMarkets,
    },
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const sha256 = createHash("sha256").update(json).digest("hex");
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-player-props-history");
  await mkdir(root, { recursive: true });
  const filename = `nfl_player_props_2025_openings_${sha256.slice(0, 16)}.json`;
  await writeFile(path.join(root, filename), json, "utf8");
  console.log(JSON.stringify({ release: RELEASE, filename, sha256, coverage: payload.coverage }, null, 2));
}

async function get(url: URL, key: string): Promise<Json> {
  const response = await fetch(url, { headers: { Authorization: key, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`BALLDONTLIE ${url.pathname} failed with HTTP ${response.status}.`);
  return await response.json() as Json;
}

function data(body: Json): unknown[] {
  return Array.isArray(body.data) ? body.data : [];
}

function nextCursor(body: Json): string | null {
  const meta = body.meta !== null && typeof body.meta === "object" ? body.meta as Json : {};
  const value = meta.next_cursor;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function normalizeGame(value: unknown): Game | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Json;
  const id = textOrNumber(row.id);
  const scheduledStart = iso(row.date);
  const home = object(row.home_team);
  const away = object(row.visitor_team ?? row.away_team);
  const homeTeam = text(home.abbreviation)?.toUpperCase() ?? null;
  const awayTeam = text(away.abbreviation)?.toUpperCase() ?? null;
  return id && scheduledStart && homeTeam && awayTeam ? { id, scheduledStart, homeTeam, awayTeam } : null;
}

function normalizePlayer(value: unknown): { id: string; name: string; team: string | null } | null {
  const row = object(value);
  const id = textOrNumber(row.id);
  const name = [text(row.first_name), text(row.last_name)].filter((part): part is string => part !== null).join(" ");
  const team = text(object(row.team).abbreviation)?.toUpperCase() ?? null;
  return id && name ? { id, name, team } : null;
}

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textOrNumber(value: unknown): string | null {
  return text(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
}

function iso(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
