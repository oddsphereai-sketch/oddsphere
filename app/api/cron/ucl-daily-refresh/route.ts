import { cronHandler } from "@/lib/cron/runCron";
import { buildUclSlate } from "@/lib/services/ucl/buildUclSlate";
import { buildUclDailyEdgePreview, hydrateUclPriceHistory, hydrateUclStoredPriceHistory, type UclStoredPriceObservation } from "@/lib/services/ucl/buildUclDailyEdgePreview";
import { persistUclLineHistory, readUclStoredPriceHistory } from "@/lib/services/ucl/uclLineHistoryStore";
import { readCurrentUclMemberSnapshot, writeCurrentUclMemberSnapshot } from "@/lib/services/ucl/uclMemberSnapshotStore";
import { seedUclSlate, verifyUclRefreshAllMarketLocks, writeUclPredictionRecords } from "@/lib/services/ucl/uclProductionPipeline";
import { UCL_COMPETITION } from "@/lib/services/ucl/uclCompetitionContext";
import { evaluateUclPublicationCoverage } from "@/lib/services/ucl/uclPublicationReadiness";
import { resolveUclFeatureFlags } from "@/lib/services/ucl/uclFeatureFlags";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "ucl_daily_refresh", async () => {
    const flags = resolveUclFeatureFlags();
    if (!flags.refresh) {
      return { records_updated: 0, details: { disabled: true, reason: "UCL refresh gate disabled" } };
    }
    const apply = flags.writes;
    const now = new Date();
    const slate = await buildUclSlate();
    hydrateUclPriceHistory(await readCurrentUclMemberSnapshot());
    const storedPriceHistory = await readUclStoredPriceHistory(slate.matches.map((match) => match.id));
    hydrateUclStoredPriceHistory(storedPriceHistory);
    let allBookPrices: UclStoredPriceObservation[] = [];
    const response = await buildUclDailyEdgePreview(slate, { storedPriceHistory, captureAllBookPrices: (rows) => { allBookPrices = rows; } });
    const coverage = evaluateUclPublicationCoverage(slate, response);
    const historyWritable = coverage.errors.length === 0;
    const seeded = historyWritable
      ? await seedUclSlate({ slate, apply })
      : { mode: apply ? "write" as const : "dry-run" as const, teamsProposed: 0, teamsWritten: 0, gamesProposed: 0, gamesWritten: 0, errors: ["slate seed blocked by UCL coverage/history gate"] };
    const lineHistory = historyWritable && seeded.errors.length === 0
      ? await persistUclLineHistory({ response, allBookPrices, apply })
      : { proposed: 0, written: 0, errors: ["line history blocked by UCL coverage/history gate"] };
    const predictions = historyWritable
      ? await writeUclPredictionRecords({ slate, response, apply, now })
      : { mode: apply ? "write" as const : "dry-run" as const, proposed: [], written: 0, lockedPreserved: 0, priorTuplesLocked: 0, lockedRecordIds: [], errors: ["prediction write blocked by UCL coherence/fixture coverage gate"], captureWarnings: [] };
    const lockVerification = apply && historyWritable && predictions.errors.length === 0
      ? await verifyUclRefreshAllMarketLocks({ response, now, modelRelease: slate.modelRelease, calibrationRelease: slate.calibrationRelease, expectedRows: predictions.proposed, writerLockedRecordIds: predictions.lockedRecordIds })
      : { dueProviderIds: [] as number[], completeProviderIds: [] as number[], incompleteProviderIds: [] as number[], lockedResponse: response };
    const errors = [...coverage.errors, ...seeded.errors, ...lineHistory.errors, ...predictions.errors,
      ...(lockVerification.incompleteProviderIds.length ? [`UCL refresh all-market lock incomplete for provider IDs ${lockVerification.incompleteProviderIds.join(",")}`] : [])];
    const publication = flags.publication && errors.length === 0
      ? await writeCurrentUclMemberSnapshot({ response: lockVerification.lockedResponse, matchweek: slate.round, boardDate: slate.boardDate, modelRelease: slate.modelRelease, calibrationRelease: slate.calibrationRelease })
      : { ok: false as const, skipped: true, reason: !apply ? "UCL write gate disabled" : !flags.publication ? "UCL publication gate disabled" : "pipeline_errors" };
    return {
      records_updated: seeded.teamsWritten + seeded.gamesWritten + lineHistory.written + predictions.written + (publication.ok ? 1 : 0),
      partial: errors.length > 0 || (flags.publication && !publication.ok),
      error_message: errors.length ? errors.slice(0, 3).join("; ") : null,
      details: {
        competition: UCL_COMPETITION,
        apply,
        matchweek: slate.round,
        fixtures: slate.matches.length,
        price_coverage: coverage,
        model_release: slate.modelRelease,
        calibration_release: slate.calibrationRelease,
        provider_history: slate.providerHealth.uclHistory,
        seed: seeded,
        line_history: lineHistory,
        predictions: { mode: predictions.mode, proposed: predictions.proposed.length, written: predictions.written, lockedPreserved: predictions.lockedPreserved, errors: predictions.errors },
        lock_verification: { dueProviderIds: lockVerification.dueProviderIds, completeProviderIds: lockVerification.completeProviderIds, incompleteProviderIds: lockVerification.incompleteProviderIds },
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
