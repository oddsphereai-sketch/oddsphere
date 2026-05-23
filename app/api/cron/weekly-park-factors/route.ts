/**
 * /api/cron/weekly-park-factors — runs Mondays 4am ET / 9am UTC.
 *
 * Refresh ballpark park factors. V1 uses MockParkFactorProvider which
 * returns the seeded values; Phase 7 wires the real FanGraphs scraper.
 *
 * Single-shot (no per-sport iteration) — park factors are MLB-only.
 * Updates ballparks table by matching team_abbreviation → team_id →
 * ballpark.id and UPDATEs the factor columns in place.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { getParkFactorProvider } from "@/lib/providers/factory";

export const maxDuration = 60;

export async function GET(request: Request) {
  return cronHandler(
    request,
    "weekly_park_factors",
    async () => {
      const provider = getParkFactorProvider();
      const factors = await provider.getParkFactors();

      // Look up team_id by abbreviation → ballpark_id
      const abbrs = factors.map((f) => f.team_abbreviation);
      const { data: teams } = await supabase
        .from("teams")
        .select("id, abbreviation")
        .in("abbreviation", abbrs);

      const teamIdByAbbr = new Map<string, number>(
        ((teams ?? []) as { id: number; abbreviation: string }[]).map((t) => [
          t.abbreviation,
          t.id,
        ])
      );

      let updated = 0;
      for (const f of factors) {
        const teamId = teamIdByAbbr.get(f.team_abbreviation);
        if (teamId === undefined) continue;
        const { error } = await supabase
          .from("ballparks")
          .update({
            park_factor_runs: f.park_factor_runs,
            park_factor_hr: f.park_factor_hr,
            park_factor_hits: f.park_factor_hits,
            park_factor_so: f.park_factor_so,
            park_factor_handedness_lhh: f.park_factor_handedness_lhh,
            park_factor_handedness_rhh: f.park_factor_handedness_rhh,
          })
          .eq("team_id", teamId);
        if (!error) updated++;
      }

      return {
        records_updated: updated,
        api_calls_made: 1,
        details: {
          factors_received: factors.length,
          ballparks_updated: updated,
        },
      };
    },
    { sport: null }
  );
}

export const POST = GET;
