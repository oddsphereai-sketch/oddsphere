import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { isPublicallyTracked } from "@/lib/config/officialTrackingStart";
import { assertOfficialTrackingMarket } from "@/lib/config/officialTrackingMarkets";
import { PlaybookClient } from "@/lib/providers/playbook/playbookClient";
import { fetchBalldontlieNcaafResultsForDates, fetchBalldontlieNcaafSlate, type NcaafGame } from "./balldontlieNcaafSlate";
import { fetchBalldontlieNcaafQuarterbacks } from "./balldontlieNcaafQuarterbacks";
import { matchCfbPlaybookRow, normalizeCfbPlaybookLine, normalizeCfbPlaybookSplits } from "./cfbPlaybookEvidence";
import {
  CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  buildCfbForwardMarketOutlooks,
  determineCfbForwardCollectionNeed,
  planCfbForwardEvidenceCaptures,
  type CfbForwardEvidencePayload,
  type CfbForwardOperationalOpening,
  type CfbForwardPublishedDecisionBundle,
  type CfbForwardStoredEvidence,
  type CfbForwardTeamQuarterbacks,
} from "./cfbForwardEvidence";
import { appendCfbForwardEvidence, readCfbForwardEvidence } from "./cfbForwardEvidenceStore";
import { buildCfbV1DecisionBundle, CFB_T60_MAX_CAPTURE_LAG_MINUTES, CFB_V1_DECISION_RELEASE, getCfbV1ForecastForGame } from "./cfbV1Decision";
import { cfbV1WeeklyGameProfileCoverage } from "./cfbV1WeeklyForecast";
import { resolveCfbCanonicalMarketAnchor } from "./cfbMarketInformedOutcome";
import {
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
  CFB_MARKET_SHADOW_WEIGHT,
  CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
} from "./cfbMarketSharpAwareShadow";
import { buildCfbOfficialTrackingRecords, cfbProviderIntegerId } from "./cfbOfficialTrackingRecord";
import { eligibleCfbWeeklyGames, isGameInCfbWeeklyWindow, resolveCfbForwardWindow, type CfbWeeklyWindow } from "./cfbWeeklyWindow";
import {
  CFB_SHARP_API_ODDS_RELEASE,
  cfbBooksNeedSharpFallback,
  fetchSharpApiNcaafOddsFallback,
  mergeCfbNamedBooks,
  preferredCfbTargetBook,
} from "./cfbSharpApiOdds";
import { fetchCfbSharpApiSplits } from "./cfbSharpApiSplits";
import { buildMarketScopedFootballTrackingPlan } from "./footballMarketScopedTracking";
import { assertFootballCrossMarketCoherence } from "./footballCrossMarketCoherence";

export const CFB_FORWARD_WRITER_RELEASE =
  "cfb_forward_evidence_writer_2026_08_30_r31_unit_probability_bound" as const;
export const CFB_FORWARD_MAX_QB_TEAMS_PER_RUN = 24 as const;
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
  publicationAttempted: boolean;
  trackingAttempted: boolean;
  trackingRecordsProposed: number;
  trackingRecordsInserted: number;
  trackingRecordsExisting: number;
};

export async function runCfbForwardEvidenceWriter(args: {
  client: SupabaseClient;
  season: number;
  runId: string;
  now: string;
  apply: boolean;
  balldontlieApiKey: string;
  playbookApiKey: string;
  sharpApiKey: string;
}): Promise<CfbForwardWriterResult> {
  const allExisting = await readCfbForwardEvidence({ client: args.client, season: args.season });
  const window = resolveCfbForwardWindow({ now: args.now, evidence: allExisting, advanceWithoutNextEvidence: true });
  const existing = allExisting.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
  const lockPlanningExisting = cfbLockPlanningEvidence(existing);
  const ordinaryNeed = determineCfbForwardCollectionNeed({ existing: lockPlanningExisting, now: args.now });
  const need = releaseRefreshNeed(existing, args.now) ?? ordinaryNeed;
  if (!need.collect) {
    const tracking = await writeOfficialTracking({ client: args.client, payloads: currentT60Payloads(existing), apply: args.apply });
    return emptyResult(need.reason, tracking);
  }
  const slate = await fetchBalldontlieNcaafSlate({ season: args.season, startDate: window.providerQueryStartDate, endDate: window.providerQueryEndDate, apiKey: args.balldontlieApiKey });
  const games = selectCfbModelCoveredWeeklyGames({ games: slate.games, existing, now: args.now, window });
  if (games.length === 0) throw new Error(`CFB authoritative weekly window ${window.boardStartDate}..${window.boardEndDate} has no eligible model-covered games.`);
  const plans = planCfbForwardEvidenceCaptures({
    games,
    existing: lockPlanningExisting,
    capturedAt: args.now,
    ...(need.reason === "release_refresh_due" ? { unlockedCadenceMinutesOverride: 0 } : {}),
  });
  if (plans.length === 0) return emptyResult("capture_plan_empty", { trackingAttempted: false, trackingRecordsProposed: 0, trackingRecordsInserted: 0, trackingRecordsExisting: 0 });
  const playbook = new PlaybookClient(args.playbookApiKey);
  const priorResults = await fetchPriorCompletedGames({ rows: allExisting, before: window.boardStartDate, apiKey: args.balldontlieApiKey });
  const teams = [...new Map(games.flatMap((game) => [[game.away.id, game.away] as const, [game.home.id, game.home] as const])).values()];
  const priorQuarterbacks = latestQuarterbacksByTeam(allExisting);
  const quarterbackTeams = selectQuarterbackTeams({ plans, teams, priorQuarterbacks, maximum: CFB_FORWARD_MAX_QB_TEAMS_PER_RUN });
  const plannedGames = [...new Map(plans.map((plan) => [plan.game.providerGameId, plan.game])).values()];
  const sharpFallbackGames = plannedGames.filter((game) => cfbBooksNeedSharpFallback(slate.currentOddsComparableBooksByGame[game.providerGameId] ?? []));
  const trustedSharpEventIdsByGame = trustedCfbSharpEventIdsByGame(existing);
  const [linesResult, splitsResult, quarterbacks, sharpFallback, sharpSplitsAttempt] = await Promise.all([
    playbook.lines("ncaaf"),
    playbook.splits("ncaaf"),
    fetchBalldontlieNcaafQuarterbacks({ teams: quarterbackTeams.map((team) => ({ id: team.id, abbreviation: team.abbreviation })), previousSeason: args.season - 1, capturedAt: args.now, apiKey: args.balldontlieApiKey }),
    fetchSharpApiNcaafOddsFallback({ games: sharpFallbackGames, apiKey: args.sharpApiKey, trustedEventIdsByGame: trustedSharpEventIdsByGame }),
    fetchCfbSharpApiSplits({ games, apiKey: args.sharpApiKey })
      .then((result) => ({ result, error: null }))
      .catch((error: unknown) => ({ result: null, error: splitRequestError(error) })),
  ]);
  const quarterbackContext = new Map([...priorQuarterbacks, ...quarterbacks.byTeamId]);
  const lines = (linesResult.body.data ?? []) as unknown[];
  const splits = (splitsResult.body.data ?? []) as unknown[];
  const priorOpening = firstOpenings(existing);
  const payloads = plans.map((plan): CfbForwardEvidencePayload => {
    const sharpBooks = sharpFallback.booksByGame[plan.game.providerGameId] ?? [];
    const sharpDisplayBooks = sharpFallback.displayBooksByGame[plan.game.providerGameId] ?? [];
    const currentBooks = mergeCfbNamedBooks(slate.currentOddsComparableBooksByGame[plan.game.providerGameId] ?? [], sharpBooks);
    const displayBooks = mergeCfbNamedBooks(slate.currentOddsAllBooksByGame[plan.game.providerGameId] ?? [], sharpDisplayBooks);
    const current = preferredCfbTargetBook(currentBooks);
    const providerOpening = slate.openingOddsByGame[plan.game.providerGameId] ?? null;
    const operationalOpening = providerOpening
      ? { provenance: "provider_opening" as const, capturedAt: providerOpening.observedAt, quote: providerOpening }
      : priorOpening.get(plan.game.providerGameId) ?? (current ? { provenance: "first_observed" as const, capturedAt: current.observedAt, quote: current } : null);
    const awayQuarterbacks = requiredQuarterbacks(quarterbackContext, plan.game.away.id, plan.game.away.abbreviation, args.now);
    const homeQuarterbacks = requiredQuarterbacks(quarterbackContext, plan.game.home.id, plan.game.home.abbreviation, args.now);
    const playbookLineRow = lines.find((row) => matchCfbPlaybookRow(plan.game, row));
    const playbookSplitRow = splits.find((row) => matchCfbPlaybookRow(plan.game, row));
    const playbookLine = playbookLineRow ? normalizeCfbPlaybookLine(playbookLineRow, args.now) : null;
    const playbookSplits = playbookSplitRow ? normalizeCfbPlaybookSplits(playbookSplitRow, args.now) : null;
    const sharpApiSplits = sharpSplitsAttempt.result?.recordsByGame[plan.game.providerGameId] ?? [];
    const sharpApiSplitsStatus = sharpSplitsAttempt.result === null
      ? "request_failed" as const
      : sharpApiSplits.length > 0
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
    const weeklyForecast = getCfbV1ForecastForGame({ game: plan.game, completedGames: priorResults.games });
    const outcomeAnchor = resolveCfbCanonicalMarketAnchor({
      books: currentBooks,
      contextLines: {
        homeSpread: playbookLine?.homeSpread ?? null,
        totalLine: playbookLine?.total ?? null,
      },
    });
    const provisionalBoardGame = plan.game.away.fbs || plan.game.home.fbs;
    if (!outcomeAnchor && provisionalBoardGame) {
      throw new Error(
        `CFB market/sharp release requires a canonical price anchor for ${plan.game.away.abbreviation}@${plan.game.home.abbreviation}; preserving the preceding coherent snapshot.`,
      );
    }
    const forecast = outcomeAnchor
      ? buildCfbMarketSharpAwareForecast({
          independentForecast: weeklyForecast.forecast,
          anchor: outcomeAnchor,
          sharpSplits: sharpApiSplits,
          evaluatedAt: capturedAt,
        })
      : weeklyForecast.forecast;
    const healthHolds = [
      ...(plan.stage === "t60" && (effectiveT60LagMinutes ?? Infinity) > CFB_T60_MAX_CAPTURE_LAG_MINUTES ? ["t60_capture_late"] : []),
      ...(plan.stage === "t60" && awayQuarterbacks.expectedStartingQuarterback === null ? ["away_quarterback_roster_unavailable"] : []),
      ...(plan.stage === "t60" && homeQuarterbacks.expectedStartingQuarterback === null ? ["home_quarterback_roster_unavailable"] : []),
      ...(weeklyForecast.featureHealth.awayProfile === "neutral_imputation" ? ["away_model_team_profile_unavailable"] : []),
      ...(weeklyForecast.featureHealth.homeProfile === "neutral_imputation" ? ["home_model_team_profile_unavailable"] : []),
      ...(!outcomeAnchor ? ["authoritative_market_anchor_unavailable_outside_provisional_board"] : []),
    ];
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
    });
    const decisions = compactDecisionBundle(outcomeAnchor
      ? applyCfbMarketSharpAwareGrades({
          bundle: decisionBundle,
          homeTeam: plan.game.home.abbreviation,
          sharpSplits: sharpApiSplits,
          operationalOpening,
        })
      : decisionBundle, playbookLine);
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
      decisions: decisions.evaluatedBets,
      unavailableMarkets: decisions.heldMarkets.map((market) => market.market),
      requireDecisionSideFromForecast: true,
    });
    const targetExcludedConsensusReady = decisions.evaluatedBets.length === 3;
    return {
      schemaRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      collectorRelease: CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
      memberRelease: CFB_FORWARD_MEMBER_RELEASE,
      runId: args.runId,
      season: args.season,
      week: plan.game.providerWeek,
      slateGameCount: games.length,
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
        playbookSplits,
        sharpApiOddsRelease: sharpBooks.length > 0 ? CFB_SHARP_API_ODDS_RELEASE : null,
        sharpApiSplits,
        sharpApiSplitsStatus,
        sharpApiSplitsError: sharpSplitsAttempt.error,
      },
      quarterbacks: { away: awayQuarterbacks, home: homeQuarterbacks },
      availability: { injuryStatus: "provider_unavailable", weatherStatus: "venue_weather_unavailable", note: "BALLDONTLIE NCAAF supplies active rosters but no timestamped injury/depth or venue-weather endpoint; those contexts are labeled unavailable and are never fabricated." },
      decisions,
      independentForecast: compactForecast(weeklyForecast.forecast),
      authoritativeForecast: {
        status: outcomeAnchor ? "market_sharp_applied" : "market_anchor_unavailable_hold",
        release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
        candidateRelease: CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
        marketWeight: outcomeAnchor ? CFB_MARKET_SHADOW_WEIGHT : 0,
      },
      coverage: {
        currentOdds: current !== null,
        comparableCurrentBookCount: currentBooks.length,
        currentOddsProviders: [...new Set(currentBooks.map((book) => book.provider ?? "balldontlie"))].sort(),
        sharpApiOddsFallback: sharpBooks.length > 0,
        targetExcludedConsensusReady,
        operationalOpening: operationalOpening !== null,
        playbookLine: playbookLine !== null,
        playbookSplits: playbookSplits !== null,
        sharpApiSplits: sharpApiSplits.length > 0,
        activeQuarterbacks: awayQuarterbacks.activeQuarterbacks.length > 0 && homeQuarterbacks.activeQuarterbacks.length > 0,
        injuries: false,
        weather: false,
        healthHolds,
        availabilityWarnings: [
          ...(sharpFallback.eventDiscoveryStatusByGame[plan.game.providerGameId] === "ambiguous" ? ["sharpapi_canonical_event_ambiguous"] : []),
          "quarterback_starter_projected_not_confirmed",
          "injury_feed_unavailable",
          "venue_weather_unavailable",
          ...(sharpApiSplitsStatus === "request_failed" ? ["sharpapi_splits_request_failed"] : sharpApiSplitsStatus === "event_not_published" ? ["sharpapi_splits_event_not_published"] : []),
          ...(sharpBooks.length > 0 ? ["sharpapi_named_book_price_fallback"] : []),
        ],
      },
      requestBudget: {
        balldontlieSlate: slate.providerRequests + priorResults.providerRequests,
        balldontlieQuarterbacks: quarterbacks.providerRequests,
        playbook: 2,
        sharpApiOdds: sharpFallback.requests,
        sharpApiSplits: 1,
        totalMaximum: slate.providerRequests + priorResults.providerRequests + quarterbacks.providerRequests + sharpFallback.requests + 3,
      },
    };
  });
  const write = await appendCfbForwardEvidence({ client: args.client, runId: args.runId, payloads, apply: args.apply });
  const tracking = await writeOfficialTracking({ client: args.client, payloads: payloads.filter((payload) => payload.stage === "t60"), apply: args.apply });
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
    apiCallsMaximum: slate.providerRequests + priorResults.providerRequests + quarterbacks.providerRequests + sharpFallback.requests + 3,
    healthHolds: [...new Set(payloads.flatMap((payload) => payload.coverage.healthHolds))],
    publicationAttempted: true,
    ...tracking,
  };
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
  return eligibleCfbWeeklyGames(args.games, args.window).filter((game) =>
    (Date.parse(game.scheduledStart) > nowMs || existingIds.has(game.providerGameId)) &&
    cfbV1WeeklyGameProfileCoverage(game).supported
  );
}

export function planCfbPriorResultReads(args: {
  rows: Array<Pick<CfbForwardStoredEvidence, "providerGameId" | "gameStartAt">>;
  before: string;
}): Array<{ gameIds: string[]; dates: string[] }> {
  const dateById = new Map<string, string>();
  for (const row of args.rows.filter((value) => value.gameStartAt.slice(0, 10) < args.before)) {
    const date = row.gameStartAt.slice(0, 10);
    const existing = dateById.get(row.providerGameId);
    if (existing && existing !== date) throw new Error(`CFB prior game ${row.providerGameId} has conflicting persisted dates.`);
    dateById.set(row.providerGameId, date);
  }
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

async function fetchPriorCompletedGames(args: { rows: CfbForwardStoredEvidence[]; before: string; apiKey: string }): Promise<{ games: NcaafGame[]; providerRequests: number }> {
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

export function selectQuarterbackTeams(args: {
  plans: Array<{ game: NcaafGame; stage: "opening" | "unlocked" | "t60" }>;
  teams: NcaafGame["home"][];
  priorQuarterbacks: Map<number, CfbForwardTeamQuarterbacks>;
  maximum: number;
}): NcaafGame["home"][] {
  if (!Number.isInteger(args.maximum) || args.maximum < 0) throw new Error("CFB quarterback team budget must be a nonnegative integer.");
  const byId = new Map(args.teams.map((team) => [team.id, team]));
  const candidates = new Map<number, { team: NcaafGame["home"]; priority: number; startsAt: number }>();
  for (const plan of args.plans) {
    for (const team of [plan.game.away, plan.game.home]) {
      if (args.priorQuarterbacks.get(team.id)?.activeQuarterbacks.length) continue;
      const priority = plan.stage === "t60" ? 0 : plan.stage === "opening" ? 1 : 2;
      const current = candidates.get(team.id);
      if (!current || priority < current.priority || Date.parse(plan.game.scheduledStart) < current.startsAt) candidates.set(team.id, { team: byId.get(team.id) ?? team, priority, startsAt: Date.parse(plan.game.scheduledStart) });
    }
  }
  return [...candidates.values()].sort((first, second) => first.priority - second.priority || first.startsAt - second.startsAt || first.team.id - second.team.id).slice(0, args.maximum).map((value) => value.team);
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

function releaseRefreshNeed(rows: CfbForwardStoredEvidence[], now: string): { collect: true; reason: string; cadenceMinutes: number } | null {
  const timestamp = Date.parse(now);
  const latest = new Map<string, CfbForwardStoredEvidence>();
  for (const row of rows) {
    const current = latest.get(row.providerGameId);
    if (!current || Date.parse(row.capturedAt) > Date.parse(current.capturedAt)) latest.set(row.providerGameId, row);
  }
  const staleUpcoming = [...latest.values()].some((row) =>
    timestamp < Date.parse(row.gameStartAt) - 60 * 60_000 &&
    (row.payload.schemaRelease !== CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
      row.payload.memberRelease !== CFB_FORWARD_MEMBER_RELEASE ||
      row.payload.decisions.decisionRelease !== CFB_V1_DECISION_RELEASE ||
      row.payload.authoritativeForecast?.release !== CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE ||
      row.payload.decisions.evaluatedBets.length + row.payload.decisions.heldMarkets.length !== 3)
  );
  return staleUpcoming ? { collect: true, reason: "release_refresh_due", cadenceMinutes: 0 } : null;
}

function compactDecisionBundle(
  bundle: ReturnType<typeof buildCfbV1DecisionBundle>,
  playbookLine: CfbForwardEvidencePayload["market"]["playbookLine"],
): CfbForwardPublishedDecisionBundle {
  const { pmf: _pmf, ...forecast } = bundle.forecast;
  void _pmf;
  return {
    ...bundle,
    forecast,
    marketOutlooks: buildCfbForwardMarketOutlooks({ forecast: bundle.forecast, playbookLine }),
  };
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

function requiredQuarterbacks(map: Map<number, CfbForwardTeamQuarterbacks>, id: number, abbreviation: string, capturedAt: string): CfbForwardTeamQuarterbacks {
  return map.get(id) ?? { provider: "balldontlie", teamId: id, team: abbreviation, capturedAt, starterStatus: "unknown", projectionMethod: "no_active_quarterback", expectedStartingQuarterback: null, activeQuarterbacks: [] };
}

function stageCounts(payloads: CfbForwardEvidencePayload[]): Record<"opening" | "unlocked" | "t60", number> {
  return { opening: payloads.filter((row) => row.stage === "opening").length, unlocked: payloads.filter((row) => row.stage === "unlocked").length, t60: payloads.filter((row) => row.stage === "t60").length };
}

function currentT60Payloads(rows: CfbForwardStoredEvidence[]): CfbForwardEvidencePayload[] { return rows.filter((row) => row.stage === "t60").map((row) => row.payload); }

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

type TrackingResult = { trackingAttempted: boolean; trackingRecordsProposed: number; trackingRecordsInserted: number; trackingRecordsExisting: number };

async function writeOfficialTracking(args: { client: SupabaseClient; payloads: CfbForwardEvidencePayload[]; apply: boolean }): Promise<TrackingResult> {
  const eligible = args.payloads.filter((payload) =>
    payload.schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE &&
    payload.memberRelease === CFB_FORWARD_MEMBER_RELEASE &&
    payload.decisions.decisionRelease === CFB_V1_DECISION_RELEASE &&
    payload.authoritativeForecast?.release === CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE &&
    payload.decisions.trackingEnabled &&
    payload.stage === "t60" &&
    payload.captureTiming === "on_time" &&
    (payload.t60LagMinutes ?? Infinity) >= 0 &&
    (payload.t60LagMinutes ?? Infinity) <= CFB_T60_MAX_CAPTURE_LAG_MINUTES &&
    isPublicallyTracked("cfb", computeSlateDate("cfb", payload.game.scheduledStart))
  );
  const trackingGames = eligible.map((payload) => ({ externalId: cfbProviderIntegerId(payload.game.providerGameId, "game"), decisions: payload.decisions.evaluatedBets }));
  const proposed = trackingGames.length === 0 ? 0 : buildMarketScopedFootballTrackingPlan(trackingGames).proposed;
  if (!args.apply || proposed === 0) return { trackingAttempted: false, trackingRecordsProposed: proposed, trackingRecordsInserted: 0, trackingRecordsExisting: 0 };
  for (const decision of eligible.flatMap((payload) => payload.decisions.evaluatedBets)) assertOfficialTrackingMarket("cfb", decision.market);
  const externalIds = eligible.map((payload) => cfbProviderIntegerId(payload.game.providerGameId, "game"));
  const { data: existingRows, error: existingError } = await args.client.from("prediction_records").select("external_id,market").eq("sport", "cfb").eq("model_version", CFB_V1_DECISION_RELEASE).in("external_id", externalIds);
  if (existingError) throw new Error(`CFB tracking record read failed: ${existingError.message}`);
  const existingKeys = buildMarketScopedFootballTrackingPlan(trackingGames, (existingRows ?? []) as Array<{ external_id: number; market: string }>).existingKeys;
  if (existingKeys.size === proposed) return { trackingAttempted: true, trackingRecordsProposed: proposed, trackingRecordsInserted: 0, trackingRecordsExisting: existingKeys.size };
  const teamIds = await upsertTeams(args.client, eligible);
  const gameIds = await upsertGames(args.client, eligible, teamIds);
  const records = eligible.flatMap((payload) => buildCfbOfficialTrackingRecords({ payload, gameId: gameIds.get(payload.game.providerGameId)! }).filter((record) => !existingKeys.has(`${record.external_id}:${record.market}`)));
  if (records.length > 0) {
    const { data, error } = await args.client.from("prediction_records").insert(records as unknown as Record<string, unknown>[]).select("id");
    if (error) throw new Error(`CFB tracking record insert failed: ${error.message}`);
    if ((data?.length ?? records.length) !== records.length) throw new Error("CFB tracking record insert count mismatch.");
  }
  return { trackingAttempted: true, trackingRecordsProposed: proposed, trackingRecordsInserted: records.length, trackingRecordsExisting: existingKeys.size };
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

function emptyResult(reason: string, tracking: TrackingResult): CfbForwardWriterResult {
  return { writerRelease: CFB_FORWARD_WRITER_RELEASE, collected: false, collectionReason: reason, proposed: 0, inserted: 0, games: 0, stages: { opening: 0, unlocked: 0, t60: 0 }, publishedEvaluations: 0, publishedBestAngles: 0, publishedLeans: 0, publishedWatchlists: 0, publishedNoPlays: 0, heldMarkets: 0, apiCallsMaximum: 0, healthHolds: [], publicationAttempted: false, ...tracking };
}
