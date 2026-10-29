/**
 * CBB launch candidate route. It only seeds canonical fixtures in this
 * revision; forecast, grades, member publication, locks and tracking remain
 * unavailable until the complete CBB release is qualified together.
 */
import { cronHandler } from "@/lib/cron/runCron";
import { currentSlateDate } from "@/lib/dates/slateDate";
import { CBB_FIXTURE_SEED_RELEASE, cbbFixtureSeedDates, seedCbbGames } from "@/lib/services/cbb/seedCbbGamesService";
import { fetchCbbTeamIdentities } from "@/lib/services/cbb/fetchCbbTeamIdentities";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "cbb_daily_refresh", async () => {
    if (process.env.CBB_CRON_ENABLED !== "true") {
      return { records_updated: 0, details: { disabled: true, release: CBB_FIXTURE_SEED_RELEASE } };
    }
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) throw new Error("BALLDONTLIE_API_KEY missing for CBB fixture seed");
    const now = new Date();
    const today = currentSlateDate("cbb", now);
    const season = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const dates = cbbFixtureSeedDates(today);
    const seeded = [];
    for (const slateDate of dates) {
      seeded.push(await seedCbbGames({ slateDate, season, apiKey, dryRun: false,
        identityFetcher: fetchCbbTeamIdentities }));
    }
    return {
      records_updated: seeded.reduce((sum, row) => sum + (row.written ? row.games + row.teams : 0), 0),
      api_calls_made: seeded.reduce((sum, row) => sum + row.providerCalls + (row.games ? 2 : 0), 0),
      details: { release: CBB_FIXTURE_SEED_RELEASE, seeded, predictionPublication: false },
    };
  }, { sport: "cbb", leaseGroup: "prediction_pipeline", requireLease: true, lockMinutes: 10 });
}
