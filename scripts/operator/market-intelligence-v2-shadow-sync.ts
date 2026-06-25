/**
 * Market Intelligence v2 shadow sync.
 *
 * Dry-run by default. Write mode requires BOTH:
 *   --write
 *   MARKET_INTELLIGENCE_V2_ENABLED=true
 *
 * Writes only to v2 shadow tables from schema-migration-v26. It never touches
 * sharp_signals, lines, line_history, game_predictions, prediction_records,
 * grades, slates, or Daily Edge DTOs.
 */

import { supabase } from "../../lib/db/supabase";
import { syncMarketIntelligenceV2Shadow } from "../../lib/services/marketIntelligenceV2/shadowSync";
import type { Sport } from "../../lib/types/domain/Sport";
import {
  readBoolFlag,
  readStringFlag,
  todayUTC,
} from "./_cliCommon";

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
    console.error(
      `✗ --write requires ${WRITE_ENV}=true in the environment.\n` +
        "  This command writes only shadow v2 tables, but still requires an explicit gate.",
    );
    process.exit(1);
  }

  if (!json) {
    console.log(
      `[market-intelligence-v2-shadow-sync] mode=${write ? "APPLY" : "DRY-RUN"} sport=${sport} date=${slateDate}`,
    );
  }

  const report = await syncMarketIntelligenceV2Shadow({
    supabase,
    sport,
    slateDate,
    apply: write,
    todayUtc: todayUTC(),
    logger: json ? undefined : (m) => console.log(`  ${m}`),
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log();
    console.log(`games=${report.gamesLoaded}`);
    console.log(`playbookRows=${report.playbookSplitRowsFetched} sharpapiRows=${report.sharpapiSplitRowsFetched}`);
    console.log(`splitBuilt=${report.splitObservationsBuilt} priceBuilt=${report.priceObservationsBuilt}`);
    console.log(`splitWritten=${report.splitObservationsWritten} priceWritten=${report.priceObservationsWritten}`);
    console.log(`rejected=${report.rejected.length} tableMissing=${report.skippedTableMissing}`);
    if (report.errors.length > 0) {
      console.log("errors:");
      for (const e of report.errors) console.log(`  - ${e}`);
    }
    if (report.rejected.length > 0) {
      console.log("sample rejected:");
      for (const r of report.rejected.slice(0, 8)) {
        console.log(`  - ${r.provider} ${r.provider_event_id ?? "-"} ${r.market_type ?? "-"}: ${r.reason}`);
      }
    }
  }

  process.exit(report.errors.length > 0 && write ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
