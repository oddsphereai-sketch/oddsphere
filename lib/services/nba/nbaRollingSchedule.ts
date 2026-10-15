import {
  addDaysToSlate,
  currentDailyEdgeBoardDate,
  isSlateDate,
} from "../../dates/slateDate";
import { isPublicallyTracked } from "../../config/officialTrackingStart";

export const NBA_REGULAR_SEASON_OPENER = "2026-10-20" as const;
export const NBA_ROLLING_SCHEDULE_DAYS = 7 as const;
export const NBA_ROLLING_SCHEDULE_RELEASE =
  "nba_rolling_member_schedule_2026_10_15_r1_schedule_only" as const;

const MEMBER_SCHEDULE_STATUSES = new Set([
  "STATUS_SCHEDULED",
  "STATUS_IN_PROGRESS",
  "STATUS_HALFTIME",
  "STATUS_END_PERIOD",
  "STATUS_DELAYED",
  "STATUS_SUSPENDED",
  "STATUS_POSTPONED",
]);

export type NbaRollingScheduleGame = {
  id: string;
  externalId: number;
  slateDate: string;
  gameStartAt: string;
  status: string;
  awayTeam: string;
  awayTeamDisplayName: string;
  awayTeamLogo: string;
  homeTeam: string;
  homeTeamDisplayName: string;
  homeTeamLogo: string;
  venue: string | null;
};

export type NbaRollingSchedule = {
  release: typeof NBA_ROLLING_SCHEDULE_RELEASE;
  anchorDate: string;
  throughDate: string;
  games: NbaRollingScheduleGame[];
};

type NbaScheduleGameRow = {
  external_id: number;
  slate_date: string;
  game_date: string;
  status: string | null;
  away_team_id: number;
  home_team_id: number;
  venue: string | null;
};

type NbaScheduleTeamRow = {
  id: number;
  abbreviation: string;
  display_name: string | null;
};

function nbaLogoUrl(abbreviation: string): string {
  return `https://a.espncdn.com/i/teamlogos/nba/500/${abbreviation.toLowerCase()}.png`;
}

export function nbaRollingScheduleWindow(anchorDate: string): {
  from: string;
  through: string;
} | null {
  if (!isSlateDate(anchorDate)) {
    throw new Error(`nbaRollingScheduleWindow: invalid anchor date ${anchorDate}`);
  }
  const through = addDaysToSlate(anchorDate, NBA_ROLLING_SCHEDULE_DAYS - 1);
  if (through < NBA_REGULAR_SEASON_OPENER) return null;
  return {
    from: anchorDate < NBA_REGULAR_SEASON_OPENER ? NBA_REGULAR_SEASON_OPENER : anchorDate,
    through,
  };
}

/**
 * The rolling schedule may be shown ahead of opening night, but an analyzed
 * Daily Edge card is member-eligible only for an official date that is not in
 * the future. Historical regular-season/postseason reads remain available.
 */
export function nbaMemberAnalysisEligible(
  requestedDate: string,
  currentBoardDate = currentDailyEdgeBoardDate("nba"),
): boolean {
  return isPublicallyTracked("nba", requestedDate) && requestedDate <= currentBoardDate;
}

/**
 * The daily full cycle seeds every date in the member window. Intraday cycles
 * refresh today for status changes and the far edge so the window advances
 * without multiplying every 30-minute provider call by seven.
 */
export function nbaScheduleSeedDates(anchorDate: string, intraday: boolean): string[] {
  if (!isSlateDate(anchorDate)) {
    throw new Error(`nbaScheduleSeedDates: invalid anchor date ${anchorDate}`);
  }
  if (!intraday) {
    return Array.from({ length: NBA_ROLLING_SCHEDULE_DAYS }, (_, index) =>
      addDaysToSlate(anchorDate, index),
    );
  }
  return [anchorDate, addDaysToSlate(anchorDate, NBA_ROLLING_SCHEDULE_DAYS - 1)];
}

export function isNbaMemberScheduleStatus(status: string | null): boolean {
  return status !== null && MEMBER_SCHEDULE_STATUSES.has(status.toUpperCase());
}

export async function loadNbaRollingSchedule(
  anchorDate = currentDailyEdgeBoardDate("nba"),
): Promise<NbaRollingSchedule> {
  const window = nbaRollingScheduleWindow(anchorDate);
  if (window === null) {
    return {
      release: NBA_ROLLING_SCHEDULE_RELEASE,
      anchorDate,
      throughDate: addDaysToSlate(anchorDate, NBA_ROLLING_SCHEDULE_DAYS - 1),
      games: [],
    };
  }

  const { supabase } = await import("../../db/supabase");

  const { data: rawGames, error: gamesError } = await supabase
    .from("games")
    .select("external_id, slate_date, game_date, status, away_team_id, home_team_id, venue")
    .eq("sport", "nba")
    .gte("slate_date", window.from)
    .lte("slate_date", window.through)
    .order("game_date", { ascending: true });
  if (gamesError) {
    throw new Error(`NBA rolling schedule games query failed: ${gamesError.message}`);
  }

  const gameRows = ((rawGames ?? []) as NbaScheduleGameRow[]).filter((game) =>
    isNbaMemberScheduleStatus(game.status),
  );
  const teamIds = Array.from(
    new Set(gameRows.flatMap((game) => [game.away_team_id, game.home_team_id])),
  );
  const { data: rawTeams, error: teamsError } = teamIds.length > 0
    ? await supabase
        .from("teams")
        .select("id, abbreviation, display_name")
        .eq("sport", "nba")
        .in("id", teamIds)
    : { data: [] as NbaScheduleTeamRow[], error: null };
  if (teamsError) {
    throw new Error(`NBA rolling schedule teams query failed: ${teamsError.message}`);
  }

  const teamById = new Map(
    ((rawTeams ?? []) as NbaScheduleTeamRow[]).map((team) => [team.id, team]),
  );
  const games = gameRows.flatMap((game): NbaRollingScheduleGame[] => {
    const away = teamById.get(game.away_team_id);
    const home = teamById.get(game.home_team_id);
    if (!away || !home) return [];
    return [{
      id: `nba-schedule-${game.external_id}`,
      externalId: game.external_id,
      slateDate: game.slate_date,
      gameStartAt: game.game_date,
      status: game.status ?? "STATUS_SCHEDULED",
      awayTeam: away.abbreviation,
      awayTeamDisplayName: away.display_name ?? away.abbreviation,
      awayTeamLogo: nbaLogoUrl(away.abbreviation),
      homeTeam: home.abbreviation,
      homeTeamDisplayName: home.display_name ?? home.abbreviation,
      homeTeamLogo: nbaLogoUrl(home.abbreviation),
      venue: game.venue,
    }];
  });

  return {
    release: NBA_ROLLING_SCHEDULE_RELEASE,
    anchorDate,
    throughDate: window.through,
    games,
  };
}
