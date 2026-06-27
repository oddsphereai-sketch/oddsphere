/**
 * Phase 4.2.C.1.R-11 — season-level pitching stats persistence.
 *
 * Mirror of `firstInningStatsWriter.ts` for the season-aggregate
 * branch. UPSERTs on `player_season_stats(player_id, season,
 * season_type='regular')` and writes ONLY season-level pitching_*
 * columns plus the natural-key + updated_at fields.
 *
 * Critical invariant: this writer NEVER includes any first_inning_*
 * field in its payload. PostgREST's UPDATE clause only sets columns
 * present in the payload, so when an existing row already carries
 * first_inning_* data (e.g., FI backfilled at R-2 step 5), those
 * fields are preserved untouched. INSERT rows for players that don't
 * have FI data yet (the 15 H-3a missing pitchers) leave the
 * first_inning_* columns at their schema NULL default — a subsequent
 * FI backfill can populate them on the same row.
 *
 * Defaults to DRY-RUN (`{ write: false }`). Production callers (the
 * operator script) gate the `write: true` call behind
 * `SEASON_PITCHING_DB_WRITES_ENABLED=true` plus a `--write` CLI flag.
 *
 * The optional `client` argument is for testability — production
 * callers pass nothing and the canonical service-role client is used.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultClient } from "../db/supabase";
import type { PitcherSeasonStatsRecord } from "../providers/real_api/_mlbStatsApiClient";

export type PersistResult =
  | { kind: "dry_run"; intended_update: Record<string, unknown> }
  | { kind: "updated"; rows_affected: number }
  | { kind: "skipped_empty"; reason: string }
  | { kind: "skipped_nulled_cleanup"; reason: string }
  | { kind: "error"; reason: string };

export type WriterOpts = {
  write: boolean;
  quiet?: boolean;
  client?: SupabaseClient;
};

function log(opts: WriterOpts, message: string): void {
  if (opts.quiet) return;
  console.log(`[seasonPitchingWriter] ${message}`);
}

/**
 * Phase 4.2.C.1.S.A-cole-cleanup invariant — preserve nulled rows.
 *
 * Stricter than the FI writer's check: a true cleanup row has ALL
 * stat fields null, INCLUDING the first_inning_* fields. The
 * canonical example is Cole (player_id=6271, season=2025) — his row
 * was deliberately nulled by `null-stale-cole-stats.ts` across both
 * season pitching AND first-inning columns.
 *
 * R-11 surfaced a defect in the looser 4-field check: the H-3a-
 * ingested pitchers all have FI-only rows from the R-2 step 5
 * backfill (pitching_* + batting_ab null, but first_inning_era
 * populated). The looser check incorrectly classified those as
 * cleanup rows and skipped them. The 5-field check (adding
 * first_inning_era === null) distinguishes:
 *
 *   • Cole row: pitching_* null AND batting_ab null AND
 *               first_inning_era null  → TRUE cleanup → skip
 *   • H-3a row: pitching_* null AND batting_ab null but
 *               first_inning_era non-null → NOT cleanup → proceed
 *
 * The FI writer keeps its 4-field check because its incoming
 * payload populates first_inning_era anyway — and a Cole-style
 * cleanup row has first_inning_era null too, so the 4-field check
 * is sufficient there. The season writer needs the extra discriminator
 * because its incoming payload only touches season columns and
 * an FI-only row from R-2 looks identical to a Cole cleanup row at
 * the 4-field level.
 */
function isFullyNulledCleanupRow(
  existing: {
  pitching_ip: number | null;
  pitching_era: number | null;
  pitching_k: number | null;
  batting_ab: number | null;
  first_inning_era: number | null;
  },
  season: number,
): boolean {
  // Treat all-null current-season rows as refillable placeholders. They
  // commonly appear when a newly mapped starter was inserted before the
  // provider had a season line ready. Historical all-null rows remain
  // cleanup-protected, preserving the Cole-style manual nulled cleanup.
  if (season >= new Date().getUTCFullYear()) return false;
  return (
    existing.pitching_ip === null &&
    existing.pitching_era === null &&
    existing.pitching_k === null &&
    existing.batting_ab === null &&
    existing.first_inning_era === null
  );
}

/**
 * Build the upsert payload from a `PitcherSeasonStatsRecord`.
 *
 * Exported for testing — the operator and writer go through
 * `persistSeasonPitchingStats` in production. Keeps the column-name
 * mapping in one place and makes the "no FI columns in payload"
 * invariant easy to assert in tests.
 */
export function buildSeasonPayload(
  playerId: number,
  season: number,
  record: PitcherSeasonStatsRecord
): Record<string, unknown> {
  return {
    player_id: playerId,
    season,
    season_type: "regular",
    pitching_gp: record.games_played,
    pitching_gs: record.games_started,
    pitching_w: record.wins,
    pitching_l: record.losses,
    pitching_era: record.era,
    pitching_whip: record.whip,
    pitching_ip: record.innings_pitched,
    pitching_h: record.hits_allowed,
    pitching_er: record.earned_runs,
    pitching_hr: record.home_runs_allowed,
    pitching_bb: record.walks,
    pitching_k: record.strikeouts,
    pitching_k_per_9: record.strikeouts_per_9,
    pitching_sv: record.saves,
    pitching_hld: record.holds,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Persist a `PitcherSeasonStatsRecord` to player_season_stats.
 *
 * UPSERT on (player_id, season, season_type='regular'). Writes ONLY
 * the season-level pitching_* columns — first_inning_* columns are
 * never included in the payload, so existing FI data on the row is
 * preserved by PostgREST.
 *
 * Skips:
 *   - `kind: "skipped_empty"` when record.raw_source === "empty"
 *     (caller can decide whether to surface this as a write or a skip).
 *     Today's 15 H-3a pitchers should never produce this since the
 *     R-11 probe confirmed all 17 returned usable data; the skip is
 *     defensive for edge cases.
 *   - `kind: "skipped_nulled_cleanup"` when the existing row matches
 *     the Cole-style fully-nulled signature.
 */
export async function persistSeasonPitchingStats(
  playerId: number,
  season: number,
  record: PitcherSeasonStatsRecord,
  opts: WriterOpts
): Promise<PersistResult> {
  if (record.raw_source === "empty") {
    log(
      opts,
      `skipped_empty player_id=${playerId} season=${season} (provider returned no stats)`
    );
    return {
      kind: "skipped_empty",
      reason: "MLB Stats returned empty record (no season aggregate)",
    };
  }

  const payload = buildSeasonPayload(playerId, season, record);

  // Defense-in-depth: NEVER allow any first_inning_* key in the payload.
  // A future edit to buildSeasonPayload should fail loudly if someone
  // accidentally includes one.
  for (const key of Object.keys(payload)) {
    if (key.startsWith("first_inning_")) {
      log(
        opts,
        `FATAL: payload contains first_inning key "${key}" — refusing to write`
      );
      return {
        kind: "error",
        reason: `payload must not include first_inning_ keys; found "${key}"`,
      };
    }
  }

  if (!opts.write) {
    log(
      opts,
      `DRY-RUN: would UPSERT player_season_stats (season pitching_* + updated_at) ON CONFLICT (player_id=${playerId}, season=${season}, season_type=regular)`
    );
    return {
      kind: "dry_run",
      intended_update: {
        table: "player_season_stats",
        op: "upsert",
        payload,
        on_conflict: "player_id,season,season_type",
      },
    };
  }

  const client = opts.client ?? defaultClient;

  // Cole-style nulled-cleanup guard — only check on existing rows.
  // Skip the guard for INSERT (no existing row to protect).
  const { data: existing } = await client
    .from("player_season_stats")
    .select("pitching_ip, pitching_era, pitching_k, batting_ab, first_inning_era")
    .eq("player_id", playerId)
    .eq("season", season)
    .eq("season_type", "regular")
    .maybeSingle();
  if (existing !== null && isFullyNulledCleanupRow(existing, season)) {
    log(
      opts,
      `skipped_nulled_cleanup player_id=${playerId} season=${season} (row matches cleanup signature)`
    );
    return {
      kind: "skipped_nulled_cleanup",
      reason: "existing row has nulled pitching_ip/era/k + batting_ab (cleanup-protected)",
    };
  }

  const { data, error } = await client
    .from("player_season_stats")
    .upsert(payload, { onConflict: "player_id,season,season_type" })
    .select("id");
  if (error) {
    log(
      opts,
      `upsert error player_id=${playerId} season=${season}: ${error.message}`
    );
    return { kind: "error", reason: error.message };
  }
  const rows = (data as unknown[] | null) ?? [];
  return { kind: "updated", rows_affected: rows.length };
}

/**
 * Two-key gate check. The operator script also performs an inline
 * check so it can print a clear error before any work; this helper
 * is exposed for symmetry with the FI writer's gate API.
 */
export function isWriteGateOpen(opts: {
  cliWriteFlag: boolean;
  envFlagValue: string | undefined;
}): boolean {
  return opts.cliWriteFlag === true && opts.envFlagValue === "true";
}

export const SEASON_PITCHING_WRITE_ENV_FLAG = "SEASON_PITCHING_DB_WRITES_ENABLED";
