/**
 * Phase 7B.1 — NBA Finals seeding operator (CLI wrapper).
 *
 * As of Phase 7K Service 1, the core seeding logic lives in
 * `lib/services/nba/seedNbaGamesService.ts` so the same flow can be
 * driven by the upcoming /api/cron/nba-daily-refresh route. This file
 * stays as a thin CLI wrapper that preserves the existing operator
 * surface:
 *
 *   • argv parsing: --apply, --date YYYYMMDD, --include-prior-days N,
 *                   --yes (skip interactive prompt)
 *   • Two-key write gate: --apply + NBA_DB_WRITES_ENABLED=true
 *   • Interactive readline y/N confirm (unless --yes)
 *   • Banner + "WRITE complete." / "DRY-RUN complete." footer
 *
 * Default: DRY-RUN. Operator-only; not wired into any cron.
 *
 * Scope (unchanged):
 *   • Reads:  ESPN public scoreboard, our `teams`/`games` tables.
 *   • Writes: `teams` (sport='nba'), `games` (sport='nba').
 *             NEVER writes any MLB row. NEVER writes prediction_records /
 *             tracking / lines / nba_team_ratings.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  seedNbaGames,
  type SeedNbaGamesResult,
} from "../../../lib/services/nba/seedNbaGamesService";
import type { CanonicalNbaEvent } from "../../../lib/providers/real_api/_espnNbaScoreboardClient";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NBA_DB_WRITES_ENV = "NBA_DB_WRITES_ENABLED";

async function confirmApply(events: CanonicalNbaEvent[]): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const lines = events
      .map(
        (e) =>
          `    • ${e.away.abbreviation}@${e.home.abbreviation}  ` +
          `start=${e.start_time}  status=${e.status_label}  ` +
          `${e.postseason_note ?? ""}`,
      )
      .join("\n");
    const ans = await rl.question(
      `\nAbout to upsert NBA teams + games into DB (sport='nba'):\n${lines}\n\n` +
        `  Two-key gate: --apply + ${NBA_DB_WRITES_ENV}=true.\n` +
        `  Idempotent: re-running produces identical state.\n` +
        `  NEVER writes MLB rows; NEVER writes ratings/lines/predictions.\n` +
        `\n  Continue? [y/N]: `,
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = readBoolFlag(argv, "--apply");
  const dateOverride = readStringFlag(argv, "--date");
  const includePriorDays = Number.parseInt(
    readStringFlag(argv, "--include-prior-days") ?? "0",
    10,
  );
  const skipPrompt = readBoolFlag(argv, "--yes");

  let write = false;
  if (apply) {
    if (process.env[NBA_DB_WRITES_ENV] !== "true") {
      console.error(
        `✗ --apply requires ${NBA_DB_WRITES_ENV}=true in the env (two-key gate).`,
      );
      process.exit(1);
    }
    write = true;
  }

  console.log(
    `[nba-seed-finals] mode=${write ? "WRITE" : "DRY-RUN"}  date_override=${dateOverride ?? "today"}  prior_days=${includePriorDays}`,
  );
  console.log("─".repeat(70));

  let result: SeedNbaGamesResult;
  try {
    result = await seedNbaGames({
      dryRun: !write,
      dateOverride,
      includePriorDays,
      logger: (msg) => console.log(msg),
      // Operator interactive prompt — only when writing AND --yes not set.
      confirmBeforeWrite: write && !skipPrompt ? confirmApply : undefined,
    });
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  }

  if (result.mode === "no-events" || result.mode === "cancelled") {
    // Pre-7K early-return shape: when the scoreboard had no events, the
    // operator exited right after the "(no NBA events visible…)" line
    // with no footer. When confirm returned false, it printed
    // "Cancelled. No writes performed." and exited. The service already
    // emitted the appropriate one-liner via logger, so nothing else to
    // print here.
    return;
  }
  console.log("\n─".repeat(70));
  console.log(write ? "WRITE complete." : "DRY-RUN complete (no DB writes).");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
