import type { SupabaseClient } from "@supabase/supabase-js";
import {
  replayNhlRegularState,
  type SettledNhlRegularGame,
} from "../../automodel/nhlRegularState";
import type { NhlCalibratedTeamState } from "../../automodel/nhlRegularPriors2026";
import { nhlGameTypeFromExternalId } from "./nhlScheduleIdentity";

/** One bounded season-level replay per slate build; never one provider call per card. */
export async function loadNhlRegularStateForSlate(
  supabase: SupabaseClient,
  season: number,
  beforeIso: string,
): Promise<Map<string, NhlCalibratedTeamState>> {
  const [{ data: teams, error: teamsError }, { data: games, error: gamesError }] = await Promise.all([
    supabase.from("teams").select("id, abbreviation").eq("sport", "nhl"),
    supabase.from("games")
      .select("external_id, game_date, home_team_id, away_team_id, home_score, away_score")
      .eq("sport", "nhl")
      .gte("external_id", season * 1_000_000 + 20_000)
      .lte("external_id", season * 1_000_000 + 29_999)
      .lt("game_date", beforeIso)
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("game_date", { ascending: true })
      .limit(1400),
  ]);
  if (teamsError) throw new Error(`NHL calibrated-state teams: ${teamsError.message}`);
  if (gamesError) throw new Error(`NHL calibrated-state games: ${gamesError.message}`);
  const abbreviationById = new Map<number, string>();
  for (const row of teams ?? []) abbreviationById.set(row.id as number, String(row.abbreviation ?? "").toUpperCase());
  const settled: SettledNhlRegularGame[] = [];
  for (const row of games ?? []) {
    const externalId = Number(row.external_id);
    const homeTeam = abbreviationById.get(Number(row.home_team_id));
    const awayTeam = abbreviationById.get(Number(row.away_team_id));
    const homeScore = Number(row.home_score);
    const awayScore = Number(row.away_score);
    if (nhlGameTypeFromExternalId(externalId) !== 2 || !homeTeam || !awayTeam || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    settled.push({ externalId, startTime: String(row.game_date), homeTeam, awayTeam, homeScore, awayScore });
  }
  return replayNhlRegularState(settled);
}
