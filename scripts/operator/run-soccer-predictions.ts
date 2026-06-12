/**
 * WC-4 Phase C operator — soccer prediction_records writer.
 *
 * Reads internal `games` rows (sport='soccer'), fetches live BDL +
 * SharpAPI inputs, runs the WC-3 auto-model, and emits / upserts
 * `prediction_records` rows. Honors locked rows. Held rows are
 * included so the Daily Edge card can render the fixture and its
 * hold reasons honestly.
 *
 * Two-key gate: --apply flag + SOCCER_PREDICTIONS_DB_WRITES_ENABLED=true
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/run-soccer-predictions.ts \
 *     [--date YYYY-MM-DD] [--game-id N] [--apply]
 *
 * Defaults:
 *   --date     today (UTC)
 *   --game-id  all soccer fixtures on the slate
 *   --apply    off — DRY-RUN
 *
 * --game-id is the surgical operator flag: only that single internal
 * games.id is touched; every other fixture on the slate (including
 * in_progress fixtures whose locked_at hasn't been stamped) is left
 * unchanged. Use this when a pre-T60 fixture needs a model refresh
 * but other fixtures must not be rewritten.
 */

import { writeSoccerPredictionRecords } from "../../lib/services/soccer/writeSoccerPredictionRecords";

const GATE_ENV = "SOCCER_PREDICTIONS_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let date = new Date().toISOString().split("T")[0];
  let apply = false;
  let gameId: number | undefined = undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
    else if (argv[i] === "--game-id" && argv[i + 1]) {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) gameId = v;
      else { console.error(`Invalid --game-id value: ${argv[i]}`); process.exit(2); }
    }
    else if (argv[i] === "--apply") apply = true;
  }

  if (apply && process.env[GATE_ENV] !== "true") {
    console.error(`Refusing to apply: ${GATE_ENV} not set to "true". Re-run with the gate set or drop --apply.`);
    process.exit(1);
  }

  const mode = apply ? "APPLY (write)" : "DRY-RUN (read-only)";
  console.log(`\n═══ SOCCER PREDICTIONS — ${new Date().toISOString()} ═══`);
  console.log(`  date=${date}  game_id=${gameId ?? "(all)"}  mode=${mode}\n`);

  const result = await writeSoccerPredictionRecords({
    slateDate: date,
    apply,
    gameId,
    logger: (m) => console.log(m),
  });

  console.log("\n─── Summary ────────────────────────────────────────────────");
  console.log(`  mode:                       ${result.mode}`);
  console.log(`  games_processed:            ${result.gamesProcessed}`);
  console.log(`  fixtures_matched_sharp:     ${result.fixturesMatched}`);
  console.log(`  fixtures_unmatched_sharp:   ${result.fixturesUnmatched}`);
  console.log(`  records_created_or_dryrun:  ${result.recordsCreated}`);
  console.log(`  records_skipped_locked:     ${result.recordsSkippedLocked}`);
  console.log(`  errors:                     ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) console.log(`    - ${e}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
