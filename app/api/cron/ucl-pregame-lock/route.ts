import { cronHandler } from "@/lib/cron/runCron";
import { eplSnapshotGamesNeedingLock } from "@/lib/services/epl/eplLockedSnapshot";
import { buildUclSlate } from "@/lib/services/ucl/buildUclSlate";
import { buildUclDailyEdgePreview, hydrateUclPriceHistory, hydrateUclStoredPriceHistory, type UclStoredPriceObservation } from "@/lib/services/ucl/buildUclDailyEdgePreview";
import { UCL_COMPETITION, UCL_EXTERNAL_ID_OFFSET } from "@/lib/services/ucl/uclCompetitionContext";
import { persistUclLineHistory, readUclStoredPriceHistory } from "@/lib/services/ucl/uclLineHistoryStore";
import { readCurrentUclMemberSnapshot, writeCurrentUclMemberSnapshot } from "@/lib/services/ucl/uclMemberSnapshotStore";
import { findUclGamesEnteringLock, writeUclPredictionRecords } from "@/lib/services/ucl/uclProductionPipeline";
import { evaluateUclPublicationCoverage } from "@/lib/services/ucl/uclPublicationReadiness";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "ucl_pregame_lock", async () => {
    if (process.env.UCL_LOCK_CRON_ENABLED !== "true") {
      return { records_updated: 0, details: { disabled: true, reason: "UCL_LOCK_CRON_ENABLED!=true" } };
    }
    const currentSnapshot = await readCurrentUclMemberSnapshot();
    const candidates = await findUclGamesEnteringLock();
    const snapshotLockIds = eplSnapshotGamesNeedingLock(currentSnapshot);
    if (!candidates.length && !snapshotLockIds.length) {
      return { records_updated: 0, details: { competition: UCL_COMPETITION, candidates: 0, provider_calls: 0 } };
    }
    const apply = process.env.UCL_DB_WRITES_ENABLED === "true";
    const slate = await buildUclSlate();
    const storedPriceHistory = await readUclStoredPriceHistory(slate.matches.map((match) => match.id));
    hydrateUclStoredPriceHistory(storedPriceHistory);
    hydrateUclPriceHistory(currentSnapshot);
    let allBookPrices: UclStoredPriceObservation[] = [];
    const response = await buildUclDailyEdgePreview(slate, { storedPriceHistory, captureAllBookPrices: (rows) => { allBookPrices = rows; } });
    const coverage = evaluateUclPublicationCoverage(slate, response);
    const lineHistory = await persistUclLineHistory({ response, allBookPrices, apply });
    const predictions = coverage.errors.length === 0
      ? await writeUclPredictionRecords({ slate, response, apply })
      : { mode: apply ? "write" as const : "dry-run" as const, proposed: [], written: 0, lockedPreserved: 0, errors: ["prediction write blocked by UCL coherence/fixture coverage gate"], captureWarnings: [] };
    const lockedProviderIds = new Set([...candidates.map((row) => row.externalId - UCL_EXTERNAL_ID_OFFSET), ...snapshotLockIds]);
    const lockedAt = new Date().toISOString();
    const lockedResponse = { ...response, games: response.games.map((game) => lockedProviderIds.has(Number(game.external_id)) ? { ...game, lockState: "locked" as const, lockedAt } : game) };
    const publicationEnabled = process.env.UCL_PUBLICATION_ENABLED === "true";
    const errors = [...coverage.errors, ...lineHistory.errors, ...predictions.errors];
    const publication = apply && publicationEnabled && errors.length === 0
      ? await writeCurrentUclMemberSnapshot({ response: lockedResponse, matchweek: slate.round, modelRelease: slate.modelRelease, calibrationRelease: slate.calibrationRelease })
      : { ok: false as const, skipped: true, reason: !apply ? "UCL_DB_WRITES_ENABLED!=true" : !publicationEnabled ? "UCL_PUBLICATION_ENABLED!=true" : "pipeline_errors" };
    return {
      records_updated: lineHistory.written + predictions.written + (publication.ok ? 1 : 0),
      partial: errors.length > 0 || (publicationEnabled && !publication.ok),
      error_message: errors.length ? errors.slice(0, 3).join("; ") : null,
      details: { competition: UCL_COMPETITION, apply, candidates, snapshot_lock_repairs: snapshotLockIds, price_coverage: coverage, line_history: lineHistory, proposed: predictions.proposed.length, written: predictions.written, locked_preserved: predictions.lockedPreserved, publication },
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
