/**
 * Phase 7L Phase 1 — NHL games seeding operator (CLI wrapper).
 *
 * Two-key gate: --apply + NHL_DB_WRITES_ENABLED=true.
 *
 *   Dry-run (today):
 *     npx tsx --env-file=.env.local scripts/operator/nhl/seed-nhl-games.ts
 *
 *   Apply (specific date):
 *     NHL_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local scripts/operator/nhl/seed-nhl-games.ts \
 *       --date 2026-06-09 --apply --yes
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  seedNhlGames,
  type SeedNhlGamesResult,
} from "../../../lib/services/nhl/seedNhlGamesService";
import type { CanonicalNhlEvent } from "../../../lib/providers/nhl/_nhlApiClient";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NHL_WRITES_ENV = "NHL_DB_WRITES_ENABLED";

async function confirmApply(events: CanonicalNhlEvent[]): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const lines = events.map((e) =>
      `    • ${e.away.abbreviation}@${e.home.abbreviation}  start=${e.start_time}  state=${e.game_state}  ${e.series ? `${e.series.series_abbrev}-G${e.series.game_number_in_series}` : ""}`,
    ).join("\n");
    const ans = await rl.question(
      `\nAbout to upsert NHL teams + games into DB (sport='nhl'):\n${lines}\n\n` +
        `  Two-key gate: --apply + ${NHL_WRITES_ENV}=true.\n` +
        `  Idempotent: re-running produces identical state.\n` +
        `  NEVER writes MLB/NBA rows.\n` +
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
  const slateDate = readStringFlag(argv, "--date");
  const skipPrompt = readBoolFlag(argv, "--yes");

  let write = false;
  if (apply) {
    if (process.env[NHL_WRITES_ENV] !== "true") {
      console.error(`✗ --apply requires ${NHL_WRITES_ENV}=true in the env (two-key gate).`);
      process.exit(1);
    }
    write = true;
  }

  console.log(`[nhl-seed-games] mode=${write ? "WRITE" : "DRY-RUN"}  date=${slateDate ?? "today(ET)"}`);
  console.log("─".repeat(70));

  let result: SeedNhlGamesResult;
  try {
    result = await seedNhlGames({
      dryRun: !write,
      slateDate,
      logger: (m) => console.log(m),
      confirmBeforeWrite: write && !skipPrompt ? confirmApply : undefined,
    });
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  }

  if (result.mode === "no-events" || result.mode === "cancelled") return;
  console.log(`\n${"─".repeat(70)}`);
  console.log(`${write ? "WRITE" : "DRY-RUN"} complete: events=${result.eventsFound} teams_upserted=${result.teamsUpserted} games_upserted=${result.gamesUpserted} skipped=${result.gamesSkippedMissingTeam} errors=${result.errors.length}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
