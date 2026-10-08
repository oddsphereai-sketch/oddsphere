import type { SupabaseClient } from "@supabase/supabase-js";
import type { IWeatherProvider } from "@/lib/providers/interfaces/IWeatherProvider";
import { SharpApiAbortError, SharpApiClientError } from "@/lib/providers/real_api/_sharpApiClient";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { isPublicallyTracked } from "@/lib/config/officialTrackingStart";
import { assertOfficialTrackingMarket } from "@/lib/config/officialTrackingMarkets";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { PlaybookReadBroker } from "@/lib/providers/playbook/playbookReadBroker";
import { fetchBalldontlieNcaafResultsForDates, fetchBalldontlieNcaafSlate, type NcaafBookOdds, type NcaafGame } from "./balldontlieNcaafSlate";
import { fetchBalldontlieNcaafQuarterbacks } from "./balldontlieNcaafQuarterbacks";
import { normalizeCfbPlaybookLine, normalizeCfbPlaybookSplits, resolveCfbPlaybookEvidence } from "./cfbPlaybookEvidence";
import {
  CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_GAP_FALLBACK_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_GAP_FALLBACK_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_RELEASE_WAVE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_RELEASE_WAVE_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_FCS_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_FCS_PRICE_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  isCfbPublishedT60AccuracyLockPayload,
  CFB_FORWARD_PRICE_PREVIOUS_MEMBER_RELEASE,
  hashCfbForwardEvidencePayload,
  buildCfbForwardMarketOutlooks,
  determineCfbForwardCollectionNeed,
  planCfbForwardEvidenceCaptures,
  type CfbForwardCapturePlan,
  type CfbForwardEvidencePayload,
  type CfbForwardMarketHistoryEvidence,
  type CfbForwardOperationalOpening,
  type CfbForwardPublishedDecisionBundle,
  type CfbForwardPlaybookSplit,
  type CfbForwardStoredEvidence,
  type CfbForwardTeamQuarterbacks,
} from "./cfbForwardEvidence";
import { appendCfbForwardEvidence, readCfbForwardMarketHistory, readCfbForwardWriterEvidence, type CfbForwardEvidenceMetadata } from "./cfbForwardEvidenceStore";
import { buildCfbV1DecisionBundle, CFB_T60_MAX_CAPTURE_LAG_MINUTES, CFB_V1_DECISION_RELEASE, CFB_V1_GAP_FALLBACK_PREVIOUS_DECISION_RELEASE, CFB_V1_FCS_PRICE_PREVIOUS_DECISION_RELEASE, getCfbV1ForecastForGame, type CfbV1Forecast, type CfbV1Market } from "./cfbV1Decision";
import { CFB_V1_WEEKLY_RUNTIME_RELEASE, cfbV1WeeklyGameProfileCoverage, getCfbV1WeeklyForecasts } from "./cfbV1WeeklyForecast";
import { loadCfbCurrentAdvancedState } from "./cfbCurrentAdvancedState";
import { resolveCfbCanonicalMarketAnchor } from "./cfbMarketInformedOutcome";
import {
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
  CFB_MARKET_SHADOW_WEIGHT,
  CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
  CFB_MARKET_SHARP_AWARE_GAP_FALLBACK_PREVIOUS_PRODUCTION_RELEASE,
  CFB_MARKET_SHARP_AWARE_FCS_PRICE_PREVIOUS_PRODUCTION_RELEASE,
  CFB_MARKET_SHARP_AWARE_PREVIOUS_PRODUCTION_RELEASE,
  CFB_MARKET_SHARP_AWARE_PRICE_QB_PREVIOUS_PRODUCTION_RELEASE,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
  type CfbMarketSharpAwareForecast,
} from "./cfbMarketSharpAwareShadow";
import {
  buildCfbOfficialTrackingRecords,
  buildCfbDisplayedBookLineRecoveryRecords,
  buildCfbEspnOpeningRecoveryRecords,
  buildCfbNamedBookLineRecoveryRecords,
  buildCfbPublishedPregameRecoveryRecords,
  cfbPublishedPregameRecoveryMarkets,
  cfbProviderIntegerId,
  cfbTrackingMarketsForPayload,
  cfbDisplayedLineRecoveryBook,
} from "./cfbOfficialTrackingRecord";
import {
  CFB_ESPN_REFERENCE_LINE_RELEASE,
  CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN,
  CFB_ESPN_REFERENCE_MAX_REQUESTS,
  fetchCfbEspnReferenceLines,
  type CfbEspnReferenceResult,
} from "./cfbEspnReferenceLine";
import {
  CFB_COLLEGE_FOOTBALL_DATA_REFRESH_MINUTES,
  fetchCfbCollegeFootballDataLines,
  type CfbCollegeFootballDataLinesResult,
} from "./cfbCollegeFootballDataLines";
import {
  CFB_THE_ODDS_API_CREDITS_PER_PULL,
  CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL,
  fetchCfbTheOddsApiFallback,
  fetchCfbTheOddsApiHistoricalOpenings,
  shouldFetchCfbTheOddsApiFallback,
  type CfbTheOddsApiFallbackResult,
  type CfbTheOddsApiHistoricalOpeningResult,
} from "./cfbTheOddsApiFallback";
import {
  CFB_ESPN_CURRENT_ODDS_MAX_GAMES_PER_RUN,
  fetchCfbEspnCurrentOdds,
} from "./cfbEspnCurrentOdds";
import { buildCfbGameAvailability } from "./cfbGameAvailability";
import {
  CFB_OFFICIAL_CONFERENCE_AVAILABILITY_PREGAME_REFRESH_MINUTES,
  CFB_OFFICIAL_CONFERENCE_AVAILABILITY_REFRESH_MINUTES,
  fetchCfbOfficialConferenceAvailability,
  type CfbOfficialConferenceAvailabilityResult,
} from "./cfbOfficialConferenceAvailability";
import { activeCfbWeeklyWindow, eligibleCfbWeeklyGames, isGameInCfbWeeklyWindow, resolveCfbVisibleWindows, type CfbWeeklyWindow } from "./cfbWeeklyWindow";
import {
  CFB_SHARP_API_ODDS_RELEASE,
  CFB_SHARP_FALLBACK_MAX_REQUESTS,
  buildCfbNamedBookPriceHierarchy,
  cfbBooksNeedSharpFallback,
  fetchSharpApiNcaafOddsFallback,
  preferredCfbTargetBook,
  retainLatestCfbNamedBookMarkets,
  type CfbSharpApiOddsResult,
} from "./cfbSharpApiOdds";
import { fetchCfbSharpApiSplits } from "./cfbSharpApiSplits";
import { collectCfbKickoffWeather, type CfbKickoffWeatherSnapshot } from "./cfbKickoffWeather";
import { buildMarketScopedFootballTrackingPlan } from "./footballMarketScopedTracking";
import {
  assertFootballCrossMarketCoherence,
  CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS,
} from "./footballCrossMarketCoherence";
import {
  buildCfbForwardContextCapture,
  CFB_FORWARD_CONTEXT_CAPTURE_RELEASE,
  cfbForwardContextSharpHistoryBooks,
} from "./cfbForwardEvidenceCapture";
import {
  captureBooksWithSharpBooks,
  fetchSharpApiNcaafSharpOdds,
  FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS,
  FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK,
} from "./sharpApiFootballSharpOdds";
import { buildCfbMemberFixture } from "./cfbMemberFixture";
import {
  buildCfbForwardMemberSnapshot,
  writeCfbForwardMemberSnapshot,
} from "./cfbForwardMemberSnapshotStore";
import {
  applyCfbVerifiedAvailabilityGradeCap,
  applyVerifiedCfbQuarterbackAvailability,
  playbookCfbQuarterbackAvailability,
  reportedCfbQuarterbackAvailability,
  type CfbVerifiedQuarterbackAvailability,
} from "./cfbVerifiedAvailability";
import type { PlaybookInjuryTeamRow } from "@/lib/providers/playbook/types";

export const CFB_FORWARD_WRITER_RELEASE =
  "cfb_forward_evidence_writer_2026_10_08_r105_the_odds_api_fcs_gap_fallback" as const;
export const CFB_FORWARD_MAX_QB_TEAMS_PER_RUN = 24 as const;
export const CFB_FORWARD_MAX_SHARP_FALLBACK_GAMES_PER_RUN = 32 as const;
export const CFB_FORWARD_MAX_ESPN_PROSPECTIVE_GAMES_PER_RUN = 32 as const;
export const CFB_FORWARD_MAX_ESPN_CURRENT_ODDS_GAMES_PER_RUN = CFB_ESPN_CURRENT_ODDS_MAX_GAMES_PER_RUN;
export const CFB_FORWARD_RESULTS_BATCH_SIZE = 100 as const;
export const CFB_FORWARD_MAX_PRIOR_GAME_IDS = 1200 as const;

export type CfbForwardWriterResult = {
  writerRelease: typeof CFB_FORWARD_WRITER_RELEASE;
  collected: boolean;
  collectionReason: string;
  proposed: number;
  inserted: number;
  games: number;
  stages: Record<"opening" | "unlocked" | "t60", number>;
  publishedEvaluations: number;
  publishedBestAngles: number;
  publishedLeans: number;
  publishedWatchlists: number;
  publishedNoPlays: number;
  heldMarkets: number;
  apiCallsMaximum: number;
  healthHolds: string[];
  captureFailures: CfbForwardCaptureFailure[];
  publicationAttempted: boolean;
  memberSnapshotAttempted: boolean;
  memberSnapshotUpdated: boolean;
  memberSnapshotKey: string | null;
  memberSnapshotError: string | null;
  trackingAttempted: boolean;
  trackingRecordsProposed: number;
  trackingRecordsInserted: number;
  trackingRecordsExisting: number;
  trackingError: string | null;
  trackingProviderRequests: number;
};

export type CfbForwardCaptureFailure = {
  providerGameId: string;
  stage: CfbForwardCapturePlan["stage"];
  error: string;
};

/**
 * Movement is evidence only when the opening and current quote come from the
 * same sportsbook. The execution quote remains independently price-shopped.
 */
export function currentCfbMovementContextBook(
  books: NcaafBookOdds[],
  operationalOpening: CfbForwardOperationalOpening | null,
): NcaafBookOdds | null {
  const openingBook = operationalOpening?.quote.sportsbook.trim().toLowerCase() ?? "";
  if (!openingBook) return null;
  return books
    .filter((book) => book.sportsbook.trim().toLowerCase() === openingBook)
    .sort((first, second) => Date.parse(second.observedAt) - Date.parse(first.observedAt))[0] ?? null;
}

type CfbForwardWindowState = {
  window: CfbWeeklyWindow;
  existing: CfbForwardStoredEvidence[];
  lockPlanningExisting: CfbForwardStoredEvidence[];
  need: { collect: boolean; reason: string; cadenceMinutes: number | null };
};

export function selectCfbForwardCollectionWindow<T extends Pick<CfbForwardWindowState, "need">>(
  states: T[],
): T | null {
  const priority = (reason: string): number => {
    if (reason === "t60_due") return 0;
    if (reason === "release_refresh_due") return 1;
    if (reason === "reference_line_completion_due") return 2;
    // During the Sunday/Monday overlap, a terminal current window can remain
    // `opening_incomplete` forever when a game was first captured at T-60 (or
    // later) and therefore has no separate opening-stage row. Seed the empty
    // adjacent window first so that terminal bookkeeping cannot starve the
    // next slate. A still-actionable current T-60 or release repair remains
    // higher priority, and the following cycle can resume current-window
    // completion after the one-time next-window seed.
    if (reason === "opening_seed") return 3;
    if (reason === "opening_incomplete") return 4;
    if (reason === "unlocked_refresh_due") return 5;
    return 6;
  };
  return states
    .map((state, index) => ({ state, index }))
    .filter(({ state }) => state.need.collect)
    .sort((first, second) => priority(first.state.need.reason) - priority(second.state.need.reason) || first.index - second.index)[0]?.state ?? null;
}

/**
 * Isolate synchronous game-specific validation/calculation failures so one
 * malformed matchup cannot prevent otherwise-due immutable T-60 captures.
 * Shared provider, storage, lease, and append failures remain fail-closed
 * outside this boundary.
 */
export function buildCfbForwardPayloadsWithIsolation<T>(
  plans: CfbForwardCapturePlan[],
  build: (plan: CfbForwardCapturePlan) => T,
): { payloads: T[]; captureFailures: CfbForwardCaptureFailure[] } {
  const payloads: T[] = [];
  const captureFailures: CfbForwardCaptureFailure[] = [];
  for (const plan of plans) {
    try {
      payloads.push(build(plan));
    } catch (error) {
      captureFailures.push({
        providerGameId: plan.game.providerGameId,
        stage: plan.stage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { payloads, captureFailures };
}

export async function runCfbForwardEvidenceWriter(args: {
  client: SupabaseClient;
  season: number;
  runId: string;
  now: string;
  apply: boolean;
  balldontlieApiKey: string;
  playbookApiKey: string;
  sharpApiKey: string;
  collegeFootballDataApiKey?: string | null;
  theOddsApiKey?: string | null;
  weatherProvider?: IWeatherProvider | null;
  /** Read-only operator evidence hook. Never used by the production route. */
  auditPayloads?: (payloads: readonly CfbForwardEvidencePayload[]) => void;
}): Promise<CfbForwardWriterResult> {
  const writerEvidence = await readCfbForwardWriterEvidence({ client: args.client, season: args.season });
  const allExisting = writerEvidence.evidence;
  const windows = resolveCfbVisibleWindows({ now: args.now, evidence: allExisting });
  const visibleGameIds = [...new Set(allExisting
    .filter((row) => windows.some((window) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)))
    .map((row) => row.providerGameId))];
  const marketHistory = await readCfbForwardMarketHistory({
    client: args.client,
    season: args.season,
    providerGameIds: visibleGameIds,
  });
  const states: CfbForwardWindowState[] = windows.map((window) => {
    const existing = allExisting.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
    const lockPlanningExisting = cfbLockPlanningEvidence(existing);
    const ordinaryNeed = determineCfbForwardCollectionNeed({ existing: lockPlanningExisting, now: args.now });
    const need = cfbForwardReleaseRefreshNeed(existing, args.now) ?? ordinaryNeed;
    return { window, existing, lockPlanningExisting, need };
  });
  const selected = selectCfbForwardCollectionWindow(states);
  if (!selected) {
    const tracking = await writeOfficialTracking({
      client: args.client,
      candidates: cfbTrackingCandidatesForRun(allExisting, [], args.now),
      apply: args.apply,
      metadata: writerEvidence.metadata,
      balldontlieApiKey: args.balldontlieApiKey,
      now: args.now,
    });
    const memberSnapshot = await refreshCompactMemberSnapshot({ client: args.client, existing: allExisting, marketHistory, payloads: [], season: args.season, now: args.now, apply: args.apply });
    return emptyResult(states.map((state) => state.need.reason).join("+"), tracking, memberSnapshot);
  }
  const { window, existing, lockPlanningExisting, need } = selected;
  const slate = await fetchBalldontlieNcaafSlate({ season: args.season, startDate: window.providerQueryStartDate, endDate: window.providerQueryEndDate, apiKey: args.balldontlieApiKey });
  const games = selectCfbModelCoveredWeeklyGames({ games: slate.games, existing, now: args.now, window });
  if (games.length === 0) throw new Error(`CFB authoritative weekly window ${window.boardStartDate}..${window.boardEndDate} has no eligible model-covered games.`);
  const latestByGame = latestCfbEvidenceByGame(existing);
  const plannedCaptures = planCfbForwardEvidenceCaptures({
    games,
    existing: lockPlanningExisting,
    capturedAt: args.now,
    ...(need.reason === "release_refresh_due" || need.reason === "reference_line_completion_due" ? { unlockedCadenceMinutesOverride: 0 } : {}),
  });
  const plans = need.reason === "reference_line_completion_due"
    ? plannedCaptures.filter((plan) => cfbReferenceCompletionNeeded(latestByGame.get(plan.game.providerGameId), args.now))
    : plannedCaptures;
  if (plans.length === 0) {
    const tracking = await writeOfficialTracking({
      client: args.client,
      candidates: cfbTrackingCandidatesForRun(allExisting, [], args.now),
      apply: args.apply,
      metadata: writerEvidence.metadata,
      balldontlieApiKey: args.balldontlieApiKey,
      now: args.now,
    });
    const memberSnapshot = await refreshCompactMemberSnapshot({ client: args.client, existing: allExisting, marketHistory, payloads: [], season: args.season, now: args.now, apply: args.apply });
    return emptyResult("capture_plan_empty", tracking, memberSnapshot);
  }
  const releaseSlateGameCount = cfbForwardReleaseSlateGameCount({ existing, plans });
  const playbook = new PlaybookReadBroker(args.playbookApiKey);
  const priorResults = await fetchPriorCompletedGames({ rows: writerEvidence.metadata, before: window.boardStartDate, apiKey: args.balldontlieApiKey });
  const advancedState = await loadCfbCurrentAdvancedState({
    client: args.client,
    season: args.season,
    now: args.now,
    apply: args.apply,
  });
  const teams = [...new Map(games.flatMap((game) => [[game.away.id, game.away] as const, [game.home.id, game.home] as const])).values()];
  const priorQuarterbacks = latestQuarterbacksByTeam(allExisting);
  const quarterbackTeams = selectQuarterbackTeams({ plans, teams, priorQuarterbacks, maximum: CFB_FORWARD_MAX_QB_TEAMS_PER_RUN, now: args.now });
  const plannedGames = [...new Map(plans.map((plan) => [plan.game.providerGameId, plan.game])).values()];
  const officialAvailabilityDue = shouldFetchCfbOfficialConferenceAvailability({
    games: plannedGames,
    existing: allExisting,
    now: args.now,
    force: need.reason === "release_refresh_due" || need.reason === "opening_seed",
  });
  const officialAvailabilityPromise = officialAvailabilityDue
    ? fetchCfbOfficialConferenceAvailability({ games: plannedGames, capturedAt: args.now })
        .then((result) => ({ result, error: null }))
        .catch((error: unknown) => ({ result: null, error: splitRequestError(error) }))
    : Promise.resolve({ result: null as CfbOfficialConferenceAvailabilityResult | null, error: null as string | null });
  const weeklyForecasts = getCfbV1WeeklyForecasts({
    games,
    completedGames: priorResults.games,
    advancedGames: advancedState.state?.games ?? [],
  });
  const trustedSharpEventIdsByGame = trustedCfbSharpEventIdsByGame(existing);
  const paidCurrentBooksByGame = Object.fromEntries(plannedGames.map((game) => [
    game.providerGameId,
    slate.currentOddsComparableBooksByGame[game.providerGameId] ?? [],
  ]));
  const sharpFallbackCandidates = plannedGames.filter((game) =>
    cfbBooksNeedSharpFallback(paidCurrentBooksByGame[game.providerGameId] ?? []));
  const sharpFallbackGames = need.reason === "reference_line_completion_due" ? [] : selectCfbSharpFallbackGames({
    games: sharpFallbackCandidates,
    trustedEventIdsByGame: trustedSharpEventIdsByGame,
    latestByGame,
    currentBooksByGame: paidCurrentBooksByGame,
    maximum: CFB_FORWARD_MAX_SHARP_FALLBACK_GAMES_PER_RUN,
  });
  const sharpFallbackGameIds = new Set(sharpFallbackGames.map((game) => game.providerGameId));
  const sharpFallbackPromise = fetchCfbSharpOddsFallbackAttempt({
    games: sharpFallbackGames,
    apiKey: args.sharpApiKey,
    trustedEventIdsByGame: trustedSharpEventIdsByGame,
  });
  const collegeFootballDataGames = plannedGames.filter((game) => !game.away.fbs && !game.home.fbs);
  const collegeFootballDataDue = Boolean(args.collegeFootballDataApiKey) && shouldFetchCfbCollegeFootballDataLines({
    games: collegeFootballDataGames,
    existing: allExisting,
    now: args.now,
    force: need.reason === "release_refresh_due" || need.reason === "opening_seed",
  });
  const collegeFootballDataAttempt = collegeFootballDataDue
      ? await fetchCfbCollegeFootballDataLines({
        games: collegeFootballDataGames,
        capturedAt: args.now,
        apiKey: args.collegeFootballDataApiKey!,
      }).then((result) => ({ result, error: null })).catch((error: unknown) => ({
        result: null,
        error: splitRequestError(error),
      }))
    : { result: null as CfbCollegeFootballDataLinesResult | null, error: null as string | null };
  const sharpFallbackAttempt = await sharpFallbackPromise;
  const sharpFallback = sharpFallbackAttempt.result;
  const paidAndSharpBooksByGame = Object.fromEntries(plannedGames.map((game) => [
    game.providerGameId,
    buildCfbNamedBookPriceHierarchy(
      paidCurrentBooksByGame[game.providerGameId] ?? [],
      sharpFallback.booksByGame[game.providerGameId] ?? [],
    ),
  ]));
  const paidSharpAndCollegeFootballDataBooksByGame = Object.fromEntries(plannedGames.map((game) => [
    game.providerGameId,
    buildCfbNamedBookPriceHierarchy(
      paidAndSharpBooksByGame[game.providerGameId] ?? [],
      collegeFootballDataAttempt.result?.moneylineBooksByGame[game.providerGameId] ?? [],
    ),
  ]));
  const theOddsApiGapGames = plannedGames.filter((game) =>
    !game.away.fbs && !game.home.fbs &&
    cfbBooksNeedSharpFallback(paidSharpAndCollegeFootballDataBooksByGame[game.providerGameId] ?? []));
  const theOddsApiHistoricalOpeningGames = theOddsApiGapGames.filter((game) => {
    const scheduledAt = Date.parse(game.scheduledStart);
    const belongsToR38TransitionSlate = scheduledAt >= Date.parse("2026-10-09T00:00:00.000Z") &&
      scheduledAt < Date.parse("2026-10-12T00:00:00.000Z");
    const recoveredInCurrentRelease = existing.some((row) =>
      row.providerGameId === game.providerGameId &&
      row.payload.schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE &&
      row.payload.market.operationalOpening?.quote.provider === "theoddsapi");
    return belongsToR38TransitionSlate && !recoveredInCurrentRelease;
  });
  const theOddsApiHistoricalOpeningAttempt = args.theOddsApiKey && theOddsApiHistoricalOpeningGames.length > 0
    ? await fetchCfbTheOddsApiHistoricalOpenings({
        games: theOddsApiHistoricalOpeningGames,
        apiKey: args.theOddsApiKey,
      }).then((result) => ({ result, error: null, requests: result.requests }))
      .catch((error: unknown) => ({
        result: null as CfbTheOddsApiHistoricalOpeningResult | null,
        error: splitRequestError(error),
        requests: 1,
      }))
    : { result: null as CfbTheOddsApiHistoricalOpeningResult | null, error: null as string | null, requests: 0 };
  const theOddsApiNeed = shouldFetchCfbTheOddsApiFallback({
    games: theOddsApiGapGames,
    existing,
    now: args.now,
    forceT60: plans.some((plan) =>
      plan.stage === "t60" && theOddsApiGapGames.some((game) => game.providerGameId === plan.game.providerGameId)),
    forceOpeningSeed: theOddsApiGapGames.some((game) =>
      !existing.some((row) =>
        row.providerGameId === game.providerGameId &&
        ((row.payload.requestBudget.theOddsApi ?? 0) > 0 ||
          row.payload.market.currentBooks.some((book) => book.provider === "theoddsapi")))),
  });
  const theOddsApiAttempt = args.theOddsApiKey && theOddsApiNeed.fetch
    ? await fetchCfbTheOddsApiFallback({
        games: theOddsApiGapGames,
        capturedAt: args.now,
        apiKey: args.theOddsApiKey,
      }).then((result) => ({ result, error: null, requests: result.requests }))
        .catch((error: unknown) => ({ result: null as CfbTheOddsApiFallbackResult | null, error: splitRequestError(error), requests: 1 }))
    : { result: null as CfbTheOddsApiFallbackResult | null, error: null as string | null, requests: 0 };
  const paidSharpCollegeFootballDataAndTheOddsApiBooksByGame = Object.fromEntries(plannedGames.map((game) => [
    game.providerGameId,
    buildCfbNamedBookPriceHierarchy(
      paidSharpAndCollegeFootballDataBooksByGame[game.providerGameId] ?? [],
      theOddsApiAttempt.result?.booksByGame[game.providerGameId] ?? [],
    ),
  ]));
  const primaryCurrentBooksByGame = Object.fromEntries(plannedGames.map((game) => [
    game.providerGameId,
    paidSharpCollegeFootballDataAndTheOddsApiBooksByGame[game.providerGameId] ?? [],
  ]));
  const espnCurrentOddsGames = plannedGames.filter((game) =>
    (game.away.fbs || game.home.fbs) &&
    cfbBooksNeedSharpFallback(primaryCurrentBooksByGame[game.providerGameId] ?? []),
  );
  const [linesAttempt, splitsAttempt, venueWeatherAttempt, injuryAttempt, quarterbacks, sharpSplitsAttempt, circaAttempt, espnCurrentOddsAttempt, officialAvailabilityAttempt] = await Promise.all([
    fetchCfbPlaybookRowsAttempt(() => playbook.lines("ncaaf")),
    fetchCfbPlaybookRowsAttempt(() => playbook.splits("ncaaf")),
    playbook.venueWeather("ncaaf")
      .then((result) => ({ rows: result.body.data ?? [], error: null }))
      .catch((error: unknown) => ({ rows: [] as unknown[], error: splitRequestError(error) })),
    fetchCfbPlaybookRowsAttempt(() => playbook.injuries("ncaaf")),
    fetchBalldontlieNcaafQuarterbacks({ teams: quarterbackTeams.map((team) => ({ id: team.id, abbreviation: team.abbreviation })), previousSeason: args.season - 1, capturedAt: args.now, apiKey: args.balldontlieApiKey }),
    fetchCfbSharpApiSplits({ games, apiKey: args.sharpApiKey })
      .then((result) => ({ result, error: null }))
      .catch((error: unknown) => ({ result: null, error: splitRequestError(error) })),
    fetchSharpApiNcaafSharpOdds({ games: plannedGames, apiKey: args.sharpApiKey })
      .then((result) => ({ result, requests: result.requests }))
      .catch(() => ({
        result: null,
        requests: FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS.length * FOOTBALL_SHARP_PRICE_CAPTURE_MAX_PAGES_PER_BOOK,
      })),
    fetchCfbEspnCurrentOdds({
      games: espnCurrentOddsGames,
      capturedAt: args.now,
      maximumGames: CFB_FORWARD_MAX_ESPN_CURRENT_ODDS_GAMES_PER_RUN,
    }).then((result) => ({ result, error: null })).catch((error: unknown) => ({
      result: null,
      error: splitRequestError(error),
    })),
    officialAvailabilityPromise,
  ]);
  const quarterbackContext = retainLatestNonemptyCfbQuarterbacks(priorQuarterbacks, quarterbacks.byTeamId);
  const lines = linesAttempt.rows;
  const splits = splitsAttempt.rows;
  const espnReferenceCandidates = plannedGames.filter((game) => {
    const evidence = resolveCfbPlaybookEvidence({ game, lines, splits });
    const line = evidence ? normalizeCfbPlaybookLine(evidence.lineRow, args.now) : null;
    const primaryMissing = line?.homeSpread === null || line?.homeSpread === undefined || line.total === null || line.total === undefined;
    const previousReference = latestByGame.get(game.providerGameId)?.payload.market.espnReferenceLine ?? null;
    return primaryMissing && previousReference === null;
  });
  const espnReferenceGames = selectCfbEspnReferenceGames({
    games: espnReferenceCandidates,
    latestByGame,
    maximum: CFB_FORWARD_MAX_ESPN_PROSPECTIVE_GAMES_PER_RUN,
  });
  const espnReferenceGameIds = new Set(espnReferenceGames.map((game) => game.providerGameId));
  const espnReferenceAttempt = await fetchCfbEspnReferenceAttempt({
    games: espnReferenceGames,
    capturedAt: args.now,
    maximumGames: CFB_FORWARD_MAX_ESPN_PROSPECTIVE_GAMES_PER_RUN,
  });
  const weatherByGame = new Map<string, { snapshot: CfbKickoffWeatherSnapshot; requests: number }>();
  await mapCfbWithConcurrency([...new Map(plans.map((plan) => [plan.game.providerGameId, plan.game])).values()], 6, async (game) => {
    const gamePlans = plans.filter((plan) => plan.game.providerGameId === game.providerGameId);
    const stage = gamePlans.some((plan) => plan.stage === "t60")
      ? "t60"
      : gamePlans.some((plan) => plan.stage === "opening") ? "opening" : "unlocked";
    const previous = latestByGame.get(game.providerGameId)?.payload.availability?.weather ?? null;
    weatherByGame.set(game.providerGameId, await collectCfbKickoffWeather({
      game,
      stage,
      capturedAt: args.now,
      venueRows: venueWeatherAttempt.rows,
      provider: args.weatherProvider ?? null,
      previous,
    }));
  });
  const weatherRequests = [...weatherByGame.values()].reduce((sum, value) => sum + value.requests, 0);
  const priorOpening = firstOpenings(existing);
  const captureHistoryBooksByGame = new Map<string, NcaafBookOdds[]>();
  const captureHistoryDisplayBooksByGame = new Map<string, NcaafBookOdds[]>();
  const captureHistorySpreadSplitsByGame = new Map<string, CfbForwardPlaybookSplit[]>();
  for (const row of marketHistory) {
    captureHistoryBooksByGame.set(row.providerGameId, [
      ...(captureHistoryBooksByGame.get(row.providerGameId) ?? []),
      ...row.payload.market.currentBooks,
    ]);
    captureHistoryDisplayBooksByGame.set(row.providerGameId, [
      ...(captureHistoryDisplayBooksByGame.get(row.providerGameId) ?? []),
      ...(row.payload.market.displayBooks ?? row.payload.market.currentBooks),
    ]);
    const spread = row.payload.market.playbookSplits?.spread ?? null;
    if (spread) {
      captureHistorySpreadSplitsByGame.set(row.providerGameId, [
        ...(captureHistorySpreadSplitsByGame.get(row.providerGameId) ?? []),
        spread,
      ]);
    }
  }
  for (const row of existing) {
    const books = captureHistoryBooksByGame.get(row.providerGameId) ?? [];
    books.push(...row.payload.market.currentBooks);
    books.push(...cfbForwardContextSharpHistoryBooks(row.payload.contextualEvidenceCapture));
    captureHistoryBooksByGame.set(row.providerGameId, books);
    const displayBooks = captureHistoryDisplayBooksByGame.get(row.providerGameId) ?? [];
    displayBooks.push(...(row.payload.market.displayBooks ?? row.payload.market.currentBooks));
    displayBooks.push(...cfbForwardContextSharpHistoryBooks(row.payload.contextualEvidenceCapture));
    captureHistoryDisplayBooksByGame.set(row.providerGameId, displayBooks);
  }
  const { payloads, captureFailures } = buildCfbForwardPayloadsWithIsolation(plans, (plan): CfbForwardEvidencePayload => {
    const sharpBooks = sharpFallback.booksByGame[plan.game.providerGameId] ?? [];
    const sharpDisplayBooks = sharpFallback.displayBooksByGame[plan.game.providerGameId] ?? [];
    const espnCurrentBooks = espnCurrentOddsAttempt.result?.booksByGame[plan.game.providerGameId] ?? [];
    const freshCurrentBooks = buildCfbNamedBookPriceHierarchy(
      primaryCurrentBooksByGame[plan.game.providerGameId] ?? [],
      espnCurrentBooks,
    );
    const currentBooks = retainLatestCfbNamedBookMarkets(
      freshCurrentBooks,
      captureHistoryBooksByGame.get(plan.game.providerGameId) ?? [],
    );
    const freshDisplayBooks = buildCfbNamedBookPriceHierarchy(
      slate.currentOddsAllBooksByGame[plan.game.providerGameId] ?? [],
      sharpDisplayBooks,
      collegeFootballDataAttempt.result?.moneylineBooksByGame[plan.game.providerGameId] ?? [],
      theOddsApiAttempt.result?.booksByGame[plan.game.providerGameId] ?? [],
      currentBooks,
      espnCurrentBooks,
    );
    const displayBooks = retainLatestCfbNamedBookMarkets(
      freshDisplayBooks,
      captureHistoryDisplayBooksByGame.get(plan.game.providerGameId) ?? [],
    );
    const current = preferredCfbTargetBook(currentBooks);
    const historicalOpening = preferredCfbTargetBook(
      theOddsApiHistoricalOpeningAttempt.result?.booksByGame[plan.game.providerGameId] ?? [],
    );
    const providerOpening = slate.openingOddsByGame[plan.game.providerGameId] ?? null;
    const operationalOpening = providerOpening
      ? { provenance: "provider_opening" as const, capturedAt: providerOpening.observedAt, quote: providerOpening }
      : historicalOpening
        ? { provenance: "first_observed" as const, capturedAt: historicalOpening.observedAt, quote: historicalOpening }
        : priorOpening.get(plan.game.providerGameId) ?? (current ? { provenance: "first_observed" as const, capturedAt: current.observedAt, quote: current } : null);
    const movementCurrent = currentCfbMovementContextBook(currentBooks, operationalOpening);
    const baseAwayQuarterbacks = requiredQuarterbacks(quarterbackContext, plan.game.away.id, plan.game.away.abbreviation, args.now);
    const baseHomeQuarterbacks = requiredQuarterbacks(quarterbackContext, plan.game.home.id, plan.game.home.abbreviation, args.now);
    const previousVerifiedAvailability = latestByGame.get(plan.game.providerGameId)?.payload.availability.verifiedQuarterback ?? null;
    const previousInjuryReport = latestByGame.get(plan.game.providerGameId)?.payload.availability.report ?? null;
    const injuryReport = buildCfbGameAvailability({
      game: plan.game,
      capturedAt: args.now,
      playbookRows: injuryAttempt.rows as PlaybookInjuryTeamRow[],
      conferenceReport: officialAvailabilityAttempt.result?.reportsByGame[plan.game.providerGameId] ?? null,
      previous: previousInjuryReport,
    });
    const freshProviderAvailability = playbookCfbQuarterbackAvailability({
      game: plan.game,
      away: baseAwayQuarterbacks,
      home: baseHomeQuarterbacks,
      injuryRows: injuryAttempt.rows as PlaybookInjuryTeamRow[],
      capturedAt: args.now,
      previousEvidence: previousVerifiedAvailability,
    });
    const freshReportedAvailability = reportedCfbQuarterbackAvailability({
      game: plan.game,
      away: baseAwayQuarterbacks,
      home: baseHomeQuarterbacks,
      // Conference reports provide honest continuity in the existing injury
      // panel, but are not model inputs until a release-pure promotion and
      // demotion replay validates that authority. Paid Playbook evidence keeps
      // the existing production projection and grade behavior.
      report: injuryReport?.source === "Playbook" ? injuryReport : null,
      capturedAt: args.now,
      previousEvidence: previousVerifiedAvailability,
    });
    const retainedProviderAvailability = retainCfbVerifiedAvailability(
      freshProviderAvailability ?? freshReportedAvailability,
      previousVerifiedAvailability,
    );
    const quarterbackAvailability = applyVerifiedCfbQuarterbackAvailability({
      game: plan.game,
      away: baseAwayQuarterbacks,
      home: baseHomeQuarterbacks,
      providerEvidence: retainedProviderAvailability,
    });
    const awayQuarterbacks = quarterbackAvailability.away;
    const homeQuarterbacks = quarterbackAvailability.home;
    const weather = weatherByGame.get(plan.game.providerGameId)!.snapshot;
    const playbookEvidence = resolveCfbPlaybookEvidence({ game: plan.game, lines, splits });
    const previousMarket = latestByGame.get(plan.game.providerGameId)?.payload.market ?? null;
    const collegeFootballDataLine = collegeFootballDataAttempt.result?.contextLineByGame[plan.game.providerGameId] ?? null;
    const playbookLine = retainLatestCfbPlaybookObservation(
      playbookEvidence
        ? normalizeCfbPlaybookLine(playbookEvidence.lineRow, args.now)
        : collegeFootballDataLine
          ? { ...collegeFootballDataLine, sourceTier: "named_book_line" }
          : null,
      previousMarket?.playbookLine ?? null,
    );
    const espnReferenceLine = espnReferenceAttempt.result.linesByGame[plan.game.providerGameId] ??
      latestByGame.get(plan.game.providerGameId)?.payload.market.espnReferenceLine ?? null;
    const playbookSplits = retainLatestCfbPlaybookObservation(
      playbookEvidence ? normalizeCfbPlaybookSplits(playbookEvidence.splitRow, args.now) : null,
      previousMarket?.playbookSplits ?? null,
    );
    const priorSpreadSplits = captureHistorySpreadSplitsByGame.get(plan.game.providerGameId) ?? [];
    const freshSharpApiSplits = sharpSplitsAttempt.result?.recordsByGame[plan.game.providerGameId] ?? [];
    // A provider omission must not erase the last verified fallback. Preserve
    // its original timestamp so the existing sport-specific freshness gates
    // can exclude it from forecast arbitration after 120 minutes while the
    // member split section remains continuous until a fresher observation
    // silently replaces it.
    const sharpApiSplits = freshSharpApiSplits.length > 0
      ? freshSharpApiSplits
      : previousMarket?.sharpApiSplits ?? [];
    const sharpApiSplitsStatus = sharpSplitsAttempt.result === null
      ? "request_failed" as const
      : freshSharpApiSplits.length > 0
        ? "matched" as const
        : "event_not_published" as const;
    const capturedAt = latestCfbPayloadTimestamp({
      runStartedAt: args.now,
      books: [...currentBooks, ...displayBooks],
      sharpApiSplits,
    });
    const effectiveT60LagMinutes = plan.stage === "t60" && plan.cutoffAt
      ? Math.max(0, (Date.parse(capturedAt) - Date.parse(plan.cutoffAt)) / 60_000)
      : plan.t60LagMinutes;
    const weeklyForecast = weeklyForecasts.get(plan.game.providerGameId);
    if (!weeklyForecast) throw new Error(`CFB professional forecast missing for ${plan.game.providerGameId}.`);
    const outcomeAnchor = resolveCfbCanonicalMarketAnchor({
      books: currentBooks,
      contextLines: {
        homeSpread: playbookLine?.homeSpread ?? null,
        totalLine: playbookLine?.total ?? null,
      },
    });
    const forecastWithoutWeather = outcomeAnchor
      ? buildCfbMarketSharpAwareForecast({
          independentForecast: weeklyForecast.forecast,
          anchor: outcomeAnchor,
          current: movementCurrent,
          operationalOpening,
          sharpSplits: sharpApiSplits,
          playbookLine,
          publicSplits: playbookSplits,
          priorSpreadSplits,
          evaluatedAt: capturedAt,
        })
      : weeklyForecast.forecast;
    const forecast = outcomeAnchor && weather.independentTotalAdjustmentPoints < 0
      ? buildCfbMarketSharpAwareForecast({
          independentForecast: weeklyForecast.forecast,
          anchor: outcomeAnchor,
          current: movementCurrent,
          operationalOpening,
          sharpSplits: sharpApiSplits,
          playbookLine,
          publicSplits: playbookSplits,
          priorSpreadSplits,
          kickoffWeather: weather,
          evaluatedAt: capturedAt,
        })
      : forecastWithoutWeather;
    const weatherAdjustment = outcomeAnchor
      ? (forecast as CfbMarketSharpAwareForecast).weatherAdjustment
      : null;
    const healthHolds = [
      ...(plan.stage === "t60" && (effectiveT60LagMinutes ?? Infinity) > CFB_T60_MAX_CAPTURE_LAG_MINUTES ? ["t60_capture_late"] : []),
      ...(weeklyForecast.featureHealth.awayProfile === "neutral_imputation" ? ["away_model_team_profile_unavailable"] : []),
      ...(weeklyForecast.featureHealth.homeProfile === "neutral_imputation" ? ["home_model_team_profile_unavailable"] : []),
      ...cfbMarketAnchorHealthHolds(outcomeAnchor),
    ];
    const fixedEvaluatedSportsbookByMarket = outcomeAnchor && weather.independentTotalAdjustmentPoints < 0
      ? Object.fromEntries(applyCfbMarketSharpAwareGrades({
          bundle: buildCfbV1DecisionBundle({
            providerGameId: plan.game.providerGameId,
            awayTeam: plan.game.away.abbreviation,
            homeTeam: plan.game.home.abbreviation,
            gameStartsAt: plan.game.scheduledStart,
            comparableCurrentBooks: currentBooks,
            stage: plan.stage === "t60" && healthHolds.length === 0 ? "t60_locked" : "unlocked",
            evaluatedAt: capturedAt,
            lockedAt: plan.stage === "t60" && healthHolds.length === 0 ? capturedAt : null,
            healthHolds,
            forecast: forecastWithoutWeather,
            contextLines: { homeSpread: playbookLine?.homeSpread ?? null, totalLine: playbookLine?.total ?? null },
          }),
          homeTeam: plan.game.home.abbreviation,
          sharpSplits: sharpApiSplits,
          playbookLine,
          publicSplits: playbookSplits,
          operationalOpening,
          current: movementCurrent,
        }).evaluatedBets.map((decision) => [decision.market, decision.evaluatedQuote.sportsbook]))
      : undefined;
    const decisionBundle = buildCfbV1DecisionBundle({
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      gameStartsAt: plan.game.scheduledStart,
      comparableCurrentBooks: currentBooks,
      stage: plan.stage === "t60" && healthHolds.length === 0 ? "t60_locked" : "unlocked",
      evaluatedAt: capturedAt,
      lockedAt: plan.stage === "t60" && healthHolds.length === 0 ? capturedAt : null,
      healthHolds,
      forecast,
      contextLines: {
        homeSpread: playbookLine?.homeSpread ?? null,
        totalLine: playbookLine?.total ?? null,
      },
      fixedEvaluatedSportsbookByMarket,
    });
    const marketAwareDecisions = outcomeAnchor
      ? applyCfbMarketSharpAwareGrades({
          bundle: decisionBundle,
          homeTeam: plan.game.home.abbreviation,
          sharpSplits: sharpApiSplits,
          playbookLine,
          publicSplits: playbookSplits,
          operationalOpening,
          current: movementCurrent,
        })
      : decisionBundle;
    const decisions = publishCfbForwardDecisionBundle(applyCfbVerifiedAvailabilityGradeCap({
      bundle: marketAwareDecisions,
      availability: quarterbackAvailability.availability,
    }), playbookLine, espnReferenceLine, {
      spread: preferredCfbContextBook(displayBooks, "spread"),
      total: preferredCfbContextBook(displayBooks, "total"),
    });
    assertFootballCrossMarketCoherence({
      sport: "cfb",
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      forecast: {
        expectedAwayPoints: forecast.expectedAwayPoints,
        expectedHomePoints: forecast.expectedHomePoints,
        representativeScore: forecast.representativeScore,
        awayWinProbability: 1 - forecast.homeWinProbability,
        homeWinProbability: forecast.homeWinProbability,
        pmf: forecast.pmf,
      },
      decisions: decisions.evaluatedBets.map((decision) => ({
        ...decision,
        executionStatus: decision.gradeAdjustment?.executionStatus,
      })),
      unavailableMarkets: decisions.heldMarkets.map((market) => market.market),
      requireDecisionSideFromForecast: true,
      allowPmfVerifiedProbabilityEndpoints: true,
      publicScoreDirectionTolerancePoints: CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS,
      allowForecastSideCalibrationFamilies: [],
    });
    const targetExcludedConsensusReady = decisions.evaluatedBets.length === 3;
    const payload: CfbForwardEvidencePayload = {
      schemaRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      collectorRelease: CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
      memberRelease: CFB_FORWARD_MEMBER_RELEASE,
      runId: args.runId,
      season: args.season,
      week: plan.game.providerWeek,
      slateGameCount: releaseSlateGameCount,
      stage: plan.stage,
      captureTiming: plan.captureTiming,
      capturedAt,
      cutoffAt: plan.cutoffAt,
      t60LagMinutes: effectiveT60LagMinutes,
      game: plan.game,
      market: {
        current,
        currentBooks,
        displayBooks,
        providerOpening,
        operationalOpening,
        playbookLine,
        espnReferenceLine,
        playbookSplits,
        sharpApiOddsRelease: sharpBooks.length > 0 ? CFB_SHARP_API_ODDS_RELEASE : null,
        sharpApiSplits,
        sharpApiSplitsStatus,
        sharpApiSplitsError: sharpSplitsAttempt.error,
      },
      quarterbacks: { away: awayQuarterbacks, home: homeQuarterbacks },
      availability: {
        injuryStatus: injuryReport ? "verified_report" : "provider_unavailable",
        report: injuryReport,
        verifiedQuarterback: quarterbackAvailability.availability,
        weatherStatus: weather.status,
        weather,
        note: quarterbackAvailability.availability
          ? `Source-attributed quarterback availability captured by ${quarterbackAvailability.availability.sourceAuthority}.`
          : injuryReport
            ? "A verified matchup injury report is stored; no listed expected-quarterback absence was uniquely matched."
          : venueWeatherAttempt.error
            ? `Timestamped NCAAF injury reports remain unavailable. Kickoff weather venue metadata was unavailable: ${venueWeatherAttempt.error}`
            : "Timestamped NCAAF injury reports remain unavailable. Kickoff weather uses exact Playbook venue identity and the configured game-time forecast provider when available.",
      },
      decisions,
      independentForecast: compactForecast(weeklyForecast.forecast),
      authoritativeForecast: {
        status: outcomeAnchor ? "market_sharp_applied" : "market_anchor_unavailable_hold",
        release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
        candidateRelease: CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
        marketWeight: outcomeAnchor ? CFB_MARKET_SHADOW_WEIGHT : 0,
        weatherIndependentTotalAdjustmentPoints: weatherAdjustment?.appliedIndependentTotalShiftPoints ?? 0,
        weatherAuthoritativeTotalAdjustmentPoints: weatherAdjustment?.authoritativeExpectedTotalShiftPoints ?? 0,
      },
      coverage: {
        currentOdds: current !== null,
        comparableCurrentBookCount: currentBooks.length,
        currentOddsProviders: [...new Set(currentBooks.map((book) => book.provider ?? "balldontlie"))].sort(),
        sharpApiOddsFallback: sharpBooks.length > 0,
        targetExcludedConsensusReady,
        operationalOpening: operationalOpening !== null,
        playbookLine: playbookLine !== null,
        espnReferenceLine: espnReferenceLine !== null,
        playbookSplits: playbookSplits !== null,
        sharpApiSplits: sharpApiSplits.length > 0,
        activeQuarterbacks: awayQuarterbacks.activeQuarterbacks.length > 0 && homeQuarterbacks.activeQuarterbacks.length > 0,
        injuries: injuryReport !== null,
        weather: weather.status === "forecast_available" || weather.status === "controlled_indoor",
        healthHolds,
        availabilityWarnings: [
          ...(sharpFallback.eventDiscoveryStatusByGame[plan.game.providerGameId] === "ambiguous" ? ["sharpapi_canonical_event_ambiguous"] : []),
          ...(sharpFallback.failuresByGame[plan.game.providerGameId]
            ? ["sharpapi_odds_fallback_request_failed"]
            : []),
          ...(sharpFallbackCandidates.some((game) => game.providerGameId === plan.game.providerGameId) && !sharpFallbackGameIds.has(plan.game.providerGameId)
            ? ["sharpapi_odds_fallback_deferred"]
            : []),
          "quarterback_starter_projected_not_confirmed",
          ...(injuryReport ? [] : ["injury_feed_unavailable"]),
          ...(weather.status === "forecast_available" || weather.status === "controlled_indoor" ? [] : [`venue_weather_${weather.status}`]),
          ...(sharpApiSplitsStatus === "request_failed" ? ["sharpapi_splits_request_failed"] : sharpApiSplitsStatus === "event_not_published" ? ["sharpapi_splits_event_not_published"] : []),
          ...(sharpBooks.length > 0 ? ["sharpapi_named_book_price_fallback"] : []),
          ...(theOddsApiAttempt.result?.booksByGame[plan.game.providerGameId]?.length ? ["the_odds_api_named_book_price_fallback"] : []),
          ...(espnReferenceAttempt.result.failuresByGame[plan.game.providerGameId] ? ["espn_reference_line_unavailable"] : []),
          ...(espnReferenceCandidates.some((game) => game.providerGameId === plan.game.providerGameId) && !espnReferenceGameIds.has(plan.game.providerGameId)
            ? ["espn_reference_line_deferred"]
            : []),
        ],
      },
      requestBudget: {
        balldontlieSlate: slate.providerRequests + priorResults.providerRequests,
        balldontlieQuarterbacks: quarterbacks.providerRequests,
        playbook: 4,
        publicReference: 0,
        collegeFootballData: collegeFootballDataAttempt.result?.requests ?? 0,
        theOddsApi: theOddsApiHistoricalOpeningAttempt.requests + theOddsApiAttempt.requests,
        theOddsApiCredits:
          (theOddsApiHistoricalOpeningAttempt.result?.creditsUsed ??
            (theOddsApiHistoricalOpeningAttempt.requests * CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL)) +
          (theOddsApiAttempt.result?.creditsUsed ??
            (theOddsApiAttempt.requests * CFB_THE_ODDS_API_CREDITS_PER_PULL)),
        theOddsApiRemainingCredits:
          theOddsApiAttempt.result?.creditsRemaining ??
          theOddsApiHistoricalOpeningAttempt.result?.creditsRemaining ??
          theOddsApiNeed.lastRemainingCredits,
        officialAvailability: officialAvailabilityAttempt.result?.requests ?? 0,
        espnReference: espnReferenceAttempt.result.requests + (espnCurrentOddsAttempt.result?.requests ?? 0),
        sharpApiOdds: sharpFallback.requests + circaAttempt.requests,
        sharpApiSplits: 1,
        weather: weatherRequests,
        totalMaximum: slate.providerRequests + priorResults.providerRequests + quarterbacks.providerRequests + sharpFallback.requests + circaAttempt.requests + weatherRequests + espnReferenceAttempt.result.requests + (espnCurrentOddsAttempt.result?.requests ?? 0) + (collegeFootballDataAttempt.result?.requests ?? 0) + theOddsApiHistoricalOpeningAttempt.requests + theOddsApiAttempt.requests + (officialAvailabilityAttempt.result?.requests ?? 0) + advancedState.requests + 5,
      },
    };
    const contextualEvidenceCapture = buildCfbForwardContextCapture({
      payload,
      captureCurrentBooks: captureBooksWithSharpBooks(
        payload.market.currentBooks,
        circaAttempt.result?.booksByGame[plan.game.providerGameId] ?? [],
      ),
      independentForecast: weeklyForecast.forecast,
      independentRelease: CFB_V1_WEEKLY_RUNTIME_RELEASE,
      authoritativeForecast: forecast,
      openingBooks: [
        ...(slate.openingOddsComparableBooksByGame[plan.game.providerGameId] ?? []),
        ...(theOddsApiHistoricalOpeningAttempt.result?.booksByGame[plan.game.providerGameId] ?? []),
        ...(captureHistoryBooksByGame.get(plan.game.providerGameId) ?? []),
      ],
    });
    return {
      ...payload,
      ...(contextualEvidenceCapture ? { contextualEvidenceCapture } : {}),
    };
  });
  args.auditPayloads?.(payloads);
  const write = await appendCfbForwardEvidence({ client: args.client, runId: args.runId, payloads, apply: args.apply });
  const tracking = await writeOfficialTracking({
    client: args.client,
    candidates: cfbTrackingCandidatesForRun(allExisting, payloads, args.now),
    apply: args.apply,
    metadata: writerEvidence.metadata,
    balldontlieApiKey: args.balldontlieApiKey,
    now: args.now,
    priorGamesByWindow: new Map([[window.boardStartDate, priorResults.games]]),
  });
  const memberSnapshot = await refreshCompactMemberSnapshot({ client: args.client, existing: allExisting, marketHistory, payloads, season: args.season, now: args.now, apply: args.apply });
  const decisions = payloads.flatMap((payload) => payload.decisions.evaluatedBets);
  return {
    writerRelease: CFB_FORWARD_WRITER_RELEASE,
    collected: true,
    collectionReason: need.reason,
    proposed: write.proposed,
    inserted: write.inserted,
    games: games.length,
    stages: stageCounts(payloads),
    publishedEvaluations: decisions.length,
    publishedBestAngles: decisions.filter((row) => row.grade === "Best Angle").length,
    publishedLeans: decisions.filter((row) => row.grade === "Lean").length,
    publishedWatchlists: decisions.filter((row) => row.grade === "Watchlist").length,
    publishedNoPlays: decisions.filter((row) => row.grade === "No Play").length,
    heldMarkets: payloads.reduce((sum, payload) => sum + payload.decisions.heldMarkets.length, 0),
    apiCallsMaximum: slate.providerRequests + priorResults.providerRequests + quarterbacks.providerRequests + sharpFallback.requests + circaAttempt.requests + weatherRequests + espnReferenceAttempt.result.requests + (espnCurrentOddsAttempt.result?.requests ?? 0) + (collegeFootballDataAttempt.result?.requests ?? 0) + theOddsApiHistoricalOpeningAttempt.requests + theOddsApiAttempt.requests + advancedState.requests + tracking.trackingProviderRequests + 5,
    healthHolds: [...new Set([
      ...payloads.flatMap((payload) => payload.coverage.healthHolds),
      ...(sharpFallbackAttempt.error ? ["sharpapi_odds_fallback_request_failed"] : []),
      ...(sharpFallbackCandidates.length > sharpFallbackGames.length ? ["sharpapi_odds_fallback_deferred"] : []),
      ...(espnReferenceAttempt.error ? ["espn_reference_line_request_failed"] : []),
      ...(theOddsApiHistoricalOpeningAttempt.error ? ["the_odds_api_historical_opening_request_failed"] : []),
      ...(espnReferenceCandidates.length > espnReferenceGames.length ? ["espn_reference_line_deferred"] : []),
      ...(espnCurrentOddsAttempt.error ? ["espn_current_odds_request_failed"] : []),
      ...(collegeFootballDataAttempt.error ? ["college_football_data_lines_request_failed"] : []),
      ...(theOddsApiAttempt.error ? ["the_odds_api_fcs_fallback_request_failed"] : []),
      ...(linesAttempt.error ? ["playbook_lines_request_failed"] : []),
      ...(splitsAttempt.error ? ["playbook_splits_request_failed"] : []),
      ...(injuryAttempt.error ? ["playbook_injuries_request_failed"] : []),
      ...(advancedState.error ? ["cfb_current_advanced_state_refresh_failed"] : []),
      ...(tracking.trackingError ? ["official_tracking_incomplete"] : []),
      ...(captureFailures.length > 0 ? ["game_capture_failed"] : []),
    ])],
    captureFailures,
    publicationAttempted: true,
    ...memberSnapshot,
    ...tracking,
  };
}

function hasCfbContextLine(book: NcaafBookOdds, market: "spread" | "total"): boolean {
  if (book[market] !== null) return true;
  return (book.marketQuotes ?? []).some((quote) =>
    quote.market === market &&
    quote.marketSelection === "main_line" &&
    quote.line !== null &&
    Number.isFinite(quote.line));
}

export function preferredCfbContextBook(
  books: NcaafBookOdds[],
  market: "spread" | "total",
): NcaafBookOdds | null {
  return books.find((book) => hasCfbContextLine(book, market)) ?? null;
}

export async function fetchCfbPlaybookRowsAttempt(
  fetcher: () => Promise<{ body?: { data?: unknown[] | null } }>,
): Promise<{ rows: unknown[]; error: string | null }> {
  try {
    const result = await fetcher();
    return { rows: result.body?.data ?? [], error: null };
  } catch (error) {
    return { rows: [], error: splitRequestError(error) };
  }
}

export function retainLatestCfbPlaybookObservation<T>(fresh: T | null, previous: T | null): T | null {
  return fresh ?? previous;
}

export function trustedCfbSharpEventIdsByGame(rows: CfbForwardStoredEvidence[]): Record<string, string> {
  const observed = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = observed.get(row.providerGameId) ?? new Set<string>();
    for (const book of [...row.payload.market.currentBooks, ...(row.payload.market.displayBooks ?? [])]) {
      if (book.provider === "sharpapi" && typeof book.providerEventId === "string" && book.providerEventId.length > 0) {
        ids.add(book.providerEventId);
      }
    }
    observed.set(row.providerGameId, ids);
  }
  return Object.fromEntries([...observed.entries()].flatMap(([providerGameId, ids]) =>
    ids.size === 1 ? [[providerGameId, [...ids][0]!] as const] : []
  ));
}

export function selectCfbSharpFallbackGames(args: {
  games: NcaafGame[];
  trustedEventIdsByGame: Readonly<Record<string, string>>;
  latestByGame?: ReadonlyMap<string, CfbForwardStoredEvidence>;
  currentBooksByGame?: Readonly<Record<string, NcaafBookOdds[]>>;
  maximum: number;
}): NcaafGame[] {
  if (!Number.isInteger(args.maximum) || args.maximum < 0) {
    throw new Error("CFB SharpAPI fallback game budget must be a nonnegative integer.");
  }
  const attemptPriority = (game: NcaafGame): number => {
    if (!args.latestByGame) return args.trustedEventIdsByGame[game.providerGameId] ? 1 : 0;
    const payload = args.latestByGame?.get(game.providerGameId)?.payload;
    if (!payload || payload.coverage.availabilityWarnings.includes("sharpapi_odds_fallback_deferred")) return 0;
    if (!args.trustedEventIdsByGame[game.providerGameId]) return 1;
    return 2;
  };
  const pairedMarketCoverage = (game: NcaafGame): number => {
    const books = args.currentBooksByGame?.[game.providerGameId] ?? [];
    return (["moneyline", "spread", "total"] as const)
      .filter((market) => books.some((book) => book[market] !== null)).length;
  };
  return [...new Map(args.games.map((game) => [game.providerGameId, game])).values()]
    .sort((first, second) =>
      pairedMarketCoverage(first) - pairedMarketCoverage(second) ||
      attemptPriority(first) - attemptPriority(second) ||
      Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) ||
      first.providerGameId.localeCompare(second.providerGameId))
    .slice(0, args.maximum);
}

export function latestCfbPayloadTimestamp(args: {
  runStartedAt: string;
  books: Array<{ observedAt: string }>;
  sharpApiSplits: Array<{ capturedAt: string }>;
}): string {
  const timestamps = [
    args.runStartedAt,
    ...args.books.map((book) => book.observedAt),
    ...args.sharpApiSplits.map((split) => split.capturedAt),
  ].map((value) => {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(`CFB payload timestamp is invalid: ${value}.`);
    return parsed;
  });
  return new Date(Math.max(...timestamps)).toISOString();
}

export function selectCfbModelCoveredWeeklyGames(args: {
  games: NcaafGame[];
  existing: CfbForwardStoredEvidence[];
  now: string;
  window: CfbWeeklyWindow;
}): NcaafGame[] {
  const existingIds = new Set(args.existing.map((row) => row.providerGameId));
  const nowMs = Date.parse(args.now);
  if (!Number.isFinite(nowMs)) throw new Error("CFB model-covered weekly selection requires a valid timestamp.");
  const providerIds = new Set(args.games.map((game) => game.providerGameId));
  const latestStoredGames = new Map<string, { game: NcaafGame; capturedAt: number }>();
  for (const row of args.existing) {
    if (providerIds.has(row.providerGameId)) continue;
    const capturedAt = Date.parse(row.capturedAt);
    const current = latestStoredGames.get(row.providerGameId);
    if (!current || capturedAt > current.capturedAt) {
      latestStoredGames.set(row.providerGameId, { game: row.payload.game, capturedAt });
    }
  }
  const candidates = [...args.games, ...[...latestStoredGames.values()].map((value) => value.game)];
  return eligibleCfbWeeklyGames(candidates, args.window).filter((game) =>
    (Date.parse(game.scheduledStart) > nowMs || existingIds.has(game.providerGameId)) &&
    cfbV1WeeklyGameProfileCoverage(game).supported
  );
}

/**
 * A release wave is complete when every game represented by that release has
 * one latest row. Games retained only for lock/tracking lifecycle (for example,
 * a completed game from the prior night) are not part of a brand-new wave
 * unless they actually have a capture plan. Later partial refreshes retain the
 * already-published release membership and add genuinely new planned games.
 */
export function cfbForwardReleaseSlateGameCount(args: {
  existing: CfbForwardStoredEvidence[];
  plans: Array<Pick<CfbForwardCapturePlan, "game">>;
}): number {
  const gameIds = new Set(
    args.existing
      .filter((row) =>
        row.payload.schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE &&
        row.payload.memberRelease === CFB_FORWARD_MEMBER_RELEASE)
      .map((row) => row.providerGameId),
  );
  for (const plan of args.plans) gameIds.add(plan.game.providerGameId);
  if (gameIds.size === 0) throw new Error("CFB release wave cannot publish an empty slate.");
  return gameIds.size;
}

export function planCfbPriorResultReads(args: {
  rows: Array<Pick<CfbForwardStoredEvidence, "providerGameId" | "gameStartAt" | "capturedAt">>;
  before: string;
}): Array<{ gameIds: string[]; dates: string[] }> {
  const latestById = new Map<string, { date: string; capturedAtMs: number }>();
  for (const row of args.rows) {
    const date = row.gameStartAt.slice(0, 10);
    const capturedAtMs = Date.parse(row.capturedAt);
    if (!Number.isFinite(capturedAtMs)) throw new Error(`CFB prior game ${row.providerGameId} has an invalid capture timestamp.`);
    const existing = latestById.get(row.providerGameId);
    if (!existing || capturedAtMs > existing.capturedAtMs) {
      latestById.set(row.providerGameId, { date, capturedAtMs });
    } else if (capturedAtMs === existing.capturedAtMs && existing.date !== date) {
      throw new Error(`CFB prior game ${row.providerGameId} has conflicting dates at the same capture timestamp.`);
    }
  }
  const dateById = new Map(
    [...latestById.entries()]
      .filter(([, value]) => value.date < args.before)
      .map(([providerGameId, value]) => [providerGameId, value.date] as const),
  );
  if (dateById.size > CFB_FORWARD_MAX_PRIOR_GAME_IDS) throw new Error(`CFB prior-game result coverage exceeds its ${CFB_FORWARD_MAX_PRIOR_GAME_IDS}-ID season budget.`);
  const idsByDate = new Map<string, string[]>();
  for (const [id, date] of dateById) idsByDate.set(date, [...(idsByDate.get(date) ?? []), id]);
  const dates = [...idsByDate.keys()].sort();
  const reads: Array<{ gameIds: string[]; dates: string[] }> = [];
  for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 3) {
    const dateBatch = dates.slice(dateIndex, dateIndex + 3);
    const ids = dateBatch.flatMap((date) => idsByDate.get(date) ?? []).sort();
    for (let idIndex = 0; idIndex < ids.length; idIndex += CFB_FORWARD_RESULTS_BATCH_SIZE) {
      reads.push({ gameIds: ids.slice(idIndex, idIndex + CFB_FORWARD_RESULTS_BATCH_SIZE), dates: dateBatch });
    }
  }
  return reads;
}

async function fetchPriorCompletedGames(args: { rows: CfbForwardEvidenceMetadata[]; before: string; apiKey: string }): Promise<{ games: NcaafGame[]; providerRequests: number }> {
  const games: NcaafGame[] = [];
  let providerRequests = 0;
  for (const read of planCfbPriorResultReads(args)) {
    const result = await fetchBalldontlieNcaafResultsForDates({
      gameIds: read.gameIds,
      dates: read.dates,
      apiKey: args.apiKey,
      pageBudget: 4,
    });
    providerRequests += result.providerRequests;
    games.push(...result.games.filter((game) => game.awayScore !== null && game.homeScore !== null));
  }
  if (new Set(games.map((game) => game.providerGameId)).size !== games.length) throw new Error("CFB prior-game results contain duplicate provider IDs.");
  return { games, providerRequests };
}

function firstOpenings(rows: CfbForwardStoredEvidence[]): Map<string, CfbForwardOperationalOpening> {
  const result = new Map<string, CfbForwardOperationalOpening>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))) {
    if (row.payload.market.operationalOpening && !result.has(row.providerGameId)) result.set(row.providerGameId, row.payload.market.operationalOpening);
  }
  return result;
}

function latestCfbEvidenceByGame(rows: CfbForwardStoredEvidence[]): Map<string, CfbForwardStoredEvidence> {
  const latest = new Map<string, CfbForwardStoredEvidence>();
  for (const row of rows) {
    const current = latest.get(row.providerGameId);
    if (!current || Date.parse(current.capturedAt) < Date.parse(row.capturedAt)) latest.set(row.providerGameId, row);
  }
  return latest;
}

export function selectCfbEspnReferenceGames(args: {
  games: NcaafGame[];
  latestByGame: Map<string, CfbForwardStoredEvidence>;
  maximum: number;
}): NcaafGame[] {
  if (!Number.isInteger(args.maximum) || args.maximum < 0 || args.maximum > CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN) {
    throw new Error(`CFB ESPN prospective batch must be between 0 and ${CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN} games.`);
  }
  const attemptPriority = (game: NcaafGame): number => {
    const payload = args.latestByGame.get(game.providerGameId)?.payload;
    if (payload?.market.espnReferenceLine) return 3;
    if (payload?.coverage.availabilityWarnings.includes("espn_reference_line_deferred")) return 0;
    if (payload?.coverage.availabilityWarnings.includes("espn_reference_line_unavailable")) return 2;
    return 1;
  };
  return [...new Map(args.games.map((game) => [game.providerGameId, game])).values()]
    .filter((game) => !args.latestByGame.get(game.providerGameId)?.payload.market.espnReferenceLine)
    .sort((first, second) => attemptPriority(first) - attemptPriority(second) ||
      Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) ||
      first.providerGameId.localeCompare(second.providerGameId))
    .slice(0, args.maximum);
}

async function mapCfbWithConcurrency<T>(
  values: T[],
  concurrency: number,
  run: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const value = values[cursor++];
      if (value !== undefined) await run(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
}

export function selectQuarterbackTeams(args: {
  plans: Array<{ game: NcaafGame; stage: "opening" | "unlocked" | "t60" }>;
  teams: NcaafGame["home"][];
  priorQuarterbacks: Map<number, CfbForwardTeamQuarterbacks>;
  maximum: number;
  now: string;
}): NcaafGame["home"][] {
  if (!Number.isInteger(args.maximum) || args.maximum < 0) throw new Error("CFB quarterback team budget must be a nonnegative integer.");
  const nowMs = Date.parse(args.now);
  if (!Number.isFinite(nowMs)) throw new Error("CFB quarterback refresh time must be valid.");
  const byId = new Map(args.teams.map((team) => [team.id, team]));
  const candidates = new Map<number, { team: NcaafGame["home"]; priority: number; startsAt: number; capturedAt: number }>();
  for (const plan of args.plans) {
    for (const team of [plan.game.away, plan.game.home]) {
      const prior = args.priorQuarterbacks.get(team.id);
      const priorCapturedAt = Date.parse(prior?.capturedAt ?? "");
      const priorIsNonempty = (prior?.activeQuarterbacks.length ?? 0) > 0;
      const dueAtT60 = plan.stage === "t60" && (!Number.isFinite(priorCapturedAt) || priorCapturedAt < Date.parse(plan.game.scheduledStart) - 75 * 60_000);
      const dueByAge = !priorIsNonempty || !Number.isFinite(priorCapturedAt) || nowMs - priorCapturedAt >= 24 * 60 * 60_000;
      if (!dueAtT60 && !dueByAge) continue;
      const priority = plan.stage === "t60" ? 0 : plan.stage === "opening" ? 1 : 2;
      const current = candidates.get(team.id);
      const capturedAt = Number.isFinite(priorCapturedAt) ? priorCapturedAt : Number.NEGATIVE_INFINITY;
      if (!current || priority < current.priority || capturedAt < current.capturedAt || Date.parse(plan.game.scheduledStart) < current.startsAt) {
        candidates.set(team.id, { team: byId.get(team.id) ?? team, priority, startsAt: Date.parse(plan.game.scheduledStart), capturedAt });
      }
    }
  }
  return [...candidates.values()].sort((first, second) =>
    first.priority - second.priority || first.capturedAt - second.capturedAt || first.startsAt - second.startsAt || first.team.id - second.team.id,
  ).slice(0, args.maximum).map((value) => value.team);
}

export function retainLatestNonemptyCfbQuarterbacks(
  previous: Map<number, CfbForwardTeamQuarterbacks>,
  fresh: Map<number, CfbForwardTeamQuarterbacks>,
): Map<number, CfbForwardTeamQuarterbacks> {
  const retained = new Map(previous);
  for (const [teamId, value] of fresh) {
    if (value.activeQuarterbacks.length > 0 || !retained.has(teamId)) retained.set(teamId, value);
  }
  return retained;
}

export function retainCfbVerifiedAvailability(
  fresh: CfbVerifiedQuarterbackAvailability | null,
  previous: CfbVerifiedQuarterbackAvailability | null,
): CfbVerifiedQuarterbackAvailability | null {
  if (!fresh) return previous;
  if (!previous) return fresh;
  if (fresh.sourceAuthority === "official_provider") return fresh;
  if (previous.sourceAuthority === "official_provider") return previous;
  return Date.parse(fresh.observedAt) >= Date.parse(previous.observedAt) ? fresh : previous;
}

function latestQuarterbacksByTeam(rows: CfbForwardStoredEvidence[]): Map<number, CfbForwardTeamQuarterbacks> {
  const result = new Map<number, CfbForwardTeamQuarterbacks>();
  for (const row of [...rows].sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt))) {
    for (const value of [row.payload.quarterbacks.away, row.payload.quarterbacks.home]) {
      if (value.activeQuarterbacks.length > 0) result.set(value.teamId, value);
    }
  }
  return result;
}

export function shouldFetchCfbOfficialConferenceAvailability(args: {
  games: NcaafGame[];
  existing: CfbForwardStoredEvidence[];
  now: string;
  force?: boolean;
}): boolean {
  if (args.games.length === 0) return false;
  if (args.force) return true;
  const nowMs = Date.parse(args.now);
  if (!Number.isFinite(nowMs)) return false;
  const pregame = args.games.some((game) => {
    const untilStart = Date.parse(game.scheduledStart) - nowMs;
    return untilStart > 0 && untilStart <= 3 * 60 * 60_000;
  });
  const minimumMinutes = pregame
    ? CFB_OFFICIAL_CONFERENCE_AVAILABILITY_PREGAME_REFRESH_MINUTES
    : CFB_OFFICIAL_CONFERENCE_AVAILABILITY_REFRESH_MINUTES;
  const lastFetch = args.existing
    .filter((row) => (row.payload.requestBudget.officialAvailability ?? 0) > 0)
    .reduce((latest, row) => Math.max(latest, Date.parse(row.capturedAt) || 0), 0);
  return lastFetch === 0 || nowMs - lastFetch >= minimumMinutes * 60_000;
}

export function shouldFetchCfbCollegeFootballDataLines(args: {
  games: NcaafGame[];
  existing: CfbForwardStoredEvidence[];
  now: string;
  force?: boolean;
}): boolean {
  if (args.games.length === 0) return false;
  if (args.force) return true;
  const nowMs = Date.parse(args.now);
  if (!Number.isFinite(nowMs)) return false;
  const lastFetch = args.existing
    .filter((row) => (row.payload.requestBudget.collegeFootballData ?? 0) > 0)
    .reduce((latest, row) => Math.max(latest, Date.parse(row.capturedAt) || 0), 0);
  return lastFetch === 0 || nowMs - lastFetch >= CFB_COLLEGE_FOOTBALL_DATA_REFRESH_MINUTES * 60_000;
}

export function cfbForwardReleaseRefreshNeed(rows: CfbForwardStoredEvidence[], now: string): { collect: true; reason: string; cadenceMinutes: number } | null {
  const timestamp = Date.parse(now);
  const latest = new Map<string, CfbForwardStoredEvidence>();
  for (const row of rows) {
    const current = latest.get(row.providerGameId);
    if (!current || Date.parse(row.capturedAt) > Date.parse(current.capturedAt)) latest.set(row.providerGameId, row);
  }
  const staleUpcoming = [...latest.values()].some((row) =>
    timestamp < Date.parse(row.gameStartAt) - 60 * 60_000 &&
    (row.payload.schemaRelease !== CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
      row.payload.collectorRelease !== CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE ||
      row.payload.memberRelease !== CFB_FORWARD_MEMBER_RELEASE ||
      row.payload.decisions.decisionRelease !== CFB_V1_DECISION_RELEASE ||
      row.payload.authoritativeForecast?.release !== CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE ||
      row.payload.contextualEvidenceCapture?.release !== CFB_FORWARD_CONTEXT_CAPTURE_RELEASE ||
      row.payload.decisions.evaluatedBets.length + row.payload.decisions.heldMarkets.length !== 3)
  );
  if (staleUpcoming) return { collect: true, reason: "release_refresh_due", cadenceMinutes: 0 };
  return [...latest.values()].some((row) => cfbReferenceCompletionNeeded(row, now))
    ? { collect: true, reason: "reference_line_completion_due", cadenceMinutes: 0 }
    : null;
}

export function cfbReferenceCompletionNeeded(row: CfbForwardStoredEvidence | undefined, now: string): boolean {
  if (!row || row.payload.schemaRelease !== CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE) return false;
  const nowMs = Date.parse(now);
  const cutoffMs = Date.parse(row.gameStartAt) - 60 * 60_000;
  if (!Number.isFinite(nowMs) || !Number.isFinite(cutoffMs) || nowMs >= cutoffMs) return false;
  const primaryIncomplete = row.payload.market.playbookLine?.homeSpread == null || row.payload.market.playbookLine?.total == null;
  return primaryIncomplete && row.payload.market.espnReferenceLine == null &&
    row.payload.coverage.availabilityWarnings.includes("espn_reference_line_deferred");
}

export function cfbMarketAnchorHealthHolds(
  outcomeAnchor: ReturnType<typeof resolveCfbCanonicalMarketAnchor>,
): string[] {
  return outcomeAnchor ? [] : ["authoritative_market_anchor_unavailable"];
}

export function publishCfbForwardDecisionBundle(
  bundle: ReturnType<typeof buildCfbV1DecisionBundle>,
  playbookLine: CfbForwardEvidencePayload["market"]["playbookLine"],
  espnReferenceLine: CfbForwardEvidencePayload["market"]["espnReferenceLine"] = null,
  namedBookLines: Partial<Record<"spread" | "total", NcaafBookOdds | null>> = {},
): CfbForwardPublishedDecisionBundle {
  const { pmf: _pmf, ...forecast } = bundle.forecast;
  void _pmf;
  return {
    ...bundle,
    forecast,
    marketOutlooks: buildCfbForwardMarketOutlooks({ forecast: bundle.forecast, playbookLine, namedBookLines, espnReferenceLine }),
  };
}

export async function fetchCfbEspnReferenceAttempt(
  args: Parameters<typeof fetchCfbEspnReferenceLines>[0],
  fetcher: typeof fetchCfbEspnReferenceLines = fetchCfbEspnReferenceLines,
): Promise<{ result: CfbEspnReferenceResult; error: string | null }> {
  try {
    return { result: await fetcher(args), error: null };
  } catch (error) {
    return {
      result: {
        release: CFB_ESPN_REFERENCE_LINE_RELEASE,
        requests: args.games.length > 0 ? CFB_ESPN_REFERENCE_MAX_REQUESTS : 0,
        attemptedGames: args.games.length,
        matchedGames: 0,
        linesByGame: {},
        failuresByGame: Object.fromEntries(args.games.map((game) => [game.providerGameId, "provider_request_failed"])),
      },
      error: splitRequestError(error),
    };
  }
}

function compactForecast(
  forecast: ReturnType<typeof getCfbV1ForecastForGame>["forecast"],
): CfbForwardEvidencePayload["decisions"]["forecast"] {
  const { pmf: _pmf, ...published } = forecast;
  void _pmf;
  return published;
}

function splitRequestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "unknown SharpAPI split request failure";
}

export async function fetchCfbSharpOddsFallbackAttempt(
  args: Parameters<typeof fetchSharpApiNcaafOddsFallback>[0],
  fetcher: typeof fetchSharpApiNcaafOddsFallback = fetchSharpApiNcaafOddsFallback,
): Promise<{ result: CfbSharpApiOddsResult; error: string | null }> {
  try {
    const result = await fetcher(args);
    const failures = Object.entries(result.failuresByGame ?? {});
    return {
      result,
      error: failures.length > 0
        ? failures.slice(0, 4).map(([gameId, reason]) => `${gameId}:${reason}`).join(" | ")
        : null,
    };
  } catch (error) {
    const message = splitRequestError(error);
    const optionalProviderRejection = error instanceof SharpApiAbortError || error instanceof SharpApiClientError
      && (error.status === 400 || error.status === 404);
    if (!optionalProviderRejection && !/sharpapi network error|fetch failed/i.test(message)) throw error;
    return {
      result: {
        release: CFB_SHARP_API_ODDS_RELEASE,
        requests: args.games.length > 0 ? CFB_SHARP_FALLBACK_MAX_REQUESTS : 0,
        attemptedGames: args.games.length,
        matchedGames: 0,
        booksByGame: {},
        displayBooksByGame: {},
        eventIdsByGame: {},
        eventDiscoveryStatusByGame: {},
        failuresByGame: {},
      },
      error: message,
    };
  }
}

function requiredQuarterbacks(map: Map<number, CfbForwardTeamQuarterbacks>, id: number, abbreviation: string, capturedAt: string): CfbForwardTeamQuarterbacks {
  return map.get(id) ?? { provider: "balldontlie", teamId: id, team: abbreviation, capturedAt, starterStatus: "unknown", projectionMethod: "no_active_quarterback", expectedStartingQuarterback: null, activeQuarterbacks: [] };
}

function stageCounts(payloads: CfbForwardEvidencePayload[]): Record<"opening" | "unlocked" | "t60", number> {
  return { opening: payloads.filter((row) => row.stage === "opening").length, unlocked: payloads.filter((row) => row.stage === "unlocked").length, t60: payloads.filter((row) => row.stage === "t60").length };
}

export type CfbTrackingCandidate = {
  payload: CfbForwardEvidencePayload;
  mode: "official_t60" | "published_t60_accuracy_lock" | "published_pregame_accuracy_recovery";
  publishedPregamePayload: CfbForwardEvidencePayload | null;
};

export function cfbTrackingCandidatesForRun(
  existing: CfbForwardStoredEvidence[],
  newlyCaptured: CfbForwardEvidencePayload[],
  now: string,
): CfbTrackingCandidate[] {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("CFB tracking candidate selection requires a valid timestamp.");
  const byGame = new Map<string, CfbForwardEvidencePayload[]>();
  for (const payload of [...existing.map((row) => row.payload), ...newlyCaptured]) {
    const rows = byGame.get(payload.game.providerGameId) ?? [];
    rows.push(payload);
    byGame.set(payload.game.providerGameId, rows);
  }
  const selected: CfbTrackingCandidate[] = [];
  for (const rows of byGame.values()) {
    const official = rows.filter(isEligibleOfficialTrackingPayload).sort(latestPayloadFirst)[0];
    const accuracyLock = rows.filter(isCfbPublishedT60AccuracyLockPayload).sort(latestPayloadFirst)[0];
    const recovery = rows.filter((payload) => {
      const gameStart = Date.parse(payload.game.scheduledStart);
      const capturedAt = Date.parse(payload.capturedAt);
      return isEligiblePublishedPregameRecoveryPayload(payload) &&
        Number.isFinite(gameStart) &&
        Number.isFinite(capturedAt) &&
        gameStart <= nowMs &&
        capturedAt < gameStart;
    }).sort(latestPayloadFirst)[0];
    if (official) selected.push({ payload: official, mode: "official_t60", publishedPregamePayload: recovery ?? null });
    else if (accuracyLock) selected.push({ payload: accuracyLock, mode: "published_t60_accuracy_lock", publishedPregamePayload: accuracyLock });
    else if (recovery) selected.push({ payload: recovery, mode: "published_pregame_accuracy_recovery", publishedPregamePayload: recovery });
  }
  return selected.sort((first, second) =>
    Date.parse(first.payload.game.scheduledStart) - Date.parse(second.payload.game.scheduledStart) ||
    first.payload.game.providerGameId.localeCompare(second.payload.game.providerGameId));
}

function latestPayloadFirst(first: CfbForwardEvidencePayload, second: CfbForwardEvidencePayload): number {
  return Date.parse(second.capturedAt) - Date.parse(first.capturedAt) || second.runId.localeCompare(first.runId);
}

function isEligibleOfficialTrackingPayload(payload: CfbForwardEvidencePayload): boolean {
  return payload.schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE &&
    payload.memberRelease === CFB_FORWARD_MEMBER_RELEASE &&
    payload.decisions.decisionRelease === CFB_V1_DECISION_RELEASE &&
    payload.authoritativeForecast?.release === CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE &&
    payload.decisions.trackingEnabled &&
    payload.stage === "t60" &&
    payload.captureTiming === "on_time" &&
    (payload.t60LagMinutes ?? Infinity) >= 0 &&
    (payload.t60LagMinutes ?? Infinity) <= CFB_T60_MAX_CAPTURE_LAG_MINUTES;
}

function isEligiblePublishedPregameRecoveryPayload(payload: CfbForwardEvidencePayload): boolean {
  const release = payload.authoritativeForecast?.release as string | undefined;
  return ((String(payload.schemaRelease) === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE && String(payload.memberRelease) === CFB_FORWARD_MEMBER_RELEASE) ||
    (String(payload.schemaRelease) === CFB_FORWARD_GAP_FALLBACK_PREVIOUS_EVIDENCE_SCHEMA_RELEASE && String(payload.memberRelease) === CFB_FORWARD_GAP_FALLBACK_PREVIOUS_MEMBER_RELEASE) ||
    (String(payload.schemaRelease) === CFB_FORWARD_RELEASE_WAVE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE && String(payload.memberRelease) === CFB_FORWARD_RELEASE_WAVE_PREVIOUS_MEMBER_RELEASE) ||
    (String(payload.schemaRelease) === CFB_FORWARD_FCS_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE && String(payload.memberRelease) === CFB_FORWARD_FCS_PRICE_PREVIOUS_MEMBER_RELEASE) ||
    (String(payload.schemaRelease) === CFB_FORWARD_PRICE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE && String(payload.memberRelease) === CFB_FORWARD_PRICE_PREVIOUS_MEMBER_RELEASE)) &&
    (payload.decisions.decisionRelease === CFB_V1_DECISION_RELEASE || payload.decisions.decisionRelease === CFB_V1_GAP_FALLBACK_PREVIOUS_DECISION_RELEASE || payload.decisions.decisionRelease === CFB_V1_FCS_PRICE_PREVIOUS_DECISION_RELEASE) &&
    payload.decisions.publicationEnabled &&
    (release === CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE || release === CFB_MARKET_SHARP_AWARE_GAP_FALLBACK_PREVIOUS_PRODUCTION_RELEASE || release === CFB_MARKET_SHARP_AWARE_FCS_PRICE_PREVIOUS_PRODUCTION_RELEASE || release === CFB_MARKET_SHARP_AWARE_PRICE_QB_PREVIOUS_PRODUCTION_RELEASE || release === CFB_MARKET_SHARP_AWARE_PREVIOUS_PRODUCTION_RELEASE) &&
    Boolean(payload.decisions.marketOutlooks);
}

export function cfbLockPlanningEvidence(rows: CfbForwardStoredEvidence[]): CfbForwardStoredEvidence[] {
  const currentReleaseT60Games = new Set(rows
    .filter((row) => row.stage === "t60" && row.payload.schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE)
    .map((row) => row.providerGameId));
  return rows.filter((row) =>
    row.stage !== "t60" ||
    currentReleaseT60Games.has(row.providerGameId) ||
    isValidImmutableT60(row.payload)
  );
}

export function isValidImmutableT60(payload: CfbForwardEvidencePayload): boolean {
  const lag = payload.t60LagMinutes ?? Infinity;
  return payload.stage === "t60" &&
    payload.captureTiming === "on_time" &&
    lag >= 0 &&
    lag <= CFB_T60_MAX_CAPTURE_LAG_MINUTES &&
    payload.coverage.healthHolds.length === 0 &&
    payload.decisions.trackingEnabled &&
    payload.decisions.evaluatedBets.length > 0 &&
    payload.decisions.evaluatedBets.every((decision) =>
      decision.stage === "t60_locked" &&
      decision.lockedAt === payload.capturedAt
    );
}

type TrackingResult = { trackingAttempted: boolean; trackingRecordsProposed: number; trackingRecordsInserted: number; trackingRecordsExisting: number; trackingError: string | null; trackingProviderRequests: number };
type MemberSnapshotResult = Pick<CfbForwardWriterResult, "memberSnapshotAttempted" | "memberSnapshotUpdated" | "memberSnapshotKey" | "memberSnapshotError">;

async function refreshCompactMemberSnapshot(args: {
  client: SupabaseClient;
  existing: CfbForwardStoredEvidence[];
  marketHistory: CfbForwardMarketHistoryEvidence[];
  payloads: CfbForwardEvidencePayload[];
  season: number;
  now: string;
  apply: boolean;
}): Promise<MemberSnapshotResult> {
  if (!args.apply) return { memberSnapshotAttempted: false, memberSnapshotUpdated: false, memberSnapshotKey: null, memberSnapshotError: null };
  const rows = [...args.existing, ...args.payloads.map(storedEvidenceForPayload)];
  if (rows.length === 0) return { memberSnapshotAttempted: false, memberSnapshotUpdated: false, memberSnapshotKey: null, memberSnapshotError: null };
  try {
    const marketHistory = [...args.marketHistory, ...args.payloads.map(marketHistoryForPayload)];
    const fixture = buildCfbMemberFixture(rows, args.now, marketHistory);
    const snapshot = buildCfbForwardMemberSnapshot({ fixture, season: args.season, publishedAt: args.now });
    const write = await writeCfbForwardMemberSnapshot({ client: args.client, snapshot });
    return { memberSnapshotAttempted: true, memberSnapshotUpdated: write.ok, memberSnapshotKey: write.snapshotKey, memberSnapshotError: write.ok ? null : write.error };
  } catch (error) {
    return { memberSnapshotAttempted: true, memberSnapshotUpdated: false, memberSnapshotKey: null, memberSnapshotError: error instanceof Error ? error.message : String(error) };
  }
}

function storedEvidenceForPayload(payload: CfbForwardEvidencePayload): CfbForwardStoredEvidence {
  return {
    id: `pending:${payload.runId}:${payload.game.providerGameId}:${payload.stage}`,
    providerGameId: payload.game.providerGameId,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    gameStartAt: payload.game.scheduledStart,
    payloadSha256: hashCfbForwardEvidencePayload(payload),
    payload,
  };
}

function marketHistoryForPayload(payload: CfbForwardEvidencePayload): CfbForwardMarketHistoryEvidence {
  return {
    id: `pending:${payload.runId}:${payload.game.providerGameId}:${payload.stage}`,
    providerGameId: payload.game.providerGameId,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    gameStartAt: payload.game.scheduledStart,
    payloadSha256: hashCfbForwardEvidencePayload(payload),
    payload: {
      market: {
        current: payload.market.current,
        currentBooks: payload.market.currentBooks,
        providerOpening: payload.market.providerOpening,
        operationalOpening: payload.market.operationalOpening,
        playbookSplits: payload.market.playbookSplits,
        sharpApiSplits: payload.market.sharpApiSplits,
      },
    },
  };
}

async function writeOfficialTracking(args: {
  client: SupabaseClient;
  candidates: CfbTrackingCandidate[];
  apply: boolean;
  metadata: CfbForwardEvidenceMetadata[];
  balldontlieApiKey: string;
  now: string;
  priorGamesByWindow?: Map<string, NcaafGame[]>;
}): Promise<TrackingResult> {
  const eligible = args.candidates.filter(({ payload }) =>
    isPublicallyTracked("cfb", computeSlateDate("cfb", payload.game.scheduledStart))
  );
  const trackingGames = eligible.map((candidate) => ({
    externalId: cfbProviderIntegerId(candidate.payload.game.providerGameId, "game"),
    decisions: candidateTrackingMarkets(candidate).map((market) => ({ market })),
  }));
  const proposed = trackingGames.length === 0 ? 0 : buildMarketScopedFootballTrackingPlan(trackingGames).proposed;
  if (!args.apply || proposed === 0) return { trackingAttempted: false, trackingRecordsProposed: proposed, trackingRecordsInserted: 0, trackingRecordsExisting: 0, trackingError: null, trackingProviderRequests: 0 };
  for (const decision of eligible.flatMap(({ payload }) => payload.decisions.evaluatedBets)) assertOfficialTrackingMarket("cfb", decision.market);
  const externalIds = eligible.map(({ payload }) => cfbProviderIntegerId(payload.game.providerGameId, "game"));
  const { data: existingRows, error: existingError } = await args.client.from("prediction_records").select("external_id,market").eq("sport", "cfb").in("external_id", externalIds);
  if (existingError) throw new Error(`CFB tracking record read failed: ${existingError.message}`);
  const existingKeys = buildMarketScopedFootballTrackingPlan(trackingGames, (existingRows ?? []) as Array<{ external_id: number; market: string }>).existingKeys;
  if (existingKeys.size === proposed) return { trackingAttempted: true, trackingRecordsProposed: proposed, trackingRecordsInserted: 0, trackingRecordsExisting: existingKeys.size, trackingError: null, trackingProviderRequests: 0 };

  const payloads = eligible.map(({ payload }) => payload);
  const teamIds = await upsertTeams(args.client, payloads);
  const gameIds = await upsertGames(args.client, payloads, teamIds);
  const standardRecords = eligible.flatMap((candidate) => {
    const gameId = gameIds.get(candidate.payload.game.providerGameId)!;
    const primary = candidate.mode === "official_t60"
      ? buildCfbOfficialTrackingRecords({ payload: candidate.payload, gameId })
      : buildCfbPublishedPregameRecoveryRecords({ payload: candidate.payload, gameId });
    const recovery = candidate.publishedPregamePayload && candidate.publishedPregamePayload !== candidate.payload
      ? buildCfbPublishedPregameRecoveryRecords({ payload: candidate.publishedPregamePayload, gameId })
      : [];
    return uniqueRecordsByMarket([...primary, ...recovery]);
  });
  const availableKeys = new Set([...existingKeys, ...standardRecords.map((record) => `${record.external_id}:${record.market}`)]);
  const supplementalCandidates = eligible.filter((candidate) => {
    const externalId = cfbProviderIntegerId(candidate.payload.game.providerGameId, "game");
    const planned = new Set(candidateTrackingMarkets(candidate));
    return candidate.publishedPregamePayload !== null && (["spread", "total"] as const)
      .some((market) => planned.has(market) && !availableKeys.has(`${externalId}:${market}`));
  });
  const namedBookRecords: PredictionRecordRow[] = [];
  const displayedBookRecords: PredictionRecordRow[] = [];
  const espnRecords: PredictionRecordRow[] = [];
  let trackingProviderRequests = 0;
  const replayForecasts = new Map<string, CfbV1Forecast>();
  const priorByWindow = new Map(args.priorGamesByWindow ?? []);
  for (const candidate of supplementalCandidates) {
    const payload = candidate.publishedPregamePayload!;
    const before = activeCfbWeeklyWindow(payload.capturedAt).boardStartDate;
    if (!priorByWindow.has(before)) {
      const prior = await fetchPriorCompletedGames({
        rows: args.metadata,
        before,
        apiKey: args.balldontlieApiKey,
      });
      trackingProviderRequests += prior.providerRequests;
      priorByWindow.set(before, prior.games);
    }
    const replayForecast = getCfbV1ForecastForGame({ game: payload.game, completedGames: priorByWindow.get(before)! }).forecast;
    replayForecasts.set(payload.game.providerGameId, replayForecast);
    const gameId = gameIds.get(payload.game.providerGameId)!;
    namedBookRecords.push(...buildCfbNamedBookLineRecoveryRecords({ payload, gameId, replayForecast }));
    displayedBookRecords.push(...buildCfbDisplayedBookLineRecoveryRecords({ payload, gameId, replayForecast }));
  }
  const availableAfterNamed = new Set([
    ...availableKeys,
    ...namedBookRecords.map((record) => `${record.external_id}:${record.market}`),
    ...displayedBookRecords.map((record) => `${record.external_id}:${record.market}`),
  ]);
  const espnCandidates = supplementalCandidates.filter((candidate) => {
    const externalId = cfbProviderIntegerId(candidate.payload.game.providerGameId, "game");
    const planned = new Set(candidateTrackingMarkets(candidate));
    return (["spread", "total"] as const)
      .some((market) => planned.has(market) && !availableAfterNamed.has(`${externalId}:${market}`));
  });
  if (espnCandidates.length > 0) {
    const attempt = await fetchCfbEspnReferenceAttempt({
      games: espnCandidates.map((candidate) => candidate.publishedPregamePayload!.game),
      capturedAt: args.now,
      maximumGames: CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN,
    });
    trackingProviderRequests += attempt.result.requests;
    for (const candidate of espnCandidates) {
      const payload = candidate.publishedPregamePayload!;
      const referenceLine = attempt.result.linesByGame[payload.game.providerGameId] ?? null;
      if (!referenceLine) continue;
      const replayForecast = replayForecasts.get(payload.game.providerGameId)!;
      const gameId = gameIds.get(payload.game.providerGameId)!;
      espnRecords.push(...buildCfbEspnOpeningRecoveryRecords({ payload, gameId, referenceLine, replayForecast }));
    }
  }
  const { records, missing } = planCfbTrackingRecordInsert({
    trackingGames,
    existingKeys,
    candidateRecords: [...standardRecords, ...namedBookRecords, ...displayedBookRecords, ...espnRecords],
  });
  if (records.length > 0) {
    const { data, error } = await args.client.from("prediction_records").insert(records as unknown as Record<string, unknown>[]).select("id");
    if (error) throw new Error(`CFB tracking record insert failed: ${error.message}`);
    if ((data?.length ?? records.length) !== records.length) throw new Error("CFB tracking record insert count mismatch.");
  }
  return {
    trackingAttempted: true,
    trackingRecordsProposed: proposed,
    trackingRecordsInserted: records.length,
    trackingRecordsExisting: existingKeys.size,
    trackingError: missing.length > 0
      ? `complete_tracking_recovery_unavailable:${missing.slice(0, 12).join(",")}`
      : null,
    trackingProviderRequests,
  };
}

export function planCfbTrackingRecordInsert(args: {
  trackingGames: Array<{ externalId: number; decisions: Array<{ market: CfbV1Market }> }>;
  existingKeys: ReadonlySet<string>;
  candidateRecords: PredictionRecordRow[];
}): { records: PredictionRecordRow[]; missing: string[] } {
  const plannedKeys = new Set(args.trackingGames.flatMap((game) => game.decisions
    .map((decision) => `${game.externalId}:${decision.market}`)));
  const candidates = uniqueRecordsByMarket(args.candidateRecords)
    .filter((record) => plannedKeys.has(`${record.external_id}:${record.market}`))
    .filter((record) => !args.existingKeys.has(`${record.external_id}:${record.market}`));
  const candidateKeys = new Set(candidates.map((record) => `${record.external_id}:${record.market}`));
  const completeGames = new Set(args.trackingGames
    .filter((game) => game.decisions.every((decision) => {
      const key = `${game.externalId}:${decision.market}`;
      return args.existingKeys.has(key) || candidateKeys.has(key);
    }))
    .map((game) => game.externalId));
  const records = candidates.filter((record) => completeGames.has(record.external_id));
  const finalKeys = new Set([...args.existingKeys, ...records.map((record) => `${record.external_id}:${record.market}`)]);
  const missing = args.trackingGames.flatMap((game) => game.decisions
    .filter((decision) => !finalKeys.has(`${game.externalId}:${decision.market}`))
    .map((decision) => `${game.externalId}:${decision.market}`));
  return { records, missing };
}

export function candidateTrackingMarkets(candidate: CfbTrackingCandidate): CfbV1Market[] {
  const markets = new Set<CfbV1Market>(candidate.mode === "official_t60"
    ? cfbTrackingMarketsForPayload(candidate.payload)
    : recoverableMarkets(candidate.payload));
  if (candidate.publishedPregamePayload) {
    for (const market of recoverableMarkets(candidate.publishedPregamePayload)) markets.add(market);
    const payload = candidate.publishedPregamePayload;
    if (payload.authoritativeForecast?.status === "market_anchor_unavailable_hold" &&
      payload.contextualEvidenceCapture?.prior.outcome.pmf.sha256) {
      if (payload.market.current?.spread) markets.add("spread");
      if (payload.market.current?.total) markets.add("total");
      if (cfbDisplayedLineRecoveryBook(payload, "spread")) markets.add("spread");
      if (cfbDisplayedLineRecoveryBook(payload, "total")) markets.add("total");
    }
  }
  return (["moneyline", "spread", "total"] as const).filter((market) => markets.has(market));
}

function recoverableMarkets(payload: CfbForwardEvidencePayload): CfbV1Market[] {
  return cfbPublishedPregameRecoveryMarkets(payload);
}

function uniqueRecordsByMarket(records: PredictionRecordRow[]): PredictionRecordRow[] {
  const output = new Map<string, PredictionRecordRow>();
  for (const record of records) {
    const key = `${record.external_id}:${record.market}`;
    if (!output.has(key)) output.set(key, record);
  }
  return [...output.values()];
}

async function upsertTeams(client: SupabaseClient, payloads: CfbForwardEvidencePayload[]): Promise<Map<number, number>> {
  const teams = [...new Map(payloads.flatMap((payload) => [[payload.game.away.id, payload.game.away] as const, [payload.game.home.id, payload.game.home] as const])).values()];
  const rows = teams.map((team) => ({ external_id: team.id, sport: "cfb", slug: `cfb-${team.abbreviation.toLowerCase()}`, abbreviation: team.abbreviation, display_name: team.name, short_display_name: team.abbreviation, name: team.name, location: team.name.split(" ").slice(0, -1).join(" ") || team.name, league: "NCAAF", division: null, logo_url: null, primary_color: null, provider_ids: { balldontlie_ncaaf: { id: String(team.id) } } }));
  const { data, error } = await client.from("teams").upsert(rows, { onConflict: "sport,external_id" }).select("id,external_id");
  if (error) throw new Error(`CFB tracking team upsert failed: ${error.message}`);
  return new Map(((data ?? []) as Array<{ id: number; external_id: number }>).map((row) => [row.external_id, row.id]));
}

async function upsertGames(client: SupabaseClient, payloads: CfbForwardEvidencePayload[], teamIds: Map<number, number>): Promise<Map<string, number>> {
  const rows = payloads.map((payload) => ({ external_id: cfbProviderIntegerId(payload.game.providerGameId, "game"), sport: "cfb", home_team_id: teamIds.get(payload.game.home.id)!, away_team_id: teamIds.get(payload.game.away.id)!, game_date: payload.game.scheduledStart, slate_date: computeSlateDate("cfb", payload.game.scheduledStart), season: payload.season, season_type: "regular", postseason: false, status: normalizeStatus(payload.game.status), venue: null, provider_ids: { balldontlie_ncaaf: { id: payload.game.providerGameId, season: payload.season, week: payload.week } } }));
  const { data, error } = await client.from("games").upsert(rows, { onConflict: "sport,external_id" }).select("id,external_id");
  if (error) throw new Error(`CFB tracking game upsert failed: ${error.message}`);
  const providerByExternal = new Map(payloads.map((payload) => [cfbProviderIntegerId(payload.game.providerGameId, "game"), payload.game.providerGameId]));
  return new Map(((data ?? []) as Array<{ id: number; external_id: number }>).map((row) => [providerByExternal.get(row.external_id)!, row.id]));
}

function normalizeStatus(value: string): string { const normalized = value.toLowerCase(); return normalized === "final" ? "final" : normalized === "in_progress" ? "in_progress" : normalized === "postponed" || normalized === "canceled" ? normalized : "scheduled"; }

function emptyResult(reason: string, tracking: TrackingResult, memberSnapshot: MemberSnapshotResult): CfbForwardWriterResult {
  return { writerRelease: CFB_FORWARD_WRITER_RELEASE, collected: false, collectionReason: reason, proposed: 0, inserted: 0, games: 0, stages: { opening: 0, unlocked: 0, t60: 0 }, publishedEvaluations: 0, publishedBestAngles: 0, publishedLeans: 0, publishedWatchlists: 0, publishedNoPlays: 0, heldMarkets: 0, apiCallsMaximum: tracking.trackingProviderRequests, healthHolds: tracking.trackingError ? ["official_tracking_incomplete"] : [], captureFailures: [], publicationAttempted: false, ...memberSnapshot, ...tracking };
}
