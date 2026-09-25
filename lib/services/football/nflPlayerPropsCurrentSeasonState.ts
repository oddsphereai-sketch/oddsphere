import type { SupabaseClient } from "@supabase/supabase-js";

export const NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE =
  "nfl_player_props_current_season_state_2026_09_25_r2_team_score_capture" as const;
const NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_PRECEDING_RELEASE =
  "nfl_player_props_current_season_state_2026_09_16_r1_prior_final_games" as const;
export const NFL_PLAYER_PROPS_CURRENT_SEASON_GAMES_PAGE_MAXIMUM = 4 as const;
export const NFL_PLAYER_PROPS_CURRENT_SEASON_STATS_PAGE_MAXIMUM = 20 as const;
const BDL_BASE_URL = "https://api.balldontlie.io/nfl/v1";

export type NflPlayerPropsCurrentSeasonStat = {
  gameId: string;
  season: number;
  week: number;
  scheduledStart: string;
  playerId: string;
  playerName: string;
  team: string;
  passing_attempts: number;
  passing_completions: number;
  passing_yards: number;
  rushing_attempts: number;
  rushing_yards: number;
  receptions: number;
  receiving_yards: number;
  receiving_targets: number;
  rushing_touchdowns: number;
  receiving_touchdowns: number;
  kick_return_touchdowns: number;
  punt_return_touchdowns: number;
  fumbles_touchdowns: number;
};

export type NflPlayerPropsCurrentSeasonGame = {
  gameId: string;
  season: number;
  week: number;
  scheduledStart: string;
  status: "final";
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

export type NflPlayerPropsCurrentSeasonState = {
  release: typeof NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE;
  season: number;
  completeThroughWeek: number;
  updatedAt: string;
  games: NflPlayerPropsCurrentSeasonGame[];
  stats: NflPlayerPropsCurrentSeasonStat[];
};

export type NflPlayerPropsCurrentSeasonRefresh = {
  state: NflPlayerPropsCurrentSeasonState;
  apiCalls: number;
  gamesDiscovered: number;
  gamesAdded: number;
  statsAdded: number;
};

export async function readNflPlayerPropsCurrentSeasonState(args: {
  client: SupabaseClient;
  season: number;
}): Promise<NflPlayerPropsCurrentSeasonState | null> {
  const { data, error } = await args.client
    .from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", snapshotKey(args.season))
    .maybeSingle();
  if (error) throw new Error(`NFL props current-season state read failed: ${error.message}`);
  return parseState(data?.payload, args.season);
}

export async function refreshNflPlayerPropsCurrentSeasonState(args: {
  season: number;
  week: number;
  now: string;
  apiKey: string;
  previous?: NflPlayerPropsCurrentSeasonState | null;
  fetchImpl?: typeof fetch;
}): Promise<NflPlayerPropsCurrentSeasonRefresh> {
  const now = Date.parse(args.now);
  if (!Number.isFinite(now)) throw new Error("NFL props current-season state now is invalid.");
  if (!Number.isInteger(args.week) || args.week < 1 || args.week > 18) throw new Error("NFL props current-season state week is invalid.");
  const previous = args.previous?.season === args.season ? args.previous : null;
  const base = previous ?? emptyState(args.season, args.now);
  const targetWeek = args.week - 1;
  if (targetWeek <= base.completeThroughWeek) {
    return { state: base, apiCalls: 0, gamesDiscovered: 0, gamesAdded: 0, statsAdded: 0 };
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const games = await fetchPriorGames({
    season: args.season,
    throughWeek: targetWeek,
    apiKey: args.apiKey,
    fetchImpl,
  });
  const malformedFinal = games.rows.filter((game) => game.status === "final" && !isCompletedGame(game));
  if (malformedFinal.length) {
    throw new Error(`NFL props current-season state is missing team or score identity for ${malformedFinal.length} final games.`);
  }
  const completed = games.rows.filter((game): game is NflPlayerPropsCurrentSeasonGame =>
    isCompletedGame(game) && Date.parse(game.scheduledStart) < now);
  const existingGameIds = new Set(base.games.map((row) => row.gameId));
  const existingStatGameIds = new Set(base.stats.map((row) => row.gameId));
  const missingGames = completed.filter((game) => !existingGameIds.has(game.gameId));
  const gamesNeedingStats = completed.filter((game) => !existingStatGameIds.has(game.gameId));
  const stats = gamesNeedingStats.length
    ? await fetchGameStats({ games: gamesNeedingStats, apiKey: args.apiKey, fetchImpl })
    : { rows: [] as NflPlayerPropsCurrentSeasonStat[], calls: 0 };
  const gamesWithStats = new Set(stats.rows.map((row) => row.gameId));
  const missingCompleted = gamesNeedingStats.filter((game) => !gamesWithStats.has(game.gameId));
  if (missingCompleted.length) {
    throw new Error(`NFL props current-season stats are incomplete for ${missingCompleted.length} final games.`);
  }
  const allPriorGamesFinal = games.rows.length > 0 && games.rows.every((game) => game.status === "final");
  const state: NflPlayerPropsCurrentSeasonState = {
    release: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
    season: args.season,
    completeThroughWeek: allPriorGamesFinal ? targetWeek : base.completeThroughWeek,
    updatedAt: new Date(now).toISOString(),
    games: [...base.games, ...missingGames].sort(compareGame),
    stats: [...base.stats, ...stats.rows].sort(compareStat),
  };
  return {
    state,
    apiCalls: games.calls + stats.calls,
    gamesDiscovered: games.rows.length,
    gamesAdded: missingGames.length,
    statsAdded: stats.rows.length,
  };
}

export async function writeNflPlayerPropsCurrentSeasonState(args: {
  client: SupabaseClient;
  state: NflPlayerPropsCurrentSeasonState;
}): Promise<void> {
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: snapshotKey(args.state.season),
    kind: "daily_edge",
    sport: "nfl",
    slate_date: null,
    payload: args.state,
    payload_version: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
    source: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
    generated_at: args.state.updatedAt,
    expires_at: new Date(Date.parse(args.state.updatedAt) + 370 * 86_400_000).toISOString(),
    stale_until: new Date(Date.parse(args.state.updatedAt) + 370 * 86_400_000).toISOString(),
    updated_at: args.state.updatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NFL props current-season state write failed: ${error.message}`);
}

type PriorGame = {
  gameId: string;
  season: number;
  week: number;
  scheduledStart: string;
  status: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

async function fetchPriorGames(args: {
  season: number;
  throughWeek: number;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<{ rows: PriorGame[]; calls: number }> {
  if (args.throughWeek < 1) return { rows: [], calls: 0 };
  const rows: PriorGame[] = [];
  let cursor: string | null = null;
  let calls = 0;
  for (let page = 0; page < NFL_PLAYER_PROPS_CURRENT_SEASON_GAMES_PAGE_MAXIMUM; page += 1) {
    const url = new URL(`${BDL_BASE_URL}/games`);
    url.searchParams.append("seasons[]", String(args.season));
    url.searchParams.append("season_type[]", "2");
    for (let week = 1; week <= args.throughWeek; week += 1) url.searchParams.append("weeks[]", String(week));
    url.searchParams.set("per_page", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = await request(url, args.apiKey, args.fetchImpl, "games");
    calls += 1;
    for (const value of body.data) {
      const game = normalizeGame(value);
      if (game) rows.push(game);
    }
    cursor = nextCursor(body.meta);
    if (!cursor) return { rows: rows.sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart)), calls };
  }
  throw new Error("NFL props current-season games exceeded its pagination budget.");
}

async function fetchGameStats(args: {
  games: PriorGame[];
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<{ rows: NflPlayerPropsCurrentSeasonStat[]; calls: number }> {
  const games = new Map(args.games.map((game) => [game.gameId, game]));
  const rows: NflPlayerPropsCurrentSeasonStat[] = [];
  let cursor: string | null = null;
  let calls = 0;
  for (let page = 0; page < NFL_PLAYER_PROPS_CURRENT_SEASON_STATS_PAGE_MAXIMUM; page += 1) {
    const url = new URL(`${BDL_BASE_URL}/stats`);
    for (const gameId of games.keys()) url.searchParams.append("game_ids[]", gameId);
    url.searchParams.set("per_page", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = await request(url, args.apiKey, args.fetchImpl, "stats");
    calls += 1;
    for (const value of body.data) {
      const stat = normalizeStat(value, games);
      if (stat) rows.push(stat);
    }
    cursor = nextCursor(body.meta);
    if (!cursor) return { rows: rows.sort(compareStat), calls };
  }
  throw new Error("NFL props current-season stats exceeded its pagination budget.");
}

async function request(url: URL, apiKey: string, fetchImpl: typeof fetch, label: string): Promise<{ data: unknown[]; meta?: Record<string, unknown> }> {
  const response = await fetchImpl(url, {
    headers: { Authorization: apiKey, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BALLDONTLIE NFL ${label} failed with HTTP ${response.status}.`);
  const body = await response.json() as { data?: unknown; meta?: Record<string, unknown> };
  if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE NFL ${label} payload is malformed.`);
  return { data: body.data, meta: body.meta };
}

function normalizeGame(value: unknown): PriorGame | null {
  const row = record(value);
  const gameId = id(row.id);
  const season = integer(row.season);
  const week = integer(row.week);
  const scheduledStart = iso(row.date);
  const status = text(row.status_state)?.toLowerCase() ?? "unknown";
  const home = normalizeTeamRecord(row.home_team);
  const away = normalizeTeamRecord(row.visitor_team ?? row.away_team);
  const homeScore = integer(row.home_team_score) ?? integer(row.home_score);
  const awayScore = integer(row.visitor_team_score) ?? integer(row.away_team_score) ?? integer(row.away_score);
  return gameId && season !== null && week !== null && scheduledStart
    ? { gameId, season, week, scheduledStart, status, homeTeam: home, awayTeam: away, homeScore, awayScore }
    : null;
}

function normalizeStat(value: unknown, games: ReadonlyMap<string, PriorGame>): NflPlayerPropsCurrentSeasonStat | null {
  const row = record(value);
  const game = record(row.game);
  const player = record(row.player);
  const team = record(row.team);
  const gameId = id(game.id);
  const priorGame = gameId ? games.get(gameId) : null;
  const playerId = id(player.id);
  const playerName = [text(player.first_name), text(player.last_name)].filter((part): part is string => Boolean(part)).join(" ");
  const teamAbbreviation = text(team.abbreviation)?.toUpperCase() ?? null;
  if (!gameId || !priorGame || !playerId || !playerName || !teamAbbreviation) return null;
  return {
    gameId,
    season: priorGame.season,
    week: priorGame.week,
    scheduledStart: priorGame.scheduledStart,
    playerId,
    playerName,
    team: normalizeTeam(teamAbbreviation),
    passing_attempts: numeric(row.passing_attempts),
    passing_completions: numeric(row.passing_completions),
    passing_yards: numeric(row.passing_yards),
    rushing_attempts: numeric(row.rushing_attempts),
    rushing_yards: numeric(row.rushing_yards),
    receptions: numeric(row.receptions),
    receiving_yards: numeric(row.receiving_yards),
    receiving_targets: numeric(row.receiving_targets),
    rushing_touchdowns: numeric(row.rushing_touchdowns),
    receiving_touchdowns: numeric(row.receiving_touchdowns),
    kick_return_touchdowns: numeric(row.kick_return_touchdowns),
    punt_return_touchdowns: numeric(row.punt_return_touchdowns),
    fumbles_touchdowns: numeric(row.fumbles_touchdowns),
  };
}

function parseState(value: unknown, season: number): NflPlayerPropsCurrentSeasonState | null {
  const row = record(value);
  if (row.release === NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_PRECEDING_RELEASE
    && row.season === season
    && Number.isInteger(row.completeThroughWeek)
    && typeof row.updatedAt === "string"
    && Array.isArray(row.stats)) {
    return {
      release: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
      season,
      completeThroughWeek: 0,
      updatedAt: row.updatedAt,
      games: [],
      stats: row.stats as NflPlayerPropsCurrentSeasonStat[],
    };
  }
  return row.release === NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE
    && row.season === season
    && Number.isInteger(row.completeThroughWeek)
    && typeof row.updatedAt === "string"
    && Array.isArray(row.games)
    && Array.isArray(row.stats)
      ? value as NflPlayerPropsCurrentSeasonState
      : null;
}

function emptyState(season: number, now: string): NflPlayerPropsCurrentSeasonState {
  return { release: NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE, season, completeThroughWeek: 0, updatedAt: new Date(now).toISOString(), games: [], stats: [] };
}
function snapshotKey(season: number): string { return `nfl::player-props-current-season::${season}`; }
function nextCursor(meta: Record<string, unknown> | undefined): string | null { const value = meta?.next_cursor; return typeof value === "number" || typeof value === "string" ? String(value) : null; }
function compareGame(a: NflPlayerPropsCurrentSeasonGame, b: NflPlayerPropsCurrentSeasonGame): number { return a.week - b.week || a.gameId.localeCompare(b.gameId); }
function compareStat(a: NflPlayerPropsCurrentSeasonStat, b: NflPlayerPropsCurrentSeasonStat): number { return a.week - b.week || a.gameId.localeCompare(b.gameId) || a.playerId.localeCompare(b.playerId); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function id(value: unknown): string | null { return typeof value === "string" || typeof value === "number" ? String(value) : null; }
function integer(value: unknown): number | null { const parsed = Number(value); return Number.isInteger(parsed) ? parsed : null; }
function numeric(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function iso(value: unknown): string | null { const parsed = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function normalizeTeam(value: string): string { return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[value] ?? value; }
function normalizeTeamRecord(value: unknown): string | null { const abbreviation = text(record(value).abbreviation)?.toUpperCase(); return abbreviation ? normalizeTeam(abbreviation) : null; }
function isCompletedGame(game: PriorGame): game is NflPlayerPropsCurrentSeasonGame {
  return game.status === "final" && game.homeTeam !== null && game.awayTeam !== null
    && game.homeScore !== null && game.awayScore !== null;
}
