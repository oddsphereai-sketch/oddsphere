import { notFound } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import type { Sport } from "@/lib/types/domain/Sport";
import { isDailyEdgeExperiencePreviewAvailable } from "@/lib/config/dailyEdgeExperience";
import {
  AVAILABLE_DAILY_EDGE_SPORTS,
  DAILY_EDGE_SPORT_KEYS,
} from "@/app/lab/lib/dailyEdgeSports";
import ActualDailyEdgePreview from "./ActualDailyEdgePreview";
import {
  emptyPreviewSnapshot,
  loadCachedFreshContractSnapshot,
  loadDailyEdgeSnapshot,
  loadPitcherFirstInningHistory,
  loadTeamHistory,
} from "./previewData";

export const metadata = {
  title: "OddSphere Experience Preview",
  robots: { index: false, follow: false },
};

type PreviewSearchParams = Promise<{
  sport?: string | string[];
  date?: string | string[];
  fresh?: string | string[];
}>;

export default async function PrivateExperiencePreviewPage({
  searchParams,
}: {
  searchParams: PreviewSearchParams;
}) {
  if (!isDailyEdgeExperiencePreviewAvailable()) notFound();

  const query = await searchParams;
  const requestedSport = query.sport;
  const sport = DAILY_EDGE_SPORT_KEYS.includes(requestedSport as Sport)
    ? (requestedSport as Sport)
    : "mlb";
  const requestedDate =
    typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
      ? query.date
      : undefined;
  const freshContractRead = query.fresh === "1";

  const snapshot = AVAILABLE_DAILY_EDGE_SPORTS.includes(sport)
    ? freshContractRead
      ? await loadCachedFreshContractSnapshot(sport, requestedDate ?? "")
      : await loadDailyEdgeSnapshot(sport, requestedDate)
    : emptyPreviewSnapshot(sport);
  const [history, pitcherFirstInningHistory] = await Promise.all([
    loadTeamHistory(snapshot, sport),
    loadPitcherFirstInningHistory(snapshot, sport),
  ]);

  return (
    <ProductAppFrame>
      <ActualDailyEdgePreview
        key={`${sport}-${snapshot.date}`}
        snapshot={snapshot}
        history={history}
        pitcherFirstInningHistory={pitcherFirstInningHistory}
        sport={sport}
        freshContractRead={freshContractRead}
        reviewMode
        soccerCompetition={sport === "soccer"
          ? { active: "world_cup", label: "World Cup" }
          : sport === "ucl"
            ? { active: "champions_league", label: "Champions League" }
            : undefined}
      />
    </ProductAppFrame>
  );
}
