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

export const __BALLDONTLIE_NHL_TEST__ = { TEAM_STAT_TYPES };
