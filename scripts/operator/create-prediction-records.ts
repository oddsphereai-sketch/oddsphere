/**
 * Push 4 operator — snapshot today's predictions into prediction_records.
 *
 * USAGE:
 *   Dry-run:
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/create-prediction-records.ts \
 *       --sport mlb --date 2026-06-06
 *
 *   Apply (launch day):
 *     PREDICTION_RECORDS_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/create-prediction-records.ts \
 *       --sport mlb --date 2026-06-06 --apply --launch-day
 *
 * Idempotent on (game_id, market, model_version, slate_date).
 *
 * `--launch-day` marks every record with launch_day=true and
 * manual_outcome_expected=true so the admin tracking page can
 * exclude them from the "fresh automated" aggregates.
 */

import { supabase } from "../../lib/db/supabase";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";
import type { TrackedSport } from "../../lib/types/domain/Tracking";

type Args = {
  sport: TrackedSport;
  date: string;
  apply: boolean;
  launchDay: boolean;
  verbose: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  let sport: TrackedSport = "mlb";
  let date: string | null = null;
  let apply = false;
  let launchDay = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as TrackedSport; continue; }
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--launch-day") { launchDay = true; continue; }
    if (a === "--verbose") { verbose = true; continue; }
  }
  if (date === null) {
    console.error("Usage: create-prediction-records.ts --sport mlb --date YYYY-MM-DD [--apply] [--launch-day] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, launchDay, verbose };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envEnabled = process.env.PREDICTION_RECORDS_DB_WRITES_ENABLED === "true";
  const willApply = opts.apply && envEnabled;

  console.log(`\n━━━ create-prediction-records · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`  --apply flag:                                ${opts.apply ? "YES" : "no"}`);
  console.log(`  PREDICTION_RECORDS_DB_WRITES_ENABLED:        ${envEnabled ? "true" : "missing"}`);
  console.log(`  --launch-day:                                ${opts.launchDay ? "YES" : "no"}`);
  console.log(`  mode:                                        ${willApply ? "APPLY (will UPSERT)" : "DRY-RUN (no DB writes)"}`);
  console.log("");

  const result = await createPredictionRecords({
    sport: opts.sport,
    slateDate: opts.date,
    launchDay: opts.launchDay,
    apply: willApply,
    supabase,
  });

  if (!result.tablesInitialized) {
    console.error(
      "\n✗ prediction_records table not found. Apply schema-migration-v17.sql first.",
    );
    process.exit(1);
  }

  console.log(`Games scanned:           ${result.scanned}`);
  console.log(`Proposed records:        ${result.proposed.length}`);
  console.log(`Held / skipped markets:  ${result.skippedHeld}`);
  if (result.errors.length > 0) {
    console.log(`Errors:                  ${result.errors.length}`);
    for (const e of result.errors) {
      console.log(`  game_id=${e.game_id} market=${e.market}: ${e.reason}`);
    }
  }

  console.log("\nPer-record preview:");
  console.log("  ext       matchup    market         pick    conf  play_grade        provis  best_angle");
  console.log("  " + "─".repeat(105));
  for (const r of result.proposed) {
    console.log(
      `  ${String(r.external_id).padEnd(8)}  ${r.matchup.padEnd(10)} ${r.market.padEnd(14)} ${(r.pick ?? "—").padEnd(7)} ${String(r.confidence ?? "—").padEnd(5)} ${(r.play_grade ?? "—").padEnd(17)} ${r.provisional ? "Y" : " "}     ${r.best_angle ? "★" : ""}`,
    );
  }

  if (willApply) {
    console.log(`\n✓ APPLIED — inserted: ${result.insertedCount}; existing skipped: ${result.skippedExisting}`);
  } else {
    console.log(`\nDRY-RUN — no DB writes performed.`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
