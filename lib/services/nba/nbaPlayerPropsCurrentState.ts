import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNbaBdlHistoricalRows } from "./balldontlieNbaHistorical";
import {
  decodeNbaPlayerPropsPrivatePayload,
  encodeNbaPlayerPropsPrivatePayload,
} from "./nbaPlayerPropsPrivateStore";
import {
  normalizeNbaHistoricalGame,
  normalizeNbaHistoricalPlayerAdvanced,
  normalizeNbaHistoricalPlayerBox,
  type NbaHistoricalGame,
  type NbaHistoricalPlayerAdvanced,
  type NbaHistoricalPlayerBox,
} from "./nbaPointInTimeFeatures";

export const NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE =
  "nba_player_props_current_state_2026_10_21_r2_regular_and_ist" as const;
const RETENTION_DAYS = 550;

export type NbaPlayerPropsPlayerIdentity = Readonly<{
  playerId: number;
  playerName: string | null;
  latestTeamId: number;
  lastObservedAt: string;
}>;

export type NbaPlayerPropsCurrentState = Readonly<{
  release: typeof NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE;
  publicEnabled: false;
  season: number;
  createdAt: string;
  updatedAt: string;
  games: readonly NbaHistoricalGame[];
  boxes: readonly NbaHistoricalPlayerBox[];
  advanced: readonly NbaHistoricalPlayerAdvanced[];
  players: readonly NbaPlayerPropsPlayerIdentity[];
}>;

export function nbaPlayerPropsCurrentStateKey(season: number): string {
  return `nba::player-props-private-current-state::${season}`;
}

export async function readNbaPlayerPropsCurrentState(args: {
  client: SupabaseClient;
  season: number;
}): Promise<NbaPlayerPropsCurrentState | null> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", nbaPlayerPropsCurrentStateKey(args.season))
    .maybeSingle();
  if (error) throw new Error(`NBA props current-state read failed: ${error.message}`);
  const state = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsCurrentState>(data?.payload, "current_state");
  if (!state) return null;
  validateState(state, args.season);
  return state;
}

export async function writeNbaPlayerPropsCurrentState(args: {
  client: SupabaseClient;
  state: NbaPlayerPropsCurrentState;
}): Promise<{ jsonBytes: number; gzipBytes: number }> {
  validateState(args.state, args.state.season);
  const payload = encodeNbaPlayerPropsPrivatePayload(args.state, "current_state");
  const retention = new Date(Date.parse(args.state.updatedAt) + RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: nbaPlayerPropsCurrentStateKey(args.state.season),
    kind: "daily_edge",
    sport: "nba",
    slate_date: null,
    payload,
    payload_version: NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,
    source: NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,
    generated_at: args.state.updatedAt,
    expires_at: retention,
    stale_until: retention,
    updated_at: args.state.updatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NBA props current-state write failed: ${error.message}`);
  return { jsonBytes: payload.uncompressedBytes, gzipBytes: payload.compressedBytes };
}

export function mergeNbaPlayerPropsCurrentState(args: {
  previous: NbaPlayerPropsCurrentState | null;
  season: number;
  capturedAt: string;
  games: readonly NbaHistoricalGame[];
  boxes: readonly NbaHistoricalPlayerBox[];
  advanced: readonly NbaHistoricalPlayerAdvanced[];
  players?: readonly NbaPlayerPropsPlayerIdentity[];
  allowOfficialCorrections?: boolean;
}): { state: NbaPlayerPropsCurrentState; gamesAdded: number; boxesAdded: number; advancedAdded: number; corrected: number } {
  const gameMap = immutableMerge(args.previous?.games ?? [], args.games, (row) => String(row.gameId), "game", args.allowOfficialCorrections);
  const boxMap = immutableMerge(args.previous?.boxes ?? [], args.boxes, (row) => String(row.rowId), "box", args.allowOfficialCorrections);
  const advancedMap = immutableMerge(args.previous?.advanced ?? [], args.advanced, (row) => String(row.rowId), "advanced", args.allowOfficialCorrections);
  const players = new Map((args.previous?.players ?? []).map((row) => [row.playerId, row]));
  for (const player of args.players ?? []) {
    const prior = players.get(player.playerId);
    if (!prior || Date.parse(player.lastObservedAt) > Date.parse(prior.lastObservedAt)) players.set(player.playerId, player);
  }
  return {
    state: {
      release: NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,
      publicEnabled: false,
      season: args.season,
      createdAt: args.previous?.createdAt ?? args.capturedAt,
      updatedAt: args.capturedAt,
      games: [...gameMap.map.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)),
      boxes: [...boxMap.map.values()].sort((a, b) => a.gameId - b.gameId || a.playerId - b.playerId),
      advanced: [...advancedMap.map.values()].sort((a, b) => a.gameId - b.gameId || a.playerId - b.playerId),
      players: [...players.values()].sort((a, b) => a.playerId - b.playerId),
    },
    gamesAdded: gameMap.added,
    boxesAdded: boxMap.added,
    advancedAdded: advancedMap.added,
    corrected: gameMap.corrected + boxMap.corrected + advancedMap.corrected,
  };
}

/** Bounded incremental collector; bootstrap uses the same path with an explicit season. */
export async function collectNbaPlayerPropsCurrentState(args: {
  previous: NbaPlayerPropsCurrentState | null;
  season: number;
  dates?: readonly string[];
  fullSeason?: boolean;
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}): Promise<{
  state: NbaPlayerPropsCurrentState;
  providerRequests: number;
  gamesAdded: number;
  boxesAdded: number;
  advancedAdded: number;
  corrected: number;
}> {
  if (!args.fullSeason && (!args.dates || args.dates.length === 0)) {
    throw new Error("NBA props incremental state collection requires exact dates.");
  }
  const gameResults = await Promise.all((["regular", "ist"] as const).map((seasonType) => fetchNbaBdlHistoricalRows({
    dataset: "games",
    season: args.fullSeason ? args.season : undefined,
    seasonType,
    dates: args.fullSeason ? undefined : args.dates,
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
    maxPages: args.maxPages,
  })));
  if (gameResults.some((result) => !result.complete)) throw new Error("NBA props game state collection hit its page ceiling.");
  const rawGames = [...new Map(gameResults.flatMap((result) => result.rows)
    .filter(isFinalRegularGame)
    .map((row) => [String(row.id), row])).values()];
  const gameRequests = gameResults.reduce((sum, result) => sum + result.requests, 0);
  const games = rawGames.map(normalizeNbaHistoricalGame).filter((row) => row.season === args.season);
  if (games.length === 0) {
    const merged = mergeNbaPlayerPropsCurrentState({
      previous: args.previous,
      season: args.season,
      capturedAt: new Date().toISOString(),
      games: [], boxes: [], advanced: [],
    });
    return { state: merged.state, providerRequests: gameRequests, gamesAdded: 0, boxesAdded: 0, advancedAdded: 0, corrected: 0 };
  }
  const gameIds = games.map((row) => row.gameId);
  const playerRows = await fetchPlayerRowsInBatches({
    gameIds, apiKey: args.apiKey, fetchImpl: args.fetchImpl, maxPages: args.maxPages,
  });
  const boxes = playerRows.boxes.map(normalizeNbaHistoricalPlayerBox);
  const advanced = playerRows.advanced.map(normalizeNbaHistoricalPlayerAdvanced);
  const startByGame = new Map(games.map((game) => [game.gameId, game.startTime]));
  const players = newestPlayerIdentities(playerRows.boxes, startByGame);
  const merged = mergeNbaPlayerPropsCurrentState({
    previous: args.previous,
    season: args.season,
    capturedAt: new Date().toISOString(),
    games,
    boxes,
    advanced,
    players,
    allowOfficialCorrections: true,
  });
  return {
    state: merged.state,
    providerRequests: gameRequests + playerRows.requests,
    gamesAdded: merged.gamesAdded,
    boxesAdded: merged.boxesAdded,
    advancedAdded: merged.advancedAdded,
    corrected: merged.corrected,
  };
}

async function fetchPlayerRowsInBatches(args: {
  gameIds: readonly number[];
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}): Promise<{ boxes: Record<string, unknown>[]; advanced: Record<string, unknown>[]; requests: number }> {
  const boxes: Record<string, unknown>[] = [];
  const advanced: Record<string, unknown>[] = [];
  let requests = 0;
  for (let index = 0; index < args.gameIds.length; index += 100) {
    const gameIds = args.gameIds.slice(index, index + 100);
    const [boxResult, advancedResult] = await Promise.all([
      fetchNbaBdlHistoricalRows({ dataset: "box", gameIds, apiKey: args.apiKey, fetchImpl: args.fetchImpl, maxPages: args.maxPages }),
      fetchNbaBdlHistoricalRows({ dataset: "advanced", gameIds, apiKey: args.apiKey, fetchImpl: args.fetchImpl, maxPages: args.maxPages }),
    ]);
    if (!boxResult.complete || !advancedResult.complete) throw new Error("NBA props player state collection hit its page ceiling.");
    boxes.push(...boxResult.rows);
    advanced.push(...advancedResult.rows);
    requests += boxResult.requests + advancedResult.requests;
  }
  return { boxes, advanced, requests };
}

function newestPlayerIdentities(
  rows: readonly Record<string, unknown>[],
  startByGame: ReadonlyMap<number, string>,
): NbaPlayerPropsPlayerIdentity[] {
  const values = new Map<number, NbaPlayerPropsPlayerIdentity>();
  for (const row of rows) {
    const player = object(row.player);
    const team = object(row.team);
    const game = object(row.game);
    const playerId = integer(row.player_id) ?? integer(player?.id);
    const teamId = integer(row.team_id) ?? integer(team?.id);
    const gameId = integer(row.game_id) ?? integer(game?.id);
    if (playerId === null || teamId === null || gameId === null) continue;
    const first = text(player?.first_name);
    const last = text(player?.last_name);
    const name = [first, last].filter(Boolean).join(" ") || null;
    const observedAt = startByGame.get(gameId);
    if (!observedAt) continue;
    const prior = values.get(playerId);
    if (!prior || Date.parse(observedAt) > Date.parse(prior.lastObservedAt)) {
      values.set(playerId, { playerId, playerName: name, latestTeamId: teamId, lastObservedAt: observedAt });
    }
  }
  return [...values.values()];
}

function immutableMerge<T>(
  previous: readonly T[], current: readonly T[], key: (row: T) => string, label: string,
  allowOfficialCorrections = false,
): { map: Map<string, T>; added: number; corrected: number } {
  const map = new Map(previous.map((row) => [key(row), row]));
  let added = 0;
  let corrected = 0;
  for (const row of current) {
    const id = key(row);
    const prior = map.get(id);
    if (!prior) { map.set(id, row); added += 1; }
    else if (JSON.stringify(prior) !== JSON.stringify(row)) {
      if (!allowOfficialCorrections) throw new Error(`NBA props current state refuses to mutate stored ${label} ${id}.`);
      map.set(id, row);
      corrected += 1;
    }
  }
  return { map, added, corrected };
}

function validateState(state: NbaPlayerPropsCurrentState, season: number): void {
  if (state.release !== NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE || state.publicEnabled !== false || state.season !== season) {
    throw new Error("NBA props current-state release, public gate, or season is invalid.");
  }
  if (!Number.isFinite(Date.parse(state.createdAt)) || !Number.isFinite(Date.parse(state.updatedAt))) {
    throw new Error("NBA props current-state timestamp is invalid.");
  }
}

function isFinalRegularGame(row: Record<string, unknown>): boolean {
  return (row.status_state === "final" || row.status === "Final")
    && row.postseason !== true && row.ist_stage !== "Championship";
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function integer(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && Number.isFinite(number) ? number : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
