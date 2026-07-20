import { cronHandler } from "@/lib/cron/runCron";
import { loadLatestMlbPropsBoardSnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import {
  syncInternalMlbPropsTracking,
  type MlbPropsTrackingSyncResult,
} from "@/lib/mlb/props/internalTracking";
import { easternSlateDate, refreshMlbPropsBoard } from "@/lib/mlb/props/liveBoard";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return cronHandler(request, "mlb_player_props_refresh", async () => {
    if (process.env.MLB_PLAYER_PROPS_CRON_ENABLED !== "true") {
      return {
        partial: true,
        error_message: "MLB player props refresh is disabled.",
        details: { skipped: true, reason: "cron_disabled" },
      };
    }
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get("date");
    const slateDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : easternSlateDate();
    const refreshMode = url.searchParams.get("full") === "true" ? "full" : "fast";
    let result: Awaited<ReturnType<typeof refreshMlbPropsBoard>>;
    try {
      result = await refreshMlbPropsBoard({ slateDate, refreshMode, persist: true });
    } catch (error) {
      // Locking must not depend on a completely successful provider refresh.
      // If BDL expands unexpectedly or a nonessential enrichment call fails,
      // freeze the latest publishable pregame board for every game currently
      // inside T-60. This preserves a deterministic member/tracking snapshot
      // while the next refresh retries the live provider work.
      const refreshError = error instanceof Error ? error.message : String(error);
      const previous = await loadLatestMlbPropsBoardSnapshot(slateDate).catch(() => null);
      let tracking: MlbPropsTrackingSyncResult | null = null;
      let trackingError: string | null = null;
      if (previous) {
        try {
          tracking = await syncInternalMlbPropsTracking(previous);
        } catch (trackingFailure) {
          trackingError = trackingFailure instanceof Error
            ? trackingFailure.message
            : String(trackingFailure);
        }
      }
      return {
        records_updated: (tracking?.entriesLocked ?? 0) + (tracking?.closingPricesUpdated ?? 0),
        api_calls_made: 0,
        partial: true,
        error_message: trackingError
          ? `${refreshError}; last-known-good lock fallback failed: ${trackingError}`
          : refreshError,
        details: {
          slateDate,
          refreshMode,
          published: false,
          refreshFailed: true,
          refreshError,
          tracking,
          trackingError,
          lastKnownGoodPreserved: Boolean(previous),
          lockFallbackAttempted: Boolean(previous),
        },
      };
    }
    const trackingFailed = result.tracking.status === "failed";
    return {
      // This metric is database writes, not the number of display rows carried
      // inside one compressed snapshot. Reporting thousands of props here made
      // capacity monitoring misleading and obscured the actual write load.
      records_updated: result.published
        ? 2 + result.tracking.entriesLocked + result.tracking.closingPricesUpdated
        : 0,
      api_calls_made: result.providerCalls.balldontlie,
      partial: !result.published || trackingFailed,
      error_message: !result.published
        ? result.snapshot.validation.errors.join(", ")
        : trackingFailed ? result.tracking.error : null,
      details: {
        slateDate,
        refreshMode: result.snapshot.refreshMode,
        published: result.published,
        scoringRunId: result.scoringRunId,
        snapshotId: result.snapshot.snapshotId,
        props: result.snapshot.data.props.length,
        actionableRows: result.snapshot.validation.actionableRows,
        warnings: result.snapshot.validation.warnings,
        providerCoverage: result.snapshot.validation.providerCoverage ?? null,
        movement: result.snapshot.movement,
        bdlApiCalls: result.providerCalls.balldontlie,
        bdlApiCallsByStage: {
          odds: result.providerCalls.balldontlieOdds,
          research: result.providerCalls.balldontlieResearch,
          lineups: result.providerCalls.balldontlieLineups,
        },
        tracking: result.tracking,
        lastKnownGoodPreserved: !result.published && result.usedPreviousSnapshot,
      },
    };
  }, { sport: "mlb", lockMinutes: 8 });
}
