import { cronHandler, isWithinCronMinimumInterval } from "@/lib/cron/runCron";
import { refreshLogger } from "@/lib/services/refreshLogger";
import { readCurrentUclMemberSnapshot } from "@/lib/services/ucl/uclMemberSnapshotStore";
import { resolveUclFeatureFlags } from "@/lib/services/ucl/uclFeatureFlags";
import { parseUclPriceProbeIds, runUclBoundedPriceSourceProbe } from "@/lib/services/ucl/uclBoundedPriceSourceProbe";

export const maxDuration = 120;

/** Unscheduled, operator-authenticated, read-only endpoint. An older deployment
 * has no such route and safely returns404 instead of running a forecast job. */
export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "ucl_price_source_probe", async () => {
    if (!resolveUclFeatureFlags().refresh) {
      return { records_updated: 0, api_calls_made: 0, details: { diagnosticOnly: true, disabled: true, reason: "UCL refresh gate disabled" } };
    }
    // Keep both normal and diagnostic15-minute guards and the shared soccer
    // lease. Diagnostic success never advances normal forecast refresh success.
    const lastNormalRefresh = await refreshLogger.getLastHealthyCompleted("ucl_daily_refresh", "soccer");
    if (isWithinCronMinimumInterval(lastNormalRefresh, 15)) {
      return { records_updated: 0, api_calls_made: 0,
        details: { diagnosticOnly: true, skipped: true, reason: "normal_refresh_minimum_interval" } };
    }
    const query = new URL(request.url).searchParams;
    const fixtureIds = parseUclPriceProbeIds(query.get("fixture_ids"));
    if (query.getAll("fixture_ids").length !== 1 || !fixtureIds) {
      return { records_updated: 0, api_calls_made: 0,
        details: { diagnosticOnly: true, skipped: true, reason: "invalid_explicit_probe_request" } };
    }
    const details = await runUclBoundedPriceSourceProbe({ snapshot: await readCurrentUclMemberSnapshot(), fixtureIds,
      apiKey: process.env.THE_ODDS_API_KEY });
    return { records_updated: 0, api_calls_made: details.catalogRequests + details.paidRequests, details };
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
