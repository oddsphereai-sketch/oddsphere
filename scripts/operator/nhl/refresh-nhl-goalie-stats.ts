/**
 * Phase 7L Phase 1 — NHL goalie stats refresh operator (CLI wrapper).
 *
 * Two-key gate: --apply + NHL_STATS_DB_WRITES_ENABLED=true.
 * Shares the same env flag as team stats (single NHL "stats" gate).
 */

import {
  refreshNhlGoalieStats,
  type RefreshNhlGoalieStatsResult,
} from "../../../lib/services/nhl/refreshNhlGoalieStatsService";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NHL_STATS_WRITES_ENV = "NHL_STATS_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seasonRaw = readStringFlag(argv, "--season");
  if (seasonRaw === undefined) {
    console.error("✗ --season YYYY required (MoneyPuck start-year, e.g. 2025)");
    process.exit(1);
  }
  const season = Number.parseInt(seasonRaw, 10);
  if (!Number.isFinite(season) || season < 2000 || season > 2100) {
    console.error(`✗ --season must be a 4-digit year, got "${seasonRaw}"`);
    process.exit(1);
  }
  const includePlayoffs = readBoolFlag(argv, "--include-playoffs");
  const apply = readBoolFlag(argv, "--apply");

  let write = false;
  if (apply) {
    if (process.env[NHL_STATS_WRITES_ENV] !== "true") {
      console.error(`✗ --apply requires ${NHL_STATS_WRITES_ENV}=true in the env (two-key gate).`);
      process.exit(1);
    }
    write = true;
  }

  console.log(`[nhl-refresh-goalie-stats] mode=${write ? "WRITE" : "DRY-RUN"}  season=${season}  playoffs=${includePlayoffs}`);
  console.log("─".repeat(70));

  let result: RefreshNhlGoalieStatsResult;
  try {
    result = await refreshNhlGoalieStats({
      season,
      includePlayoffs,
      dryRun: !write,
      logger: (m) => console.log(m),
    });
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`${write ? "WRITE" : "DRY-RUN"} complete: ${result.written} written, ${result.errors.length} errors.`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
