import { cronHandler } from "@/lib/cron/runCron";
import { addDaysToSlate, currentSlateDate } from "@/lib/dates/slateDate";
import { CBB_FIXTURE_SEED_RELEASE, cbbFixtureRefreshDates, seedCbbGames } from "@/lib/services/cbb/seedCbbGamesService";
import { fetchCbbTeamIdentities } from "@/lib/services/cbb/fetchCbbTeamIdentities";
import { refreshCbbCurrentTraining } from "@/lib/services/cbb/cbbCurrentSeasonTraining";
import { refreshCbbMemberBoard } from "@/lib/services/cbb/cbbMemberPipeline";
import { CBB_ACTIVATION } from "@/lib/cbb/releases";
import { gradePredictionsForSlate } from "@/lib/services/predictionGradingService";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const intraday = new URL(request.url).searchParams.get("intraday") === "true";
    // The next morning's grader reads canonical games, not provider responses.
    // Refresh yesterday's fixture too: a late ET tip can finish after the
    // prior daily seed, and the rolling forward board no longer includes it.
    const dates = intraday ? [] : cbbFixtureRefreshDates(today);
    const seeded = [];
    for (const slateDate of dates) {
      seeded.push(await seedCbbGames({ slateDate, season, apiKey, dryRun: false,
        identityFetcher: fetchCbbTeamIdentities }));
    }
    if (!CBB_ACTIVATION.predictionWrites) {
      return { records_updated: seeded.reduce((sum, row) => sum + (row.written ? row.games + row.teams : 0), 0),
        api_calls_made: seeded.reduce((sum, row) => sum + row.providerCalls + (row.games ? 2 : 0), 0),
        details: { release: CBB_FIXTURE_SEED_RELEASE, seeded, predictionPublication: false } };
    }
    const owlsKey = process.env.OWLS_INSIGHT_API_KEY;
    if (!owlsKey) throw new Error("OWLS_INSIGHT_API_KEY missing for CBB member writer");
    const training = await refreshCbbCurrentTraining({season,anchorDate:today,apiKey,now:now.toISOString()});
    const board = await refreshCbbMemberBoard({anchorDate:today,season,bdlKey:apiKey,owlsKey,
      trainingGames:training.receipt.games});
    const graded = [];
    for (const slateDate of Array.from({length:7},(_,i)=>addDaysToSlate(today,i-6))) {
      const result = await gradePredictionsForSlate({sport:"cbb",slateDate,apply:true,supabase,source:"auto_score_ingest"});
      if (result.errors.length) throw new Error(`CBB tracking settlement failed: ${result.errors.map(e=>e.reason).join("; ")}`);
      graded.push({date:slateDate,settled:result.upsertedCount});
    }
    return {
      records_updated: seeded.reduce((sum, row) => sum + (row.written ? row.games + row.teams : 0), 0)
        + board.written + board.trackingInserted + training.added + graded.reduce((sum,row)=>sum+row.settled,0),
      api_calls_made: seeded.reduce((sum, row) => sum + row.providerCalls + (row.games ? 2 : 0), 0)
        + training.providerCalls + board.providerCalls + board.owlsCalls,
      details: { release: board.release, seeded, training:{added:training.added,pending:training.pending,rejected:training.rejected},
        board,graded,predictionPublication:true },
    };
  }, { sport: "cbb", leaseGroup: "prediction_pipeline", requireLease: true, lockMinutes: 10 });
}
