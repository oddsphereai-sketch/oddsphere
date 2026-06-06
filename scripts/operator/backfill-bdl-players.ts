/**
 * Push 3A-4 Phase 2 — BDL player backfill CLI.
 * Push 3B-5f — refactored to a thin CLI wrapper. All logic lives in
 * lib/services/bdlPlayerBackfillService.ts so cron routes can import
 * it without dragging this file's top-level `main()` call into the
 * Next build worker.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local scripts/operator/backfill-bdl-players.ts \
 *       --sport mlb --date 2026-06-06 [--verbose]
 *
 *   Apply:
 *     BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED=true \
 *       PLAYER_STATS_PROVIDER=real_api \
 *       npx tsx --env-file=.env.local scripts/operator/backfill-bdl-players.ts \
 *       --sport mlb --date 2026-06-06 --apply
 *
 * SAFETY (delegated to the service):
 *   • Ambiguous matches NEVER written.
 *   • Existing name/team_id NEVER overwritten — link mode only
 *     merges provider_ids.bdl.
 *   • Writes ONLY to the `players` table.
 *   • Never writes predictions, slate_status, locked_at, lineups,
 *     weather, tracking, or model_version.
 */

import { runBdlPlayerBackfillCycle } from "../../lib/services/bdlPlayerBackfillService";
import type { Sport } from "../../lib/types/domain/Sport";

type Opts = { sport: Sport; date: string; apply: boolean; verbose: boolean };

function parseArgs(argv: string[]): Opts {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let apply = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--verbose") { verbose = true; continue; }
  }
  if (!date) {
    console.error("Usage: backfill-bdl-players.ts --sport mlb --date YYYY-MM-DD [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, verbose };
}

async function main() {
  const opts = parseArgs(process.argv);
  const envEnabled = process.env.BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED === "true";
  const providerMode = process.env.PLAYER_STATS_PROVIDER === "real_api" ? "real_api" : "mock";
  const writeMode = opts.apply && envEnabled && providerMode === "real_api";

  console.log(`\n━━━ BDL PLAYER BACKFILL · ${opts.date} ━━━`);
  console.log(`         mode=${writeMode ? "APPLY" : "DRY-RUN"}  sport=${opts.sport}  provider=${providerMode}`);
  if (opts.apply && !envEnabled) {
    console.error(`✗ --apply requires BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED=true in env.`);
    process.exit(1);
  }
  if (opts.apply && providerMode !== "real_api") {
    console.error(`✗ --apply requires PLAYER_STATS_PROVIDER=real_api in env.`);
    process.exit(1);
  }
  console.log("");

  const result = await runBdlPlayerBackfillCycle({
    sport: opts.sport,
    date: opts.date,
    writeMode,
    log: opts.verbose ? (m) => console.log(`  ${m}`) : undefined,
  });

  console.log(`status=${result.status}`);
  console.log(`unique BDL players=${result.unique_bdl_players}  api_calls=${result.api_calls}`);
  console.log(`\nPlan summary:`);
  for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(22)}  ${v}`);
  if (writeMode) {
    console.log(`\nApply result: linked=${result.linked}  created=${result.created}  failed=${result.failed}`);
    console.log(`BDL player map size: ${result.pre_map_size} → ${result.post_map_size}`);
    console.log(`\n✅ BDL player backfill applied for ${opts.sport.toUpperCase()} ${opts.date}.`);
  } else {
    console.log(`\nDRY-RUN — no DB writes.`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
