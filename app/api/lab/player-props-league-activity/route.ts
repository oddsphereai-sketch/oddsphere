import { unstable_cache } from "next/cache";

import { readPlayerPropsLeagueActivity } from "@/lib/services/playerProps/playerPropsLeagueActivity.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const readCachedPlayerPropsLeagueActivity = unstable_cache(
  readPlayerPropsLeagueActivity,
  ["player-props-league-activity-v1"],
  { revalidate: 2 * 60, tags: ["player-props-league-activity"] },
);

export async function GET() {
  const leagues = await readCachedPlayerPropsLeagueActivity().catch(() => ({}));
  return Response.json(
    { leagues },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=90" } },
  );
}
