/**
 * Phase 4.2.C.1.S.A-cleanup — null out Gerrit Cole's stale 2025
 * `player_season_stats` row.
 *
 * BACKGROUND: Cole missed all of 2025 with Tommy John surgery. BDL
 * returned no 2025 season aggregate for him, so the recent full-slate
 * apply correctly skipped him. But a pre-existing row from an older
 * broken `/season_stats` ingest persisted, with values that look like
 * a Cy Young pitcher's line (era=2.92, whip=1.029, ip=178.8 — note
 * `178.8` is not a valid BDL baseball-decimal IP, strongly suggesting
 * the value came from the broken league-wide endpoint and is wrong-
 * player data).
 *
 * The dry-run automodel verified the row IS being read and is
 * materially biasing games where Cole is listed as the starter. This
 * operator nulls out the pitching/FI fields so featureSnapshot treats
 * Cole as a missing-stats case and falls back to league-average ERA.
 *
 * SCOPE (tightly limited):
 *   • One row: (player_id=6271, season=2025, season_type='regular')
 *   • Sets pitching_* and first_inning_* columns to null
 *   • Does NOT touch:
 *       - players table (Cole's player row stays put)
 *       - player_splits (Cole is a pitcher → no splits anyway)
 *       - batting_* fields (already null for pitchers)
 *       - team_id, postseason, season metadata (kept for audit)
 *       - any other table (predictions/games/slates untouched)
 *
 * GATING (mirrors backfill-provider-mappings / manual-map patterns):
 *   • --apply required for write path
 *   • STATS_CLEANUP_DB_WRITES_ENABLED=true env required
 *   • Interactive y/N confirmation
 *   • Pre-flight: row must exist; players.full_name must match "Gerrit
 *     Cole" before write proceeds
 *   • Verbose before/after diff printed in dry-run
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { supabase } from "../../lib/db/supabase";

// ─── Target ───────────────────────────────────────────────────────────

const TARGET_PLAYER_ID = 6271;
const TARGET_FULL_NAME = "Gerrit Cole";
const TARGET_SEASON = 2025;
const TARGET_SEASON_TYPE = "regular";

// Columns to nullout (pitching block + first-inning block). Batting
// fields are left alone because they're already null for pitchers, and
// keeping the row metadata (player_id, season, season_type, postseason,
// team_id) preserves audit trail.
const NULL_FIELDS = {
  pitching_gp: null,
  pitching_gs: null,
  pitching_qs: null,
  pitching_w: null,
  pitching_l: null,
  pitching_era: null,
  pitching_sv: null,
  pitching_hld: null,
  pitching_ip: null,
  pitching_h: null,
  pitching_er: null,
  pitching_hr: null,
  pitching_bb: null,
  pitching_whip: null,
  pitching_k: null,
  pitching_k_per_9: null,
  pitching_war: null,
  first_inning_era: null,
  first_inning_starts: null,
  first_inning_whip: null,
  first_inning_runs_allowed: null,
  first_inning_earned_runs: null,
  first_inning_innings_pitched: null,
} as const;

const READ_COLUMNS =
  "player_id, season, season_type, team_id, postseason, " +
  Object.keys(NULL_FIELDS).join(", ");

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = argv.includes("--apply");
  const envEnabled =
    process.env.STATS_CLEANUP_DB_WRITES_ENABLED === "true";
  return {
    applyRequested,
    envEnabled,
    canApply: applyRequested && envEnabled,
  };
}

function refuseApplyMisconfig(applyRequested: boolean, envEnabled: boolean): void {
  if (!applyRequested) return;
  if (envEnabled) return;
  console.error(
    [
      "✗ --apply requires STATS_CLEANUP_DB_WRITES_ENABLED=true in the environment.",
      "",
      "    STATS_CLEANUP_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/null-stale-cole-stats.ts --apply",
    ].join("\n")
  );
  process.exit(1);
}

async function confirmApply(): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to UPDATE exactly 1 row:\n` +
        `  table:        player_season_stats\n` +
        `  player_id:    ${TARGET_PLAYER_ID}  (${TARGET_FULL_NAME})\n` +
        `  season:       ${TARGET_SEASON}\n` +
        `  season_type:  ${TARGET_SEASON_TYPE}\n` +
        `  fields set NULL: pitching_* (17 cols) + first_inning_* (6 cols)\n` +
        `  fields unchanged: batting_*, team_id, postseason, player_id,\n` +
        `                     season, season_type\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── main ─────────────────────────────────────────────────────────────

type SeasonStatsRow = Record<string, number | string | boolean | null> & {
  player_id: number;
  season: number;
  season_type: string;
};

async function main() {
  const argv = process.argv;
  const gate = resolveApplyGate(argv);
  refuseApplyMisconfig(gate.applyRequested, gate.envEnabled);
  const writeMode = gate.canApply;

  console.log(
    `[null-stale-cole-stats] mode=${writeMode ? "APPLY" : "DRY-RUN"}`
  );
  if (!writeMode) console.log("             DRY RUN — NO DB WRITES");

  // ── Verify the player ───────────────────────────────────────────────
  console.log();
  console.log("━━━ Verifying target player ━━━");
  const { data: player, error: playerErr } = await supabase
    .from("players")
    .select("id, full_name, is_pitcher")
    .eq("id", TARGET_PLAYER_ID)
    .maybeSingle();
  if (playerErr) {
    console.error(`✗ failed to load player: ${playerErr.message}`);
    process.exit(1);
  }
  if (player === null) {
    console.error(`✗ player_id=${TARGET_PLAYER_ID} not found in DB`);
    process.exit(1);
  }
  console.log(`  player_id=${player.id} full_name="${player.full_name}" is_pitcher=${player.is_pitcher}`);
  if (player.full_name !== TARGET_FULL_NAME) {
    console.error(
      `✗ full_name mismatch — expected "${TARGET_FULL_NAME}" but found "${player.full_name}". Aborting.`
    );
    process.exit(1);
  }
  console.log(`  ✓ full_name matches expected "${TARGET_FULL_NAME}"`);

  // ── Read current row ─────────────────────────────────────────────────
  console.log();
  console.log("━━━ Current row (BEFORE) ━━━");
  const { data: current, error: readErr } = await supabase
    .from("player_season_stats")
    .select(READ_COLUMNS)
    .eq("player_id", TARGET_PLAYER_ID)
    .eq("season", TARGET_SEASON)
    .eq("season_type", TARGET_SEASON_TYPE)
    .maybeSingle();
  if (readErr) {
    console.error(`✗ failed to read row: ${readErr.message}`);
    process.exit(1);
  }
  if (current === null) {
    console.log(`  (no row — nothing to clean up)`);
    console.log();
    console.log("  Nothing to do. Exiting.");
    return;
  }
  const before = current as unknown as SeasonStatsRow;
  for (const k of Object.keys(NULL_FIELDS)) {
    const v = before[k];
    if (v !== null) {
      console.log(`    ${k.padEnd(35)} = ${v}`);
    }
  }
  // count non-null fields
  const nonNullCount = Object.keys(NULL_FIELDS).filter(
    (k) => before[k] !== null
  ).length;
  console.log(`  ${nonNullCount} non-null field(s) to be set to NULL`);
  console.log(`  Preserved: player_id=${before.player_id}, season=${before.season},`);
  console.log(`             season_type=${before.season_type}, team_id=${before.team_id}, postseason=${before.postseason}`);

  // ── After preview ───────────────────────────────────────────────────
  console.log();
  console.log("━━━ Planned row (AFTER) ━━━");
  console.log(`  player_id=${before.player_id}, season=${before.season}, season_type=${before.season_type}`);
  console.log(`  team_id=${before.team_id}, postseason=${before.postseason}  (unchanged)`);
  console.log(`  pitching_*       → NULL`);
  console.log(`  first_inning_*   → NULL`);
  console.log(`  batting_*        → unchanged (already null for pitcher)`);

  // ── Dry-run exit ────────────────────────────────────────────────────
  if (!writeMode) {
    console.log();
    console.log("━━━ Verdict ━━━");
    console.log(`  Would UPDATE 1 row in player_season_stats.`);
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    console.log();
    console.log("  To apply (with explicit env flag):");
    console.log("    STATS_CLEANUP_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\");
    console.log("      scripts/operator/null-stale-cole-stats.ts --apply");
    return;
  }

  // ── APPLY: confirm + write ──────────────────────────────────────────
  const confirmed = await confirmApply();
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  console.log();
  console.log("Writing UPDATE…");
  const { error: updErr, count } = await supabase
    .from("player_season_stats")
    .update(NULL_FIELDS, { count: "exact" })
    .eq("player_id", TARGET_PLAYER_ID)
    .eq("season", TARGET_SEASON)
    .eq("season_type", TARGET_SEASON_TYPE);
  if (updErr) {
    console.error(`✗ UPDATE failed: ${updErr.message}`);
    process.exit(1);
  }
  console.log(`  ✓ Rows updated: ${count ?? "(unknown — check verification query)"}`);

  // ── Verify after ────────────────────────────────────────────────────
  console.log();
  console.log("━━━ Verifying AFTER ━━━");
  const { data: after } = await supabase
    .from("player_season_stats")
    .select(READ_COLUMNS)
    .eq("player_id", TARGET_PLAYER_ID)
    .eq("season", TARGET_SEASON)
    .eq("season_type", TARGET_SEASON_TYPE)
    .maybeSingle();
  if (after === null) {
    console.log(`  (row not found post-update — unexpected)`);
    return;
  }
  const a = after as unknown as SeasonStatsRow;
  const stillNonNull = Object.keys(NULL_FIELDS).filter((k) => a[k] !== null);
  if (stillNonNull.length === 0) {
    console.log(`  ✓ All targeted fields are now NULL`);
  } else {
    console.log(`  ✗ Still non-null: ${stillNonNull.join(", ")}`);
  }
  console.log(`  Preserved metadata: player_id=${a.player_id}, season=${a.season}, season_type=${a.season_type}, team_id=${a.team_id}, postseason=${a.postseason}`);
  console.log();
  console.log("━━━ Cleanup complete ━━━");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
