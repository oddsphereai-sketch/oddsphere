import { unstable_cache } from "next/cache";

import { loadPublishedDailyEdgeSnapshot } from "@/app/dev/experience-preview/previewData";
import type { DailyEdgeSportActivityMap } from "@/app/lab/lib/dailyEdgeSports";
import { isNflDailyEdgeEnabled } from "@/lib/config/nflDailyEdge";
import { currentDailyEdgeBoardDate } from "@/lib/dates/slateDate";
import { supabase } from "@/lib/db/supabase";
import { readCfbForwardMemberSnapshot } from "@/lib/services/football/cfbForwardMemberSnapshotStore";
import { readNflForwardMemberSnapshot } from "@/lib/services/football/nflForwardMemberSnapshotStore";
import { resolveNflForwardWeek } from "@/lib/services/football/nflForwardWeekSelection";
import { resolveUclFeatureFlags } from "@/lib/services/ucl/uclFeatureFlags";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAILY_BOARD_SPORTS = ["mlb", "wnba", "nba", "nhl"] as const;

async function readDailyBoardCount(sport: typeof DAILY_BOARD_SPORTS[number]): Promise<number> {
  return loadPublishedDailyEdgeSnapshot(sport, currentDailyEdgeBoardDate(sport))
    .then((snapshot) => snapshot.games.length)
    .catch(() => 0);
}

async function readFootballBoardCounts(): Promise<Pick<DailyEdgeSportActivityMap, "nfl" | "cfb">> {
  const nflSeason = Number(process.env.NFL_FORWARD_SEASON ?? "2026");
  const nflWeek = resolveNflForwardWeek({
    season: nflSeason,
    configuredWeek: Number(process.env.NFL_FORWARD_WEEK ?? "1"),
  });
  const cfbSeason = Number(process.env.CFB_FORWARD_SEASON ?? "2026");
  const [nflSnapshot, cfbSnapshot] = await Promise.all([
    isNflDailyEdgeEnabled()
      ? readNflForwardMemberSnapshot({ client: supabase, season: nflSeason, week: nflWeek }).catch(() => null)
      : Promise.resolve(null),
    process.env.CFB_DAILY_EDGE_ENABLED === "true"
      ? readCfbForwardMemberSnapshot({ client: supabase, season: cfbSeason }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const checkedAt = new Date().toISOString();
  return {
    nfl: { gameCount: nflSnapshot?.fixture.snapshot.games.length ?? 0, checkedAt },
    cfb: { gameCount: cfbSnapshot?.fixture.snapshot.games.length ?? 0, checkedAt },
  };
}

async function readSoccerBoardCount(): Promise<number> {
  const eplEnabled = process.env.PREMIER_LEAGUE_DAILY_EDGE_ENABLED === "true";
  const uclEnabled = resolveUclFeatureFlags().member;
  const [eplSnapshot, uclSnapshot] = await Promise.all([
    eplEnabled
      ? import("@/lib/services/epl/eplMemberSnapshotStore")
          .then(({ readCurrentEplMemberSnapshot }) => readCurrentEplMemberSnapshot())
          .catch(() => null)
      : Promise.resolve(null),
    uclEnabled
      ? import("@/lib/services/ucl/uclMemberSnapshotStore")
          .then(({ readCurrentUclMemberSnapshot }) => readCurrentUclMemberSnapshot())
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return (eplSnapshot?.games.length ?? 0) + (uclSnapshot?.games.length ?? 0);
}

const loadCachedSportActivity = unstable_cache(
  async (): Promise<DailyEdgeSportActivityMap> => {
    const checkedAt = new Date().toISOString();
    const [dailyCounts, footballCounts, soccerCount] = await Promise.all([
      Promise.all(DAILY_BOARD_SPORTS.map(async (sport) => [sport, await readDailyBoardCount(sport)] as const)),
      readFootballBoardCounts(),
      readSoccerBoardCount(),
    ]);
    const sports: DailyEdgeSportActivityMap = {
      ...footballCounts,
      soccer: { gameCount: soccerCount, checkedAt },
    };
    for (const [sport, gameCount] of dailyCounts) {
      sports[sport] = { gameCount, checkedAt };
    }
    return sports;
  },
  ["daily-edge-sport-activity-v1"],
  { revalidate: 2 * 60, tags: ["daily-edge-sport-activity"] },
);

export async function GET() {
  const sports = await loadCachedSportActivity().catch(() => ({}));
  return Response.json(
    { sports },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=90" } },
  );
}
