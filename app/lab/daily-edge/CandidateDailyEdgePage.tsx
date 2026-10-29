import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import {
  emptyPreviewSnapshot,
  loadDailyEdgeSnapshot,
  loadPublishedDailyEdgeSnapshot,
  loadPitcherFirstInningHistory,
  loadTeamHistory,
} from "@/app/dev/experience-preview/previewData";
import { resolveDailyEdgeSport } from "@/app/lab/lib/dailyEdgeSports";
import {
  isNflDailyEdgeEnabled,
  isNflWeekOneEvidenceBoardEnabled,
} from "@/lib/config/nflDailyEdge";
import type { Sport } from "@/lib/types/domain/Sport";
import DailyEdgeLiveRefresh from "./DailyEdgeLiveRefresh";
import { readMemberDataWithDeadline } from "@/lib/services/memberDataAvailability";
import { resolveUclFeatureFlags } from "@/lib/services/ucl/uclFeatureFlags";
import { CBB_ACTIVATION } from "@/lib/cbb/releases";
import { currentSlateDate } from "@/lib/dates/slateDate";

// The canonical weekly snapshot retains every game's full reader evidence.
// Keep the read bounded, but do not turn a healthy transfer into a false
// empty-board state; unopened evidence is projected out below.
const CFB_MEMBER_DATA_READ_TIMEOUT_MS = 20_000;

const MEMBER_SPORT_SWITCH_DESTINATIONS: Partial<Record<Sport, string>> = {
  mlb: "/lab/daily-edge?sport=mlb",
  wnba: "/lab/daily-edge?sport=wnba",
  nba: "/lab/daily-edge?sport=nba",
  nhl: "/lab/daily-edge?sport=nhl",
  cbb: "/lab/daily-edge?sport=cbb",
  nfl: "/lab/daily-edge?sport=nfl",
  cfb: "/lab/daily-edge?sport=cfb",
};

export default async function CandidateDailyEdgePage({
  searchParams,
}: {
  searchParams: Promise<{
    sport?: string | string[];
    league?: string | string[];
    game?: string | string[];
    market?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const requestedSport = Array.isArray(query.sport) ? query.sport[0] : query.sport;
  const sourceSport = resolveDailyEdgeSport(requestedSport);
  const requestedLeague = Array.isArray(query.league) ? query.league[0] : query.league;
  const requestedGame = Array.isArray(query.game) ? query.game[0] : query.game;
  const soccerRequested = sourceSport === "soccer" || sourceSport === "ucl";
  const competition = !soccerRequested
    ? null
    : sourceSport === "ucl" || requestedLeague === "ucl" || requestedLeague === "champions-league"
      ? "champions_league"
      : requestedLeague === "epl"
        ? "premier_league"
        : "world_cup";
  const sport: Sport = soccerRequested ? "soccer" : sourceSport;
  const cbbPublicationEnabled = sport === "cbb" && CBB_ACTIVATION.memberPublication &&
    process.env.CBB_DAILY_EDGE_ENABLED === "true";
  const publishedSnapshotOnly = sport === "mlb" || sport === "nba" || sport === "nhl" || sport === "wnba" || cbbPublicationEnabled;
  const eplRequested = competition === "premier_league";
  const eplEnabled = process.env.PREMIER_LEAGUE_DAILY_EDGE_ENABLED === "true";
  const uclRequested = competition === "champions_league";
  const uclEnabled = resolveUclFeatureFlags().member;
  const sportSwitchDestinations: Partial<Record<Sport, string>> = {
    ...MEMBER_SPORT_SWITCH_DESTINATIONS,
    soccer: eplEnabled
      ? "/lab/daily-edge?sport=soccer&league=epl"
      : uclEnabled
        ? "/lab/daily-edge?sport=soccer&league=ucl"
        : "/lab/daily-edge?sport=soccer&league=world-cup",
  };
  const nflRequested = sport === "nfl";
  const cfbRequested = sport === "cfb";
  const nflEnabled = nflRequested && isNflDailyEdgeEnabled();
  const cfbEnabled = cfbRequested && process.env.CFB_DAILY_EDGE_ENABLED === "true";
  const nflWeekOneEvidenceEnabled = nflEnabled && isNflWeekOneEvidenceBoardEnabled();
  const nflSeason = Number(process.env.NFL_FORWARD_SEASON ?? "2026");
  const configuredNflWeek = Number(process.env.NFL_FORWARD_WEEK ?? "1");
  const nflWeek = nflRequested
    ? (await import("@/lib/services/football/nflForwardWeekSelection")).resolveNflForwardWeek({
        season: nflSeason,
        configuredWeek: configuredNflWeek,
      })
    : configuredNflWeek;
  const nflFixtureRead = !nflWeekOneEvidenceEnabled
    ? { value: null, unavailable: false, reason: "ok" as const }
    : await readMemberDataWithDeadline({
      label: "nfl-daily-edge-fixture",
      fallback: null,
      read: async () => {
        const fixture = await import("@/lib/services/football/nflMemberReader")
          .then(({ readCachedNflMemberFixture }) =>
            readCachedNflMemberFixture(nflSeason, nflWeek))
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
      timeoutMs: CFB_MEMBER_DATA_READ_TIMEOUT_MS,
      read: async () => (await import("@/lib/services/football/cfbMemberReader"))
        .readResilientCfbMemberFixture(
          Number(process.env.CFB_FORWARD_SEASON ?? "2026"),
        ),
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
  } else if (uclRequested && uclEnabled) {
    const result = await readMemberDataWithDeadline({
      label: "ucl-daily-edge-snapshot",
      fallback: emptyPreviewSnapshot(sport, "temporarily_unavailable"),
      read: async () => (await import("@/lib/services/ucl/uclMemberSnapshotStore"))
        .readCurrentUclMemberSnapshot()
        .then((value) => value ?? emptyPreviewSnapshot(sport)),
    });
    snapshot = result.value;
    snapshotUnavailable = result.unavailable;
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
  } else if (eplRequested || uclRequested) {
    snapshot = emptyPreviewSnapshot(sport);
  } else {
    const result = await readMemberDataWithDeadline({
      label: `${sport}-daily-edge-snapshot`,
      fallback: emptyPreviewSnapshot(sport, "temporarily_unavailable"),
      read: () => publishedSnapshotOnly
        ? loadPublishedDailyEdgeSnapshot(sport)
        : loadDailyEdgeSnapshot(sport),
    });
    snapshot = result.value;
    snapshotUnavailable = result.unavailable;
  }
  if (snapshotUnavailable && snapshot.games.length === 0) {
    snapshot = emptyPreviewSnapshot(sport, "temporarily_unavailable");
  }
  if (cbbPublicationEnabled && !snapshotUnavailable) {
    const scheduleRead = await readMemberDataWithDeadline({
      label: "cbb-seven-day-schedule",
      fallback: null,
      read: async () => (await import("@/lib/services/cbb/cbbRollingSchedule"))
        .loadCbbRollingSchedule(currentSlateDate("cbb")),
    });
    if (scheduleRead.value) {
      snapshot.cbbRollingSchedule = (await import("@/lib/services/cbb/cbbRollingSchedule"))
        .excludeAnalyzedCbbScheduleGames(scheduleRead.value,
          snapshot.games.map((game) => game.external_id));
    } else if (scheduleRead.unavailable && snapshot.games.length === 0) {
      snapshot = emptyPreviewSnapshot(sport, "temporarily_unavailable");
    }
  }
  if (nflFixture) {
    snapshot = (await import("@/lib/services/dailyEdge/weeklyReaderLifecycle"))
      .filterWeeklyReaderSnapshot(snapshot, "nfl");
  } else if (cfbFixture) {
    snapshot = (await import("@/lib/services/dailyEdge/weeklyReaderLifecycle"))
      .filterWeeklyReaderSnapshot(snapshot, "cfb");
  } else if ((eplRequested && eplEnabled) || (uclRequested && uclEnabled)) {
    snapshot = (await import("@/lib/services/dailyEdge/weeklyReaderLifecycle"))
      .filterWeeklyReaderSnapshot(snapshot, "soccer");
  }
  const initialCfbReaderGameId = cfbFixture && requestedGame && snapshot.games.some((game) => game.id === requestedGame)
    ? requestedGame
    : null;
  const initialNflReaderGameId = nflFixture && requestedGame && snapshot.games.some((game) => game.id === requestedGame)
    ? requestedGame
    : null;
  // Display-only source hierarchy: current Circa remains authoritative, while
  // a complete DraftKings pair silently occupies the same established split
  // card when Circa is absent. Provider identity stays in the DTO for audit;
  // predictions, recommendations, grades, and member-facing copy are untouched.
  let splitFallbackPromise: Promise<unknown> | null = null;
  if (cfbFixture && initialCfbReaderGameId) {
    const { populateDailyEdgeStoredSplitFallback } = await import(
      "@/lib/providers/draftkings/draftKingsNetworkSplits"
    );
    await populateDailyEdgeStoredSplitFallback(snapshot, "cfb", {
      reconstructMissingLockedPreLock: true,
    });
  } else if (!cfbFixture && !publishedSnapshotOnly) {
    // Direct weekly and competition snapshots use only the durable rows
    // captured by their scheduled writers. Never contact providers while a
    // member is waiting for sport navigation to finish.
    splitFallbackPromise = import("@/lib/providers/draftkings/draftKingsNetworkSplits")
      .then(({ populateDailyEdgeStoredSplitFallback }) =>
        populateDailyEdgeStoredSplitFallback(snapshot, uclRequested ? "ucl" : sport));
  }
  const cfbBoardProjection = cfbFixture
    ? (await import("@/lib/services/football/cfbMemberBoardProjection"))
      .projectCfbSnapshotForInitialBoard({ snapshot, fullReaderGameId: initialCfbReaderGameId })
    : null;
  if (cfbBoardProjection) snapshot = cfbBoardProjection.snapshot;
  const nflBoardProjection = nflFixture
    ? (await import("@/lib/services/football/nflMemberBoardProjection"))
      .projectNflSnapshotForInitialBoard({ snapshot, fullReaderGameId: initialNflReaderGameId })
    : null;
  if (nflBoardProjection) snapshot = nflBoardProjection.snapshot;
  // Retain the established prop identifier because shared football reader
  // regression tests treat it as part of the page contract. CFB uses the same
  // existing availability surface when its fixture is active.
  const visibleNflAvailability = nflFixture
    ? Object.fromEntries(
        snapshot.games.flatMap((game) => {
          const availability = nflFixture.availability[game.id];
          return availability ? [[game.id, availability]] : [];
        }),
      )
    : cfbFixture
      ? Object.fromEntries(
          snapshot.games.flatMap((game) => {
            if (game.id !== initialCfbReaderGameId) return [];
            // Stored CFB fixtures retain the provider game id as the
            // availability key, while member game DTOs use the `cfb-` prefix.
            // Resolve both forms so verified reports reach the existing panel
            // during the compact-snapshot transition.
            const providerGameId = game.id.startsWith("cfb-") ? game.id.slice(4) : game.id;
            const availability = cfbFixture.availability?.[game.id] ??
              cfbFixture.availability?.[providerGameId];
            return availability ? [[game.id, availability]] : [];
          }),
        )
      : undefined;
  const historyReadPromise: Promise<[
    Awaited<ReturnType<typeof loadTeamHistory>>,
    Awaited<ReturnType<typeof loadPitcherFirstInningHistory>>,
  ]> = nflFixture || cfbFixture
    ? Promise.resolve([(nflFixture ?? cfbFixture)!.history, {}])
    : readMemberDataWithDeadline({
        label: `${sport}-daily-edge-history`,
        fallback: [{}, {}] as [
          Awaited<ReturnType<typeof loadTeamHistory>>,
          Awaited<ReturnType<typeof loadPitcherFirstInningHistory>>,
        ],
        read: () => Promise.all([
          loadTeamHistory(
            snapshot,
            sport,
            uclRequested ? "uefa_champions_league" : eplRequested ? "english_premier_league" : sport === "soccer" ? "fifa_world_cup" : undefined,
          ),
          loadPitcherFirstInningHistory(snapshot, sport),
        ]),
      }).then((result) => result.value);
  const [historyRead] = await Promise.all([
    historyReadPromise,
    splitFallbackPromise ?? Promise.resolve(null),
  ]);
  const [history, pitcherFirstInningHistory] = historyRead;
  const cfbFbsGameCount = cfbFixture
    ? snapshot.games.filter((game) => game.collegeFootballScope === "fbs_involved").length
    : 0;
  const nbaRollingBoard = sport === "nba" && snapshot.games.length > 0;
  const cbbRollingBoard = cbbPublicationEnabled &&
    (snapshot.games.length > 0 || (snapshot.cbbRollingSchedule?.games.length ?? 0) > 0);
  const activePreviewSports: Sport[] = [
    ...(nflFixture || nflWeekOneEvidenceEnabled ? ["nfl" as const] : []),
    ...(cfbFixture || cfbEnabled ? ["cfb" as const] : []),
    ...(nbaRollingBoard ? ["nba" as const] : []),
    ...(cbbRollingBoard ? ["cbb" as const] : []),
  ];

  return (
    <>
      <DailyEdgeLiveRefresh initialGameCount={snapshot.games.length} />
      <ActualDailyEdgePreview
        key={`${sport}-${snapshot.date}`}
        snapshot={snapshot}
        history={history}
        pitcherFirstInningHistory={pitcherFirstInningHistory}
        initialAvailability={visibleNflAvailability}
        deferredCfbGameIds={cfbBoardProjection?.deferredGameIds}
        deferredNflGameIds={nflBoardProjection?.deferredGameIds}
        sport={sport}
        freshContractRead={false}
        reviewMode={false}
        soccerCompetition={competition === "premier_league" && eplEnabled
          ? { active: "premier_league", label: "Premier League", eplAvailable: true, uclAvailable: uclEnabled }
          : competition === "champions_league" && uclEnabled
            ? { active: "champions_league", label: "Champions League", eplAvailable: eplEnabled, uclAvailable: true }
          : sport === "soccer"
              ? { active: "world_cup", label: "World Cup", eplAvailable: eplEnabled, uclAvailable: uclEnabled }
              : undefined}
        activePreviewSports={activePreviewSports}
        sportSwitchDestinations={sportSwitchDestinations}
        weeklySlate={nbaRollingBoard
          ? {
              label: `NBA · Next 7 Days · ${snapshot.games.length} games · ${snapshot.games.length * 3} predictions · live model and exact-price Bet grades`,
              previousHref: null,
              nextHref: null,
              asOf: snapshot.as_of,
              cadenceLabel: "hourly board · T-60 lock",
            }
          : cbbRollingBoard
            ? {
                label: `CBB · Next 7 Days · ${snapshot.games.length} analyzed games · ${snapshot.cbbRollingSchedule?.games.length ?? 0} schedule-only games`,
                previousHref: null,
                nextHref: null,
                asOf: snapshot.as_of,
                cadenceLabel: "game-timed refresh · T-60 lock",
              }
          : nflFixture
          ? {
              label: `NFL · ${nflFixture.week.label} · ${snapshot.games.length} games · ${snapshot.games.length * 3} predictions · ${"heldMemberFixtureRelease" in nflFixture ? "live predictions and exact-price Bet grades" : nflFixture.tracking.seasonPhase === "preseason" ? "preseason is excluded from official tracking" : "tracking begins only with an approved pre-kickoff lock"}`,
              previousHref: null,
              nextHref: null,
              asOf: snapshot.as_of,
              cadenceLabel: "hourly evidence · 15-minute T-60 checks",
            }
          : nflWeekOneEvidenceEnabled
            ? {
                label: `NFL · Regular Season Week ${nflWeek} · evidence temporarily unavailable`,
                previousHref: null,
                nextHref: null,
                displayGameCount: 0,
                asOf: snapshot.as_of,
                cadenceLabel: "hourly evidence · 15-minute T-60 checks",
              }
          : cfbFixture
            ? {
                label: `CFB · ${cfbFixture.week.label} · ${cfbFbsGameCount} FBS-involved games by default · ${snapshot.games.length} model-covered Division I forecasts · live model and exact-price Bet grades`,
                previousHref: null,
                nextHref: null,
                asOf: snapshot.as_of,
                cadenceLabel: "hourly evidence · T-60 lock",
              }
          : cfbEnabled
            ? {
                label: "CFB · Weekly slate · evidence temporarily unavailable",
                previousHref: null,
                nextHref: null,
                displayGameCount: 0,
                unavailable: true,
                asOf: snapshot.as_of,
                cadenceLabel: "hourly evidence · T-60 lock",
              }
          : eplRequested && eplEnabled
            ? { label: `Weekly Premier League slate · ${snapshot.games.length} matches`, previousHref: null, nextHref: null }
            : undefined}
      />
    </>
  );
}
