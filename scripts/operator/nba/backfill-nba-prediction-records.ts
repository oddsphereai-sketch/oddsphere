/**
 * Phase 7H operator — one-time backfill of NBA prediction_records.
 *
 * Calls `createNbaPredictionRecords()` for a target slate date, which
 * runs the NBA daily-edge pipeline (same source members see) and
 * writes one prediction_records row per non-held market for
 * moneyline + total ONLY.
 *
 * USAGE:
 *   Dry-run (default — always run this first):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/backfill-nba-prediction-records.ts \
 *       --date 2026-06-08
 *
 *   Apply (after dry-run is clean):
 *     NBA_TRACKING_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *       scripts/operator/nba/backfill-nba-prediction-records.ts \
 *       --date 2026-06-08 --apply
 *
 * SAFETY:
 *   • Two-key gate: --apply AND NBA_TRACKING_DB_WRITES_ENABLED=true.
 *   • Dry-run by default. Prints exactly the rows that would be
 *     inserted (or skipped) without touching the DB.
 *   • Idempotent: re-running on the same slate skips rows that
 *     already exist (or are locked) — never overwrites.
 *   • Writes ONLY sport='nba'. Touches ZERO MLB rows.
 *   • Writes market='moneyline' OR 'total' — never 'first_inning'
 *     for NBA. Spread is intentionally NOT written (deferred).
 *   • Requires schema-migration-v21 applied (game_prediction_id
 *     nullable). If not yet applied, --apply will FAIL with a
 *     null-constraint violation. Dry-run still works.
 */

import process from "node:process";
import { supabase } from "../../../lib/db/supabase";
import { createNbaPredictionRecords } from "../../../lib/services/nba/buildNbaPredictionRecords";

const WRITES_ENV = "NBA_TRACKING_DB_WRITES_ENABLED";

type Args = {
  date: string;
  apply: boolean;
  launchDay: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  let date: string | null = null;
  let apply = false;
  let launchDay = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--launch-day") { launchDay = true; continue; }
  }
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(
      "Usage: backfill-nba-prediction-records.ts --date YYYY-MM-DD [--apply] [--launch-day]",
    );
    process.exit(1);
  }
  return { date, apply, launchDay };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const writesEnabled = process.env[WRITES_ENV] === "true";
  const effectiveApply = args.apply && writesEnabled;

  console.log("─".repeat(64));
  console.log(
    `[nba-tracking-backfill] date=${args.date} mode=${
      effectiveApply ? "APPLY" : "DRY-RUN"
    } launch_day=${args.launchDay}`,
  );
  if (args.apply && !writesEnabled) {
    console.log(`  ⚠️  --apply was passed but ${WRITES_ENV}=true is missing — staying in DRY-RUN.`);
  }
  console.log("─".repeat(64));

  const result = await createNbaPredictionRecords({
    slateDate: args.date,
    apply: effectiveApply,
    launchDay: args.launchDay,
    supabase,
  });

  console.log(`Scanned ${result.scanned} NBA games on ${args.date}.`);
  console.log(`  Proposed rows:    ${result.proposed.length}`);
  console.log(`    Would insert:   ${result.proposed.filter((p) => p.wouldInsert).length}`);
  console.log(`    Already exists: ${result.skippedExisting}`);
  console.log(`    Already locked: ${result.skippedLocked}`);
  console.log(`    Held (no pick): ${result.skippedHeld}`);
  console.log(`  Errors:           ${result.errors.length}`);

  if (result.proposed.length > 0) {
    console.log("");
    console.log("Per-row preview:");
    for (const p of result.proposed) {
      const line = p.line_value !== null ? ` line=${p.line_value}` : "";
      const lockNote = p.locked_at !== null ? ` [LOCKED:${p.locked_at}]` : "";
      const skipNote = p.reason_if_skipped ? ` — ${p.reason_if_skipped}` : "";
      const action = p.wouldInsert ? "  + INSERT" : "  • SKIP  ";
      console.log(
        `${action} game=${p.matchup} ext=${p.external_id} market=${p.market} pick=${p.pick}${line} odds=${p.odds_american ?? "?"} conf=${p.confidence?.toFixed?.(1) ?? "?"} grade=${p.play_grade} best_angle=${p.best_angle}${lockNote}${skipNote}`,
      );
    }
  }

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const e of result.errors) {
      console.log(`  ✗ game_id=${e.game_id ?? "?"} market=${e.market}: ${e.reason}`);
    }
  }

  if (effectiveApply) {
    console.log("");
    console.log(`✅ Apply complete: ${result.insertedCount} row(s) inserted.`);
  } else {
    console.log("");
    console.log(`Dry-run only — no writes performed. Re-run with --apply ${WRITES_ENV}=true to write.`);
  }
}

main().catch((e) => {
  console.error("[nba-tracking-backfill] fatal:", e);
  process.exit(1);
});
