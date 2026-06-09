/**
 * Phase 7L Phase 1 — NHL lines refresh operator (CLI wrapper).
 *
 * Two-key gate: --apply + NHL_LINES_DB_WRITES_ENABLED=true.
 * SHARPAPI_KEY read from env, passed by argument to the service, never logged.
 *
 * CLI surface: --date 2026-06-09 (ET slate-date). The service treats the
 * value as ET slate_date and derives SharpAPI's UTC date(s) internally.
 */

import {
  refreshNhlLines,
  type RefreshNhlLinesResult,
} from "../../../lib/services/nhl/refreshNhlLinesService";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NHL_LINES_WRITES_ENV = "NHL_LINES_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = readStringFlag(argv, "--date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("✗ --date YYYY-MM-DD required (ET slate-date)");
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
    if (process.env[NHL_LINES_WRITES_ENV] !== "true") {
      console.error(`✗ --apply requires ${NHL_LINES_WRITES_ENV}=true in the env (two-key gate).`);
      process.exit(1);
    }
    write = true;
  }

  console.log(`[nhl-refresh-lines] mode=${write ? "WRITE" : "DRY-RUN"}  date=${date}`);
  console.log("─".repeat(70));

  let result: RefreshNhlLinesResult;
  try {
    result = await refreshNhlLines({
      slateDate: date,
      sharpApiKey: sharpKey,
      dryRun: !write,
      logger: (m) => console.log(m),
    });
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  }

  if (result.mode === "no-games") return;
  if (result.mode === "dry-run") return;

  console.log(`\n${"─".repeat(70)}`);
  console.log(`WRITE complete: ${result.linesWritten} lines, ${result.lineHistoryWritten} history, ${result.errors.length} errors.`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
