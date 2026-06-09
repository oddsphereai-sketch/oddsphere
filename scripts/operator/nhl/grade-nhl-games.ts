/**
 * Phase 7L Phase 4 — NHL grading operator (CLI wrapper).
 *
 * Two steps in one operator:
 *   1. Ingest final scores from NHL API for the requested slate.
 *   2. Grade any ungraded NHL prediction_records whose game is now FINAL.
 *
 * Two-key gate for writes: --apply + NHL_GRADING_DB_WRITES_ENABLED=true.
 * Both steps are guarded together (single gate; both write to safe
 * tables — games.{status,scores} and prediction_grades).
 *
 *   Dry-run (today):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nhl/grade-nhl-games.ts --date 2026-06-09
 *
 *   Apply:
 *     NHL_GRADING_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/nhl/grade-nhl-games.ts --date 2026-06-09 --apply
 */

import {
  ingestNhlFinalScores,
  type IngestNhlScoresResult,
} from "../../../lib/services/nhl/nhlScoreIngestService";
import {
  gradeNhlPredictions,
  type GradeNhlResult,
} from "../../../lib/services/nhl/gradeNhlPredictions";
import { computeSlateDate } from "../../../lib/dates/slateDate";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NHL_GRADING_WRITES_ENV = "NHL_GRADING_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slateDate = readStringFlag(argv, "--date") ?? computeSlateDate("nhl", new Date());
  const apply = readBoolFlag(argv, "--apply");

  let write = false;
  if (apply) {
    if (process.env[NHL_GRADING_WRITES_ENV] !== "true") {
      console.error(`✗ --apply requires ${NHL_GRADING_WRITES_ENV}=true in the env (two-key gate).`);
      process.exit(1);
    }
    write = true;
  }

  console.log(`[nhl-grade] mode=${write ? "WRITE" : "DRY-RUN"}  date=${slateDate}`);
  console.log("─".repeat(70));

  console.log("\n▶ Step 1 — ingest NHL final scores");
  let scoreResult: IngestNhlScoresResult;
  try {
    scoreResult = await ingestNhlFinalScores({
      slateDate,
      apply: write,
      logger: (m) => console.log(m),
    });
  } catch (e) {
    console.error("Fatal in score ingest:", e);
    process.exit(1);
  }
  console.log(`Score ingest: games=${scoreResult.gamesInDb} api_events=${scoreResult.apiEventsFetched} matched=${scoreResult.matched} updated=${scoreResult.updated} finalized=${scoreResult.finalizedCount}`);

  console.log("\n▶ Step 2 — grade NHL prediction_records");
  let gradeResult: GradeNhlResult;
  try {
    gradeResult = await gradeNhlPredictions({
      slateDate,
      apply: write,
      logger: (m) => console.log(m),
    });
  } catch (e) {
    console.error("Fatal in grading:", e);
    process.exit(1);
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`${write ? "WRITE" : "DRY-RUN"} complete:`);
  console.log(`  scores_updated:        ${scoreResult.updated}`);
  console.log(`  games_finalized:       ${scoreResult.finalizedCount}`);
  console.log(`  records_ungraded:      ${gradeResult.pending}`);
  console.log(`  final_games_available: ${gradeResult.finalGamesAvailable}`);
  console.log(`  grades_written:        ${gradeResult.graded}`);
  console.log(`  errors:                ${scoreResult.errors.length + gradeResult.errors.length}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
