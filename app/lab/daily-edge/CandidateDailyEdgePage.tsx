import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import {
  emptyPreviewSnapshot,
  loadDailyEdgeSnapshot,
  loadPitcherFirstInningHistory,
  loadTeamHistory,
} from "@/app/dev/experience-preview/page";
import { DAILY_EDGE_SPORT_KEYS } from "@/app/lab/lib/dailyEdgeSports";
import type { Sport } from "@/lib/types/domain/Sport";

export default async function CandidateDailyEdgePage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedSport = query.sport;
  const sport = DAILY_EDGE_SPORT_KEYS.includes(requestedSport as Sport)
    ? (requestedSport as Sport)
    : "mlb";
  const snapshot = await loadDailyEdgeSnapshot(sport).catch(() => emptyPreviewSnapshot(sport));
  const [history, pitcherFirstInningHistory] = await Promise.all([
    loadTeamHistory(snapshot, sport),
    loadPitcherFirstInningHistory(snapshot, sport),
  ]);

  return (
    <ActualDailyEdgePreview
      key={`${sport}-${snapshot.date}`}
      snapshot={snapshot}
      history={history}
      pitcherFirstInningHistory={pitcherFirstInningHistory}
      sport={sport}
      freshContractRead={false}
      reviewMode={false}
    />
  );
}
