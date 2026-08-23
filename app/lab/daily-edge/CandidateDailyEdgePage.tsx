import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import {
  emptyPreviewSnapshot,
  loadDailyEdgeSnapshot,
  loadPitcherFirstInningHistory,
  loadTeamHistory,
} from "@/app/dev/experience-preview/page";
import { DAILY_EDGE_SPORT_KEYS } from "@/app/lab/lib/dailyEdgeSports";
import {
  isNflDailyEdgeEnabled,
  isNflWeekOneEvidenceBoardEnabled,
} from "@/lib/config/nflDailyEdge";
import { filterWeeklyReaderSnapshot } from "@/lib/services/dailyEdge/weeklyReaderLifecycle";
import type { Sport } from "@/lib/types/domain/Sport";
import DailyEdgeLiveRefresh from "./DailyEdgeLiveRefresh";

const NFL_SPORT_SWITCH_DESTINATIONS: Partial<Record<Sport, string>> = {
  mlb: "/lab/daily-edge?sport=mlb",
  wnba: "/lab/daily-edge?sport=wnba",
  soccer: "/lab/daily-edge?sport=soccer&league=epl",
  nba: "/lab/daily-edge?sport=nba",
  nhl: "/lab/daily-edge?sport=nhl",
  cbb: "/lab/daily-edge?sport=cbb",
  nfl: "/lab/daily-edge?sport=nfl",
  cfb: "/lab/daily-edge?sport=cfb",
};

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
  const nflRequested = sport === "nfl";
  const nflEnabled = nflRequested && isNflDailyEdgeEnabled();
  const nflWeekOneEvidenceEnabled = nflEnabled && isNflWeekOneEvidenceBoardEnabled();
  const nflWeekOneHeldFixture = !nflWeekOneEvidenceEnabled
    ? null
    : await Promise.all([
        import("@/lib/db/supabase"),
        import("@/lib/services/football/nflWeekOneHeldMemberFixture"),
      ])
        .then(([{ supabase }, { readCurrentNflWeekOneHeldMemberFixture }]) =>
          readCurrentNflWeekOneHeldMemberFixture({
            client: supabase,
            season: Number(process.env.NFL_FORWARD_SEASON ?? "2026"),
            week: Number(process.env.NFL_FORWARD_WEEK ?? "1"),
          }))
        .catch(() => null);
  const nflFixture = nflWeekOneEvidenceEnabled
    ? nflWeekOneHeldFixture
    : !nflEnabled
    ? null
    : process.env.NODE_ENV !== "production"
      ? await (await import("@/lib/services/football/nflMemberSnapshotStore")).readCurrentNflMemberSnapshot()
      : await (await import("@/lib/services/football/nflPublishedMemberSnapshotStore"))
          .readCurrentNflPublishedMemberSnapshot()
          .then((published) => published?.fixture ?? null);
  let snapshot: DailyEdgeResponse;
  if (nflFixture) {
    snapshot = nflFixture.snapshot;
  } else if (nflRequested) {
    snapshot = emptyPreviewSnapshot(sport);
  } else if (eplRequested && eplEnabled) {
    snapshot = await (await import("@/lib/services/epl/eplMemberSnapshotStore"))
      .readCurrentEplMemberSnapshot()
      .then((value) => value ?? emptyPreviewSnapshot(sport));
  } else if (eplRequested) {
    snapshot = emptyPreviewSnapshot(sport);
  } else {
    snapshot = await loadDailyEdgeSnapshot(competition === "champions_league" ? "ucl" : sport)
      .catch(() => emptyPreviewSnapshot(sport));
  }
  const weeklySourceGameCount = snapshot.games.length;
  if (nflFixture) {
    snapshot = filterWeeklyReaderSnapshot(snapshot, "nfl");
  } else if (eplRequested && eplEnabled) {
    snapshot = filterWeeklyReaderSnapshot(snapshot, "soccer");
  }
  const visibleNflAvailability = nflFixture
    ? Object.fromEntries(
        snapshot.games.flatMap((game) => {
          const availability = nflFixture.availability[game.id];
          return availability ? [[game.id, availability]] : [];
        }),
      )
    : undefined;
  const [history, pitcherFirstInningHistory] = nflFixture
    ? [nflFixture.history, {}]
    : await Promise.all([
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
        initialAvailability={visibleNflAvailability}
        sport={sport}
        freshContractRead={false}
        reviewMode={false}
        soccerCompetition={competition === "premier_league" && eplEnabled
          ? { active: "premier_league", label: "Premier League" }
          : competition === "champions_league"
            ? { active: "champions_league", label: "Champions League" }
            : competition === "world_cup"
              ? { active: "world_cup", label: "World Cup" }
              : undefined}
        activePreviewSports={nflFixture || nflWeekOneEvidenceEnabled ? ["nfl"] : []}
        sportSwitchDestinations={nflFixture || nflWeekOneEvidenceEnabled ? NFL_SPORT_SWITCH_DESTINATIONS : undefined}
        weeklySlate={nflFixture
          ? {
              label: `NFL · ${nflFixture.week.label} · ${snapshot.games.length} games · ${snapshot.games.length * 3} predictions · ${"heldMemberFixtureRelease" in nflFixture ? "Bet grades held inside the normal Daily Edge reader" : nflFixture.tracking.seasonPhase === "preseason" ? "preseason is excluded from official tracking" : "tracking begins only with an approved pre-kickoff lock"}`,
              evidence: `${"heldMemberFixtureRelease" in nflFixture ? "Captured" : "Stored"} ${new Date("capturedAt" in nflFixture ? nflFixture.capturedAt : nflFixture.storedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET · schedule, named-book odds, injuries and depth from BALLDONTLIE · ${nflFixture.provenance.firstObservedCoverageGames}/${weeklySourceGameCount} weekly same-book Opening trails · ${nflFixture.provenance.splitCoverageGames}/${weeklySourceGameCount} weekly Playbook public-consensus split sets${"heldMemberFixtureRelease" in nflFixture ? " · independent score and winner forecasts shown separately · exact-price Bet grades remain Held until an authoritative evaluated tuple qualifies" : nflFixture.tracking.seasonPhase === "preseason" ? " (unavailable for this preseason slate)" : " (context-only until chronologically validated)"} · ${snapshot.games.length} games currently displayed`,
              previousHref: null,
              nextHref: null,
              asOf: snapshot.as_of,
              cadenceLabel: "six-hour early evidence · hourly inside 48h · 15-minute T-60 checks",
            }
          : nflWeekOneEvidenceEnabled
            ? {
                label: "NFL · Regular Season Week 1 · evidence temporarily unavailable · model validation hold",
                evidence: "The stale preseason package is retired from the member reader. Week 1 evidence could not be verified for this request, so the board fails closed instead of restoring an older slate.",
                previousHref: null,
                nextHref: null,
                displayGameCount: 0,
                asOf: snapshot.as_of,
                cadenceLabel: "six-hour early evidence · hourly inside 48h · 15-minute T-60 checks",
              }
          : eplRequested && eplEnabled
            ? { label: `Weekly Premier League slate · ${snapshot.games.length} matches`, previousHref: null, nextHref: null }
            : undefined}
      />
    </>
  );
}
