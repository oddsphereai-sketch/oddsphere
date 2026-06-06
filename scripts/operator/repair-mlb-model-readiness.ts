/**
 * Push 3B-4 Phase 2 — MLB model readiness repair CLI.
 * Push 3B-6 — refactored to thin wrapper. Logic lives in
 *   lib/services/modelReadinessService.ts so the orchestrator can
 *   import it without dragging this file's CLI surface into the
 *   Next build worker.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local scripts/operator/repair-mlb-model-readiness.ts \
 *       --sport mlb --date 2026-06-06
 *
 *   Apply:
 *     MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=true \
 *       AUTOMODEL_DB_WRITES_ENABLED=true \
 *       PLAYER_STATS_PROVIDER=real_api \
 *       WEATHER_PROVIDER=real_api \
 *       BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local scripts/operator/repair-mlb-model-readiness.ts \
 *       --sport mlb --date 2026-06-06 --apply
 *
 * SAFETY GATES (every gate must pass before any write fires):
 *   • --apply flag
 *   • MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=true
 *   • AUTOMODEL_DB_WRITES_ENABLED=true (the pitcher backfill helper
 *     also enforces its own gate via writeMode)
 *   • PLAYER_STATS_PROVIDER=real_api (lineup + pitcher backfill)
 *   • WEATHER_PROVIDER=real_api      (weather refresh)
 *   • BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED=true (BDL mapping writes)
 *
 * SAFETY:
 *   • Writes ONLY to: players, player_season_stats, lineups,
 *     weather_forecasts.
 *   • Never touches game_predictions, slate_status, locked_at,
 *     tracking, model_version, or any lock/publish state.
 *   • Per-step try/catch; one failure doesn't block the others.
 */

import {
  auditMlbModelReadiness,
  repairMlbModelReadiness,
} from "../../lib/services/modelReadinessService";
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
    console.error("Usage: repair-mlb-model-readiness.ts --sport mlb --date YYYY-MM-DD [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, verbose };
}

async function main() {
  const opts = parseArgs(process.argv);
  const writesEnabled = process.env.MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED === "true";
  const automodelEnabled = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";
  const playerStatsProviderReal = process.env.PLAYER_STATS_PROVIDER === "real_api";
  const weatherProviderReal = process.env.WEATHER_PROVIDER === "real_api";
  const bdlWritesEnabled = process.env.BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED === "true";
  const writeMode = opts.apply && writesEnabled && automodelEnabled;

  console.log(`\n━━━ MLB MODEL READINESS REPAIR · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`     mode=${writeMode ? "APPLY" : "DRY-RUN"}`);
  console.log(`     gates: MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=${writesEnabled} AUTOMODEL_DB_WRITES_ENABLED=${automodelEnabled}`);
  console.log(`     providers: PLAYER_STATS_PROVIDER=${playerStatsProviderReal ? "real_api" : "mock"} WEATHER_PROVIDER=${weatherProviderReal ? "real_api" : "mock"} BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED=${bdlWritesEnabled}`);
  if (opts.apply && (!writesEnabled || !automodelEnabled)) {
    console.error(`\n✗ --apply requires BOTH:`);
    console.error(`    MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=true`);
    console.error(`    AUTOMODEL_DB_WRITES_ENABLED=true`);
    process.exit(1);
  }
  console.log("");

  const audit = await auditMlbModelReadiness({ sport: opts.sport, date: opts.date });
  if (audit.games_total === 0) {
    console.log("No games on slate. Done.");
    return;
  }
  console.log(`Audit summary: ${audit.games_total} games  V2.2-ready=${audit.v22_ready_count}  FI-V2-ready=${audit.fi_v2_ready_count}`);
  if (Object.keys(audit.blocker_counts).length > 0) {
    console.log(`Blockers (pre-repair):`);
    for (const [k, v] of Object.entries(audit.blocker_counts)) console.log(`  ${k.padEnd(36)} ${v}`);
  }

  const report = await repairMlbModelReadiness({
    sport: opts.sport,
    date: opts.date,
    writeMode,
    providerGuards: {
      playerStatsProviderReal,
      weatherProviderReal,
      bdlWritesEnabled,
    },
    audit,
    log: opts.verbose ? (m) => console.log(m) : undefined,
  });

  console.log(`\n━━━ Repair steps ━━━`);
  console.log(`  BDL players:      ran=${report.steps.bdl_players.ran} linked=${report.steps.bdl_players.linked ?? "-"} created=${report.steps.bdl_players.created ?? "-"} status=${report.steps.bdl_players.status ?? "-"} ${report.steps.bdl_players.reason ?? ""}`);
  console.log(`  Pitcher stats:    ran=${report.steps.season_pitching.ran} rows_written=${report.steps.season_pitching.rows_written ?? "-"} errors=${report.steps.season_pitching.errors ?? "-"} status=${report.steps.season_pitching.status ?? "-"} ${report.steps.season_pitching.reason ?? ""}`);
  console.log(`  Lineup refresh:   ran=${report.steps.lineup.ran} records_updated=${report.steps.lineup.records_updated ?? "-"} ${report.steps.lineup.reason ?? ""}`);
  console.log(`  Weather refresh:  ran=${report.steps.weather.ran} records_updated=${report.steps.weather.records_updated ?? "-"} ${report.steps.weather.reason ?? ""}`);

  console.log(`\nReason codes: ${report.reasons.join(", ")}`);
  if (!writeMode) console.log(`\nDRY-RUN — no DB writes performed.`);
  else console.log(`\nApply complete. Re-run audit-mlb-model-readiness.ts to verify gates are now green.`);
}

if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
}
