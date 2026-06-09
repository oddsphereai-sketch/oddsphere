/**
 * Phase 7L Phase 4 — NHL prediction_records writer operator (CLI wrapper).
 *
 * Two-key gate: --apply + NHL_PREDICTIONS_DB_WRITES_ENABLED=true.
 *
 * Dry-run (today, default season):
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/nhl/write-nhl-prediction-records.ts \
 *     --date 2026-06-09 --season 2025
 *
 * Apply with manual goalies:
 *   NHL_PREDICTIONS_DB_WRITES_ENABLED=true \
 *     npx tsx --env-file=.env.local \
 *     scripts/operator/nhl/write-nhl-prediction-records.ts \
 *     --date 2026-06-09 --season 2025 \
 *     --home-goalie 8479394 --away-goalie 8475883 --apply
 */

import {
  writeNhlPredictionRecords,
  type WriteNhlRecordsResult,
} from "../../../lib/services/nhl/buildNhlPredictionRecords";
import { computeSlateDate } from "../../../lib/dates/slateDate";
import { readBoolFlag, readStringFlag, readNumberFlag } from "../_cliCommon";

const NHL_PREDS_WRITES_ENV = "NHL_PREDICTIONS_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seasonRaw = readStringFlag(argv, "--season");
  if (seasonRaw === undefined) {
    console.error("✗ --season YYYY required (e.g. 2025 for 2025-26)");
    process.exit(1);
  }
  const season = Number.parseInt(seasonRaw, 10);
  const slateDate = readStringFlag(argv, "--date") ?? computeSlateDate("nhl", new Date());
  const homeGoalieExternalId = readNumberFlag(argv, "--home-goalie");
  const awayGoalieExternalId = readNumberFlag(argv, "--away-goalie");
  const apply = readBoolFlag(argv, "--apply");

  let write = false;
  if (apply) {
    if (process.env[NHL_PREDS_WRITES_ENV] !== "true") {
      console.error(`✗ --apply requires ${NHL_PREDS_WRITES_ENV}=true in the env (two-key gate).`);
      process.exit(1);
    }
    write = true;
  }

  const goalieSource = (homeGoalieExternalId !== undefined || awayGoalieExternalId !== undefined)
    ? "manual_override"
    : "default_most_playoff_gp";

  console.log(`[nhl-write-prediction-records] mode=${write ? "WRITE" : "DRY-RUN"}  date=${slateDate}  season=${season}  goalie_source=${goalieSource}`);
  console.log("─".repeat(70));

  let result: WriteNhlRecordsResult;
  try {
    result = await writeNhlPredictionRecords({
      slateDate,
      season,
      apply: write,
      homeGoalieExternalId,
      awayGoalieExternalId,
      goalieSource,
      logger: (m) => console.log(m),
    });
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`${write ? "WRITE" : "DRY-RUN"} complete:`);
  console.log(`  games_processed:       ${result.gamesProcessed}`);
  console.log(`  records_created:       ${result.recordsCreated}`);
  console.log(`  records_skipped_locked: ${result.recordsSkippedLocked}`);
  console.log(`  records_skipped_pass:   ${result.recordsSkippedPass}`);
  console.log(`  errors:                ${result.errors.length}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
