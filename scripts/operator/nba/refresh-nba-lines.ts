/**
 * Phase 7B.1 — NBA odds/lines refresh operator (CLI wrapper).
 *
 * As of Phase 7K Service 3, the core flow lives in
 * `lib/services/nba/refreshNbaLinesService.ts` so the same logic can
 * be driven by the upcoming /api/cron/nba-daily-refresh route. This
 * file stays as a thin CLI wrapper that preserves the existing operator
 * surface:
 *
 *   • argv parsing: --date YYYY-MM-DD (required), --apply
 *   • Two-key write gate: --apply + NBA_LINES_DB_WRITES_ENABLED=true
 *   • SHARPAPI_KEY read from process.env here, then passed to the
 *     service. NEVER logged.
 *   • Banner + "WRITE/DRY-RUN complete: N lines written, N history
 *     snapshots appended, N errors." footer
 *
 * Default: DRY-RUN.
 *
 * Scope (unchanged):
 *   • Reads:  SharpAPI /odds?league=nba, our `games` + `teams` tables.
 *   • Writes: `lines` (only NBA game rows) + `line_history` (append-only).
 *             NEVER writes any other table; NEVER touches MLB rows.
 *
 * Examples:
 *   Dry-run for a date:
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-lines.ts --date 2026-06-08
 *
 *   Apply:
 *     NBA_LINES_DB_WRITES_ENABLED=true \
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-lines.ts --date 2026-06-08 --apply
 */

import {
  refreshNbaLines,
  type RefreshNbaLinesResult,
} from "../../../lib/services/nba/refreshNbaLinesService";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NBA_LINES_WRITES_ENV = "NBA_LINES_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = readStringFlag(argv, "--date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("✗ --date YYYY-MM-DD required");
    process.exit(1);
  }
  const apply = readBoolFlag(argv, "--apply");
  const sharpKey = process.env.SHARPAPI_KEY;
  if (!sharpKey) {
    console.error("✗ SHARPAPI_KEY missing from env");
    process.exit(1);
  }

  let write = false;
  if (apply) {
    if (process.env[NBA_LINES_WRITES_ENV] !== "true") {
      console.error(
        `✗ --apply requires ${NBA_LINES_WRITES_ENV}=true in the env (two-key gate).`,
      );
      process.exit(1);
    }
    write = true;
  }

  console.log(`[nba-refresh-lines] mode=${write ? "WRITE" : "DRY-RUN"}  date=${date}`);
  console.log("─".repeat(70));

  let result: RefreshNbaLinesResult;
  try {
    // CLI surface stays --date YYYY-MM-DD. The service treats the value
    // as ET slate_date (Phase 7K Fix 1): DB filter by games.slate_date,
    // SharpAPI date(s) derived internally from matched games' UTC
    // game_date column.
    result = await refreshNbaLines({
      slateDate: date,
      sharpApiKey: sharpKey,
      dryRun: !write,
      logger: (msg) => console.log(msg),
    });
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  }

  // Pre-7K early-return shapes: when there are no NBA games in DB,
  // operator printed the "(no NBA games in DB…)" line and returned
  // without a footer. When dry-run, operator printed the sample and
  // returned without a footer. The service already emitted the
  // appropriate lines via logger, so handle both here.
  if (result.mode === "no-games") {
    return;
  }
  if (result.mode === "dry-run") {
    return;
  }

  console.log(`\n─${"─".repeat(70)}`);
  console.log(
    `${write ? "WRITE" : "DRY-RUN"} complete: ${result.linesWritten} lines written, ` +
      `${result.lineHistoryWritten} line_history snapshots appended, ${result.errors.length} errors.`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
