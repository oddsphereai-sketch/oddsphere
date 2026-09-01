import { isNflDailyEdgeEnabled } from "@/lib/config/nflDailyEdge";
import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import {
  auditNflForwardMemberSnapshot,
  readNflForwardMemberSnapshot,
} from "@/lib/services/football/nflForwardMemberSnapshotStore";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "nfl_daily_edge_health", async () => {
    if (!isNflDailyEdgeEnabled()) {
      return {
        records_updated: 0,
        details: { disabled: true, reason: "NFL_DAILY_EDGE_ENABLED!=true" },
      };
    }
    const season = boundedInteger(process.env.NFL_FORWARD_SEASON ?? "2026", 2026, 2100, "NFL_FORWARD_SEASON");
    const week = boundedInteger(process.env.NFL_FORWARD_WEEK ?? "1", 1, 18, "NFL_FORWARD_WEEK");
    const published = await readNflForwardMemberSnapshot({ client: supabase, season, week });
    if (!published) {
      return {
        records_updated: 0,
        partial: true,
        error_message: "NFL published member snapshot is unavailable",
        details: { healthy: false, published: false },
      };
    }
    const audit = auditNflForwardMemberSnapshot({ snapshot: published });
    return {
      records_updated: 0,
      partial: !audit.healthy,
      error_message: audit.critical.length > 0 ? audit.critical.slice(0, 3).join("; ") : null,
      details: {
        healthy: audit.healthy,
        published: true,
        publication_release: published.snapshotRelease,
        member_snapshot_release: published.fixture.heldMemberFixtureRelease,
        source_snapshot_sha256: published.sourceChecksum,
        published_at: published.publishedAt,
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

function boundedInteger(value: string, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}
