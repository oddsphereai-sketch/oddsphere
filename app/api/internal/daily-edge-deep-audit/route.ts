import { validateCronAuth } from "@/lib/cron/auth";
import {
  auditDailyEdgeBoards,
  DAILY_EDGE_DEEP_AUDIT_SPORTS,
} from "@/lib/services/dailyEdgeDeepAudit";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 60;

async function loadPublishedFootballBoard(sport: "nfl" | "cfb"): Promise<DailyEdgeResponse | null> {
  const [
    { supabase },
    { filterWeeklyReaderSnapshot },
    { populateDailyEdgeDraftKingsFallback },
  ] = await Promise.all([
    import("@/lib/db/supabase"),
    import("@/lib/services/dailyEdge/weeklyReaderLifecycle"),
    import("@/lib/providers/draftkings/draftKingsNetworkSplits"),
  ]);

  let payload: DailyEdgeResponse | null = null;
  if (sport === "cfb") {
    const { readCfbForwardMemberSnapshot } = await import(
      "@/lib/services/football/cfbForwardMemberSnapshotStore"
    );
    const season = Number(process.env.CFB_FORWARD_SEASON ?? "2026");
    const published = await readCfbForwardMemberSnapshot({ client: supabase, season });
    payload = published?.fixture?.snapshot
      ? structuredClone(published.fixture.snapshot)
      : null;
  } else {
    const [
      { readNflForwardMemberSnapshot },
      { resolveNflForwardWeek },
      { enrichCachedNflFootballEvidence },
    ] = await Promise.all([
      import("@/lib/services/football/nflForwardMemberSnapshotStore"),
      import("@/lib/services/football/nflForwardWeekSelection"),
      import("@/lib/services/football/footballMemberEvidence"),
    ]);
    const season = Number(process.env.NFL_FORWARD_SEASON ?? "2026");
    const week = resolveNflForwardWeek({
      season,
      configuredWeek: Number(process.env.NFL_FORWARD_WEEK ?? "1"),
    });
    const published = await readNflForwardMemberSnapshot({ client: supabase, season, week });
    payload = published?.fixture?.snapshot
      ? structuredClone(enrichCachedNflFootballEvidence(published.fixture).snapshot)
      : null;
  }

  if (!payload) return null;
  const filtered = filterWeeklyReaderSnapshot(payload, sport);
  await populateDailyEdgeDraftKingsFallback(filtered, sport);
  return filtered;
}

async function loadAuditBoard(sport: Sport, origin: string): Promise<unknown> {
  if (sport === "nfl" || sport === "cfb") {
    const published = await loadPublishedFootballBoard(sport);
    if (published) return published;
  }

  const { GET: dailyEdgeGet } = await import("@/app/api/lab/daily-edge/route");
  const response = await dailyEdgeGet(new Request(`${origin}/api/lab/daily-edge?sport=${sport}`));
  return response.json();
}

export async function GET(request: Request): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;

  const origin = new URL(request.url).origin;
  const boards: Record<string, unknown> = {};

  await Promise.all(DAILY_EDGE_DEEP_AUDIT_SPORTS.map(async (sport) => {
    boards[sport] = await loadAuditBoard(sport, origin);
  }));

  const result = auditDailyEdgeBoards(boards as Record<string, Record<string, unknown>>);
  return Response.json({
    ok: result.ok,
    result,
    // Returned intentionally so the operator script can validate the same DTO
    // payload the member UI consumes, without exposing secrets or user data.
    boards,
  }, { status: result.ok ? 200 : 409 });
}
