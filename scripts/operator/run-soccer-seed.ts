/**
 * WC-4 Phase B operator — soccer (FIFA WC) games + teams seed.
 *
 * Read-only by default. Apply requires --apply AND the env gate
 * `SOCCER_SEED_DB_WRITES_ENABLED=true`.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/run-soccer-seed.ts \
 *     [--date YYYY-MM-DD] [--apply]
 *
 * Defaults:
 *   --date  today (UTC)
 *   --apply off — DRY-RUN
 */

import { seedSoccerGames } from "../../lib/services/soccer/seedSoccerGamesService";

const GATE_ENV = "SOCCER_SEED_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let date = new Date().toISOString().split("T")[0];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
    else if (argv[i] === "--apply") apply = true;
  }

  if (apply && process.env[GATE_ENV] !== "true") {
    console.error(`Refusing to apply: ${GATE_ENV} not set to "true". Re-run with the gate set or drop --apply.`);
    process.exit(1);
  }

  const mode = apply ? "APPLY (write)" : "DRY-RUN (read-only)";
  console.log(`\n═══ SOCCER SEED — ${new Date().toISOString()} ═══`);
  console.log(`  date=${date}  mode=${mode}\n`);

  const result = await seedSoccerGames({
    slateDate: date,
    dryRun: !apply,
    logger: (m) => console.log(m),
  });

  console.log("\n─── Summary ────────────────────────────────────────────────");
  console.log(`  mode:                       ${result.mode}`);
  console.log(`  slate_date:                 ${result.slateDate}`);
  console.log(`  events_found:               ${result.eventsFound}`);
  console.log(`  teams_attempted:            ${result.teamsAttempted}`);
  console.log(`  teams_upserted:             ${result.teamsUpserted}`);
  console.log(`  games_attempted:            ${result.gamesAttempted}`);
  console.log(`  games_upserted:             ${result.gamesUpserted}`);
  console.log(`  games_skipped_missing_team: ${result.gamesSkippedMissingTeam}`);
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
