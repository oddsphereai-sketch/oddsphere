import { cronHandler } from "@/lib/cron/runCron";
import { buildUclSlate } from "@/lib/services/ucl/buildUclSlate";
import { buildUclDailyEdgePreview, hydrateUclPriceHistory, hydrateUclStoredPriceHistory, type UclStoredPriceObservation } from "@/lib/services/ucl/buildUclDailyEdgePreview";
import { persistUclLineHistory, readUclStoredPriceHistory } from "@/lib/services/ucl/uclLineHistoryStore";
import { readCurrentUclMemberSnapshot, writeCurrentUclMemberSnapshot } from "@/lib/services/ucl/uclMemberSnapshotStore";
import { seedUclSlate, writeUclPredictionRecords } from "@/lib/services/ucl/uclProductionPipeline";
import { UCL_COMPETITION } from "@/lib/services/ucl/uclCompetitionContext";
import { evaluateUclPublicationCoverage } from "@/lib/services/ucl/uclPublicationReadiness";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "ucl_daily_refresh", async () => {
    if (process.env.UCL_CRON_ENABLED !== "true") {
      return { records_updated: 0, details: { disabled: true, reason: "UCL_CRON_ENABLED!=true" } };
    }
    const apply = process.env.UCL_DB_WRITES_ENABLED === "true";
    const slate = await buildUclSlate();
    hydrateUclPriceHistory(await readCurrentUclMemberSnapshot());
    const storedPriceHistory = await readUclStoredPriceHistory(slate.matches.map((match) => match.id));
    hydrateUclStoredPriceHistory(storedPriceHistory);
    let allBookPrices: UclStoredPriceObservation[] = [];
    const response = await buildUclDailyEdgePreview(slate, { storedPriceHistory, captureAllBookPrices: (rows) => { allBookPrices = rows; } });
    const coverage = evaluateUclPublicationCoverage(slate, response);
    const seeded = await seedUclSlate({ slate, apply });
    const lineHistory = seeded.errors.length === 0
      ? await persistUclLineHistory({ response, allBookPrices, apply })
      : { proposed: 0, written: 0, errors: ["line history skipped because slate seeding failed"] };
    const predictions = coverage.errors.length === 0
      ? await writeUclPredictionRecords({ slate, response, apply })
      : { mode: apply ? "write" as const : "dry-run" as const, proposed: [], written: 0, lockedPreserved: 0, errors: ["prediction write blocked by UCL coherence/fixture coverage gate"], captureWarnings: [] };
    const errors = [...coverage.errors, ...seeded.errors, ...lineHistory.errors, ...predictions.errors];
    const publicationEnabled = process.env.UCL_PUBLICATION_ENABLED === "true";
    const publication = apply && publicationEnabled && errors.length === 0
      ? await writeCurrentUclMemberSnapshot({ response, matchweek: slate.round, modelRelease: slate.modelRelease, calibrationRelease: slate.calibrationRelease })
      : { ok: false as const, skipped: true, reason: !apply ? "UCL_DB_WRITES_ENABLED!=true" : !publicationEnabled ? "UCL_PUBLICATION_ENABLED!=true" : "pipeline_errors" };
    return {
      records_updated: seeded.teamsWritten + seeded.gamesWritten + lineHistory.written + predictions.written + (publication.ok ? 1 : 0),
      partial: errors.length > 0 || (publicationEnabled && !publication.ok),
      error_message: errors.length ? errors.slice(0, 3).join("; ") : null,
      details: {
        competition: UCL_COMPETITION,
        apply,
        matchweek: slate.round,
        fixtures: slate.matches.length,
        price_coverage: coverage,
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
