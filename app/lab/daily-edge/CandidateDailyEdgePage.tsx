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
import { unstable_cache } from "next/cache";
import { NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE } from "@/lib/services/football/nflForwardMemberSnapshotStore";
import { enrichCachedNflFootballEvidence } from "@/lib/services/football/footballMemberEvidence";
import DailyEdgeLiveRefresh from "./DailyEdgeLiveRefresh";
import { readMemberDataWithDeadline } from "@/lib/services/memberDataAvailability";

const readCachedNflForwardMemberSnapshot = unstable_cache(
  async (season: number, week: number) => {
    const [{ supabase }, { readNflForwardMemberSnapshot }] = await Promise.all([
      import("@/lib/db/supabase"),
      import("@/lib/services/football/nflForwardMemberSnapshotStore"),
    ]);
    return readNflForwardMemberSnapshot({ client: supabase, season, week });
  },
  [NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE],
  { revalidate: 15, tags: [NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE] },
);

const MEMBER_SPORT_SWITCH_DESTINATIONS: Partial<Record<Sport, string>> = {
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
  const cfbRequested = sport === "cfb";
  const nflEnabled = nflRequested && isNflDailyEdgeEnabled();
  const cfbEnabled = cfbRequested && process.env.CFB_DAILY_EDGE_ENABLED === "true";
  const nflWeekOneEvidenceEnabled = nflEnabled && isNflWeekOneEvidenceBoardEnabled();
  const nflSeason = Number(process.env.NFL_FORWARD_SEASON ?? "2026");
  const nflWeek = Number(process.env.NFL_FORWARD_WEEK ?? "1");
  const nflFixtureRead = !nflWeekOneEvidenceEnabled
    ? { value: null, unavailable: false, reason: "ok" as const }
    : await readMemberDataWithDeadline({
      label: "nfl-daily-edge-fixture",
      fallback: null,
      read: async () => {
        const fixture = await readCachedNflForwardMemberSnapshot(nflSeason, nflWeek)
          .then((value) => value?.fixture ? enrichCachedNflFootballEvidence(value.fixture) : null)
          .catch(() => null);
        if (fixture) return fixture;
        return Promise.all([
          import("@/lib/db/supabase"),
          import("@/lib/services/football/nflWeekOneHeldMemberFixture"),
        ])
          .then(([{ supabase }, { readCurrentNflWeekOneHeldMemberFixture }]) =>
            readCurrentNflWeekOneHeldMemberFixture({
              client: supabase,
              season: nflSeason,
              week: nflWeek,
            }));
      },
    });
  const nflWeekOneHeldFixture = nflFixtureRead.value;
  const nflFixture = nflWeekOneEvidenceEnabled
    ? nflWeekOneHeldFixture
    : !nflEnabled
    ? null
    : process.env.NODE_ENV !== "production"
      ? await (await import("@/lib/services/football/nflMemberSnapshotStore")).readCurrentNflMemberSnapshot()
      : null;
  const cfbFixtureRead = !cfbEnabled
    ? { value: null, unavailable: false, reason: "ok" as const }
    : await readMemberDataWithDeadline({
      label: "cfb-daily-edge-fixture",
      fallback: null,
      read: () => Promise.all([
        import("@/lib/db/supabase"),
        import("@/lib/services/football/cfbMemberFixture"),
      ])
        .then(([{ supabase }, { readCurrentCfbMemberFixture }]) =>
          readCurrentCfbMemberFixture({
            client: supabase,
            season: Number(process.env.CFB_FORWARD_SEASON ?? "2026"),
          })),
    });
  const cfbFixture = cfbFixtureRead.value;
  let snapshot: DailyEdgeResponse;
  let snapshotUnavailable = nflFixtureRead.unavailable || cfbFixtureRead.unavailable;
  if (nflFixture) {
    snapshot = nflFixture.snapshot;
  } else if (cfbFixture) {
    snapshot = cfbFixture.snapshot;
  } else if (nflRequested) {
    snapshot = emptyPreviewSnapshot(sport);
  } else if (cfbRequested) {
    snapshot = emptyPreviewSnapshot(sport);
  } else if (eplRequested && eplEnabled) {
    const result = await readMemberDataWithDeadline({
      label: "epl-daily-edge-snapshot",
      fallback: emptyPreviewSnapshot(sport, "temporarily_unavailable"),
      read: async () => (await import("@/lib/services/epl/eplMemberSnapshotStore"))
        .readCurrentEplMemberSnapshot()
        .then((value) => value ?? emptyPreviewSnapshot(sport)),
    });
    snapshot = result.value;
    snapshotUnavailable = result.unavailable;
  } else if (eplRequested) {
    snapshot = emptyPreviewSnapshot(sport);
  } else {
    const result = await readMemberDataWithDeadline({
      label: `${sport}-daily-edge-snapshot`,
      fallback: emptyPreviewSnapshot(sport, "temporarily_unavailable"),
      read: () => loadDailyEdgeSnapshot(competition === "champions_league" ? "ucl" : sport),
    });
    snapshot = result.value;
    snapshotUnavailable = result.unavailable;
  }
  if (snapshotUnavailable && snapshot.games.length === 0) {
    snapshot = emptyPreviewSnapshot(sport, "temporarily_unavailable");
  }
  if (nflFixture) {
    snapshot = filterWeeklyReaderSnapshot(snapshot, "nfl");
  } else if (cfbFixture) {
    snapshot = filterWeeklyReaderSnapshot(snapshot, "cfb");
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
  const historyRead: [
    Awaited<ReturnType<typeof loadTeamHistory>>,
    Awaited<ReturnType<typeof loadPitcherFirstInningHistory>>,
  ] = nflFixture || cfbFixture
    ? [(nflFixture ?? cfbFixture)!.history, {}]
    : (await readMemberDataWithDeadline({
        label: `${sport}-daily-edge-history`,
        fallback: [{}, {}] as [
          Awaited<ReturnType<typeof loadTeamHistory>>,
          Awaited<ReturnType<typeof loadPitcherFirstInningHistory>>,
        ],
        read: () => Promise.all([
          loadTeamHistory(snapshot, sport),
          loadPitcherFirstInningHistory(snapshot, sport),
        ]),
      })).value;
  const [history, pitcherFirstInningHistory] = historyRead;
  const cfbFbsGameCount = cfbFixture
    ? snapshot.games.filter((game) => game.collegeFootballScope === "fbs_involved").length
    : 0;

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
        activePreviewSports={nflFixture || nflWeekOneEvidenceEnabled ? ["nfl"] : cfbFixture || cfbEnabled ? ["cfb"] : []}
        sportSwitchDestinations={MEMBER_SPORT_SWITCH_DESTINATIONS}
        weeklySlate={nflFixture
          ? {
              label: `NFL · ${nflFixture.week.label} · ${snapshot.games.length} games · ${snapshot.games.length * 3} predictions · ${"heldMemberFixtureRelease" in nflFixture ? "live predictions and exact-price Bet grades" : nflFixture.tracking.seasonPhase === "preseason" ? "preseason is excluded from official tracking" : "tracking begins only with an approved pre-kickoff lock"}`,
              previousHref: null,
              nextHref: null,
              asOf: snapshot.as_of,
              cadenceLabel: "six-hour early evidence · hourly inside 48h · 15-minute T-60 checks",
            }
          : nflWeekOneEvidenceEnabled
            ? {
                label: "NFL · Regular Season Week 1 · evidence temporarily unavailable · model validation hold",
                previousHref: null,
                nextHref: null,
                displayGameCount: 0,
                asOf: snapshot.as_of,
                cadenceLabel: "six-hour early evidence · hourly inside 48h · 15-minute T-60 checks",
              }
          : cfbFixture
            ? {
                label: `CFB · ${cfbFixture.week.label} · ${cfbFbsGameCount} FBS-involved games by default · ${snapshot.games.length} model-covered Division I forecasts · live model and exact-price Bet grades`,
                previousHref: null,
                nextHref: null,
                asOf: snapshot.as_of,
                cadenceLabel: "six-hour beyond 48h · hourly inside 48h · T-60 lock",
              }
          : cfbEnabled
            ? {
                label: "CFB · Opening Week · evidence temporarily unavailable",
                previousHref: null,
                nextHref: null,
                displayGameCount: 0,
                asOf: snapshot.as_of,
                cadenceLabel: "six-hour beyond 48h · hourly inside 48h · T-60 lock",
              }
          : eplRequested && eplEnabled
            ? { label: `Weekly Premier League slate · ${snapshot.games.length} matches`, previousHref: null, nextHref: null }
            : undefined}
      />
    </>
  );
}
