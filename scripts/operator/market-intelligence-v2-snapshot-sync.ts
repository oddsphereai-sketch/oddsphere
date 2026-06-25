/**
 * Market Intelligence v2 shadow snapshot sync.
 *
 * Dry-run by default. Write mode requires BOTH:
 *   --write
 *   MARKET_INTELLIGENCE_V2_ENABLED=true
 *
 * Writes only to market_intelligence_snapshots_v2. It does not touch Daily
 * Edge, prediction records, grades, slates, lines, or sharp_signals.
 */

import { supabase } from "../../lib/db/supabase";
import { syncMarketIntelligenceV2Snapshots } from "../../lib/services/marketIntelligenceV2/snapshotSync";
import type { Sport } from "../../lib/types/domain/Sport";
import { readBoolFlag, readStringFlag, todayUTC } from "./_cliCommon";

const WRITE_ENV = "MARKET_INTELLIGENCE_V2_ENABLED";

function parseSport(raw: string | undefined): Sport {
  const sport = (raw ?? "mlb").toLowerCase();
  if (sport === "mlb" || sport === "wnba" || sport === "nba" || sport === "nhl" || sport === "nfl" || sport === "cfb" || sport === "cbb" || sport === "soccer" || sport === "ucl") {
    return sport as Sport;
  }
  throw new Error(`Invalid --sport ${raw}.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sport = parseSport(readStringFlag(argv, "--sport"));
  const slateDate = readStringFlag(argv, "--date") ?? todayUTC();
  const write = readBoolFlag(argv, "--write");
  const json = readBoolFlag(argv, "--json");

  if (write && process.env[WRITE_ENV] !== "true") {
    console.error(`✗ --write requires ${WRITE_ENV}=true in the environment.`);
    process.exit(1);
  }

  if (!json) {
    console.log(`[market-intelligence-v2-snapshot-sync] mode=${write ? "APPLY" : "DRY-RUN"} sport=${sport} date=${slateDate}`);
  }

  const report = await syncMarketIntelligenceV2Snapshots({
    supabase,
    sport,
    slateDate,
    apply: write,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log();
    console.log(`candidates=${report.candidates}`);
    console.log(`snapshotsBuilt=${report.snapshotsBuilt}`);
    console.log(`snapshotsWritten=${report.snapshotsWritten}`);
    console.log(`tableMissing=${report.skippedTableMissing}`);
    console.log(`labels=${JSON.stringify(report.labelCounts)}`);
    if (report.errors.length > 0) {
      console.log("errors:");
      for (const e of report.errors) console.log(`  - ${e}`);
    }
  }

  process.exit(report.errors.length > 0 && write ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
