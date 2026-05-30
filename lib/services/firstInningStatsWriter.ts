/**
 * Phase 3.x.0d — first-inning persistence helpers.
 *
 * Two UPDATE-only writers:
 *   • persistMlbPersonId      — sets players.mlb_person_id with a defensive
 *                                refuse-to-overwrite check.
 *   • persistFirstInningStats — updates only the six first_inning_* columns
 *                                on the matching player_season_stats row;
 *                                never inserts a partial row.
 *
 * Both default to DRY-RUN (`{ write: false }`). The operator script gates
 * the `write: true` call behind FIRST_INNING_DB_WRITES_ENABLED=true plus
 * a --write CLI flag.
 *
 * The optional `client` argument is for testability — production callers
 * pass nothing and the canonical service-role client is used.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultClient } from "../db/supabase";
import type { PitcherFirstInningStatsRecord } from "../providers/real_api/_mlbStatsApiClient";

export type PersistResult =
  | { kind: "dry_run"; intended_update: Record<string, unknown> }
  | { kind: "updated"; rows_affected: number }
  | { kind: "skipped_no_row" }
  | { kind: "skipped_conflict"; reason: string }
  | { kind: "error"; reason: string };

type WriterOpts = {
  write: boolean;
  quiet?: boolean;
  client?: SupabaseClient;
};

function log(opts: WriterOpts, message: string): void {
  if (opts.quiet) return;
  console.log(`[firstInningWriter] ${message}`);
}

export async function persistMlbPersonId(
  playerId: number,
  mlbPersonId: number,
  opts: WriterOpts
): Promise<PersistResult> {
  if (!opts.write) {
    log(
      opts,
      `DRY-RUN: would UPDATE players SET mlb_person_id=${mlbPersonId} WHERE id=${playerId} (defensive on existing value)`
    );
    return {
      kind: "dry_run",
      intended_update: {
        table: "players",
        set: { mlb_person_id: mlbPersonId },
        where: { id: playerId },
        defensive: "skip if existing mlb_person_id is non-null and differs",
      },
    };
  }

  const client = opts.client ?? defaultClient;
  const { data: existing, error: selErr } = await client
    .from("players")
    .select("mlb_person_id")
    .eq("id", playerId)
    .single();
  if (selErr) {
    log(opts, `select error on persistMlbPersonId id=${playerId}: ${selErr.message}`);
    return { kind: "error", reason: selErr.message };
  }
  const existingId = (existing as { mlb_person_id: number | null } | null)?.mlb_person_id ?? null;
  if (existingId !== null && existingId !== mlbPersonId) {
    log(
      opts,
      `refusing to overwrite players.id=${playerId} mlb_person_id=${existingId} with ${mlbPersonId}`
    );
    return {
      kind: "skipped_conflict",
      reason: `existing mlb_person_id=${existingId} differs from requested ${mlbPersonId}`,
    };
  }
  if (existingId === mlbPersonId) {
    return { kind: "updated", rows_affected: 0 };
  }

  const { error: updErr } = await client
    .from("players")
    .update({ mlb_person_id: mlbPersonId, updated_at: new Date().toISOString() })
    .eq("id", playerId);
  if (updErr) {
    log(opts, `update error on persistMlbPersonId id=${playerId}: ${updErr.message}`);
    return { kind: "error", reason: updErr.message };
  }
  return { kind: "updated", rows_affected: 1 };
}

export async function persistFirstInningStats(
  playerId: number,
  season: number,
  record: PitcherFirstInningStatsRecord,
  opts: WriterOpts
): Promise<PersistResult> {
  const fiUpdate = {
    first_inning_era: record.first_inning_era,
    first_inning_starts: record.first_inning_starts,
    first_inning_runs_allowed: record.first_inning_runs_allowed,
    first_inning_earned_runs: record.first_inning_earned_runs,
    first_inning_innings_pitched: record.first_inning_innings_pitched,
    first_inning_whip: record.first_inning_whip,
    updated_at: new Date().toISOString(),
  };

  if (!opts.write) {
    log(
      opts,
      `DRY-RUN: would UPDATE player_season_stats SET first_inning_* WHERE player_id=${playerId} season=${season} season_type=regular`
    );
    return {
      kind: "dry_run",
      intended_update: {
        table: "player_season_stats",
        set: fiUpdate,
        where: { player_id: playerId, season, season_type: "regular" },
      },
    };
  }

  const client = opts.client ?? defaultClient;
  const { data, error } = await client
    .from("player_season_stats")
    .update(fiUpdate)
    .eq("player_id", playerId)
    .eq("season", season)
    .eq("season_type", "regular")
    .select("id");
  if (error) {
    log(
      opts,
      `update error on persistFirstInningStats player_id=${playerId} season=${season}: ${error.message}`
    );
    return { kind: "error", reason: error.message };
  }
  const rows = (data as unknown[] | null) ?? [];
  if (rows.length === 0) {
    log(
      opts,
      `no player_season_stats row for player_id=${playerId} season=${season} season_type=regular; skipping`
    );
    return { kind: "skipped_no_row" };
  }
  return { kind: "updated", rows_affected: rows.length };
}

/**
 * Two-key gate check. The operator script also performs an inline check
 * so it can print a clear error before any work; this helper is exposed
 * for callers that want to gate at the service layer.
 */
export function isFirstInningWritesEnabled(): boolean {
  return process.env.FIRST_INNING_DB_WRITES_ENABLED === "true";
}
