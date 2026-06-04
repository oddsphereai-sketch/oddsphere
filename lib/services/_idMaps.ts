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
  // Phase 4.2.C.1.H-0: external_id is nullable for MLB-Stats-only rows;
  // skip them — this map is keyed by BDL external_id and a null key would
  // be meaningless to every caller.
  let q = supabase
    .from("players")
    .select("id, external_id")
    .not("external_id", "is", null);
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
  // Phase 4.2.C.1.H-0: skip MLB-Stats-only rows (external_id null) — same
  // rationale as loadPlayerIdMap; the map is keyed by BDL external_id.
  let q = supabase
    .from("players")
    .select("id, external_id, is_pitcher, team_id")
    .not("external_id", "is", null);
  if (sport !== undefined) q = q.eq("sport", sport);
  const { data, error } = await q;
  if (error) throw new Error(`loadPlayerMetadata failed: ${error.message}`);
  return new Map(
    ((data ?? []) as PlayerMetadata[]).map((r) => [r.external_id, r])
  );
}

/**
 * Phase 4.2.C.1.S.A — keyed by `provider_ids.bdl.id` (the BDL ID),
 * which is the namespace BDL stats endpoints understand. Skips rows
 * that don't have a populated bdl block — those are still unmapped.
 *
 * `team_id` is the DB id; `external_id` and `mlb_stats_id` are kept
 * around so callers can audit the row or fan out to MLB Stats.
 */
export type PlayerMappingMetadata = {
  id: number;
  external_id: number;
  bdl_id: number;
  mlb_stats_id: number | null;
  is_pitcher: boolean;
  team_id: number | null;
};

export async function loadPlayerBdlIdMap(
  sport?: Sport
): Promise<Map<number, PlayerMappingMetadata>> {
  let q = supabase
    .from("players")
    .select("id, external_id, is_pitcher, team_id, provider_ids");
  if (sport !== undefined) q = q.eq("sport", sport);
  const { data, error } = await q;
  if (error) throw new Error(`loadPlayerBdlIdMap failed: ${error.message}`);
  const out = new Map<number, PlayerMappingMetadata>();
  for (const r of (data ?? []) as Array<{
    id: number;
    external_id: number;
    is_pitcher: boolean;
    team_id: number | null;
    provider_ids: Record<string, unknown> | null;
  }>) {
    const pi = r.provider_ids ?? {};
    const bdl = pi.bdl as { id?: unknown } | undefined;
    const mlbStats = pi.mlb_stats as { id?: unknown } | undefined;
    const bdlId = typeof bdl?.id === "number" ? bdl.id : null;
    const mlbStatsId =
      typeof mlbStats?.id === "number" ? mlbStats.id : null;
    if (bdlId === null) continue;
    out.set(bdlId, {
      id: r.id,
      external_id: r.external_id,
      bdl_id: bdlId,
      mlb_stats_id: mlbStatsId,
      is_pitcher: r.is_pitcher,
      team_id: r.team_id,
    });
  }
  return out;
}

/**
 * Load (game_external_id → game_id) map for games on a given slate date.
 *
 * Uses the games.slate_date column (added in Phase 5E.1) — the local-evening
 * date in the sport's broadcast anchor timezone. Direct equality replaces
 * the UTC-window hack that previously misclassified games at the
 * midnight-UTC seam.
 */
export async function loadGameIdMap(
  sport: Sport,
  date: string
): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", sport)
    .eq("slate_date", date);
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
