import type { SupabaseClient } from "@supabase/supabase-js";
import type { IWeatherProvider } from "@/lib/providers/interfaces/IWeatherProvider";
import { isPublicallyTracked } from "@/lib/config/officialTrackingStart";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { PlaybookClient } from "@/lib/providers/playbook/playbookClient";
import type { PlaybookLineGame, PlaybookSplitGame } from "@/lib/providers/playbook/types";
import { fetchBalldontlieNflSlateAvailability } from "./balldontlieNflAvailability";
import { fetchBalldontlieNflRegularSlate, type NflPreviewBookOdds, type NflPreviewGame } from "./balldontlieNflPreviewSlate";
import { fetchBalldontlieNflTeamDepthSnapshots } from "./balldontlieNflRoster";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  determineNflForwardCollectionNeed,
  hashNflForwardEvidencePayload,
  planNflForwardEvidenceCaptures,
  type NflForwardEvidencePayload,
  type NflForwardOperationalOpening,
  type NflForwardPlaybookLine,
  type NflForwardPlaybookSplitSet,
  type NflForwardStoredEvidence,
  type NflForwardTeamDepthSnapshot,
} from "./nflForwardEvidence";
import {
  appendNflForwardEvidence,
  readLegacyNflForwardEvidence,
  readNflForwardEvidence,
  readPriorNflForwardEvidence,
  readPreviousNflForwardEvidence,
} from "./nflForwardEvidenceStore";
import { collectNflForwardWeather } from "./nflVenueWeather";
import {
  completeSharpApiNflSplitSet,
  fetchSharpApiNflSplits,
  type NflRegularSharpSplitSet,
} from "./sharpApiNflSplits";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "./nflRegularDecisionEvidence";
import { buildNflR6ShadowMoneylineDecision } from "./nflR6MoneylineShadow";
import { assertFootballCrossMarketCoherence } from "./footballCrossMarketCoherence";
import {
  buildNflV1ActionableGradeBundle,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
} from "./nflV1ActionableGradeCandidate";
import {
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";
import { nflForwardT60TrackingEligibility } from "./nflTrackingLifecycle";
import {
  buildNflOfficialTrackingRecords,
  nflProviderIntegerId,
} from "./nflOfficialTrackingRecord";
import { buildMarketScopedFootballTrackingPlan } from "./footballMarketScopedTracking";
import { buildNflWeekOneHeldMemberFixture } from "./nflWeekOneHeldMemberFixture";
import {
  buildNflForwardMemberSnapshot,
  writeNflForwardMemberSnapshot,
} from "./nflForwardMemberSnapshotStore";

export const NFL_FORWARD_WRITER_RELEASE =
  "nfl_forward_evidence_writer_2026_08_31_r16_market_split_injury" as const;

export type NflForwardWriterResult = {
  writerRelease: typeof NFL_FORWARD_WRITER_RELEASE;
  collected: boolean;
  collectionReason: string;
  proposed: number;
  inserted: number;
  games: number;
  stages: Record<"opening" | "unlocked" | "t60", number>;
  quarterbackHealthReasons: string[];
  publishedEvaluations: number;
  publishedBestAngles: number;
  publishedLeans: number;
  publishedWatchlists: number;
  publishedNoPlays: number;
  publishedHeldGames: number;
  apiCallsMaximum: number;
  healthHolds: string[];
  publicationAttempted: boolean;
  memberSnapshotAttempted: boolean;
  memberSnapshotUpdated: boolean;
  memberSnapshotKey: string | null;
  memberSnapshotError: string | null;
  trackingAttempted: boolean;
  trackingRecordsProposed: number;
  trackingRecordsInserted: number;
  trackingRecordsExisting: number;
};

type NflTrackingWriteResult = Pick<
  NflForwardWriterResult,
  "trackingAttempted" | "trackingRecordsProposed" | "trackingRecordsInserted" | "trackingRecordsExisting"
>;

type NflMemberSnapshotWriteResult = Pick<
  NflForwardWriterResult,
  "memberSnapshotAttempted" | "memberSnapshotUpdated" | "memberSnapshotKey" | "memberSnapshotError"
>;

export async function runNflForwardEvidenceWriter(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  runId: string;
  now: string;
  apply: boolean;
  balldontlieApiKey: string;
  playbookApiKey: string;
  sharpApiKey: string;
  weatherProvider: IWeatherProvider | null;
}): Promise<NflForwardWriterResult> {
  const [existing, previousExisting, priorExisting, legacyExisting] = await Promise.all([
    readNflForwardEvidence({ client: args.client, season: args.season, week: args.week }),
    readPreviousNflForwardEvidence({ client: args.client, season: args.season, week: args.week }),
    readPriorNflForwardEvidence({ client: args.client, season: args.season, week: args.week }),
    readLegacyNflForwardEvidence({ client: args.client, season: args.season, week: args.week }),
  ]);
  const historicalExisting = [...legacyExisting, ...priorExisting, ...previousExisting, ...existing];
  const need = determineNflForwardCollectionNeed({
    existing,
    now: args.now,
    requiredPublicRelease: {
      memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      evaluatedBetCount: 3,
    },
  });
  if (!need.collect) {
    const tracking = await writeOfficialTrackingFromPayloads({
      client: args.client,
      payloads: currentT60Payloads(existing),
      apply: args.apply,
    });
    const memberSnapshot = await refreshCompactMemberSnapshot({
      client: args.client,
      existing,
      payloads: [],
      season: args.season,
      week: args.week,
      now: args.now,
      apply: args.apply,
    });
    return emptyResult(need.reason, tracking, memberSnapshot);
  }

  const slate = await fetchBalldontlieNflRegularSlate({
    season: args.season,
    week: args.week,
    apiKey: args.balldontlieApiKey,
  });
  const plans = planNflForwardEvidenceCaptures({
    games: slate.games,
    existing,
    capturedAt: args.now,
    unlockedCadenceMinutes: need.cadenceMinutes ?? 60,
  });
  if (plans.length === 0) {
    const tracking = await writeOfficialTrackingFromPayloads({
      client: args.client,
      payloads: currentT60Payloads(existing),
      apply: args.apply,
    });
    const memberSnapshot = await refreshCompactMemberSnapshot({
      client: args.client,
      existing,
      payloads: [],
      season: args.season,
      week: args.week,
      now: args.now,
      apply: args.apply,
    });
    return emptyResult("provider_slate_has_no_due_capture", tracking, memberSnapshot);
  }

  const criticalTeamIds = new Set(plans
    .filter((plan) => plan.stage === "opening" || plan.stage === "t60")
    .flatMap((plan) => [plan.game.away.id, plan.game.home.id]));
  const criticalTeams = slate.games.flatMap((game) => [game.away, game.home])
    .filter((team, index, rows) => criticalTeamIds.has(team.id) && rows.findIndex((row) => row.id === team.id) === index);

  const playbook = new PlaybookClient(args.playbookApiKey);
  const [rosters, availability, linesResult, splitsResult, sharpResult] = await Promise.all([
    fetchBalldontlieNflTeamDepthSnapshots({
      teams: criticalTeams,
      season: args.season,
      capturedAt: args.now,
      apiKey: args.balldontlieApiKey,
    }),
    fetchBalldontlieNflSlateAvailability(slate.games.map((game) => ({
      id: game.providerGameId,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      awayTeamId: game.away.id,
      homeTeamId: game.home.id,
    })), { apiKey: args.balldontlieApiKey }),
    playbook.lines("nfl").then((result) => result.body.data ?? []).catch(() => null),
    playbook.splits("nfl").then((result) => result.body.data ?? []).catch(() => null),
    fetchSharpApiNflSplits({ apiKey: args.sharpApiKey, games: slate.games, capturedAt: args.now })
      .catch(() => ({
        splitsByGame: {} as Record<string, NflRegularSharpSplitSet>,
        requests: 1,
        rows: 0,
        dates: [],
      })),
  ]);

  const availabilityByGame = new Map((availability ?? []).map((row) => [row.eventId, row]));
  const linesByGame = matchPlaybookRowsOptional(slate.games, linesResult ?? []);
  const splitsByGame = matchPlaybookRowsOptional(slate.games, splitsResult ?? []);
  const weatherByGame = new Map<string, Awaited<ReturnType<typeof collectNflForwardWeather>>>();
  for (const game of uniquePlannedGames(plans.map((plan) => plan.game))) {
    const stages = plans.filter((plan) => plan.game.providerGameId === game.providerGameId).map((plan) => plan.stage);
    const stage = stages.includes("t60") ? "t60" : stages.includes("opening") ? "opening" : "unlocked";
    weatherByGame.set(game.providerGameId, await collectNflForwardWeather({
      homeTeam: game.home.abbreviation,
      gameStartsAt: game.scheduledStart,
      stage,
      capturedAt: args.now,
      provider: args.weatherProvider,
    }));
  }
  const weatherRequests = [...weatherByGame.values()].reduce((sum, value) => sum + value.requests, 0);
  const apiCallsMaximum = slate.providerRequests + rosters.requests + 4 + 2 + sharpResult.requests + weatherRequests;

  const payloadBuildHolds: string[] = [];
  const payloads = plans.flatMap((plan): NflForwardEvidencePayload[] => {
    try {
    const current = requiredCurrentOdds(slate.currentOddsByGame[plan.game.providerGameId], plan.game.providerGameId);
    const currentBooks = requiredCurrentBooks(
      slate.currentOddsAllBooksByGame[plan.game.providerGameId],
      plan.game.providerGameId,
      "all-book",
      true,
    );
    const comparableCurrentBooks = requiredCurrentBooks(
      slate.currentOddsComparableBooksByGame[plan.game.providerGameId],
      plan.game.providerGameId,
      "comparable-book",
      false,
    );
    const providerOpeningBooks = slate.openingOddsAllBooksByGame[plan.game.providerGameId] ?? [];
    const comparableProviderOpeningBooks = slate.openingOddsComparableBooksByGame[plan.game.providerGameId] ?? [];
    const previous = latestEvidenceForGame(historicalExisting, plan.game.providerGameId);
    const opening = operationalOpening({
      previous,
      providerOpening: slate.openingOddsByGame[plan.game.providerGameId] ?? null,
      current,
      capturedAt: args.now,
    });
    const awayDepth = depthForTeam(plan.game.away.abbreviation, rosters.byTeam, previous, "away");
    const homeDepth = depthForTeam(plan.game.home.abbreviation, rosters.byTeam, previous, "home");
    const playbookLine = linesByGame[plan.game.providerGameId]
      ? normalizePlaybookLine(args.now, linesByGame[plan.game.providerGameId]!) : null;
    const playbookSplits = splitsByGame[plan.game.providerGameId]
      ? normalizePlaybookSplits(args.now, splitsByGame[plan.game.providerGameId]!) : null;
    const sharpSplits = sharpResult.splitsByGame[plan.game.providerGameId] ?? null;
    const injuries = availabilityByGame.get(plan.game.providerGameId) ?? null;
    const weather = weatherByGame.get(plan.game.providerGameId)!.snapshot;
    const rosterAndDepth = awayDepth.roster.length > 0 && homeDepth.roster.length > 0;
    const expectedQuarterbacks = awayDepth.expectedStartingQuarterback !== null && homeDepth.expectedStartingQuarterback !== null;
    const playbookCoverage = completePlaybookSplits(playbookSplits);
    const sharpCoverage = completeSharpApiNflSplitSet(sharpSplits ?? undefined);
    const weatherCoverage = plan.stage === "unlocked" || weather.status !== "provider_unavailable";
    const holds = [
      !rosterAndDepth ? "roster_depth_unavailable" : null,
      !expectedQuarterbacks ? "expected_quarterback_unavailable" : null,
      injuries === null ? "injury_report_unavailable" : null,
      !playbookCoverage ? "playbook_splits_unavailable" : null,
      !sharpCoverage ? "sharpapi_splits_unavailable" : null,
      comparableCurrentBooks.length < 2 ? "multibook_consensus_unavailable" : null,
      comparableCurrentBooks.length < 3 ? "r6_leave_one_out_consensus_unavailable" : null,
      !weatherCoverage ? "weather_unavailable" : null,
      plan.stage === "t60" && (plan.t60LagMinutes ?? 0) > NFL_T60_MAX_CAPTURE_LAG_MINUTES
        ? "t60_capture_late"
        : null,
    ].filter((value): value is string => value !== null);
    const shadowMoneyline = buildNflR6ShadowMoneylineDecision({
      game: plan.game,
      opening,
      comparableCurrentBooks,
      startersAndDepth: { away: awayDepth, home: homeDepth },
      injuries,
      stage: plan.stage,
      capturedAt: args.now,
      t60LagMinutes: plan.t60LagMinutes,
      coverageHealthHolds: holds,
    });
    const baseOutcome = getNflV1WeekOneOutcomeForecast({
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      weeklyFallback: shadowMoneyline.footballProjection && current.total
        ? {
            projectedHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
            marketTotal: current.total.line,
          }
        : undefined,
    });
    const outcome = shadowMoneyline.footballProjection
      ? buildNflMarketEvidenceOutcomeForecast({
          baseForecast: baseOutcome,
          footballHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
          current,
          playbookLine,
          playbookSplits,
          sharpSplits,
          evaluatedAt: args.now,
        })
      : baseOutcome;
    const production = buildNflV1ActionableGradeBundle({
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      gameStartsAt: plan.game.scheduledStart,
      current,
      comparableCurrentBooks,
      shadowMoneyline,
      outcomeForecast: outcome,
    });
    assertFootballCrossMarketCoherence({
      sport: "nfl",
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      forecast: {
        expectedAwayPoints: outcome.expectedAwayScore,
        expectedHomePoints: outcome.expectedHomeScore,
        representativeScore: {
          away: outcome.representativeAwayScore,
          home: outcome.representativeHomeScore,
        },
        awayWinProbability: outcome.awayWinProbability,
        homeWinProbability: outcome.homeWinProbability,
        marginDistribution: outcome.marginDistribution,
        totalDistribution: outcome.totalDistribution,
      },
      decisions: production.evaluatedBets,
      allowWholeGameOperationalHold: holds.length > 0 && production.evaluatedBets.length === 0,
    });
    const trackingEligibility = nflForwardT60TrackingEligibility({
      stage: plan.stage,
      captureTiming: plan.captureTiming,
      t60LagMinutes: plan.t60LagMinutes,
      capturedAt: new Date(args.now).toISOString(),
      providerGameId: plan.game.providerGameId,
      gameStartsAt: plan.game.scheduledStart,
      decisions: production.evaluatedBets,
      publicationApproved: production.publicationEnabled,
      officialRegistryLaunched: isPublicallyTracked(
        "nfl",
        computeSlateDate("nfl", plan.game.scheduledStart),
      ),
    });
    return [{
      schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
      runId: args.runId,
      season: args.season,
      week: args.week,
      slateGameCount: slate.games.length,
      stage: plan.stage,
      captureTiming: plan.captureTiming,
      capturedAt: new Date(args.now).toISOString(),
      cutoffAt: plan.cutoffAt,
      t60LagMinutes: plan.t60LagMinutes,
      game: plan.game,
      market: {
        current,
        currentBooks,
        comparableCurrentBooks,
        providerOpening: slate.openingOddsByGame[plan.game.providerGameId] ?? null,
        providerOpeningBooks,
        comparableProviderOpeningBooks,
        operationalOpening: opening,
        playbookLine,
        playbookSplits,
        sharpApiSplits: sharpSplits,
      },
      startersAndDepth: { away: awayDepth, home: homeDepth },
      injuries,
      weather,
      outcomeForecast: outcome,
      decisions: {
        evaluatedBets: production.evaluatedBets,
        outcomeConfidence: production.outcomeConfidence,
        modelPromotionStatus: production.modelPromotionStatus,
        publicationEnabled: production.publicationEnabled,
        trackingEnabled: trackingEligibility.eligible,
      },
      coverage: {
        currentOdds: true,
        currentBookCount: currentBooks.length,
        comparableCurrentBookCount: comparableCurrentBooks.length,
        multibookConsensusReady: comparableCurrentBooks.length >= 2,
        operationalOpening: true, rosterAndDepth, expectedQuarterbacks,
        injuries: injuries !== null, playbookSplits: playbookCoverage,
        sharpApiSplits: sharpCoverage, weather: weatherCoverage, healthHolds: holds,
      },
      requestBudget: {
        balldontlieSlate: slate.providerRequests, balldontlieRoster: rosters.requests,
        balldontlieInjuriesMaximum: 4, playbook: 2, sharpApi: sharpResult.requests,
        weather: weatherRequests, totalMaximum: apiCallsMaximum,
      },
    }];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_payload_failure";
      payloadBuildHolds.push(`game_${plan.game.providerGameId}_held_${reason}`);
      return [];
    }
  });

  const write = await appendNflForwardEvidence({ client: args.client, runId: args.runId, payloads, apply: args.apply });
  const tracking = await writeOfficialTrackingFromPayloads({
    client: args.client,
    payloads: [...currentT60Payloads(existing), ...payloads.filter((payload) => payload.stage === "t60")],
    apply: args.apply,
  });
  const memberSnapshot = await refreshCompactMemberSnapshot({
    client: args.client,
    existing,
    payloads,
    season: args.season,
    week: args.week,
    now: args.now,
    apply: args.apply,
  });
  const publishedEvaluations = payloads.flatMap((payload) => payload.decisions.evaluatedBets);
  const quarterbackHealthReasons = payloads.flatMap((payload) => {
    const away = payload.startersAndDepth.away.starterStatus;
    const home = payload.startersAndDepth.home.starterStatus;
    return [
      away !== "confirmed" ? `away_quarterback_${away}_not_confirmed` : null,
      home !== "confirmed" ? `home_quarterback_${home}_not_confirmed` : null,
    ].filter((reason): reason is string => reason !== null);
  });
  return {
    writerRelease: NFL_FORWARD_WRITER_RELEASE,
    collected: true,
    collectionReason: need.reason,
    proposed: write.proposed,
    inserted: write.inserted,
    games: new Set(payloads.map((payload) => payload.game.providerGameId)).size,
    stages: stageCounts(payloads),
    quarterbackHealthReasons: [...new Set(quarterbackHealthReasons)].sort(),
    publishedEvaluations: publishedEvaluations.length,
    publishedBestAngles: publishedEvaluations.filter((decision) => decision.grade === "Best Angle").length,
    publishedLeans: publishedEvaluations.filter((decision) => decision.grade === "Lean").length,
    publishedWatchlists: publishedEvaluations.filter((decision) => decision.grade === "Watchlist").length,
    publishedNoPlays: publishedEvaluations.filter((decision) => decision.grade === "No Play").length,
    publishedHeldGames: payloads.filter((payload) => payload.decisions.evaluatedBets.length !== 3).length,
    apiCallsMaximum,
    healthHolds: [...new Set([
      ...payloads.flatMap((payload) => payload.coverage.healthHolds),
      ...payloadBuildHolds,
    ])].sort(),
    publicationAttempted: args.apply,
    ...memberSnapshot,
    ...tracking,
  };
}

function depthForTeam(
  team: string,
  current: Record<string, NflForwardTeamDepthSnapshot>,
  previous: NflForwardStoredEvidence | null,
  side: "away" | "home",
): NflForwardTeamDepthSnapshot {
  const fresh = current[team];
  if (fresh) return fresh;
  const stored = previous?.payload.startersAndDepth[side];
  if (!stored || stored.team !== team) throw new Error(`NFL depth snapshot is unavailable for ${team}.`);
  return { ...stored, sourceSnapshotId: previous.id };
}

function operationalOpening(args: {
  previous: NflForwardStoredEvidence | null;
  providerOpening: NflPreviewBookOdds | null;
  current: NflPreviewBookOdds;
  capturedAt: string;
}): NflForwardOperationalOpening {
  if (args.previous) return args.previous.payload.market.operationalOpening;
  return args.providerOpening
    ? { provenance: "provider_opening", capturedAt: args.providerOpening.observedAt, quote: args.providerOpening }
    : { provenance: "first_observed", capturedAt: new Date(args.capturedAt).toISOString(), quote: args.current };
}

function matchPlaybookRowsOptional<T extends PlaybookLineGame | PlaybookSplitGame>(
  games: NflPreviewGame[],
  rows: T[],
): Record<string, T> {
  const matched: Record<string, T> = {};
  for (const game of games) {
    const candidates = rows.filter((row) =>
      normalizeTeam(row.homeTeamName) === normalizeTeam(game.home.name) &&
      normalizeTeam(row.awayTeamName) === normalizeTeam(game.away.name) &&
      startsNear(row.startTime ?? row.startTimeEst, game.scheduledStart)
    );
    if (candidates.length === 1) matched[game.providerGameId] = candidates[0]!;
  }
  return matched;
}

function normalizePlaybookLine(capturedAt: string, row: PlaybookLineGame): NflForwardPlaybookLine {
  return {
    provider: "playbook",
    capturedAt,
    sourceTier: text(row.lineSourceTier),
    homeMoneyline: finite(row.lines?.moneyline?.home),
    awayMoneyline: finite(row.lines?.moneyline?.away),
    homeSpread: finite(row.lines?.spread?.home),
    awaySpread: finite(row.lines?.spread?.away),
    total: finite(row.lines?.total),
  };
}

function normalizePlaybookSplits(capturedAt: string, row: PlaybookSplitGame): NflForwardPlaybookSplitSet {
  const base = { provider: "playbook" as const, capturedAt };
  return {
    moneyline: {
      ...base,
      booksUsed: finite(row.splits?.moneyline?.source?.booksUsed),
      homeMoneyPct: finite(row.splits?.moneyline?.money?.homePercent),
      awayMoneyPct: finite(row.splits?.moneyline?.money?.awayPercent),
      homeBetsPct: finite(row.splits?.moneyline?.bets?.homePercent),
      awayBetsPct: finite(row.splits?.moneyline?.bets?.awayPercent),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    spread: {
      ...base,
      booksUsed: finite(row.splits?.spread?.source?.booksUsed),
      homeMoneyPct: finite(row.splits?.spread?.money?.homePercent),
      awayMoneyPct: finite(row.splits?.spread?.money?.awayPercent),
      homeBetsPct: finite(row.splits?.spread?.bets?.homePercent),
      awayBetsPct: finite(row.splits?.spread?.bets?.awayPercent),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    total: {
      ...base,
      booksUsed: finite(row.splits?.total?.source?.booksUsed),
      homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
      overMoneyPct: finite(row.splits?.total?.money?.overPercent),
      underMoneyPct: finite(row.splits?.total?.money?.underPercent),
      overBetsPct: finite(row.splits?.total?.bets?.overPercent),
      underBetsPct: finite(row.splits?.total?.bets?.underPercent),
    },
  };
}

function completePlaybookSplits(value: NflForwardPlaybookSplitSet | null): boolean {
  if (!value) return false;
  return complementary(value.moneyline.homeMoneyPct, value.moneyline.awayMoneyPct) &&
    complementary(value.moneyline.homeBetsPct, value.moneyline.awayBetsPct) &&
    complementary(value.spread.homeMoneyPct, value.spread.awayMoneyPct) &&
    complementary(value.spread.homeBetsPct, value.spread.awayBetsPct) &&
    complementary(value.total.overMoneyPct, value.total.underMoneyPct) &&
    complementary(value.total.overBetsPct, value.total.underBetsPct);
}

function latestEvidenceForGame(rows: NflForwardStoredEvidence[], providerGameId: string): NflForwardStoredEvidence | null {
  return rows.filter((row) => row.providerGameId === providerGameId)
    .sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))[0] ?? null;
}

function requiredCurrentOdds(value: NflPreviewBookOdds | undefined, gameId: string): NflPreviewBookOdds {
  if (!value?.moneyline || !value.spread || !value.total) throw new Error(`NFL current named-book quote is incomplete for ${gameId}.`);
  return value;
}

function requiredCurrentBooks(
  value: NflPreviewBookOdds[] | undefined,
  gameId: string,
  label: string,
  requireAtLeastOne: boolean,
): NflPreviewBookOdds[] {
  const books = value?.filter((row) => row.moneyline && row.spread && row.total) ?? [];
  if (requireAtLeastOne && books.length === 0) {
    throw new Error(`NFL current ${label} quotes are incomplete for ${gameId}.`);
  }
  const vendors = new Set(books.map((row) => row.sportsbook.toLowerCase()));
  if (vendors.size !== books.length) throw new Error(`NFL current ${label} quotes contain duplicate books for ${gameId}.`);
  return books;
}

function uniquePlannedGames(games: NflPreviewGame[]): NflPreviewGame[] {
  return games.filter((game, index) => games.findIndex((candidate) => candidate.providerGameId === game.providerGameId) === index);
}

function stageCounts(payloads: NflForwardEvidencePayload[]): Record<"opening" | "unlocked" | "t60", number> {
  return {
    opening: payloads.filter((payload) => payload.stage === "opening").length,
    unlocked: payloads.filter((payload) => payload.stage === "unlocked").length,
    t60: payloads.filter((payload) => payload.stage === "t60").length,
  };
}

function emptyResult(
  reason: string,
  tracking: NflTrackingWriteResult = {
    trackingAttempted: false,
    trackingRecordsProposed: 0,
    trackingRecordsInserted: 0,
    trackingRecordsExisting: 0,
  },
  memberSnapshot: NflMemberSnapshotWriteResult = {
    memberSnapshotAttempted: false,
    memberSnapshotUpdated: false,
    memberSnapshotKey: null,
    memberSnapshotError: null,
  },
): NflForwardWriterResult {
  return {
    writerRelease: NFL_FORWARD_WRITER_RELEASE,
    collected: false,
    collectionReason: reason,
    proposed: 0,
    inserted: 0,
    games: 0,
    stages: { opening: 0, unlocked: 0, t60: 0 },
    quarterbackHealthReasons: [],
    publishedEvaluations: 0,
    publishedBestAngles: 0,
    publishedLeans: 0,
    publishedWatchlists: 0,
    publishedNoPlays: 0,
    publishedHeldGames: 0,
    apiCallsMaximum: 0,
    healthHolds: [],
    publicationAttempted: false,
    ...memberSnapshot,
    ...tracking,
  };
}

async function refreshCompactMemberSnapshot(args: {
  client: SupabaseClient;
  existing: NflForwardStoredEvidence[];
  payloads: NflForwardEvidencePayload[];
  season: number;
  week: number;
  now: string;
  apply: boolean;
}): Promise<NflMemberSnapshotWriteResult> {
  if (!args.apply) {
    return {
      memberSnapshotAttempted: false,
      memberSnapshotUpdated: false,
      memberSnapshotKey: null,
      memberSnapshotError: null,
    };
  }
  const rows = [...args.existing, ...args.payloads.map(storedEvidenceForPayload)];
  if (rows.length === 0) {
    return {
      memberSnapshotAttempted: false,
      memberSnapshotUpdated: false,
      memberSnapshotKey: null,
      memberSnapshotError: null,
    };
  }
  try {
    const fixture = buildNflWeekOneHeldMemberFixture(rows);
    const snapshot = buildNflForwardMemberSnapshot({
      fixture,
      season: args.season,
      week: args.week,
      publishedAt: args.now,
    });
    const write = await writeNflForwardMemberSnapshot({ client: args.client, snapshot });
    return {
      memberSnapshotAttempted: true,
      memberSnapshotUpdated: write.ok,
      memberSnapshotKey: write.snapshotKey,
      memberSnapshotError: write.ok ? null : write.error,
    };
  } catch (error) {
    return {
      memberSnapshotAttempted: true,
      memberSnapshotUpdated: false,
      memberSnapshotKey: null,
      memberSnapshotError: error instanceof Error ? error.message : String(error),
    };
  }
}

function storedEvidenceForPayload(payload: NflForwardEvidencePayload): NflForwardStoredEvidence {
  return {
    id: `pending:${payload.runId}:${payload.game.providerGameId}:${payload.stage}`,
    providerGameId: payload.game.providerGameId,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    gameStartAt: payload.game.scheduledStart,
    payloadSha256: hashNflForwardEvidencePayload(payload),
    payload,
  };
}

function currentT60Payloads(rows: NflForwardStoredEvidence[]): NflForwardEvidencePayload[] {
  return rows.flatMap((row) =>
    row.stage === "t60" && row.payload.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE
      ? [row.payload]
      : []);
}

/**
 * Official record persistence stays inside this existing leased writer. It is
 * append-only at the prediction boundary: teams/games are seeded idempotently,
 * while a frozen prediction record is inserted only when its exact
 * game/market/release key does not already exist.
 */
async function writeOfficialTrackingFromPayloads(args: {
  client: SupabaseClient;
  payloads: NflForwardEvidencePayload[];
  apply: boolean;
}): Promise<NflTrackingWriteResult> {
  const eligibleByGame = new Map<string, NflForwardEvidencePayload>();
  for (const payload of args.payloads) {
    const boundary = nflForwardT60TrackingEligibility({
      stage: payload.stage,
      captureTiming: payload.captureTiming,
      t60LagMinutes: payload.t60LagMinutes,
      capturedAt: payload.capturedAt,
      providerGameId: payload.game.providerGameId,
      gameStartsAt: payload.game.scheduledStart,
      decisions: payload.decisions.evaluatedBets,
      publicationApproved: payload.decisions.publicationEnabled,
      officialRegistryLaunched: isPublicallyTracked(
        "nfl",
        computeSlateDate("nfl", payload.game.scheduledStart),
      ),
    });
    if (payload.decisions.trackingEnabled && boundary.eligible) {
      eligibleByGame.set(payload.game.providerGameId, payload);
    }
  }
  const payloads = [...eligibleByGame.values()];
  const trackingGames = payloads.map((payload) => ({
    externalId: nflProviderIntegerId(payload.game.providerGameId, "game"),
    decisions: payload.decisions.evaluatedBets,
  }));
  const proposed = trackingGames.length === 0 ? 0 : buildMarketScopedFootballTrackingPlan(trackingGames).proposed;
  if (!args.apply || proposed === 0) {
    return {
      trackingAttempted: false,
      trackingRecordsProposed: proposed,
      trackingRecordsInserted: 0,
      trackingRecordsExisting: 0,
    };
  }
  const decisionReleases = new Set(payloads.flatMap((payload) =>
    payload.decisions.evaluatedBets.map((decision) => decision.decisionRelease)));
  if (decisionReleases.size !== 1) throw new Error("NFL T-60 tracking payloads carry incoherent decision releases.");
  const decisionRelease = [...decisionReleases][0]!;
  const externalIds = payloads.map((payload) => nflProviderIntegerId(payload.game.providerGameId, "game"));
  const { data: existingRows, error: existingError } = await args.client
    .from("prediction_records")
    .select("id,external_id,market,locked_at")
    .eq("sport", "nfl")
    .eq("model_version", decisionRelease)
    .in("external_id", externalIds);
  if (existingError) throw new Error(`NFL tracking record read failed: ${existingError.message}`);
  const existingKeys = buildMarketScopedFootballTrackingPlan(trackingGames, (existingRows ?? []) as Array<{
    external_id: number;
    market: string;
    locked_at: string | null;
  }>).existingKeys;
  if (existingKeys.size === proposed) {
    return {
      trackingAttempted: true,
      trackingRecordsProposed: proposed,
      trackingRecordsInserted: 0,
      trackingRecordsExisting: existingKeys.size,
    };
  }

  const teamIdByProviderId = await upsertTrackedNflTeams(args.client, payloads);
  const gameIdByProviderId = await upsertTrackedNflGames(args.client, payloads, teamIdByProviderId);
  const records = payloads.flatMap((payload) => {
    const externalId = nflProviderIntegerId(payload.game.providerGameId, "game");
    const gameId = gameIdByProviderId.get(payload.game.providerGameId);
    if (gameId === undefined) throw new Error(`NFL tracking game row missing for ${payload.game.providerGameId}.`);
    return buildNflOfficialTrackingRecords({ payload, gameId })
      .filter((record) => !existingKeys.has(`${externalId}:${record.market}`));
  });
  if (records.length > 0) {
    const { data, error } = await args.client
      .from("prediction_records")
      .insert(records as unknown as Record<string, unknown>[])
      .select("id");
    if (error) throw new Error(`NFL tracking record insert failed: ${error.message}`);
    if ((data?.length ?? records.length) !== records.length) {
      throw new Error(`NFL tracking record insert count mismatch: expected ${records.length}.`);
    }
  }
  return {
    trackingAttempted: true,
    trackingRecordsProposed: proposed,
    trackingRecordsInserted: records.length,
    trackingRecordsExisting: existingKeys.size,
  };
}

async function upsertTrackedNflTeams(
  client: SupabaseClient,
  payloads: NflForwardEvidencePayload[],
): Promise<Map<number, number>> {
  const teams = new Map(payloads.flatMap((payload) => [
    [payload.game.away.id, payload.game.away] as const,
    [payload.game.home.id, payload.game.home] as const,
  ]));
  const rows = [...teams.values()].map((team) => ({
    external_id: team.id,
    sport: "nfl",
    slug: `nfl-${team.abbreviation.toLowerCase()}`,
    abbreviation: team.abbreviation,
    display_name: team.name,
    short_display_name: team.abbreviation,
    name: team.name,
    location: team.name.split(" ").slice(0, -1).join(" ") || team.name,
    league: "NFL",
    division: null,
    logo_url: null,
    primary_color: null,
    provider_ids: { balldontlie_nfl: { id: String(team.id) } },
  }));
  const { data, error } = await client
    .from("teams")
    .upsert(rows, { onConflict: "sport,external_id" })
    .select("id,external_id");
  if (error) throw new Error(`NFL tracking team upsert failed: ${error.message}`);
  const result = new Map(((data ?? []) as Array<{ id: number; external_id: number }>).map((row) => [row.external_id, row.id]));
  if (result.size !== rows.length) throw new Error("NFL tracking team upsert returned incomplete identities.");
  return result;
}

async function upsertTrackedNflGames(
  client: SupabaseClient,
  payloads: NflForwardEvidencePayload[],
  teamIdByProviderId: Map<number, number>,
): Promise<Map<string, number>> {
  const rows = payloads.map((payload) => ({
    external_id: nflProviderIntegerId(payload.game.providerGameId, "game"),
    sport: "nfl",
    home_team_id: requiredTrackedIdentity(teamIdByProviderId, payload.game.home.id, "home team"),
    away_team_id: requiredTrackedIdentity(teamIdByProviderId, payload.game.away.id, "away team"),
    game_date: payload.game.scheduledStart,
    slate_date: computeSlateDate("nfl", payload.game.scheduledStart),
    season: payload.season,
    season_type: "regular",
    postseason: false,
    status: normalizeTrackedNflStatus(payload.game.status),
    venue: payload.weather.venueName,
    provider_ids: {
      balldontlie_nfl: {
        id: payload.game.providerGameId,
        season: payload.season,
        week: payload.week,
      },
    },
  }));
  const { data, error } = await client
    .from("games")
    .upsert(rows, { onConflict: "sport,external_id" })
    .select("id,external_id");
  if (error) throw new Error(`NFL tracking game upsert failed: ${error.message}`);
  const providerByExternal = new Map(payloads.map((payload) => [
    nflProviderIntegerId(payload.game.providerGameId, "game"),
    payload.game.providerGameId,
  ]));
  const result = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ id: number; external_id: number }>) {
    const providerGameId = providerByExternal.get(row.external_id);
    if (providerGameId) result.set(providerGameId, row.id);
  }
  if (result.size !== rows.length) throw new Error("NFL tracking game upsert returned incomplete identities.");
  return result;
}

function requiredTrackedIdentity(map: Map<number, number>, key: number, label: string): number {
  const value = map.get(key);
  if (value === undefined) throw new Error(`NFL tracking ${label} identity ${key} is missing.`);
  return value;
}

function normalizeTrackedNflStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "final" || normalized === "completed" || normalized === "post") return "final";
  if (normalized === "in_progress" || normalized === "live") return "in_progress";
  if (normalized === "postponed" || normalized === "canceled" || normalized === "cancelled") return normalized;
  return "scheduled";
}

function normalizeTeam(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function startsNear(first: unknown, second: string): boolean {
  const firstTime = typeof first === "string" ? Date.parse(first) : NaN;
  const secondTime = Date.parse(second);
  return Number.isFinite(firstTime) && Number.isFinite(secondTime) && Math.abs(firstTime - secondTime) <= 12 * 60 * 60_000;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function complementary(first: number | null, second: number | null): boolean {
  return first !== null && second !== null && Math.abs(first + second - 100) <= 1;
}
