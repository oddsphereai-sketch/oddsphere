/**
 * FK resolution helpers — load (external_id → DB id) maps once per service
 * call so the heavy work of FK translation happens in memory.
 *
 * Each service calls these at start, then references the returned Maps
 * during payload construction. Maps are NOT cached across calls because
 * each cron run may see DB state that's evolved between invocations.
 */

import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";

export async function loadTeamIdMap(
  sport?: Sport
): Promise<Map<number, number>> {
  let q = supabase.from("teams").select("id, external_id");
  if (sport !== undefined) q = q.eq("sport", sport);
  const { data, error } = await q;
  if (error) throw new Error(`loadTeamIdMap failed: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: number; external_id: number }[]).map((r) => [
      r.external_id,
      r.id,
    ])
  );
}

export async function loadPlayerIdMap(
  sport?: Sport
): Promise<Map<number, number>> {
  let q = supabase.from("players").select("id, external_id");
  if (sport !== undefined) q = q.eq("sport", sport);
  const { data, error } = await q;
  if (error) throw new Error(`loadPlayerIdMap failed: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: number; external_id: number }[]).map((r) => [
      r.external_id,
      r.id,
    ])
  );
}

export type PlayerMetadata = { id: number; external_id: number; is_pitcher: boolean; team_id: number | null };

export async function loadPlayerMetadata(
  sport?: Sport
): Promise<Map<number, PlayerMetadata>> {
  let q = supabase
    .from("players")
    .select("id, external_id, is_pitcher, team_id");
  if (sport !== undefined) q = q.eq("sport", sport);
  const { data, error } = await q;
  if (error) throw new Error(`loadPlayerMetadata failed: ${error.message}`);
  return new Map(
    ((data ?? []) as PlayerMetadata[]).map((r) => [r.external_id, r])
  );
}

/**
 * Load (game_external_id → game_id) map for games on a given slate date.
 *
 * Date matching handles the slate-date convention: games starting before
 * 06:00 UTC are considered the previous local day's slate (Pacific evening
 * games run into next-day UTC). We widen the window to capture them.
 */
export async function loadGameIdMap(
  sport: Sport,
  date: string
): Promise<Map<number, number>> {
  const startOfDay = `${date}T00:00:00.000Z`;
  // End: next day at 06:00 UTC catches Pacific games starting at 02:10 UTC the next day
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(6, 0, 0, 0);
  const endOfSlate = next.toISOString();

  const { data, error } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", sport)
    .gte("game_date", startOfDay)
    .lt("game_date", endOfSlate);
  if (error) throw new Error(`loadGameIdMap failed: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: number; external_id: number }[]).map((r) => [
      r.external_id,
      r.id,
    ])
  );
}

/**
 * Ballpark id keyed by team_id (DB id, not external).
 * Each team has one home ballpark (1:1).
 */
export async function loadBallparkIdByTeamId(): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from("ballparks")
    .select("id, team_id");
  if (error) throw new Error(`loadBallparkIdByTeamId failed: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: number; team_id: number }[]).map((r) => [
      r.team_id,
      r.id,
    ])
  );
}

/**
 * Ballpark metadata by team_id — lat/lng + dome flags for weather decisions.
 */
export type BallparkRow = {
  id: number;
  team_id: number;
  latitude: number;
  longitude: number;
  is_dome: boolean;
  is_retractable: boolean;
};

export async function loadBallparkMetadata(): Promise<Map<number, BallparkRow>> {
  const { data, error } = await supabase
    .from("ballparks")
    .select("id, team_id, latitude, longitude, is_dome, is_retractable");
  if (error) throw new Error(`loadBallparkMetadata failed: ${error.message}`);
  return new Map(
    ((data ?? []) as BallparkRow[]).map((r) => [r.team_id, r])
  );
}
