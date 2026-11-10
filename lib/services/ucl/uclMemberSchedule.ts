import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { currentSoccerBoardDate } from "@/lib/dates/slateDate";
import { filterWeeklyReaderSnapshot } from "@/lib/services/dailyEdge/weeklyReaderLifecycle";
import { UCL_EXTERNAL_ID_OFFSET, UCL_EXTERNAL_ID_UPPER_BOUND } from "./uclCompetitionContext";

export const UCL_MEMBER_SCHEDULE_RELEASE = "ucl_member_schedule_2026_11_10_r1_forecast_outage_visibility";
type Fixture = { external_id: number; game_date: string; home_team_id: number; away_team_id: number };
type Team = { id: number; display_name: string };

/** Exact foreign keys and the next contiguous round. No model/provider calls or writes. */
export function buildUclMemberSchedule(rows: Fixture[], teams: Team[], now = new Date()): NonNullable<DailyEdgeResponse["uclUpcomingSchedule"]> {
  const names = new Map(teams.map(team => [team.id, team.display_name]));
  const ordered = rows.filter(row => row.external_id >= UCL_EXTERNAL_ID_OFFSET && row.external_id < UCL_EXTERNAL_ID_UPPER_BOUND
    && Number.isFinite(Date.parse(row.game_date)) && Date.parse(row.game_date) >= now.getTime())
    .sort((a, b) => Date.parse(a.game_date) - Date.parse(b.game_date) || a.external_id - b.external_id);
  const selected: Fixture[] = [];
  for (const row of ordered) {
    if (selected.length && Date.parse(row.game_date) - Date.parse(selected.at(-1)!.game_date) > 3 * 86_400_000) break;
    if (selected.some(other => other.external_id === row.external_id) || row.home_team_id === row.away_team_id
      || !names.get(row.home_team_id)?.trim() || !names.get(row.away_team_id)?.trim()) throw Error("UCL schedule identity is incomplete or duplicated");
    selected.push(row);
  }
  return { release: UCL_MEMBER_SCHEDULE_RELEASE, games: selected.map(row => ({ externalId: row.external_id,
    gameStartAt: row.game_date, homeTeam: names.get(row.home_team_id)!, awayTeam: names.get(row.away_team_id)! })) };
}

export async function readUclMemberBoard(snapshot: DailyEdgeResponse | null, now = new Date()): Promise<DailyEdgeResponse> {
  const date = currentSoccerBoardDate(now);
  const visible = snapshot ? filterWeeklyReaderSnapshot(snapshot, "soccer", now) : null;
  if (visible?.games.length) return visible;
  const fallback: DailyEdgeResponse = { as_of: snapshot?.as_of ?? now.toISOString(), sport: "soccer", date,
    requested_date: date, fallback_used: false, slateState: "temporarily_unavailable", slate_status: null,
    last_slate_update_at: snapshot?.last_slate_update_at ?? null, games: [] };
  const { supabase } = await import("@/lib/db/supabase");
  // Find the next fixture first, then read its bounded round. A 14-day break
  // must not disappear behind a today-only or seven-day forecast window.
  const query = () => supabase.from("games").select("external_id,game_date,home_team_id,away_team_id")
    .eq("sport", "soccer").gte("external_id", UCL_EXTERNAL_ID_OFFSET).lt("external_id", UCL_EXTERNAL_ID_UPPER_BOUND)
    .eq("status", "scheduled").gte("game_date", now.toISOString()).order("game_date").order("external_id");
  const first = await query().limit(1);
  if (first.error) throw Error(`UCL schedule lookup failed: ${first.error.message}`);
  if (!first.data?.length) return fallback;
  const through = new Date(Date.parse(first.data[0]!.game_date) + 3 * 86_400_000).toISOString();
  const fixtures = await query().lte("game_date", through).limit(65);
  if (fixtures.error || !fixtures.data?.length || fixtures.data.length >= 65) throw Error("UCL schedule round lookup failed or exceeded bound");
  const ids = [...new Set(fixtures.data.flatMap(row => [row.home_team_id, row.away_team_id]))];
  const teams = await supabase.from("teams").select("id,display_name").eq("sport", "soccer").in("id", ids);
  if (teams.error) throw Error(`UCL schedule teams lookup failed: ${teams.error.message}`);
  return { ...fallback, uclUpcomingSchedule: buildUclMemberSchedule(fixtures.data, teams.data ?? [], now) };
}
