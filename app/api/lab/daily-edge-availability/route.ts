import { unstable_cache } from "next/cache";

import type { DailyEdgeGameAvailability } from "@/lib/services/dailyEdge/gameAvailability";
import {
  parseDailyEdgeAvailabilityMatchup,
  type RequestedDailyEdgeMatchup,
} from "@/lib/services/dailyEdge/availabilityRequest";
import {
  fetchPlaybookMlbSlateAvailability,
  type MlbDailyEdgeGameAvailability,
} from "@/lib/services/mlb/playbookMlbAvailability";
import { fetchEspnWnbaSlateAvailability } from "@/lib/services/wnba/espnWnbaAvailability";
import { fetchEspnNhlSlateAvailability } from "@/lib/services/nhl/espnNhlAvailability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = url.searchParams.get("sport");
  const date = url.searchParams.get("date");
  const matchups = url.searchParams.getAll("game")
    .map(parseDailyEdgeAvailabilityMatchup)
    .filter((row): row is RequestedDailyEdgeMatchup => row !== null);
  if ((sport !== "mlb" && sport !== "wnba" && sport !== "nhl") || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || matchups.length === 0 || matchups.length > 40) {
    return Response.json({ reports: {} }, { status: 400 });
  }

  const reports = sport === "mlb"
    ? await loadCachedMlbAvailability(date, matchups)
    : sport === "nhl"
      ? await loadCachedNhlAvailability(date)
      : await loadCachedWnbaAvailability(date);
  const byGame: Record<string, DailyEdgeGameAvailability | MlbDailyEdgeGameAvailability> = {};
  for (const matchup of matchups) {
    const report = reports?.find((candidate) =>
      candidate.awayTeam === matchup.awayTeam && candidate.homeTeam === matchup.homeTeam,
    );
    if (report) byGame[matchup.id] = report;
  }
  return Response.json(
    { reports: byGame },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}

const loadCachedWnbaAvailability = unstable_cache(
  fetchEspnWnbaSlateAvailability,
  ["daily-edge-experience-wnba-availability-v3"],
  { revalidate: 15 * 60, tags: ["daily-edge-experience-wnba-availability"] },
);

const loadCachedMlbAvailability = unstable_cache(
  fetchPlaybookMlbSlateAvailability,
  ["daily-edge-experience-mlb-availability-v3"],
  { revalidate: 15 * 60, tags: ["daily-edge-experience-mlb-availability"] },
);

const loadCachedNhlAvailability = unstable_cache(
  fetchEspnNhlSlateAvailability,
  ["daily-edge-experience-nhl-availability-v2"],
  { revalidate: 15 * 60, tags: ["daily-edge-experience-nhl-availability"] },
);
