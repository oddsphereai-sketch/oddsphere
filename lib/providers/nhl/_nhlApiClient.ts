/**
 * NHL public API client — api-web.nhle.com wrapper.
 *
 * Read-only, no auth required. Provides the canonical schedule, game
 * status, series context, and final-score signals for the NHL Daily
 * Edge pipeline. Mirrors the shape of `_espnNbaScoreboardClient.ts`
 * so the seeding service can be written in the same style.
 *
 * Endpoints used (all GET, JSON):
 *   • /v1/schedule/{YYYY-MM-DD}   — week-window schedule including the
 *                                    requested date.
 *   • /v1/score/{YYYY-MM-DD}      — date-day game list + final scores.
 *   • /v1/gamecenter/{id}/landing — per-game detail (used post-game for
 *                                    grading + actual goalie-in-net).
 *
 * Phase 7L Phase 1 — schedule + status + series only. Post-game grading
 * source added in Phase 4.
 */

const NHL_API_BASE = "https://api-web.nhle.com";
const USER_AGENT = "oddsphere/1.0 (NHL public API ingest)";

export type CanonicalNhlEvent = {
  /** NHL gamecenter id, e.g. 2025030414. Stored as string for consistency
   *  with ESPN-style external_ids, but always parseable as integer. */
  nhl_game_id: string;
  /** ISO 8601 UTC start time, e.g. "2026-06-10T00:00:00Z". */
  start_time: string;
  /** Season as the API reports it (e.g. 20252026 for the 2025-26 season). */
  season: number;
  /** 1 = preseason, 2 = regular, 3 = playoff. */
  game_type: number;
  /** NHL gameState: FUT / PRE / LIVE / CRIT / FINAL / OFF. */
  game_state: string;
  /** "Final" / "In progress" / "Scheduled" — light label. */
  status_label: string;
  /** Venue name, e.g. "T-Mobile Arena". */
  venue_name: string | null;
  home: NhlEventTeam;
  away: NhlEventTeam;
  /** Playoff series context when game_type === 3. */
  series: NhlSeriesContext | null;
};

export type NhlEventTeam = {
  /** Canonical 3-letter abbreviation: VGK, CAR, TOR, etc. */
  abbreviation: string;
  /** NHL team id (numeric, stable across seasons). */
  nhl_team_id: number;
  /** Score so far. null when game hasn't started. */
  score: number | null;
};

export type NhlSeriesContext = {
  /** 1 = first round, 2 = second, 3 = conf final, 4 = Stanley Cup Final. */
  round: number;
  /** "R1" / "R2" / "ECF" / "WCF" / "SCF". */
  series_abbrev: string;
  /** Human-readable, e.g. "Stanley Cup Final". */
  series_title: string;
  /** Game-in-series, 1..7. */
  game_number_in_series: number;
  /** Wins to clinch (always 4 for NHL). */
  games_to_win: number;
  /** Higher-seeded team's abbreviation + current win count. */
  top_seed_abbrev: string;
  top_seed_wins: number;
  bottom_seed_abbrev: string;
  bottom_seed_wins: number;
};

type ApiTeam = {
  id: number;
  abbrev: string;
  score?: number;
};

type ApiGame = {
  id: number;
  startTimeUTC: string;
  season: number;
  gameType: number;
  gameState: string;
  venue?: { default?: string };
  awayTeam: ApiTeam;
  homeTeam: ApiTeam;
  seriesStatus?: {
    round: number;
    seriesAbbrev?: string;
    seriesTitle?: string;
    gameNumberOfSeries?: number;
    neededToWin?: number;
    topSeedTeamAbbrev?: string;
    topSeedWins?: number;
    bottomSeedTeamAbbrev?: string;
    bottomSeedWins?: number;
    game?: number; // older field name for game-in-series
  };
};

function statusLabel(gameState: string): string {
  switch (gameState) {
    case "FUT":
    case "PRE":
      return "Scheduled";
    case "LIVE":
    case "CRIT":
      return "In Progress";
    case "FINAL":
    case "OFF":
      return "Final";
    default:
      return gameState;
  }
}

function toCanonical(g: ApiGame): CanonicalNhlEvent {
  const series: NhlSeriesContext | null = g.seriesStatus
    ? {
        round: g.seriesStatus.round,
        series_abbrev: g.seriesStatus.seriesAbbrev ?? "",
        series_title: g.seriesStatus.seriesTitle ?? "",
        game_number_in_series:
          g.seriesStatus.gameNumberOfSeries ?? g.seriesStatus.game ?? 0,
        games_to_win: g.seriesStatus.neededToWin ?? 4,
        top_seed_abbrev: g.seriesStatus.topSeedTeamAbbrev ?? "",
        top_seed_wins: g.seriesStatus.topSeedWins ?? 0,
        bottom_seed_abbrev: g.seriesStatus.bottomSeedTeamAbbrev ?? "",
        bottom_seed_wins: g.seriesStatus.bottomSeedWins ?? 0,
      }
    : null;
  return {
    nhl_game_id: String(g.id),
    start_time: g.startTimeUTC,
    season: g.season,
    game_type: g.gameType,
    game_state: g.gameState,
    status_label: statusLabel(g.gameState),
    venue_name: g.venue?.default ?? null,
    home: {
      abbreviation: g.homeTeam.abbrev,
      nhl_team_id: g.homeTeam.id,
      score: typeof g.homeTeam.score === "number" ? g.homeTeam.score : null,
    },
    away: {
      abbreviation: g.awayTeam.abbrev,
      nhl_team_id: g.awayTeam.id,
      score: typeof g.awayTeam.score === "number" ? g.awayTeam.score : null,
    },
    series,
  };
}

/**
 * Fetch all games visible from /v1/schedule for the requested date.
 * The endpoint returns a week-window (`gameWeek`); we filter to the
 * exact `date` (ET sports-day matches the API's date keying).
 */
export async function fetchNhlScheduleForDate(
  date: string, // YYYY-MM-DD
): Promise<CanonicalNhlEvent[]> {
  const url = `${NHL_API_BASE}/v1/schedule/${date}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`NHL schedule fetch ${date} failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { gameWeek?: Array<{ date: string; games?: ApiGame[] }> };
  const week = json.gameWeek ?? [];
  const day = week.find((d) => d.date === date);
  if (!day || !day.games) return [];
  return day.games.map(toCanonical);
}

/**
 * Fetch /v1/score/{date}. Same date keying as schedule, but the response
 * shape carries final scores when games are OFF/FINAL — used by the
 * NHL grading pipeline.
 */
export async function fetchNhlScoreForDate(
  date: string,
): Promise<CanonicalNhlEvent[]> {
  const url = `${NHL_API_BASE}/v1/score/${date}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`NHL score fetch ${date} failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { games?: ApiGame[] };
  return (json.games ?? []).map(toCanonical);
}
