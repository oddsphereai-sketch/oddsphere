/**
 * Public-splits observation refresh cron — dual-source Phase 1 FRESHNESS.
 *
 * Keeps `public_splits_observations` fresh so the Phase 2 resolved read can
 * display Playbook-preferred splits without going stale (resolver staleness
 * threshold = 15 min). Runs every 15 minutes.
 *
 * ADDITIVE / SAFE:
 *   • Writes ONLY public_splits_observations (mirror sharp_signals -> sharpapi
 *     for MLB + fetch Playbook -> playbook). Touches NO other table, cron, UI,
 *     grade, model, or the automodel files.
 *   • Graceful no-op if the table isn't applied (schema-migration-v25.sql).
 *   • Gate: PUBLIC_SPLITS_OBSERVATIONS_ENABLED=true. Default OFF so the Vercel
 *     cron entry can land without firing any write until explicitly enabled.
 *   • MLB + WNBA current ET slate, live Playbook /splits.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { syncPublicSplitsObservations } from "@/lib/services/syncPublicSplitsObservations";
import { currentSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";

const ENV = "PUBLIC_SPLITS_OBSERVATIONS_ENABLED";
const SPORTS: Sport[] = ["mlb", "wnba"];

export async function GET(request: Request): Promise<Response> {
  return cronHandler(
    request,
    "public_splits_observations_refresh",
    async () => {
      if (process.env[ENV] !== "true") {
        return { records_updated: 0, details: { disabled: true, reason: `${ENV}!=true` } };
      }
      let upserted = 0;
      const errors: string[] = [];
      const details: Record<string, unknown> = {};
      for (const sport of SPORTS) {
        // Current ET slate, live Playbook /splits (todayUtc=slate -> live path).
        const slate = currentSlateDate(sport);
        try {
          const r = await syncPublicSplitsObservations({
            supabase, sport, slateDate: slate, apply: true, todayUtc: slate,
          });
          upserted += r.upserted;
          if (r.skippedTableMissing) errors.push(`${sport} ${slate}: table not applied`);
          errors.push(...r.errors);
          details[`${sport}_${slate}`] = { sharpapi: r.sharpapiRows, playbook: r.playbookRows, upserted: r.upserted };
        } catch (e) {
          errors.push(`${sport} ${slate}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (errors.length) details.errors = errors.slice(0, 20);
      return { records_updated: upserted, partial: errors.length > 0, details };
    },
    { sport: "mlb" },
  );
}
