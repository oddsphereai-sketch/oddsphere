const BDL_NHL_BASE = "https://api.balldontlie.io/nhl/v1";
const CACHE_MS = 30 * 60 * 1000;

const TEAM_STAT_TYPES = [
  "goals_for_per_game",
  "goals_against_per_game",
  "shots_for_per_game",
  "shots_against_per_game",
  "power_play_percentage",
  "penalty_kill_percentage",
  "points_pct",
] as const;

type TeamStatType = typeof TEAM_STAT_TYPES[number];

type LeaderRow = {
  team?: { tricode?: string };
  name?: string;
  value?: number;
  season?: number;
  postseason?: boolean;
};

export type BdlNhlTeamMetrics = {
  team: string;
  season: number;
  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;
  shotsForPerGame: number | null;
  shotsAgainstPerGame: number | null;
  powerPlayPct: number | null;
  penaltyKillPct: number | null;
  pointsPct: number | null;
  fetchedAt: string;
};

type Cached = { expiresAt: number; value: Map<string, BdlNhlTeamMetrics> };
const cache = new Map<number, Cached>();

export type BdlNhlRosterPlayer = {
  id: number;
  fullName: string;
  positionCode: string;
  team: string;
};

type BdlNhlTeamRow = { id?: number; tricode?: string; season?: number };
type BdlNhlPlayerRow = {
  id?: number;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position_code?: string;
  teams?: BdlNhlTeamRow[];
};
type RosterCached = { expiresAt: number; value: Map<string, BdlNhlRosterPlayer[]> };
const rosterCache = new Map<string, RosterCached>();

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function setMetric(row: BdlNhlTeamMetrics, type: TeamStatType, value: number | null): void {
  if (type === "goals_for_per_game") row.goalsForPerGame = value;
  else if (type === "goals_against_per_game") row.goalsAgainstPerGame = value;
  else if (type === "shots_for_per_game") row.shotsForPerGame = value;
  else if (type === "shots_against_per_game") row.shotsAgainstPerGame = value;
  else if (type === "power_play_percentage") row.powerPlayPct = value;
  else if (type === "penalty_kill_percentage") row.penaltyKillPct = value;
  else if (type === "points_pct") row.pointsPct = value;
}

export async function fetchBdlNhlTeamMetrics(
  season: number,
  apiKey: string,
): Promise<Map<string, BdlNhlTeamMetrics>> {
  const cached = cache.get(season);
  if (cached && cached.expiresAt > Date.now()) return new Map(cached.value);

  const fetchedAt = new Date().toISOString();
  const byTeam = new Map<string, BdlNhlTeamMetrics>();
  const payloads = await Promise.all(TEAM_STAT_TYPES.map(async (type) => {
    const url = new URL(`${BDL_NHL_BASE}/team_stats/leaders`);
    url.searchParams.set("season", String(season));
    url.searchParams.set("type", type);
    url.searchParams.set("postseason", "false");
    const response = await fetch(url, { headers: { Authorization: apiKey } });
    if (!response.ok) {
      throw new Error(`BALLDONTLIE NHL team leaders ${type}/${season} failed with HTTP ${response.status}`);
    }
    const body = await response.json() as { data?: LeaderRow[] };
    if (!Array.isArray(body.data)) {
      throw new Error(`BALLDONTLIE NHL team leaders ${type}/${season} returned malformed data`);
    }
    return { type, rows: body.data };
  }));
  for (const { type, rows } of payloads) {
    for (const raw of rows) {
      const team = raw.team?.tricode?.trim().toUpperCase();
      if (!team) continue;
      const row = byTeam.get(team) ?? {
        team,
        season,
        goalsForPerGame: null,
        goalsAgainstPerGame: null,
        shotsForPerGame: null,
        shotsAgainstPerGame: null,
        powerPlayPct: null,
        penaltyKillPct: null,
        pointsPct: null,
        fetchedAt,
      };
      setMetric(row, type, finite(raw.value));
      byTeam.set(team, row);
    }
  }
  cache.set(season, { expiresAt: Date.now() + CACHE_MS, value: new Map(byTeam) });
  return byTeam;
}

/**
 * Early-season fallback: use current-season rows when BALLDONTLIE has loaded
 * them, otherwise use the fully completed prior regular season. This is one
 * bounded league-level read per stat family, cached for 30 minutes.
 */
export async function fetchBdlNhlTeamMetricsWithPriorFallback(
  season: number,
  apiKey: string,
): Promise<{ metrics: Map<string, BdlNhlTeamMetrics>; sourceSeason: number }> {
  try {
    const current = await fetchBdlNhlTeamMetrics(season, apiKey);
    if (current.size >= 20) return { metrics: current, sourceSeason: season };
  } catch {
    // Opening-week provider lag is expected; the completed prior season is
    // the explicit fallback and is still bounded by the same league cache.
  }
  const prior = await fetchBdlNhlTeamMetrics(season - 1, apiKey);
  return { metrics: prior, sourceSeason: season - 1 };
}

/**
 * Load the current season roster once per slate-team set. The NHL API exposes
 * player-team membership as a season-specific array on each player, so a
 * player is assigned only through the requested season row (never a stale
 * profile-level team). Pagination is bounded to protect the scheduled writer.
 */
export async function fetchBdlNhlRosters(
  season: number,
  teamTricodes: readonly string[],
  apiKey: string,
): Promise<Map<string, BdlNhlRosterPlayer[]>> {
  const requested = [...new Set(teamTricodes.map((team) => team.trim().toUpperCase()).filter(Boolean))].sort();
  const cacheKey = `${season}:${requested.join(",")}`;
  const cached = rosterCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Map([...cached.value].map(([team, players]) => [team, [...players]]));
  }
  if (requested.length === 0) return new Map();

  const teamsUrl = new URL(`${BDL_NHL_BASE}/teams`);
  const teamsResponse = await fetch(teamsUrl, { headers: { Authorization: apiKey } });
  if (!teamsResponse.ok) throw new Error(`BALLDONTLIE NHL teams/${season} failed with HTTP ${teamsResponse.status}`);
  const teamsBody = await teamsResponse.json() as { data?: BdlNhlTeamRow[] };
  const requestedIds = new Set<number>();
  for (const team of teamsBody.data ?? []) {
    if (typeof team.id === "number" && requested.includes(team.tricode?.trim().toUpperCase() ?? "")) {
      requestedIds.add(team.id);
    }
  }
  if (requestedIds.size === 0) throw new Error(`BALLDONTLIE NHL teams/${season} did not resolve requested slate teams`);

  const byTeam = new Map<string, BdlNhlRosterPlayer[]>(requested.map((team) => [team, []]));
  let cursor: number | null = null;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${BDL_NHL_BASE}/players`);
    url.searchParams.append("seasons[]", String(season));
    url.searchParams.set("per_page", "100");
    for (const teamId of requestedIds) url.searchParams.append("team_ids[]", String(teamId));
    if (cursor !== null) url.searchParams.set("cursor", String(cursor));
    const response = await fetch(url, { headers: { Authorization: apiKey } });
    if (!response.ok) throw new Error(`BALLDONTLIE NHL players/${season} failed with HTTP ${response.status}`);
    const body = await response.json() as {
      data?: BdlNhlPlayerRow[];
      meta?: { next_cursor?: number | null };
    };
    if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE NHL players/${season} returned malformed data`);
    for (const player of body.data) {
      const membership = (player.teams ?? []).find((team) => (
        team.season === season && typeof team.id === "number" && requestedIds.has(team.id)
      ));
      const team = membership?.tricode?.trim().toUpperCase();
      const fullName = player.full_name?.trim()
        || `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
      if (!team || !requested.includes(team) || !fullName || typeof player.id !== "number") continue;
      byTeam.get(team)!.push({
        id: player.id,
        fullName,
        positionCode: player.position_code?.trim().toUpperCase() ?? "",
        team,
      });
    }
    const next = body.meta?.next_cursor;
    if (next === null || next === undefined) break;
    cursor = next;
    if (page === 19) throw new Error(`BALLDONTLIE NHL players/${season} exceeded pagination budget`);
  }
  rosterCache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, value: byTeam });
  return new Map([...byTeam].map(([team, players]) => [team, [...players]]));
}

export const __BALLDONTLIE_NHL_TEST__ = { TEAM_STAT_TYPES };
