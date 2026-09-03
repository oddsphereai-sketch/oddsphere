import { cronHandler } from "@/lib/cron/runCron";
import { eplSnapshotGamesNeedingLock } from "@/lib/services/epl/eplLockedSnapshot";
import { buildUclSlate } from "@/lib/services/ucl/buildUclSlate";
import { buildUclDailyEdgePreview, hydrateUclPriceHistory, hydrateUclStoredPriceHistory, type UclStoredPriceObservation } from "@/lib/services/ucl/buildUclDailyEdgePreview";
import { UCL_COMPETITION, UCL_EXTERNAL_ID_OFFSET } from "@/lib/services/ucl/uclCompetitionContext";
import { persistUclLineHistory, readUclStoredPriceHistory } from "@/lib/services/ucl/uclLineHistoryStore";
import { readCurrentUclMemberSnapshot, writeCurrentUclMemberSnapshot } from "@/lib/services/ucl/uclMemberSnapshotStore";
import { findUclGamesEnteringLock, verifyUclAllMarketLocks, writeUclPredictionRecords } from "@/lib/services/ucl/uclProductionPipeline";
import { evaluateUclPublicationCoverage } from "@/lib/services/ucl/uclPublicationReadiness";
import { resolveUclFeatureFlags } from "@/lib/services/ucl/uclFeatureFlags";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "ucl_pregame_lock", async () => {
    const flags = resolveUclFeatureFlags();
    if (!flags.lock) {
      return { records_updated: 0, details: { disabled: true, reason: "UCL lock gate disabled" } };
    }
    const currentSnapshot = await readCurrentUclMemberSnapshot();
    const candidates = await findUclGamesEnteringLock();
    const snapshotLockIds = eplSnapshotGamesNeedingLock(currentSnapshot);
    if (!candidates.length && !snapshotLockIds.length) {
      return { records_updated: 0, details: { competition: UCL_COMPETITION, candidates: 0, provider_calls: 0 } };
    }
    const apply = flags.writes;
    const slate = await buildUclSlate();
    const storedPriceHistory = await readUclStoredPriceHistory(slate.matches.map((match) => match.id));
    hydrateUclStoredPriceHistory(storedPriceHistory);
    hydrateUclPriceHistory(currentSnapshot);
    let allBookPrices: UclStoredPriceObservation[] = [];
    const response = await buildUclDailyEdgePreview(slate, { storedPriceHistory, captureAllBookPrices: (rows) => { allBookPrices = rows; } });
    const coverage = evaluateUclPublicationCoverage(slate, response);
    const lineHistory = coverage.errors.length === 0
      ? await persistUclLineHistory({ response, allBookPrices, apply })
      : { proposed: 0, written: 0, errors: ["line history blocked by UCL coverage/history gate"] };
    const predictions = coverage.errors.length === 0
      ? await writeUclPredictionRecords({ slate, response, apply })
      : { mode: apply ? "write" as const : "dry-run" as const, proposed: [], written: 0, lockedPreserved: 0, priorTuplesLocked: 0, lockedRecordIds: [], errors: ["prediction write blocked by UCL coherence/fixture coverage gate"], captureWarnings: [] };
    const requestedLockIds = [...new Set([...candidates.map((row) => row.externalId - UCL_EXTERNAL_ID_OFFSET), ...snapshotLockIds])];
    const lockVerification = apply
      ? await verifyUclAllMarketLocks({ providerIds: requestedLockIds, modelRelease: slate.modelRelease, calibrationRelease: slate.calibrationRelease, expectedRows: predictions.proposed, writerLockedRecordIds: predictions.lockedRecordIds, response })
      : { completeProviderIds: [] as number[], incompleteProviderIds: requestedLockIds, lockedResponse: response };
    const lockedResponse = lockVerification.lockedResponse;
    const errors = [...coverage.errors, ...lineHistory.errors, ...predictions.errors,
      ...(lockVerification.incompleteProviderIds.length ? [`UCL all-market lock incomplete for provider IDs ${lockVerification.incompleteProviderIds.join(",")}`] : [])];
    const publication = flags.publication && errors.length === 0
      ? await writeCurrentUclMemberSnapshot({ response: lockedResponse, matchweek: slate.round, boardDate: slate.boardDate, modelRelease: slate.modelRelease, calibrationRelease: slate.calibrationRelease })
      : { ok: false as const, skipped: true, reason: !apply ? "UCL write gate disabled" : !flags.publication ? "UCL publication gate disabled" : "pipeline_errors" };
    return {
      records_updated: lineHistory.written + predictions.written + (publication.ok ? 1 : 0),
      partial: errors.length > 0 || (flags.publication && !publication.ok),
      error_message: errors.length ? errors.slice(0, 3).join("; ") : null,
      details: { competition: UCL_COMPETITION, apply, candidates, snapshot_lock_repairs: snapshotLockIds, lock_verification: { completeProviderIds: lockVerification.completeProviderIds, incompleteProviderIds: lockVerification.incompleteProviderIds }, provider_history: slate.providerHealth.uclHistory, price_coverage: coverage, line_history: lineHistory, proposed: predictions.proposed.length, written: predictions.written, locked_preserved: predictions.lockedPreserved, publication },
    };
  }, {
    sport: "soccer",
    leaseGroup: "prediction_pipeline",
    requireLease: true,
    lockMinutes: 4,
    minIntervalMinutes: 1,
    leaseRetryMaxWaitMs: 45_000,
    leaseRetryIntervalMs: 2_000,
  });
}

export const POST = GET;
