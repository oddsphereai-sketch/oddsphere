/**
 * Phase 4.2.C.1.S.A — operator script that previews what
 * `statsService.refreshSeasonStats` + `refreshSplits` would write, on
 * a small sample. Reads BDL `/players/splits` per player using their
 * mapped `provider_ids.bdl.id`.
 *
 * DRY-RUN by default. The --apply path exists for future controlled
 * apply (gated by `--apply` + `STATS_REFRESH_DB_WRITES_ENABLED=true`
 * + interactive y/N) but is NOT being run as part of Phase 4.2.C.1.S.A.
 *
 * USAGE (dry-run):
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/refresh-mlb-stats-from-splits.ts [--season 2025] \
 *     [--players bdl_id_1,bdl_id_2,...]
 *
 * If --players is omitted, defaults to a tiny smoke list (Aaron Judge,
 * Tarik Skubal). The smoke list is intentionally short for the first
 * verification pass; broader runs should pass --players or --all.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { supabase } from "../../lib/db/supabase";
import { BallDontLieProvider } from "../../lib/providers/real_api/BallDontLieProvider";
import { loadPlayerBdlIdMap, type PlayerMappingMetadata } from "../../lib/services/_idMaps";

// ─── CLI parsing ──────────────────────────────────────────────────────

function readArg(argv: readonly string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return null;
  return argv[i + 1] ?? null;
}

function readBoolFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}

const DEFAULT_SMOKE_BDL_IDS = [
  569,  // Aaron Judge (hitter)
  178,  // Tarik Skubal (pitcher)
];

function parsePlayersArg(s: string | null): number[] | null {
  if (s === null) return null;
  const parts = s.split(",").map((t) => Number(t.trim())).filter((n) => Number.isFinite(n));
  return parts.length === 0 ? null : parts;
}

// ─── apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled = process.env.STATS_REFRESH_DB_WRITES_ENABLED === "true";
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
      "✗ --apply requires STATS_REFRESH_DB_WRITES_ENABLED=true in the environment.",
      "",
      "    STATS_REFRESH_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-mlb-stats-from-splits.ts --apply [...flags]",
    ].join("\n")
  );
  process.exit(1);
}

async function confirmApply(seasonCount: number, splitsCount: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(
      `About to UPDATE/INSERT:\n` +
        `  player_season_stats: ${seasonCount} row(s)\n` +
        `  player_splits:       ${splitsCount} row(s)\n` +
        `  All UPSERTs idempotent on natural keys; existing rows merged.\n` +
        `  Continue? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── main ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv;
  const season = Number(readArg(argv, "--season") ?? "2025");
  const playersArg = parsePlayersArg(readArg(argv, "--players"));
  const allFlag = readBoolFlag(argv, "--all");
  const gate = resolveApplyGate(argv);
  refuseApplyMisconfig(gate.applyRequested, gate.envEnabled);
  const writeMode = gate.canApply;

  console.log(
    `[refresh-mlb-stats-from-splits] mode=${writeMode ? "APPLY" : "DRY-RUN"} season=${season}`
  );
  if (!writeMode) console.log("             DRY RUN — NO DB WRITES");

  if (!process.env.BALLDONTLIE_API_KEY) {
    console.error("✗ BALLDONTLIE_API_KEY not set");
    process.exit(1);
  }
  const bdl = new BallDontLieProvider(process.env.BALLDONTLIE_API_KEY);

  // ── Load all MLB players with provider_ids.bdl populated ────────────
  console.log();
  console.log("━━━ Loading players (with BDL mapping) ━━━");
  const allByBdl = await loadPlayerBdlIdMap("mlb");
  console.log(`  Total MLB players with provider_ids.bdl: ${allByBdl.size}`);

  // ── Filter to sample ─────────────────────────────────────────────────
  let targetBdlIds: number[];
  if (allFlag) {
    targetBdlIds = Array.from(allByBdl.keys());
  } else if (playersArg !== null) {
    targetBdlIds = playersArg;
  } else {
    targetBdlIds = DEFAULT_SMOKE_BDL_IDS;
  }
  console.log(`  Sample size: ${targetBdlIds.length} (${allFlag ? "all" : playersArg !== null ? "explicit --players" : "default smoke list"})`);

  // Resolve metadata for the sample. Skip BDL IDs we don't have mapped.
  const sample: PlayerMappingMetadata[] = [];
  for (const bdlId of targetBdlIds) {
    const meta = allByBdl.get(bdlId);
    if (meta === undefined) {
      console.log(`  ⚠ bdl_id=${bdlId} not in DB / not mapped — skipping`);
      continue;
    }
    sample.push(meta);
  }
  if (sample.length === 0) {
    console.log("✗ No mapped players matched the sample. Exiting.");
    return;
  }

  // ── Per-player fetch + plan ─────────────────────────────────────────
  console.log();
  console.log(`━━━ Probing /players/splits per player (sample=${sample.length}) ━━━`);

  type PlanRow = {
    meta: PlayerMappingMetadata;
    seasonRecord:
      | { kind: "ok"; record: Record<string, unknown> }
      | { kind: "empty" }
      | { kind: "error"; message: string };
    splitRecords: Record<string, unknown>[];
  };

  const planRows: PlanRow[] = [];
  let bdlCalls = 0;

  for (const meta of sample) {
    console.log();
    console.log(`  player_id=${meta.id}  bdl=${meta.bdl_id}  external_id=${meta.external_id}  is_pitcher=${meta.is_pitcher}`);
    try {
      // Two separate calls (one for season, one for splits) — same
      // endpoint, kept separate to match the IPlayerStatsProvider
      // interface cleanly. For 1-3 players this is acceptable; for full
      // slate we'd add a single-call optimization later.
      const seasonRecords = await bdl.getPlayerSeasonStats(meta.bdl_id, [season]);
      bdlCalls++;
      // Always fetch splits for hitters; skip for pitchers (matches
      // statsService.refreshSplits convention).
      let splits: Array<{
        player_id: number;
        season: number;
        split_type: string;
        ab: number | null;
        h: number | null;
        avg: number | null;
        obp: number | null;
        slg: number | null;
        ops: number | null;
        hr: number | null;
        rbi: number | null;
        so: number | null;
        bb: number | null;
        tb: number | null;
        pa: number | null;
      }> = [];
      if (!meta.is_pitcher) {
        const splitRows = await bdl.getPlayerSplits(meta.bdl_id, season);
        bdlCalls++;
        splits = splitRows.map((r) => ({
          player_id: meta.id,
          season: r.season,
          split_type: String(r.split_type),
          ab: r.ab, h: r.h, avg: r.avg, obp: r.obp, slg: r.slg, ops: r.ops,
          hr: r.hr, rbi: r.rbi, so: r.so, bb: r.bb, tb: r.tb, pa: r.pa,
        }));
      }

      // Build planned season row
      let seasonRowOut: PlanRow["seasonRecord"];
      if (seasonRecords.length === 0) {
        seasonRowOut = { kind: "empty" };
      } else {
        const r = seasonRecords[0]!;
        seasonRowOut = {
          kind: "ok",
          record: {
            player_id: meta.id,
            team_id: meta.team_id,
            season: r.season,
            season_type: r.season_type,
            postseason: r.postseason,
            batting_gp: r.batting_gp, batting_ab: r.batting_ab, batting_h: r.batting_h,
            batting_avg: r.batting_avg, batting_hr: r.batting_hr, batting_rbi: r.batting_rbi,
            batting_bb: r.batting_bb, batting_so: r.batting_so, batting_sb: r.batting_sb,
            batting_obp: r.batting_obp, batting_slg: r.batting_slg, batting_ops: r.batting_ops,
            batting_tb: r.batting_tb, batting_pa: r.batting_pa, batting_hbp: r.batting_hbp,
            pitching_gp: r.pitching_gp, pitching_gs: r.pitching_gs,
            pitching_w: r.pitching_w, pitching_l: r.pitching_l, pitching_era: r.pitching_era,
            pitching_sv: r.pitching_sv, pitching_ip: r.pitching_ip,
            pitching_h: r.pitching_h, pitching_er: r.pitching_er, pitching_hr: r.pitching_hr,
            pitching_bb: r.pitching_bb, pitching_whip: r.pitching_whip, pitching_k: r.pitching_k,
            pitching_k_per_9: r.pitching_k_per_9,
          },
        };
      }

      planRows.push({ meta, seasonRecord: seasonRowOut, splitRecords: splits });
    } catch (e) {
      planRows.push({
        meta,
        seasonRecord: { kind: "error", message: e instanceof Error ? e.message : String(e) },
        splitRecords: [],
      });
    }
  }

  console.log();
  console.log(`  BDL API calls: ${bdlCalls}`);

  // ── Print per-player plan ───────────────────────────────────────────
  console.log();
  console.log("━━━ Plan: player_season_stats ━━━");
  let plannedSeasonRows = 0;
  for (const row of planRows) {
    if (row.seasonRecord.kind === "empty") {
      console.log(`  ⏭  player_id=${row.meta.id} bdl=${row.meta.bdl_id}: BDL returned no season aggregate for ${season}`);
      continue;
    }
    if (row.seasonRecord.kind === "error") {
      console.log(`  ✗  player_id=${row.meta.id} bdl=${row.meta.bdl_id}: ${row.seasonRecord.message}`);
      continue;
    }
    plannedSeasonRows++;
    const r = row.seasonRecord.record;
    console.log(
      `  ✓  player_id=${r.player_id} bdl=${row.meta.bdl_id} season=${r.season}/${r.season_type} ` +
        `bat: ab=${r.batting_ab} h=${r.batting_h} hr=${r.batting_hr} obp=${r.batting_obp} slg=${r.batting_slg} ops=${r.batting_ops}` +
        ` | pit: ip=${r.pitching_ip} era=${r.pitching_era} whip=${typeof r.pitching_whip === "number" ? (r.pitching_whip as number).toFixed(3) : "—"} k9=${typeof r.pitching_k_per_9 === "number" ? (r.pitching_k_per_9 as number).toFixed(2) : "—"}`
    );
  }

  console.log();
  console.log("━━━ Plan: player_splits ━━━");
  let plannedSplitRows = 0;
  for (const row of planRows) {
    if (row.meta.is_pitcher) {
      console.log(`  ⏭  player_id=${row.meta.id} bdl=${row.meta.bdl_id}: pitcher (splits refresh skips pitchers)`);
      continue;
    }
    if (row.splitRecords.length === 0) {
      console.log(`  ⏭  player_id=${row.meta.id} bdl=${row.meta.bdl_id}: no recognized byBreakdown buckets`);
      continue;
    }
    for (const s of row.splitRecords) {
      plannedSplitRows++;
      console.log(
        `  ✓  player_id=${s.player_id} bdl=${row.meta.bdl_id} season=${s.season} split=${s.split_type} ` +
          `ab=${s.ab} h=${s.h} hr=${s.hr} ops=${s.ops} obp=${s.obp} slg=${s.slg}`
      );
    }
  }

  console.log();
  console.log("━━━ Plan summary ━━━");
  console.log(`  player_season_stats rows: ${plannedSeasonRows}`);
  console.log(`  player_splits rows:       ${plannedSplitRows}`);
  console.log(`  BDL calls used:           ${bdlCalls}`);

  if (!writeMode) {
    console.log();
    console.log("  DRY RUN — NO DB WRITES PERFORMED.");
    console.log();
    console.log("  To apply later (gated):");
    console.log("    STATS_REFRESH_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \\");
    console.log("      scripts/operator/refresh-mlb-stats-from-splits.ts --apply [--players ...] [--season N]");
    return;
  }

  // ── APPLY path (NOT exercised in Phase 4.2.C.1.S.A) ─────────────────
  const confirmed = await confirmApply(plannedSeasonRows, plannedSplitRows);
  if (!confirmed) {
    console.log("Cancelled by operator. No writes performed.");
    return;
  }

  // Collect rows
  const seasonRows: Array<Record<string, unknown>> = [];
  for (const row of planRows) {
    if (row.seasonRecord.kind === "ok") seasonRows.push(row.seasonRecord.record);
  }
  const splitRows: Array<Record<string, unknown>> = [];
  for (const row of planRows) for (const s of row.splitRecords) splitRows.push(s);

  console.log();
  console.log("Writing…");
  if (seasonRows.length > 0) {
    const { error } = await supabase
      .from("player_season_stats")
      .upsert(seasonRows, { onConflict: "player_id,season,season_type" });
    if (error) throw new Error(`upsert player_season_stats failed: ${error.message}`);
    console.log(`  ✓ wrote ${seasonRows.length} player_season_stats row(s)`);
  }
  if (splitRows.length > 0) {
    const { error } = await supabase
      .from("player_splits")
      .upsert(splitRows, { onConflict: "player_id,season,split_type" });
    if (error) throw new Error(`upsert player_splits failed: ${error.message}`);
    console.log(`  ✓ wrote ${splitRows.length} player_splits row(s)`);
  }
  console.log();
  console.log("━━━ Apply complete ━━━");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
