import { cronHandler } from "@/lib/cron/runCron";
import { buildEplDailyEdgePreview, hydrateEplPriceHistory, hydrateEplStoredPriceHistory } from "@/lib/services/epl/buildEplDailyEdgePreview";
import { buildEplShadowSlate } from "@/lib/services/epl/buildEplShadowSlate";
import { persistEplLineHistory, readEplStoredPriceHistory } from "@/lib/services/epl/eplLineHistoryStore";
import { seedEplSlate, writeEplPredictionRecords } from "@/lib/services/epl/eplProductionPipeline";
import { readCurrentEplMemberSnapshot, writeCurrentEplMemberSnapshot } from "@/lib/services/epl/eplMemberSnapshotStore";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "epl_daily_refresh", async () => {
    if (process.env.EPL_CRON_ENABLED !== "true") {
      return { records_updated: 0, details: { disabled: true, reason: "EPL_CRON_ENABLED!=true" } };
    }
    const apply = process.env.EPL_DB_WRITES_ENABLED === "true";
    const slate = await buildEplShadowSlate();
    // Both sources are merged by economic observation. The member snapshot
    // restores the latest published trail; durable history then fills any
    // observations that were captured between publications.
    hydrateEplPriceHistory(await readCurrentEplMemberSnapshot());
    hydrateEplStoredPriceHistory(await readEplStoredPriceHistory(slate.matches.map((match) => match.id)));
    let allBookPrices: Parameters<typeof persistEplLineHistory>[0]["allBookPrices"] = [];
    const response = await buildEplDailyEdgePreview(slate, { captureAllBookPrices: (rows) => { allBookPrices = rows; } });
    const marketRows = response.games.flatMap((game) => [
      game.markets.moneyline,
      game.soccerDoubleChanceMarket,
      game.markets.total,
      game.markets.first_inning,
    ].filter((market) => market !== null && market !== undefined));
    const selectedCurrent = marketRows.filter((market) => market.currentPriceAmerican !== null).length;
    const outcomeCurrent = marketRows.reduce((sum, market) => sum + (market.soccerPriceBoard?.rows.length ?? 0), 0);
    const coverageErrors = [
      ...(selectedCurrent === slate.matches.length * 4 ? [] : [`selected current-price coverage ${selectedCurrent}/${slate.matches.length * 4}`]),
      ...(outcomeCurrent === slate.matches.length * 10 ? [] : [`outcome price-board coverage ${outcomeCurrent}/${slate.matches.length * 10}`]),
    ];
    const seeded = await seedEplSlate({ slate, apply });
    const lineHistory = seeded.errors.length === 0
      ? await persistEplLineHistory({ response, allBookPrices, apply })
      : { proposed: 0, written: 0, errors: ["line history skipped because slate seeding failed"] };
    const predictions = await writeEplPredictionRecords({ slate, response, apply });
    const errors = [...coverageErrors, ...seeded.errors, ...lineHistory.errors, ...predictions.errors];
    const publicationEnabled = process.env.EPL_PUBLICATION_ENABLED === "true";
    const publication = apply && publicationEnabled && errors.length === 0
      ? await writeCurrentEplMemberSnapshot({
          response,
          round: slate.round,
          modelRelease: slate.modelRelease,
          calibrationRelease: slate.calibrationRelease,
        })
      : { ok: false as const, skipped: true, reason: !apply ? "EPL_DB_WRITES_ENABLED!=true" : !publicationEnabled ? "EPL_PUBLICATION_ENABLED!=true" : "pipeline_errors" };
    return {
      records_updated: seeded.teamsWritten + seeded.gamesWritten + lineHistory.written + predictions.written + (publication.ok ? 1 : 0),
      partial: errors.length > 0 || (publicationEnabled && !publication.ok),
      error_message: errors.length ? errors.slice(0, 3).join("; ") : null,
      details: {
        competition: "english_premier_league",
        apply,
        round: slate.round,
        fixtures: slate.matches.length,
        price_coverage: { selectedCurrent, selectedExpected: slate.matches.length * 4, outcomeCurrent, outcomeExpected: slate.matches.length * 10 },
        model_release: slate.modelRelease,
        calibration_release: slate.calibrationRelease,
        seed: seeded,
        line_history: lineHistory,
        predictions: { mode: predictions.mode, proposed: predictions.proposed.length, written: predictions.written, lockedPreserved: predictions.lockedPreserved, errors: predictions.errors },
        publication,
      },
    };
  }, {
    sport: "soccer",
    leaseGroup: "prediction_pipeline",
    requireLease: true,
    lockMinutes: 8,
    minIntervalMinutes: 15,
    leaseRetryMaxWaitMs: 45_000,
    leaseRetryIntervalMs: 2_000,
  });
}

export const POST = GET;
