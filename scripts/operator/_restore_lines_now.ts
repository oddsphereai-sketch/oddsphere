/**
 * One-shot operator restore for today's MLB lines, using the same
 * refreshGameLinesV2 path the production cron uses. Restores prices
 * for games the buggy pregame-sweep V1 just wiped, without waiting
 * for the next scheduled slate-cycle.
 *
 * Pure delegation — no model math, no prediction mutation, no lock
 * touches. Calls refreshGameLinesV2 which:
 *   • only DELETEs (game_id, market_type) pairs the provider returned
 *     rows for
 *   • preserves rows for any (game, market) the provider didn't return
 *
 * Usage:
 *   ODDS_PROVIDER=real_api npx tsx --env-file=.env.local scripts/operator/_restore_lines_now.ts
 */
import { linesService } from "../../lib/services/linesService";

async function main() {
  if (process.env.ODDS_PROVIDER !== "real_api") {
    console.error("Set ODDS_PROVIDER=real_api inline. Aborting.");
    process.exit(1);
  }
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  console.log(`\n=== refreshGameLinesV2 sport=mlb date=${date} ===\n`);
  const res = await linesService.refreshGameLinesV2("mlb", date);
  console.log(`records_updated: ${res.records_updated}`);
  console.log(`api_calls_made:  ${res.api_calls_made}`);
  console.log(`details:`);
  console.log(JSON.stringify(res.details, null, 2));
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
