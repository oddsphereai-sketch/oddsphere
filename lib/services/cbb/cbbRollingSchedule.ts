import { computeSlateDate } from "../../dates/slateDate";
import { CBB_ROLLING_SLATE_RELEASE, cbbRollingSlateDates } from "../../cbb/rollingSlate";

export type CbbRollingScheduleGame = {
  id: string;
  externalId: number;
  slateDate: string;
  gameStartAt: string;
  status: string;
  awayTeam: string;
  awayTeamDisplayName: string;
  awayTeamLogo: string | null;
  homeTeam: string;
  homeTeamDisplayName: string;
  homeTeamLogo: string | null;
  venue: string | null;
};

export type CbbRollingSchedule = {
  release: typeof CBB_ROLLING_SLATE_RELEASE;
  anchorDate: string;
  throughDate: string;
  games: CbbRollingScheduleGame[];
};

/** A model-covered event must render as an analyzed card, never twice. */
export function excludeAnalyzedCbbScheduleGames(
  schedule: CbbRollingSchedule,
  analyzedExternalIds: Iterable<number>,
): CbbRollingSchedule {
  const analyzed = new Set(analyzedExternalIds);
  return { ...schedule, games: schedule.games.filter(game => !analyzed.has(game.externalId)) };
}

export type CbbScheduleGameRow = {
  external_id: number;
  slate_date: string;
  game_date: string;
  status: string | null;
  away_team_id: number;
  home_team_id: number;
  venue: string | null;
};
export type CbbScheduleTeamRow = {
  id: number;
  abbreviation: string;
  display_name: string;
  logo_url: string | null;
};

const MEMBER_STATUSES = new Set(["STATUS_SCHEDULED", "STATUS_IN_PROGRESS", "STATUS_HALFTIME",
  "STATUS_END_PERIOD", "STATUS_DELAYED", "STATUS_SUSPENDED", "STATUS_POSTPONED", "STATUS_FINAL",
  "STATUS_CANCELED"]);

/** Exact DB foreign keys and ET dates; an identity failure never becomes another team's card. */
export function buildCbbRollingSchedule(args: {
  anchorDate: string;
  games: CbbScheduleGameRow[];
  teams: CbbScheduleTeamRow[];
}): CbbRollingSchedule {
  const dates = cbbRollingSlateDates(args.anchorDate);
  const allowed = new Set(dates);
  const teams = new Map<number, CbbScheduleTeamRow>();
  for (const team of args.teams) {
    if (!Number.isInteger(team.id) || teams.has(team.id) || !team.abbreviation?.trim() ||
      !team.display_name?.trim()) throw new Error("CBB schedule team identity is incomplete or duplicated");
    teams.set(team.id, team);
  }
  const seenGames = new Set<number>();
  const games: CbbRollingScheduleGame[] = [];
  for (const row of args.games) {
    if (!allowed.has(row.slate_date)) continue;
    if (!MEMBER_STATUSES.has(row.status ?? "")) continue;
    if (!Number.isInteger(row.external_id) || seenGames.has(row.external_id) ||
      !Number.isFinite(Date.parse(row.game_date)) ||
      computeSlateDate("cbb", row.game_date) !== row.slate_date ||
      row.home_team_id === row.away_team_id) {
      throw new Error("CBB rolling schedule game identity/date is inconsistent");
    }
    seenGames.add(row.external_id);
    const home = teams.get(row.home_team_id), away = teams.get(row.away_team_id);
    if (!home || !away) throw new Error(`CBB rolling schedule ${row.external_id} has an unresolved team`);
    games.push({ id: `cbb-schedule-${row.external_id}`, externalId: row.external_id,
      slateDate: row.slate_date, gameStartAt: row.game_date, status: row.status!,
      homeTeam: home.abbreviation, homeTeamDisplayName: home.display_name,
      homeTeamLogo: home.logo_url, awayTeam: away.abbreviation,
      awayTeamDisplayName: away.display_name, awayTeamLogo: away.logo_url,
      venue: row.venue });
  }
  games.sort((a, b) => Date.parse(a.gameStartAt) - Date.parse(b.gameStartAt) || a.externalId - b.externalId);
  return { release: CBB_ROLLING_SLATE_RELEASE, anchorDate: args.anchorDate,
    throughDate: dates.at(-1)!, games };
}

/** Read-only schedule layer. No predictions, prices, grades, or locks are created here. */
export async function loadCbbRollingSchedule(anchorDate: string): Promise<CbbRollingSchedule> {
  const dates = cbbRollingSlateDates(anchorDate);
  const { supabase } = await import("../../db/supabase");
  const gameRows: CbbScheduleGameRow[] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const { data, error } = await supabase.from("games")
      .select("external_id,slate_date,game_date,status,away_team_id,home_team_id,venue")
      .eq("sport", "cbb").gte("slate_date", dates[0]).lte("slate_date", dates.at(-1)!)
      .order("game_date", { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`CBB rolling schedule games lookup failed: ${error.message}`);
    gameRows.push(...(data ?? []) as CbbScheduleGameRow[]);
    if ((data ?? []).length < 500) break;
    if (offset === 4500) throw new Error("CBB rolling schedule page budget exhausted");
  }
  const teamIds = [...new Set(gameRows.flatMap(row => [row.home_team_id, row.away_team_id]))];
  const teamRows: CbbScheduleTeamRow[] = [];
  for (let offset = 0; offset < teamIds.length; offset += 100) {
    const { data, error } = await supabase.from("teams")
      .select("id,abbreviation,display_name,logo_url").eq("sport", "cbb")
      .in("id", teamIds.slice(offset, offset + 100));
    if (error) throw new Error(`CBB rolling schedule teams lookup failed: ${error.message}`);
    teamRows.push(...(data ?? []) as CbbScheduleTeamRow[]);
  }
  return buildCbbRollingSchedule({ anchorDate, games: gameRows, teams: teamRows });
}
