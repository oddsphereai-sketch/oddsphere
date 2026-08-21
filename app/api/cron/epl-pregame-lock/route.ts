import { cronHandler } from "@/lib/cron/runCron";
import { buildEplDailyEdgePreview, hydrateEplPriceHistory, hydrateEplStoredPriceHistory } from "@/lib/services/epl/buildEplDailyEdgePreview";
import { buildEplShadowSlate } from "@/lib/services/epl/buildEplShadowSlate";
import { persistEplLineHistory, readEplStoredPriceHistory } from "@/lib/services/epl/eplLineHistoryStore";
import { EPL_EXTERNAL_ID_OFFSET, findEplGamesEnteringLock, writeEplPredictionRecords } from "@/lib/services/epl/eplProductionPipeline";
import { eplSnapshotGamesNeedingLock } from "@/lib/services/epl/eplLockedSnapshot";
import { readCurrentEplMemberSnapshot, writeCurrentEplMemberSnapshot } from "@/lib/services/epl/eplMemberSnapshotStore";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "epl_pregame_lock", async () => {
    if (process.env.EPL_LOCK_CRON_ENABLED !== "true") {
      return { records_updated: 0, details: { disabled: true, reason: "EPL_LOCK_CRON_ENABLED!=true" } };
    }
    const currentSnapshot = await readCurrentEplMemberSnapshot();
    const candidates = await findEplGamesEnteringLock();
    const snapshotLockIds = eplSnapshotGamesNeedingLock(currentSnapshot);
    if (candidates.length === 0 && snapshotLockIds.length === 0) {
      return { records_updated: 0, details: { competition: "english_premier_league", candidates: 0, provider_calls: 0 } };
    }
    const apply = process.env.EPL_DB_WRITES_ENABLED === "true";
    const slate = await buildEplShadowSlate();
    hydrateEplStoredPriceHistory(await readEplStoredPriceHistory(slate.matches.map((match) => match.id)));
    hydrateEplPriceHistory(currentSnapshot);
    let allBookPrices: Parameters<typeof persistEplLineHistory>[0]["allBookPrices"] = [];
    const response = await buildEplDailyEdgePreview(slate, { captureAllBookPrices: (rows) => { allBookPrices = rows; } });
    const lineHistory = await persistEplLineHistory({ response, allBookPrices, apply });
    const predictions = await writeEplPredictionRecords({ slate, response, apply });
    const lockedProviderIds = new Set([
      ...candidates.map((row) => row.externalId - EPL_EXTERNAL_ID_OFFSET),
      ...snapshotLockIds,
    ]);
    const lockedAt = new Date().toISOString();
    const lockedResponse = {
      ...response,
      games: response.games.map((game) => lockedProviderIds.has(Number(game.external_id))
        ? { ...game, lockState: "locked" as const, lockedAt }
        : game),
    };
    const publicationEnabled = process.env.EPL_PUBLICATION_ENABLED === "true";
    const pipelineErrors = [...lineHistory.errors, ...predictions.errors];
    const publication = apply && publicationEnabled && pipelineErrors.length === 0
      ? await writeCurrentEplMemberSnapshot({ response: lockedResponse, round: slate.round, modelRelease: slate.modelRelease, calibrationRelease: slate.calibrationRelease })
      : { ok: false as const, skipped: true, reason: !apply ? "EPL_DB_WRITES_ENABLED!=true" : !publicationEnabled ? "EPL_PUBLICATION_ENABLED!=true" : "pipeline_errors" };
    return {
      records_updated: lineHistory.written + predictions.written + (publication.ok ? 1 : 0),
      partial: pipelineErrors.length > 0 || (publicationEnabled && !publication.ok),
      error_message: pipelineErrors.length ? pipelineErrors.slice(0, 3).join("; ") : null,
      details: {
        competition: "english_premier_league",
        apply,
        candidates,
        snapshot_lock_repairs: snapshotLockIds,
        line_history: lineHistory,
        proposed: predictions.proposed.length,
        written: predictions.written,
        locked_preserved: predictions.lockedPreserved,
        publication,
      },
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
