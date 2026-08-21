import { isNflDailyEdgeEnabled } from "@/lib/config/nflDailyEdge";
import { cronHandler } from "@/lib/cron/runCron";
import {
  auditNflMemberSnapshot,
  readCurrentNflPublishedMemberSnapshot,
} from "@/lib/services/football/nflPublishedMemberSnapshotStore";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "nfl_daily_edge_health", async () => {
    if (!isNflDailyEdgeEnabled()) {
      return {
        records_updated: 0,
        details: { disabled: true, reason: "NFL_DAILY_EDGE_ENABLED!=true" },
      };
    }
    const published = await readCurrentNflPublishedMemberSnapshot();
    if (!published) {
      return {
        records_updated: 0,
        partial: true,
        error_message: "NFL published member snapshot is unavailable",
        details: { healthy: false, published: false },
      };
    }
    const audit = auditNflMemberSnapshot({
      fixture: published.fixture,
      maxSourceAgeMinutes: 120,
      maxStoredAgeMinutes: 120,
    });
    return {
      records_updated: 0,
      partial: !audit.healthy,
      error_message: audit.critical.length > 0 ? audit.critical.slice(0, 3).join("; ") : null,
      details: {
        healthy: audit.healthy,
        published: true,
        publication_release: published.publicationRelease,
        member_snapshot_release: published.fixture.memberSnapshotRelease,
        source_snapshot_sha256: published.sourceSnapshotSha256,
        published_at: published.publishedAt,
        locked_games: published.lockedGameIds.length,
        tracking_eligible: published.fixture.tracking.trackingEligible,
        metrics: audit.metrics,
        warnings: audit.warnings,
      },
    };
  }, {
    sport: "nfl",
    lockMinutes: 2,
    minIntervalMinutes: 20,
  });
}

export const POST = GET;
