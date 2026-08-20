import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import {
  emptyPreviewSnapshot,
  loadDailyEdgeSnapshot,
  loadPitcherFirstInningHistory,
  loadTeamHistory,
} from "@/app/dev/experience-preview/page";
import { DAILY_EDGE_SPORT_KEYS } from "@/app/lab/lib/dailyEdgeSports";
import type { Sport } from "@/lib/types/domain/Sport";
import DailyEdgeLiveRefresh from "./DailyEdgeLiveRefresh";

export default async function CandidateDailyEdgePage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[]; league?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedSport = Array.isArray(query.sport) ? query.sport[0] : query.sport;
  const sourceSport = DAILY_EDGE_SPORT_KEYS.includes(requestedSport as Sport)
    ? (requestedSport as Sport)
    : "mlb";
  const requestedLeague = Array.isArray(query.league) ? query.league[0] : query.league;
  const soccerRequested = sourceSport === "soccer" || sourceSport === "ucl";
  const competition = !soccerRequested
    ? null
    : sourceSport === "ucl" || requestedLeague === "ucl" || requestedLeague === "champions-league"
      ? "champions_league"
      : requestedLeague === "epl"
        ? "premier_league"
        : "world_cup";
  const sport: Sport = soccerRequested ? "soccer" : sourceSport;
  const eplRequested = competition === "premier_league";
  const eplEnabled = process.env.PREMIER_LEAGUE_DAILY_EDGE_ENABLED === "true";
  const snapshot = eplRequested
    ? eplEnabled
      ? await (await import("@/lib/services/epl/eplMemberSnapshotStore")).readCurrentEplMemberSnapshot().then((value) => value ?? emptyPreviewSnapshot(sport))
      : emptyPreviewSnapshot(sport)
    : await loadDailyEdgeSnapshot(competition === "champions_league" ? "ucl" : sport).catch(() => emptyPreviewSnapshot(sport));
  const [history, pitcherFirstInningHistory] = await Promise.all([
    loadTeamHistory(snapshot, sport),
    loadPitcherFirstInningHistory(snapshot, sport),
  ]);

  return (
    <>
      <DailyEdgeLiveRefresh />
      <ActualDailyEdgePreview
        key={`${sport}-${snapshot.date}`}
        snapshot={snapshot}
        history={history}
        pitcherFirstInningHistory={pitcherFirstInningHistory}
        sport={sport}
        freshContractRead={false}
        reviewMode={false}
        soccerCompetition={competition === "premier_league"
          ? { active: "premier_league", label: "Premier League" }
          : competition === "champions_league"
            ? { active: "champions_league", label: "Champions League" }
            : competition === "world_cup"
              ? { active: "world_cup", label: "World Cup" }
              : undefined}
        weeklySlate={eplRequested ? { label: `Weekly Premier League slate · ${snapshot.games.length} matches`, previousHref: null, nextHref: null } : undefined}
      />
    </>
  );
}
