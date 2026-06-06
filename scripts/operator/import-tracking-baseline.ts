/**
 * Push 4 operator — import legacy tracking CSV into tracking_baselines.
 *
 * USAGE:
 *   Dry-run (default — no DB writes):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/import-tracking-baseline.ts \
 *       --file data/oddsphere_tracking_updated_6_2_26.csv
 *
 *   Apply:
 *     TRACKING_BASELINE_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/import-tracking-baseline.ts \
 *       --file data/oddsphere_tracking_updated_6_2_26.csv --apply
 *
 * Two-key gate. Idempotent on (source_label, imported_from). NEVER
 * writes to prediction_records or prediction_grades.
 *
 * If `tracking_baselines` doesn't exist (migration v17 not applied),
 * the script reports cleanly and exits 1.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseTrackingBaselineCsv } from "../../lib/services/trackingBaselineImport";
import { supabase } from "../../lib/db/supabase";

type Args = { file: string; apply: boolean; verbose: boolean };

function parseArgs(argv: readonly string[]): Args {
  let file = "data/oddsphere_tracking_updated_6_2_26.csv";
  let apply = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) { file = argv[++i]!; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--verbose" || a === "-v") { verbose = true; continue; }
  }
  return { file, apply, verbose };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envEnabled = process.env.TRACKING_BASELINE_DB_WRITES_ENABLED === "true";
  const willApply = opts.apply && envEnabled;

  const absPath = path.isAbsolute(opts.file) ? opts.file : path.resolve(opts.file);
  console.log(`\n━━━ import-tracking-baseline ━━━`);
  console.log(`  file:                                        ${absPath}`);
  console.log(`  --apply flag:                                ${opts.apply ? "YES" : "no"}`);
  console.log(`  TRACKING_BASELINE_DB_WRITES_ENABLED:         ${envEnabled ? "true" : "missing"}`);
  console.log(`  mode:                                        ${willApply ? "APPLY (will UPSERT)" : "DRY-RUN (no DB writes)"}`);
  if (opts.apply && !envEnabled) {
    console.warn(`  ⚠ --apply was set but TRACKING_BASELINE_DB_WRITES_ENABLED is missing — forcing dry-run.`);
  }
  console.log("");

  if (!fs.existsSync(absPath)) {
    console.error(`✗ file not found: ${absPath}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(absPath, "utf-8");
  const importedFrom = path.basename(absPath);
  const { rows, errors } = parseTrackingBaselineCsv(csvText, importedFrom);

  console.log(`Parsed rows: ${rows.length}`);
  if (errors.length > 0) {
    console.log(`Parse errors: ${errors.length}`);
    for (const e of errors) {
      console.log(`  line ${e.line}: ${e.reason}  (raw: "${e.raw}")`);
    }
  }
  if (rows.length === 0) {
    console.error("✗ no rows parsed — abort");
    process.exit(1);
  }

  console.log("\nPer-row preview:");
  console.log("  sport  market         label                          lifetime           season           weekly");
  console.log("  " + "─".repeat(110));
  for (const r of rows) {
    const lt = `${r.lifetime_wins}/${r.lifetime_total} (${r.lifetime_pct.toFixed(1)}%)`;
    const cs =
      r.current_season_wins !== null && r.current_season_total !== null
        ? `${r.current_season_wins}/${r.current_season_total} (${(r.current_season_pct ?? 0).toFixed(1)}%)`
        : "—";
    const wk =
      r.weekly_wins !== null && r.weekly_total !== null
        ? `${r.weekly_wins}/${r.weekly_total} (${(r.weekly_pct ?? 0).toFixed(1)}%)`
        : "—";
    console.log(
      `  ${r.sport.padEnd(6)} ${r.market.padEnd(14)} ${r.source_label.padEnd(30)} ${lt.padEnd(18)} ${cs.padEnd(16)} ${wk}`,
    );
  }

  if (!willApply) {
    console.log("\nDRY-RUN — no DB writes performed.");
    return;
  }

  // Probe table existence first — surfaces v17 migration unapplied
  const probe = await supabase
    .from("tracking_baselines")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (
    probe.error &&
    /relation .* does not exist|could not find the table/i.test(probe.error.message)
  ) {
    console.error(
      "\n✗ tracking_baselines table not found. Apply schema-migration-v17.sql first.",
    );
    process.exit(1);
  }

  console.log("\nUpserting baselines…");
  const { error: upErr, data: upData } = await supabase
    .from("tracking_baselines")
    .upsert(rows, {
      onConflict: "source_label,imported_from",
      ignoreDuplicates: false,
    })
    .select("id, source_label");
  if (upErr) {
    console.error(`✗ upsert failed: ${upErr.message}`);
    process.exit(1);
  }
  console.log(`✓ APPLIED — ${upData?.length ?? 0} rows upserted.`);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
