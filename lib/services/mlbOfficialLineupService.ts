import { supabase } from "../db/supabase";
import { mlbStatsTeamIdToAbbr } from "./starterResolver";

type DbGame = {
  id: number;
  game_date: string | null;
  home_team_id: number;
  away_team_id: number;
  home_abbr: string;
  away_abbr: string;
};

type DbTeam = {
  id: number;
  abbreviation: string;
};

type DbPlayer = {
  id: number;
  mlb_person_id: number | null;
  provider_ids: Record<string, unknown> | null;
};

type ScheduleGame = {
  gamePk: number;
  gameDate: string | null;
  homeMlbTeamId: number | null;
  awayMlbTeamId: number | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
};

export type MlbOfficialLineupSpot = {
  gamePk: number;
  dbGameId: number;
  dbTeamId: number;
  mlbTeamId: number;
  playerMlbId: number;
  battingPosition: number | null;
  startingPosition: string | null;
  isStartingPitcher: boolean;
  isDh: boolean;
  fullName: string;
  firstName: string;
  lastName: string;
  bats: string | null;
  throws: string | null;
  rawPayload: Record<string, unknown>;
};

export type MlbOfficialLineupRefreshResult = {
  records_updated: number;
  api_calls_made: number;
  details: {
    enabled: boolean;
    games_seen: number;
    games_matched: number;
    teams_with_official_lineups: number;
    confirmed_starters_written: number;
    players_created: number;
    skipped_by_reason: Record<string, number>;
    deadline_reached: boolean;
    deadline_stage: string | null;
    games_deferred: number;
    teams_deferred: number;
  };
};

export type MlbOfficialLineupRefreshOptions = {
  deadlineAtMs?: number;
};

const MLB_STATS_BASE_URL =
  process.env.ODDSPHERE_MLB_STATS_API_BASE_URL ?? "https://statsapi.mlb.com/api/v1";
const MLB_OFFICIAL_LINEUP_OPERATION_TIMEOUT_MS = 8_000;
export const MLB_OFFICIAL_LINEUP_TEAM_START_RESERVE_MS = 12_000;

export function canStartMlbOfficialLineupTeamUnit(
  deadlineAtMs: number | undefined,
  nowMs = Date.now(),
): boolean {
  return deadlineAtMs === undefined ||
    deadlineAtMs - nowMs >= MLB_OFFICIAL_LINEUP_TEAM_START_RESERVE_MS;
}

function deadlineReached(options: MlbOfficialLineupRefreshOptions): boolean {
  return options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs;
}

function deadlineSignal(options: MlbOfficialLineupRefreshOptions): AbortSignal {
  if (options.deadlineAtMs === undefined) return new AbortController().signal;
  const remaining = Math.max(1, options.deadlineAtMs - Date.now());
  return AbortSignal.timeout(Math.min(MLB_OFFICIAL_LINEUP_OPERATION_TIMEOUT_MS, remaining));
}

function isDeadlineError(error: unknown, options: MlbOfficialLineupRefreshOptions): boolean {
  if (deadlineReached(options)) return true;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);
  return name === "AbortError" || name === "TimeoutError" || /abort|timed?\s*out|timeout/i.test(message);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asObject(value[0]);
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstLast(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: fullName, lastName: fullName };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? fullName,
  };
}

function normalizeHand(value: unknown): string | null {
  const raw = asString(value)?.toUpperCase() ?? null;
  return raw === "L" || raw === "R" || raw === "S" ? raw : null;
}

function readNestedId(obj: Record<string, unknown> | null, path: string[]): number | null {
  let cur: unknown = obj;
  for (const key of path) cur = asObject(cur)?.[key];
  return asNumber(cur);
}

export function parseMlbStatsScheduleGames(payload: unknown): ScheduleGame[] {
  const dates = asArray(asObject(payload)?.dates);
  const games: ScheduleGame[] = [];
  for (const dateRow of dates) {
    for (const game of asArray(asObject(dateRow)?.games)) {
      const g = asObject(game);
      if (g === null) continue;
      const teams = asObject(g.teams);
      const homeTeam = asObject(asObject(teams?.home)?.team);
      const awayTeam = asObject(asObject(teams?.away)?.team);
      const homeMlbTeamId = asNumber(homeTeam?.id);
      const awayMlbTeamId = asNumber(awayTeam?.id);
      games.push({
        gamePk: asNumber(g.gamePk) ?? -1,
        gameDate: asString(g.gameDate),
        homeMlbTeamId,
        awayMlbTeamId,
        homeAbbr: mlbStatsTeamIdToAbbr(homeMlbTeamId),
        awayAbbr: mlbStatsTeamIdToAbbr(awayMlbTeamId),
      });
    }
  }
  return games.filter((g) => g.gamePk > 0);
}

function playerObject(feed: Record<string, unknown>, playerId: number): Record<string, unknown> | null {
  const players = asObject(asObject(feed.gameData)?.players);
  return asObject(players?.[`ID${playerId}`]);
}

function boxscorePlayer(
  feed: Record<string, unknown>,
  side: "home" | "away",
  playerId: number,
): Record<string, unknown> | null {
  const team = asObject(asObject(asObject(asObject(feed.liveData)?.boxscore)?.teams)?.[side]);
  const players = asObject(team?.players);
  return asObject(players?.[`ID${playerId}`]);
}

export function parseMlbStatsOfficialLineups(
  feedPayload: unknown,
  gamePk: number,
  dbGame: DbGame,
  teamByAbbr: ReadonlyMap<string, DbTeam>,
): MlbOfficialLineupSpot[] {
  const feed = asObject(feedPayload);
  if (feed === null) return [];

  const boxscore = asObject(asObject(feed.liveData)?.boxscore);
  const teams = asObject(boxscore?.teams);
  const out: MlbOfficialLineupSpot[] = [];

  for (const side of ["away", "home"] as const) {
    const teamBox = asObject(teams?.[side]);
    const battingOrder = asArray(teamBox?.battingOrder)
      .map((v) => asNumber(v))
      .filter((v): v is number => v !== null);
    if (battingOrder.length < 8) continue;

    const expectedAbbr = side === "home" ? dbGame.home_abbr : dbGame.away_abbr;
    const dbTeam = teamByAbbr.get(expectedAbbr);
    const mlbTeamId =
      readNestedId(teamBox, ["team", "id"]) ??
      readNestedId(asObject(asObject(feed.gameData)?.teams), [side, "id"]);
    if (dbTeam === undefined || mlbTeamId === null) continue;

    for (let i = 0; i < battingOrder.length; i++) {
      const playerMlbId = battingOrder[i]!;
      const meta = playerObject(feed, playerMlbId);
      const boxPlayer = boxscorePlayer(feed, side, playerMlbId);
      const person = asObject(boxPlayer?.person) ?? meta;
      const fullName =
        asString(person?.fullName) ??
        asString(meta?.fullName) ??
        `MLB Player ${playerMlbId}`;
      const nameParts = firstLast(fullName);
      const position =
        asString(asObject(boxPlayer?.position)?.abbreviation) ??
        asString(asObject(meta?.primaryPosition)?.abbreviation);
      const batSide = asObject(meta?.batSide);
      const pitchHand = asObject(meta?.pitchHand);

      out.push({
        gamePk,
        dbGameId: dbGame.id,
        dbTeamId: dbTeam.id,
        mlbTeamId,
        playerMlbId,
        battingPosition: i + 1,
        startingPosition: position,
        isStartingPitcher: false,
        isDh: position === "DH",
        fullName,
        firstName: asString(meta?.firstName) ?? nameParts.firstName,
        lastName: asString(meta?.lastName) ?? nameParts.lastName,
        bats: normalizeHand(batSide?.code),
        throws: normalizeHand(pitchHand?.code),
        rawPayload: {
          gamePk,
          side,
          player: person ?? {},
          boxscore: boxPlayer ?? {},
        },
      });
    }

    // MLB Stats' official feed posts the batting order and probable starter
    // together. Once a team has an official batting order, persist that
    // starter as a confirmed P row too. The feature snapshot intentionally
    // derives starter confirmation from lineups.is_confirmed; omitting this
    // row left every MLB starter permanently "probable" and blocked all
    // data-completeness-gated Best Angles.
    const probablePitcher = asObject(
      asObject(asObject(feed.gameData)?.probablePitchers)?.[side],
    );
    const pitcherMlbId = asNumber(probablePitcher?.id);
    if (pitcherMlbId !== null) {
      const meta = playerObject(feed, pitcherMlbId) ?? probablePitcher;
      const fullName =
        asString(meta?.fullName) ??
        asString(probablePitcher?.fullName) ??
        `MLB Player ${pitcherMlbId}`;
      const nameParts = firstLast(fullName);
      const pitchHand = asObject(meta?.pitchHand);
      out.push({
        gamePk,
        dbGameId: dbGame.id,
        dbTeamId: dbTeam.id,
        mlbTeamId,
        playerMlbId: pitcherMlbId,
        battingPosition: null,
        startingPosition: "P",
        isStartingPitcher: true,
        isDh: false,
        fullName,
        firstName: asString(meta?.firstName) ?? nameParts.firstName,
        lastName: asString(meta?.lastName) ?? nameParts.lastName,
        bats: normalizeHand(asObject(meta?.batSide)?.code),
        throws: normalizeHand(pitchHand?.code),
        rawPayload: {
          gamePk,
          side,
          probablePitcher,
          officialBattingOrderSize: battingOrder.length,
        },
      });
    }
  }

  return out;
}

function mlbStatsProviderId(providerIds: Record<string, unknown> | null): number | null {
  const mlbStats = asObject(providerIds?.mlb_stats);
  return asNumber(mlbStats?.id);
}

async function fetchJson(
  url: URL,
  options: MlbOfficialLineupRefreshOptions,
): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: deadlineSignal(options),
  });
  if (!res.ok) {
    throw new Error(`MLB Stats fetch failed ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function loadDbGames(
  date: string,
  options: MlbOfficialLineupRefreshOptions,
): Promise<DbGame[]> {
  const { data, error } = await supabase
    .from("games")
    .select(`
      id,
      game_date,
      home_team_id,
      away_team_id,
      home_team:teams!games_home_team_id_fkey(id, abbreviation),
      away_team:teams!games_away_team_id_fkey(id, abbreviation)
    `)
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .abortSignal(deadlineSignal(options));
  if (error) throw new Error(`official lineup games query failed: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const home = asObject(row.home_team);
    const away = asObject(row.away_team);
    const homeAbbr = asString(home?.abbreviation);
    const awayAbbr = asString(away?.abbreviation);
    if (homeAbbr === null || awayAbbr === null) return [];
    return [{
      id: Number(row.id),
      game_date: asString(row.game_date),
      home_team_id: Number(row.home_team_id),
      away_team_id: Number(row.away_team_id),
      home_abbr: homeAbbr,
      away_abbr: awayAbbr,
    }];
  });
}

async function loadDbTeams(
  options: MlbOfficialLineupRefreshOptions,
): Promise<Map<string, DbTeam>> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", "mlb")
    .abortSignal(deadlineSignal(options));
  if (error) throw new Error(`official lineup teams query failed: ${error.message}`);
  return new Map(
    ((data ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [
      t.abbreviation,
      { id: t.id, abbreviation: t.abbreviation },
    ]),
  );
}

async function loadPlayerMap(
  options: MlbOfficialLineupRefreshOptions,
): Promise<Map<number, DbPlayer>> {
  const { data, error } = await supabase
    .from("players")
    .select("id, mlb_person_id, provider_ids")
    .eq("sport", "mlb")
    .abortSignal(deadlineSignal(options));
  if (error) throw new Error(`official lineup players query failed: ${error.message}`);
  const out = new Map<number, DbPlayer>();
  for (const row of (data ?? []) as DbPlayer[]) {
    const direct = row.mlb_person_id;
    if (typeof direct === "number") out.set(direct, row);
    const providerId = mlbStatsProviderId(row.provider_ids);
    if (providerId !== null) out.set(providerId, row);
  }
  return out;
}

function matchScheduleGame(schedule: ScheduleGame, dbGames: DbGame[]): DbGame | null {
  if (schedule.homeAbbr === null || schedule.awayAbbr === null) return null;
  const candidates = dbGames.filter(
    (g) => g.home_abbr === schedule.homeAbbr && g.away_abbr === schedule.awayAbbr,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || schedule.gameDate === null) return candidates[0] ?? null;
  const scheduleMs = new Date(schedule.gameDate).getTime();
  return candidates
    .map((g) => ({
      game: g,
      diff: g.game_date ? Math.abs(new Date(g.game_date).getTime() - scheduleMs) : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.diff - b.diff)[0]?.game ?? null;
}

async function ensurePlayer(
  spot: MlbOfficialLineupSpot,
  playerByMlbId: Map<number, DbPlayer>,
  options: MlbOfficialLineupRefreshOptions,
): Promise<{ playerId: number | null; created: boolean }> {
  const existing = playerByMlbId.get(spot.playerMlbId);
  if (existing !== undefined) return { playerId: existing.id, created: false };

  const { data, error } = await supabase
    .from("players")
    .insert({
      external_id: null,
      mlb_person_id: spot.playerMlbId,
      sport: "mlb",
      team_id: spot.dbTeamId,
      first_name: spot.firstName,
      last_name: spot.lastName,
      full_name: spot.fullName,
      position: spot.startingPosition,
      position_abbr: spot.startingPosition,
      is_pitcher: spot.startingPosition === "P",
      active: true,
      bats: spot.bats,
      throws: spot.throws,
      provider_ids: { mlb_stats: { id: spot.playerMlbId } },
    })
    .select("id, mlb_person_id, provider_ids")
    .abortSignal(deadlineSignal(options))
    .maybeSingle();

  if (error) {
    if (isDeadlineError(error, options)) throw error;
    const { data: reloaded, error: reloadError } = await supabase
      .from("players")
      .select("id, mlb_person_id, provider_ids")
      .eq("mlb_person_id", spot.playerMlbId)
      .abortSignal(deadlineSignal(options))
      .maybeSingle();
    if (reloadError && isDeadlineError(reloadError, options)) throw reloadError;
    if (reloaded) {
      const row = reloaded as DbPlayer;
      playerByMlbId.set(spot.playerMlbId, row);
      return { playerId: row.id, created: false };
    }
    return { playerId: null, created: false };
  }

  if (!data) return { playerId: null, created: false };
  const row = data as DbPlayer;
  playerByMlbId.set(spot.playerMlbId, row);
  return { playerId: row.id, created: true };
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export async function refreshMlbOfficialLineups(
  date: string,
  options: MlbOfficialLineupRefreshOptions = {},
): Promise<MlbOfficialLineupRefreshResult> {
  const enabled = process.env.MLB_STATS_OFFICIAL_LINEUPS_ENABLED !== "false";
  const details = {
    enabled,
    games_seen: 0,
    games_matched: 0,
    teams_with_official_lineups: 0,
    confirmed_starters_written: 0,
    players_created: 0,
    skipped_by_reason: {} as Record<string, number>,
    deadline_reached: false,
    deadline_stage: null as string | null,
    games_deferred: 0,
    teams_deferred: 0,
  };
  if (!enabled) return { records_updated: 0, api_calls_made: 0, details };

  let dbGames: DbGame[];
  let teamByAbbr: Map<string, DbTeam>;
  let playerByMlbId: Map<number, DbPlayer>;
  try {
    [dbGames, teamByAbbr, playerByMlbId] = await Promise.all([
      loadDbGames(date, options),
      loadDbTeams(options),
      loadPlayerMap(options),
    ]);
  } catch (error) {
    if (!isDeadlineError(error, options)) throw error;
    details.deadline_reached = true;
    details.deadline_stage = "official_context_load";
    return { records_updated: 0, api_calls_made: 0, details };
  }
  if (dbGames.length === 0) return { records_updated: 0, api_calls_made: 0, details };

  const scheduleUrl = new URL(`${MLB_STATS_BASE_URL}/schedule`);
  scheduleUrl.searchParams.set("sportId", "1");
  scheduleUrl.searchParams.set("date", date);
  let schedulePayload: unknown;
  try {
    schedulePayload = await fetchJson(scheduleUrl, options);
  } catch (error) {
    if (!isDeadlineError(error, options)) throw error;
    details.deadline_reached = true;
    details.deadline_stage = "official_schedule_fetch";
    return { records_updated: 0, api_calls_made: 0, details };
  }
  let apiCalls = 1;
  const scheduleGames = parseMlbStatsScheduleGames(schedulePayload);
  details.games_seen = scheduleGames.length;

  let recordsUpdated = 0;
  const officialByTeam = new Map<string, MlbOfficialLineupSpot[]>();

  for (let scheduleIndex = 0; scheduleIndex < scheduleGames.length; scheduleIndex++) {
    const schedule = scheduleGames[scheduleIndex]!;
    if (!canStartMlbOfficialLineupTeamUnit(options.deadlineAtMs)) {
      details.deadline_reached = true;
      details.deadline_stage = "official_feed_collection";
      details.games_deferred = scheduleGames.length - scheduleIndex;
      break;
    }
    const dbGame = matchScheduleGame(schedule, dbGames);
    if (dbGame === null) {
      bump(details.skipped_by_reason, "game_not_matched");
      continue;
    }
    details.games_matched++;

    const feedUrl = new URL(`${MLB_STATS_BASE_URL}.1/game/${schedule.gamePk}/feed/live`);
    let feedPayload: unknown;
    try {
      feedPayload = await fetchJson(feedUrl, options);
    } catch (error) {
      if (!isDeadlineError(error, options)) throw error;
      details.deadline_reached = true;
      details.deadline_stage = "official_feed_collection";
      details.games_deferred = scheduleGames.length - scheduleIndex;
      break;
    }
    apiCalls++;
    const spots = parseMlbStatsOfficialLineups(feedPayload, schedule.gamePk, dbGame, teamByAbbr);
    for (const spot of spots) {
      const key = `${spot.dbGameId}|${spot.dbTeamId}`;
      const arr = officialByTeam.get(key) ?? [];
      arr.push(spot);
      officialByTeam.set(key, arr);
    }
  }

  const officialTeams = [...officialByTeam.entries()];
  teamLoop: for (let teamIndex = 0; teamIndex < officialTeams.length; teamIndex++) {
    if (!canStartMlbOfficialLineupTeamUnit(options.deadlineAtMs)) {
      details.deadline_reached = true;
      details.deadline_stage = "official_team_persistence";
      details.teams_deferred = officialTeams.length - teamIndex;
      break;
    }
    const [key, spots] = officialTeams[teamIndex]!;
    const orderedBatters = spots
      .filter(
        (s) =>
          !s.isStartingPitcher &&
          s.battingPosition !== null &&
          s.battingPosition >= 1 &&
          s.battingPosition <= 9,
      )
      .sort((a, b) => (a.battingPosition ?? 999) - (b.battingPosition ?? 999));
    if (orderedBatters.length < 8) {
      bump(details.skipped_by_reason, "lineup_less_than_8");
      continue;
    }
    const officialStarter = spots.find((s) => s.isStartingPitcher) ?? null;
    const ordered = officialStarter === null
      ? orderedBatters
      : [...orderedBatters, officialStarter];

    const [gameIdRaw, teamIdRaw] = key.split("|");
    const gameId = Number(gameIdRaw);
    const teamId = Number(teamIdRaw);
    const rows: Array<Record<string, unknown>> = [];
    for (const spot of ordered) {
      let ensured: Awaited<ReturnType<typeof ensurePlayer>>;
      try {
        ensured = await ensurePlayer(spot, playerByMlbId, options);
      } catch (error) {
        if (!isDeadlineError(error, options)) throw error;
        details.deadline_reached = true;
        details.deadline_stage = "official_player_persistence";
        details.teams_deferred = officialTeams.length - teamIndex;
        break teamLoop;
      }
      if (ensured.created) details.players_created++;
      if (ensured.playerId === null) {
        bump(details.skipped_by_reason, "player_unmapped");
        continue;
      }
      rows.push({
        game_id: gameId,
        team_id: teamId,
        player_id: ensured.playerId,
        batting_position: spot.isStartingPitcher ? null : spot.battingPosition,
        starting_position: spot.startingPosition,
        is_confirmed: true,
        is_dh: spot.isDh,
      });
      if (spot.isStartingPitcher) details.confirmed_starters_written++;
    }
    if (rows.filter((row) => row.starting_position !== "P").length < 8) {
      bump(details.skipped_by_reason, "mapped_lineup_less_than_8");
      continue;
    }

    // Publish the complete replacement first. A deadline may leave an old
    // projected row alongside the new confirmed unit for one cycle, but can
    // never delete a team's usable lineup and then die before replacement.
    const { error: upsertErr } = await supabase
      .from("lineups")
      .upsert(rows, { onConflict: "game_id,team_id,player_id" })
      .abortSignal(deadlineSignal(options));
    if (upsertErr) {
      if (!isDeadlineError(upsertErr, options)) {
        throw new Error(`official lineup upsert failed: ${upsertErr.message}`);
      }
      details.deadline_reached = true;
      details.deadline_stage = "official_team_upsert";
      details.teams_deferred = officialTeams.length - teamIndex;
      break;
    }
    recordsUpdated += rows.length;
    details.teams_with_official_lineups++;

    const retainedPlayerIds = rows
      .map((row) => Number(row.player_id))
      .filter((playerId) => Number.isSafeInteger(playerId) && playerId > 0);
    const { error: deleteErr } = await supabase
      .from("lineups")
      .delete()
      .eq("game_id", gameId)
      .eq("team_id", teamId)
      .not("player_id", "in", `(${retainedPlayerIds.join(",")})`)
      .abortSignal(deadlineSignal(options));
    if (deleteErr) {
      if (!isDeadlineError(deleteErr, options)) {
        throw new Error(`official lineup stale-row cleanup failed: ${deleteErr.message}`);
      }
      details.deadline_reached = true;
      details.deadline_stage = "official_team_stale_cleanup";
      details.teams_deferred = Math.max(0, officialTeams.length - teamIndex - 1);
      break;
    }
  }

  return { records_updated: recordsUpdated, api_calls_made: apiCalls, details };
}
