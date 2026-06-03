/**
 * Phase 4.2.C.1.F — small helpers for the first-inning backfill operator.
 *
 * Pure (no I/O) where possible so they're unit-testable in isolation.
 * The operator script (scripts/operator/backfill-first-inning-stats.ts)
 * imports these helpers and adds CLI glue + DB queries on top.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── ID resolution ────────────────────────────────────────────────────

export type MlbStatsIdSource =
  | "provider_ids_mlb_stats"
  | "players_mlb_person_id"
  | "name_dob_search";

export type IdResolution =
  | { kind: "ok"; mlbId: number; source: MlbStatsIdSource }
  | { kind: "needs_search"; reason: "no_id_in_db" }
  | { kind: "skip"; reason: "missing_dob" };

/**
 * Pure helper. Resolves an MLB Stats Person ID for a player row using
 * the priority order:
 *   1. provider_ids.mlb_stats.id      (Phase 4.2.C.1.M mapping layer)
 *   2. players.mlb_person_id          (legacy Phase 3.x column)
 *   3. name+DOB search                (last resort — caller invokes
 *      `searchPersonByNameDob` separately and represents that branch
 *      as `kind: "needs_search"`)
 *
 * Returns:
 *   • { kind: "ok", mlbId, source }  — id resolved from DB
 *   • { kind: "needs_search" }       — caller must run name+DOB search
 *   • { kind: "skip" }               — no id and no dob to search by
 */
export function resolveMlbStatsIdFromDbRow(row: {
  mlb_person_id: number | null;
  dob: string | null;
  provider_ids: Record<string, unknown> | null;
}): IdResolution {
  const pi = (row.provider_ids ?? {}) as Record<string, unknown>;
  const mlbStats = pi.mlb_stats as { id?: unknown } | undefined;
  const mlbStatsId =
    typeof mlbStats?.id === "number" && Number.isFinite(mlbStats.id)
      ? mlbStats.id
      : null;
  if (mlbStatsId !== null) {
    return {
      kind: "ok",
      mlbId: mlbStatsId,
      source: "provider_ids_mlb_stats",
    };
  }
  if (row.mlb_person_id !== null) {
    return {
      kind: "ok",
      mlbId: row.mlb_person_id,
      source: "players_mlb_person_id",
    };
  }
  if (row.dob === null) {
    return { kind: "skip", reason: "missing_dob" };
  }
  return { kind: "needs_search", reason: "no_id_in_db" };
}

// ─── Nulled-season guard ──────────────────────────────────────────────

/**
 * Pure helper. Detects whether a `player_season_stats` row is in the
 * "nulled cleanup" state — i.e., all the meaningful counters are null.
 * This is the signature left by `null-stale-cole-stats.ts` after the
 * Cole cleanup.
 *
 * Used to short-circuit FI refresh for rows we deliberately blanked:
 * we don't want to re-populate Cole's FI just because his
 * provider_ids.mlb_stats.id still resolves. The operator caller may
 * later add a --force-nulled override if needed; for now the default
 * is conservative.
 *
 * Heuristic: a row is "nulled" when ALL of pitching_ip, pitching_era,
 * pitching_k, AND batting_ab are null. This combination doesn't occur
 * for a normal pitcher (who has pitching_* populated even if batting
 * is null) or normal hitter (who has batting_* populated even if
 * pitching is null) — it only matches the explicit cleanup signature.
 *
 * Returns `false` if the row is null/undefined (no row to short-circuit
 * — the writer will return `skipped_no_row` naturally).
 */
export function isFullyNulledSeasonRow(
  row: {
    pitching_ip: number | null;
    pitching_era: number | null;
    pitching_k: number | null;
    batting_ab: number | null;
  } | null
  | undefined
): boolean {
  if (row === null || row === undefined) return false;
  return (
    row.pitching_ip === null &&
    row.pitching_era === null &&
    row.pitching_k === null &&
    row.batting_ab === null
  );
}

// ─── Slate starter resolution (DB-bound) ──────────────────────────────

/**
 * Resolve unique probable-starter player_ids from `games` for a given
 * slate_date. Reads `home_pitcher_id` and `away_pitcher_id` (which the
 * BDL slate ingest populates), drops nulls, dedupes.
 *
 * A typical MLB slate of ~15 games has ~30 distinct starter ids
 * (occasionally fewer when the same starter appears twice in a
 * doubleheader; dedup handles that).
 */
export async function loadSlateStarterPlayerIds(
  client: SupabaseClient,
  slateDate: string,
  sport: string = "mlb"
): Promise<number[]> {
  const { data, error } = await client
    .from("games")
    .select("home_pitcher_id, away_pitcher_id")
    .eq("sport", sport)
    .eq("slate_date", slateDate);
  if (error !== null) {
    throw new Error(
      `loadSlateStarterPlayerIds failed for ${slateDate}: ${error.message}`
    );
  }
  const seen = new Set<number>();
  for (const r of (data ?? []) as Array<{
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
  }>) {
    if (r.home_pitcher_id !== null) seen.add(r.home_pitcher_id);
    if (r.away_pitcher_id !== null) seen.add(r.away_pitcher_id);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

// ─── Pure helper for unique-ifying caller-provided id lists ──────────

export function dedupePlayerIds(ids: number[]): number[] {
  return Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0))).sort(
    (a, b) => a - b
  );
}
