/**
 * Research-only retention lane. It is intentionally not present in
 * vercel.json and is disabled by default in cron auth until an operator has
 * separately approved the research schema and schedule.
 */
import { supabase } from "@/lib/db/supabase";
import { cronHandler } from "@/lib/cron/runCron";
import { purgeExpiredNflMarketBrainResearch } from
  "@/lib/services/football/nflMarketBrainShadowStore";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(
    request,
    "nfl_market_brain_retention",
    async () => {
      const result = await purgeExpiredNflMarketBrainResearch({ client: supabase, limit: 5_000 });
      return {
        records_updated: result.shadowsDeleted + result.artifactsDeleted + result.rawInputsDeleted,
        api_calls_made: 0,
        partial: result.capped.shadows || result.capped.artifacts || result.capped.rawInputs,
        details: {
          retention_days: { shadows: 210, prior_artifacts: 600, raw_parser_inputs: 30 },
          purge_limit_per_class: 5_000,
          result,
        },
      };
    },
    { lockMinutes: 5, requireLease: true },
  );
}
