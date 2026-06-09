/**
 * Phase 7B.1 — NBA team ratings refresh operator (CLI wrapper).
 *
 * As of Phase 7K Service 2, the core flow lives in
 * `lib/services/nba/refreshNbaTeamRatingsService.ts` so the same logic
 * can be driven by the upcoming /api/cron/nba-daily-refresh route. This
 * file stays as a thin CLI wrapper that preserves the existing operator
 * surface:
 *
 *   • argv parsing: --season YYYY (required), --include-playoffs, --apply
 *   • Two-key write gate: --apply + NBA_RATINGS_DB_WRITES_ENABLED=true
 *   • Banner + "WRITE/DRY-RUN complete: N written, N errors." footer
 *
 * Default: DRY-RUN.
 *
 * Scope (unchanged):
 *   • Reads:  BBR public HTML pages, our `teams` table (sport='nba').
 *   • Writes: `nba_team_ratings`. NEVER writes any other table.
 *
 * Examples:
 *   Dry-run season 2026:
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-team-ratings.ts --season 2026
 *
 *   Apply season 2026 + playoffs:
 *     NBA_RATINGS_DB_WRITES_ENABLED=true \
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-team-ratings.ts \
 *       --season 2026 --include-playoffs --apply
 */

import {
  refreshNbaTeamRatings,
  type RefreshNbaTeamRatingsResult,
} from "../../../lib/services/nba/refreshNbaTeamRatingsService";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NBA_RATINGS_WRITES_ENV = "NBA_RATINGS_DB_WRITES_ENABLED";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seasonRaw = readStringFlag(argv, "--season");
  if (seasonRaw === undefined) {
    console.error("✗ --season YYYY required (e.g. --season 2026)");
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
    if (process.env[NBA_RATINGS_WRITES_ENV] !== "true") {
      console.error(
        `✗ --apply requires ${NBA_RATINGS_WRITES_ENV}=true in the env (two-key gate).`,
      );
      process.exit(1);
    }
    write = true;
  }

  console.log(
    `[nba-refresh-ratings] mode=${write ? "WRITE" : "DRY-RUN"}  season=${season}  playoffs=${includePlayoffs}`,
  );
  console.log("─".repeat(70));

  let result: RefreshNbaTeamRatingsResult;
  try {
    result = await refreshNbaTeamRatings({
      season,
      includePlayoffs,
      dryRun: !write,
      logger: (msg) => console.log(msg),
    });
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  }

  if (result.mode === "no-teams") {
    console.error("✗ No NBA teams in DB — run seed-nba-finals.ts first.");
    process.exit(1);
  }

  console.log(`\n─${"─".repeat(70)}`);
  console.log(
    `${write ? "WRITE" : "DRY-RUN"} complete: ${result.written} written, ${result.errors.length} errors.`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
