import type { SupabaseClient } from "@supabase/supabase-js";
import type { IWeatherProvider } from "@/lib/providers/interfaces/IWeatherProvider";
import { isPublicallyTracked } from "@/lib/config/officialTrackingStart";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { PlaybookReadBroker } from "@/lib/providers/playbook/playbookReadBroker";
import type { PlaybookLineGame, PlaybookSplitGame } from "@/lib/providers/playbook/types";
import {
  bindMarketBrainPriorInputLineage,
  marketBrainPriorArtifactSha256,
  type MarketBrainPriorInputLineage,
} from "@/lib/services/marketBrain/marketBrainContract";
import { marketBrainSha256 } from "@/lib/services/marketBrain/marketBrainCanonical";
import {
  fetchBalldontlieNflSlateAvailability,
  mergeNflAvailabilityWithPrior,
  nflAvailabilityRequestBudgetMaximum,
} from "./balldontlieNflAvailability";
import {
  fetchBalldontlieNflRegularSlate,
  type NflPreviewBookOdds,
  type NflPreviewGame,
} from "./balldontlieNflPreviewSlate";
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
  readNflForwardEvidence,
} from "./nflForwardEvidenceStore";
import { collectNflForwardWeather } from "./nflVenueWeather";
import {
  completeSharpApiNflSplitSet,
  fetchSharpApiNflSplits,
  nflModelSharpSplits,
  unavailableNflSharpApiSplitSources,
  type NflRegularSharpSplitSet,
} from "./sharpApiNflSplits";
import { fetchNflOwlsSplits, qualifyNflOwlsSplitsForModel } from "./nflOwlsSplits";
import { captureBooksWithSharpBooks } from "./sharpApiFootballSharpOdds";
import { readNflOwlsNamedPriceHistory } from "./nflOwlsNamedPriceHistory";
import {
  auditNflJointMarketImpact,
  type NflJointMarketImpactAuditRow,
} from "./nflJointMarketImpactAudit";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "./nflRegularDecisionEvidence";
import {
  buildNflR6ShadowMoneylineDecision,
  resolveNflAvailabilityAdjustedQuarterbackDepth,
} from "./nflR6MoneylineShadow";
import {
  assertFootballCrossMarketCoherence,
  NFL_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS,
} from "./footballCrossMarketCoherence";
import {
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
} from "./nflV1ActionableGradeCandidate";
import {
  buildNflIndependentScoreBaseForecast,
  buildNflPaidTeamScoreBaseForecast,
  buildNflMarketEvidenceOutcomeForecast,
  buildNflNoWeightMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
  hasNflV1WeekOneOutcomeForecast,
  inferNflTargetExcludedSpreadMean,
  inferNflTargetExcludedMoneylineMean,
  inferNflTargetExcludedTotalMean,
  NFL_V1_WEEKLY_OUTCOME_MODEL_RELEASE,
  NFL_V1_PAID_TEAM_SCORE_MODEL_RELEASE,
  NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
} from "./nflV1WeekOneOutcome";
import {
  resolveNflTargetExcludedMarketAxes,
  resolveNflTargetExcludedMoneylineAnchor,
  resolveNflTargetExcludedProduction,
} from "./nflTargetExcludedMarketOutcome";
import {
  buildNflForwardContextCapture,
  buildNflForwardContextMarket,
  NFL_FORWARD_CONTEXT_CAPTURE_RELEASE,
  NFL_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES,
  nflForwardContextSharpHistoryBooks,
} from "./nflForwardEvidenceCapture";
import { buildNflNamedMarketSequenceAuthority } from "./nflNamedMarketSequence";
import { buildNflProfessionalMarketAuthority } from "./nflProfessionalMarketAuthority";
import { buildNflThreeStateMarketAuthority } from "./nflThreeStateMarketReader";
import { nflForwardT60TrackingEligibility } from "./nflTrackingLifecycle";
import {
  buildNflImmutableT60RecoveryRecords,
  buildNflOfficialTrackingRecords,
  nflProviderIntegerId,
  nflTrackingMarketsForPayload,
} from "./nflOfficialTrackingRecord";
import { buildMarketScopedFootballTrackingPlan } from "./footballMarketScopedTracking";
import {
  buildNflWeekOneHeldMemberFixture,
  type NflWeekOneHeldMemberFixture,
} from "./nflWeekOneHeldMemberFixture";
import {
  buildNflForwardMemberSnapshot,
  readNflForwardMemberSnapshot,
  writeNflForwardMemberSnapshot,
} from "./nflForwardMemberSnapshotStore";
import {
  readNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonState,
} from "./nflPlayerPropsCurrentSeasonState";
import { buildNflWeeklyPossessionMargin } from "./nflWeeklyPossessionMargin";
import {
  buildNflExactProviderIndependentScore,
  buildNflExactProviderScoreContext,
  NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE,
  NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
  NFL_EXACT_PROVIDER_SCORE_CONTEXT_RELEASE,
  NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE,
  type NflExactProviderScoreContext,
} from "./nflExactProviderScoreRuntime";
import { buildNflAvailabilityArbitrationShadow } from "./nflAvailabilityArbitrationShadow";
import { buildNflMarketState } from "./nflMarketState";
import { applyNflFullGameEvidenceRuntime, deriveNflEvaluatedMarketContract, stabilizeNflFullGameEvidenceTargets } from "./nflFullGameEvidenceRuntime";
import {
  buildNflMarketBrainShadow,
  nflMarketBrainCaptureFailure,
} from "./nflMarketBrainShadow";
import {
  appendNflMarketBrainShadows,
  readNflMarketBrainPriorArtifactIndex,
} from "./nflMarketBrainShadowStore";
import {
  buildNflOwlsMarketBrainSplitEvidence,
  readNflOwlsMarketBrainSplitEvidence,
} from "./nflOwlsMarketBrainSplits";
import {
  fetchBalldontlieNflWeeklyProjectionShadows,
  NFL_PAID_PROJECTION_MAX_PAGES,
  shouldRefreshNflPaidProjectionShadows,
  type NflPaidProjectionShadow,
} from "./balldontlieNflWeeklyProjectionShadow";

export const NFL_FORWARD_WRITER_RELEASE =
  "nfl_forward_evidence_writer_2026_11_01_r101_independent_market_axes" as const;

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
  marketBrainShadowsProposed: number;
  marketBrainShadowsInserted: number;
  marketBrainShadowsExisting: number;
  marketBrainCaptureFailures: number;
  marketBrainCaptureFailureReasons: string[];
  marketBrainPersistenceAttempted: boolean;
  marketBrainPersistenceError: string | null;
  owlsCapture: {
    attempted: boolean;
    requests: number;
    events: number;
    rows: number;
    matchedGames: number;
    feedStatus: "ok" | "partial" | "unknown" | null;
    partialReason: string | null;
    rejected: number;
    error: string | null;
  };
  namedPriceCapture: {
    attempted: boolean;
    queries: number;
    rows: number;
    rejectedPairs: number;
    matchedGames: number;
    completeGames: number;
    error: string | null;
  };
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
  owlsApiKey?: string;
  /** Existing split provider credential; never used for named-price history. */
  sharpApiKey?: string;
  weatherProvider: IWeatherProvider | null;
  /** Read-only audit hook; never persists or mutates a payload. */
  auditPayloads?: (payloads: NflForwardEvidencePayload[]) => void;
  /** One-run, no-write comparison only; never stored or used for publication. */
  auditJointImpact?: (rows: NflJointMarketImpactAuditRow[]) => void;
  /** Same-input, no-write comparison of the upstream game tuple to the final semantic reader. */
  auditSemanticImpact?: (rows: Array<{
    providerGameId: string;
    game: string;
    upstreamScore: [number, number];
    finalScore: [number, number];
    upstreamDecisions: Array<{ market: string; side: string; grade: string }>;
    finalDecisions: Array<{ market: string; side: string; grade: string }>;
    sideStory: string;
    totalStory: string;
    marketResolutions?: import("./nflFullGameEvidenceArbiter").NflFullGameEvidenceArbitration["marketResolutions"];
    status: string;
  }>) => void;
  /** No-write audit reuses timestamped stored Playbook observations if this local key is absent. */
  playbookAuditOnlySkip?: boolean;
  /** Test/audit-only provider injection; production always uses the default fetcher. */
  sharpSplitsFetcher?: typeof fetchSharpApiNflSplits;
  /** Test/audit-only read of the existing Owl's observation tape; never a second provider request. */
  namedPriceHistoryReader?: typeof readNflOwlsNamedPriceHistory;
  /** Test/audit-only Owls injection; production uses the bounded default fetcher. */
  owlsSplitsFetcher?: typeof fetchNflOwlsSplits;
  /** Test/audit-only canonical evidence injection; never calls Owls directly. */
  owlsMarketBrainSplitEvidenceReader?: typeof readNflOwlsMarketBrainSplitEvidence;
  /** Explicit foundational-score gate. Locked rows retain stored payload precedence. */
  exactProviderCandidate?: boolean;
  /** Research capture is opt-in and has no model/member/tracking authority. */
  marketBrainCaptureEnabled?: boolean;
  /** Canary-only hard ceiling on distinct games captured in one writer run. */
  marketBrainCaptureMaxGames?: number;
  /** All future event:stage attempt windows predeclared by the persisted research manifest. */
  marketBrainCaptureAttemptSchedule?: Record<string, Array<{
    attemptId: string;
    windowOpensAt: string;
    windowClosesAt: string;
  }>>;
}): Promise<NflForwardWriterResult> {
  if (args.apply && (args.auditJointImpact || args.auditSemanticImpact || args.playbookAuditOnlySkip)) {
    throw new Error("NFL joint-impact audit options are forbidden on the authoritative writer.");
  }
  let marketBrainCaptureEnabled = args.marketBrainCaptureEnabled === true;
  let marketBrainConfigurationError: string | null = null;
  if (marketBrainCaptureEnabled && (!Number.isInteger(args.marketBrainCaptureMaxGames) ||
    args.marketBrainCaptureMaxGames! < 1 || args.marketBrainCaptureMaxGames! > 4)) {
    marketBrainCaptureEnabled = false;
    marketBrainConfigurationError = "nfl_market_brain_capture_disabled_invalid_canary_limit";
  }
  if (marketBrainCaptureEnabled) {
    try {
      validateNflMarketBrainCaptureAttemptSchedule(args.marketBrainCaptureAttemptSchedule, args.now);
    } catch (error) {
      marketBrainCaptureEnabled = false;
      marketBrainConfigurationError = `nfl_market_brain_capture_disabled_attempt_schedule:${
        error instanceof Error ? error.message : "unknown_error"}`.slice(0, 512);
    }
  }
  // Publication and planning need the complete current release only. Loading
  // superseded large JSON releases added no current fixture authority and can
  // make Postgres cancel the writer before it reaches the provider slate.
  const existing = await readNflForwardEvidence({ client: args.client, season: args.season, week: args.week });
  const historicalExisting = existing;
  const need = determineNflForwardCollectionNeed({
    existing,
    now: args.now,
    requiredPublicRelease: {
      memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      evaluatedBetCount: 3,
      contextCaptureRelease: NFL_FORWARD_CONTEXT_CAPTURE_RELEASE,
      collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
    },
  });
  if (!need.collect) {
    const memberSnapshot = await refreshCompactMemberSnapshot({
      client: args.client,
      existing: historicalExisting,
      payloads: [],
      season: args.season,
      week: args.week,
      now: args.now,
      apply: args.apply,
    });
    const tracking = await writeOfficialTrackingFromPayloads({
      client: args.client,
      payloads: currentT60Payloads(existing),
      apply: args.apply,
    });
    return emptyResult(need.reason, tracking, memberSnapshot);
  }

  const slate = await fetchBalldontlieNflRegularSlate({
    season: args.season,
    week: args.week,
    apiKey: args.balldontlieApiKey,
    captureRawPriceManifest: marketBrainCaptureEnabled,
  });
  const plans = planNflForwardEvidenceCaptures({
    games: slate.games,
    existing,
    capturedAt: args.now,
    unlockedCadenceMinutes: need.cadenceMinutes ?? 60,
  });
  const marketBrainCanaryGames = new Set(marketBrainCaptureEnabled
    ? selectNflMarketBrainCanaryGames({
        games: uniquePlannedGames(plans.map((plan) => plan.game)),
        currentOddsByGame: slate.currentOddsByGame,
        season: args.season,
        week: args.week,
        maximumGames: args.marketBrainCaptureMaxGames!,
      }).map((game) => game.providerGameId)
    : []);
  const marketBrainAttemptIds = new Map<string, string>();
  if (marketBrainCaptureEnabled) {
    try {
      for (const plan of plans.filter((row) => marketBrainCanaryGames.has(row.game.providerGameId))) {
        const key = `${plan.game.providerGameId}:${plan.stage}`;
        marketBrainAttemptIds.set(key, resolveNflMarketBrainCaptureAttempt({
          key, capturedAt: args.now, schedule: args.marketBrainCaptureAttemptSchedule?.[key] ?? [],
        }));
      }
    } catch (error) {
      marketBrainCaptureEnabled = false;
      marketBrainCanaryGames.clear();
      marketBrainAttemptIds.clear();
      marketBrainConfigurationError = `nfl_market_brain_capture_disabled_attempt_schedule:${
        error instanceof Error ? error.message : "unknown_error"}`.slice(0, 512);
    }
  }
  // No research read begins until the selected canary games have resolved to
  // exactly one predeclared attempt. A malformed schedule therefore cannot add
  // database load to the authoritative writer.
  const marketBrainPriorArtifactRead = marketBrainCaptureEnabled
    ? boundedMarketBrainPriorArtifactRead(args)
    : Promise.resolve({
        rows: [] as Awaited<ReturnType<typeof readNflMarketBrainPriorArtifactIndex>>,
        error: null as string | null,
      });
  const marketBrainOwlsSplitRead = marketBrainCaptureEnabled
    ? boundedMarketBrainOwlsSplitRead({
        client: args.client,
        games: slate.games.filter((game) => marketBrainCanaryGames.has(game.providerGameId)),
        evaluatedAt: args.now,
        reader: args.owlsMarketBrainSplitEvidenceReader ?? readNflOwlsMarketBrainSplitEvidence,
      })
    : Promise.resolve({
        byGame: {} as Awaited<ReturnType<typeof readNflOwlsMarketBrainSplitEvidence>>,
        error: null as string | null,
      });
  if (plans.length === 0) {
    const memberSnapshot = await refreshCompactMemberSnapshot({
      client: args.client,
      existing: historicalExisting,
      payloads: [],
      season: args.season,
      week: args.week,
      now: args.now,
      apply: args.apply,
    });
    const tracking = await writeOfficialTrackingFromPayloads({
      client: args.client,
      payloads: currentT60Payloads(existing),
      apply: args.apply,
    });
    return emptyResult("provider_slate_has_no_due_capture", tracking, memberSnapshot);
  }

  const criticalTeamIds = new Set(plans
    .filter((plan) => plan.stage === "opening" || plan.stage === "t60")
    .flatMap((plan) => [plan.game.away.id, plan.game.home.id]));
  const criticalTeams = slate.games.flatMap((game) => [game.away, game.home])
    .filter((team, index, rows) => criticalTeamIds.has(team.id) && rows.findIndex((row) => row.id === team.id) === index);
  const availabilityMatchups = slate.games.map((game) => ({
    id: game.providerGameId,
    awayTeam: game.away.abbreviation,
    homeTeam: game.home.abbreviation,
    awayTeamId: game.away.id,
    homeTeamId: game.home.id,
  }));
  const availabilityRequestsMaximum = nflAvailabilityRequestBudgetMaximum(availabilityMatchups);

  const playbook = args.playbookAuditOnlySkip ? null : new PlaybookReadBroker(args.playbookApiKey);
  const storedPaidProjectionShadows = latestStoredPaidProjectionShadows(historicalExisting);
  const plannedGameIds = new Set(plans.map((plan) => plan.game.providerGameId));
  const paidProjectionRefreshDue = shouldRefreshNflPaidProjectionShadows({
    byGame: storedPaidProjectionShadows,
    requiredGameIds: plannedGameIds,
    now: args.now,
  });
  // BALLDONTLIE enforces a shared request ceiling across its NFL endpoints.
  // Serialize its roster and availability cursor chains so a parallel burst
  // cannot silently turn one failed injury batch into a missing slate.
  const rosters = await fetchBalldontlieNflTeamDepthSnapshots({
    teams: criticalTeams,
    season: args.season,
    capturedAt: args.now,
    apiKey: args.balldontlieApiKey,
  });
  const availability = await fetchBalldontlieNflSlateAvailability(availabilityMatchups, {
    apiKey: args.balldontlieApiKey,
    season: args.season,
    week: args.week,
    seasonType: 2,
  });
  const namedBookSplits = args.sharpSplitsFetcher
    ? args.sharpSplitsFetcher({
        apiKey: args.sharpApiKey ?? "compatibility-fixture",
        games: slate.games,
        capturedAt: args.now,
        captureResearchManifest: marketBrainCaptureEnabled,
      }).then((result) => ({
        splitsByGame: result.splitsByGame,
        sourcesByGame: result.sourcesByGame,
        requests: result.requests,
        sharpApiRequests: result.requests,
        owlsCapture: {
          attempted: false, requests: 0, events: 0, rows: 0, matchedGames: 0,
          feedStatus: null, partialReason: null, rejected: 0, error: null,
        } satisfies NflForwardWriterResult["owlsCapture"],
      })).catch(() => ({
        splitsByGame: {} as Record<string, NflRegularSharpSplitSet>,
        sourcesByGame: Object.fromEntries(slate.games.map((game) => [
          game.providerGameId,
          unavailableNflSharpApiSplitSources(),
        ])),
        requests: 1,
        sharpApiRequests: 1,
        owlsCapture: {
          attempted: false, requests: 0, events: 0, rows: 0, matchedGames: 0,
          feedStatus: null, partialReason: null, rejected: 0, error: null,
        } satisfies NflForwardWriterResult["owlsCapture"],
      }))
    : (args.owlsSplitsFetcher ?? fetchNflOwlsSplits)({
        apiKey: args.owlsApiKey,
        games: slate.games,
        capturedAt: args.now,
      }).then((result) => ({
        splitsByGame: result.splitsByGame,
        sourcesByGame: Object.fromEntries(slate.games.map((game) => [
          game.providerGameId,
          unavailableNflSharpApiSplitSources(),
        ])),
        requests: result.requests,
        sharpApiRequests: 0,
        owlsCapture: {
          attempted: true,
          requests: result.requests,
          events: result.events,
          rows: result.rows,
          matchedGames: result.matchedGames,
          feedStatus: result.feedStatus,
          partialReason: result.partialReason,
          rejected: result.rejected.length,
          error: null,
        } satisfies NflForwardWriterResult["owlsCapture"],
      })).catch((error) => ({
        splitsByGame: {} as Record<string, NflRegularSharpSplitSet>,
        sourcesByGame: Object.fromEntries(slate.games.map((game) => [
          game.providerGameId,
          unavailableNflSharpApiSplitSources(),
        ])),
        requests: 1,
        sharpApiRequests: 0,
        owlsCapture: {
          attempted: true, requests: 1, events: 0, rows: 0, matchedGames: 0,
          feedStatus: null, partialReason: null, rejected: 0,
          error: error instanceof Error ? error.message : "unknown_owls_split_capture_failure",
        } satisfies NflForwardWriterResult["owlsCapture"],
      }));
  const namedBookPrices = (args.namedPriceHistoryReader ?? readNflOwlsNamedPriceHistory)({
    client: args.client,
    gameIds: uniquePlannedGames(plans.map((plan) => plan.game)).map((game) => game.providerGameId),
    evaluatedAt: args.now,
  }).then((result) => ({ result, error: null as string | null }))
    .catch((error) => ({
      result: null,
      error: error instanceof Error ? error.message : "named_price_history_read_failed",
    }));
  const [linesResult, splitsResult, sharpResult, namedPriceResult, currentSeasonState, paidProjectionFetch] = await Promise.all([
    playbook ? playbook.lines("nfl").then((result) => result.body.data ?? []).catch(() => null) : Promise.resolve(null),
    playbook ? playbook.splits("nfl").then((result) => result.body.data ?? []).catch(() => null) : Promise.resolve(null),
    namedBookSplits,
    namedBookPrices,
    args.week > 1
      ? readNflPlayerPropsCurrentSeasonState({ client: args.client, season: args.season })
      : Promise.resolve(null),
    paidProjectionRefreshDue
      ? fetchBalldontlieNflWeeklyProjectionShadows({
          apiKey: args.balldontlieApiKey,
          season: args.season,
          week: args.week,
          games: slate.games,
          fetchedAt: args.now,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (args.week > 1 && (!currentSeasonState || currentSeasonState.completeThroughWeek < args.week - 1)) {
    throw new Error(`NFL current-season matchup state is incomplete through Week ${args.week - 1}.`);
  }

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
  // This is deliberately later than every provider promise used by the research tape.
  // Dry-runs retain their injected clock so replays remain deterministic.
  const retrievalCompletedAt = args.apply ? new Date().toISOString() : args.now;
  const namedPriceBooksByGame = Object.fromEntries(uniquePlannedGames(plans.map((plan) => plan.game))
    .map((game) => [game.providerGameId, usableNflNamedPriceBooks(
      namedPriceResult.result?.latestByGame[game.providerGameId] ?? [], retrievalCompletedAt,
    )]));
  const paidProjectionShadows = {
    ...storedPaidProjectionShadows,
    ...(paidProjectionFetch?.byGame ?? {}),
  };
  const paidProjectionRequestsMaximum = paidProjectionRefreshDue ? NFL_PAID_PROJECTION_MAX_PAGES : 0;
  const apiCallsMaximum = slate.providerRequests + rosters.requests + availabilityRequestsMaximum + paidProjectionRequestsMaximum
    + (playbook ? 2 : 0) + sharpResult.requests + weatherRequests;
  // The lightweight research index read overlaps provider collection and has a hard abort.
  // It can never hold the production writer indefinitely.
  const marketBrainPriorArtifactReadResult = await marketBrainPriorArtifactRead;
  const storedMarketBrainPriorArtifacts = marketBrainPriorArtifactReadResult.rows;
  const marketBrainReadError = marketBrainPriorArtifactReadResult.error;
  const marketBrainOwlsSplitReadResult = await marketBrainOwlsSplitRead;
  const marketBrainOwlsSplitByGame = marketBrainOwlsSplitReadResult.byGame;
  const marketBrainOwlsSplitReadError = marketBrainOwlsSplitReadResult.error;
  const captureHistoryBooksByGame = new Map<string, NflPreviewBookOdds[]>();
  const knownPriorArtifactsByGame = new Map<string, Set<string>>();
  for (const row of historicalExisting) {
    const books = captureHistoryBooksByGame.get(row.providerGameId) ?? [];
    books.push(...row.payload.market.comparableCurrentBooks);
    books.push(...nflForwardContextSharpHistoryBooks(row.payload.contextualEvidenceCapture));
    captureHistoryBooksByGame.set(row.providerGameId, books);
    const shadow = row.payload.marketBrainShadow;
    if (shadow && "case" in shadow) {
      const sha256 = marketBrainPriorArtifactSha256(shadow.case.prior);
      if (sha256) {
        const artifacts = knownPriorArtifactsByGame.get(row.providerGameId) ?? new Set<string>();
        artifacts.add(sha256);
        knownPriorArtifactsByGame.set(row.providerGameId, artifacts);
      }
    }
  }
  for (const row of storedMarketBrainPriorArtifacts) {
    const artifacts = knownPriorArtifactsByGame.get(row.providerGameId) ?? new Set<string>();
    artifacts.add(row.priorArtifactSha256);
    knownPriorArtifactsByGame.set(row.providerGameId, artifacts);
  }

  const payloadBuildHolds: string[] = [];
  const jointImpactRows: Parameters<NonNullable<typeof args.auditJointImpact>>[0] = [];
  const semanticImpactRows: Parameters<NonNullable<typeof args.auditSemanticImpact>>[0] = [];
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
    const namedCurrentBooks = namedPriceBooksByGame[plan.game.providerGameId] ?? [];
    const capturedAt = nflEvidenceCapturedAt(args.apply ? retrievalCompletedAt : args.now,
      [current, ...currentBooks, ...comparableCurrentBooks, ...namedCurrentBooks]);
    const t60LagMinutes = plan.stage === "t60" && plan.cutoffAt
      ? (Date.parse(capturedAt) - Date.parse(plan.cutoffAt)) / 60_000
      : plan.t60LagMinutes;
    const providerOpeningBooks = slate.openingOddsAllBooksByGame[plan.game.providerGameId] ?? [];
    const comparableProviderOpeningBooks = slate.openingOddsComparableBooksByGame[plan.game.providerGameId] ?? [];
    const previous = latestEvidenceForGame(historicalExisting, plan.game.providerGameId);
    const opening = operationalOpening({
      previous,
      providerOpening: slate.openingOddsByGame[plan.game.providerGameId] ?? null,
      current,
      capturedAt,
      allowProviderUpgrade: plan.stage === "unlocked" &&
        Date.parse(args.now) < Date.parse(plan.game.scheduledStart),
    });
    const providerAwayDepth = depthForTeam(plan.game.away.abbreviation, rosters.byTeam, previous, "away");
    const providerHomeDepth = depthForTeam(plan.game.home.abbreviation, rosters.byTeam, previous, "home");
    const playbookLine = linesByGame[plan.game.providerGameId]
      ? normalizePlaybookLine(capturedAt, linesByGame[plan.game.providerGameId]!)
      : previous?.payload.market.playbookLine ?? null;
    const playbookSplits = splitsByGame[plan.game.providerGameId]
      ? normalizePlaybookSplits(capturedAt, splitsByGame[plan.game.providerGameId]!)
      : previous?.payload.market.playbookSplits ?? null;
    // Preserve the last verified observation with its original provider time.
    // The NFL market reader already ignores split evidence older than two
    // hours, so retention protects continuity without treating old evidence as
    // a fresh forecast input.
    const displaySharpSplits = sharpResult.splitsByGame[plan.game.providerGameId]
      ?? previous?.payload.market.sharpApiSplits
      ?? null;
    // Only exact-game, fresh Circa rows at the evaluated main-line contract
    // qualify as model evidence. Other Owls rows retain display provenance;
    // an off-line split can never direct a different spread or total.
    const qualifiedOwls = qualifyNflOwlsSplitsForModel({
      splits: displaySharpSplits,
      providerGameId: plan.game.providerGameId,
      evaluatedAt: capturedAt,
      currentHomeSpread: current.spread?.homeLine ?? null,
      currentTotal: current.total?.line ?? null,
    });
    const sharpSplits = nflModelSharpSplits(displaySharpSplits)
      ?? qualifiedOwls.splits
      ?? latestLegacyNflSharpSplits(historicalExisting, plan.game.providerGameId);
    const contextCurrentBooks = captureBooksWithSharpBooks(
      comparableCurrentBooks,
      namedCurrentBooks,
    );
    const contextOpeningBooks = [
      ...comparableProviderOpeningBooks,
      ...(captureHistoryBooksByGame.get(plan.game.providerGameId) ?? []),
      ...(namedPriceResult.result?.earliestByGame[plan.game.providerGameId] ?? []),
    ];
    const currentContextMarket = (market: "moneyline" | "spread" | "total") =>
      buildNflForwardContextMarket({
        market,
        capturedAt,
        currentBooks: contextCurrentBooks,
        openingBooks: contextOpeningBooks,
        operationalOpening: opening.quote,
        decision: null,
        homeTeam: plan.game.home.abbreviation,
        publicEvidence: playbookSplits?.[market] ?? null,
        sharpEvidence: sharpSplits?.[market] ?? null,
      });
    const currentContextMarkets = {
      moneyline: currentContextMarket("moneyline"),
      spread: currentContextMarket("spread"),
      total: currentContextMarket("total"),
    };
    const namedSequenceSnapshots = [
      ...(namedPriceResult.result?.historyByGame[plan.game.providerGameId] ?? [])
        .filter((snapshot) => snapshot.capturedAt <= capturedAt)
        .map((snapshot) => ({
          capturedAt: snapshot.capturedAt,
          markets: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
            market,
            buildNflForwardContextMarket({
              market, capturedAt: snapshot.capturedAt,
              currentBooks: snapshot.books,
              openingBooks: namedPriceResult.result?.earliestByGame[plan.game.providerGameId] ?? [],
              operationalOpening: opening.quote,
              decision: null,
              homeTeam: plan.game.home.abbreviation,
              publicEvidence: null,
              sharpEvidence: null,
            }),
          ])) as typeof currentContextMarkets,
        })),
      ...historicalExisting.flatMap((row) =>
        row.providerGameId === plan.game.providerGameId && row.capturedAt <= capturedAt && row.payload.contextualEvidenceCapture
          ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
          : []),
      { capturedAt, markets: currentContextMarkets },
    ];
    const injuries = mergeNflAvailabilityWithPrior(
      availabilityByGame.get(plan.game.providerGameId) ?? null,
      latestVerifiedInjuriesForGame(historicalExisting, plan.game.providerGameId),
    );
    const awayDepth = resolveNflAvailabilityAdjustedQuarterbackDepth(providerAwayDepth, injuries);
    const homeDepth = resolveNflAvailabilityAdjustedQuarterbackDepth(providerHomeDepth, injuries);
    const weather = weatherByGame.get(plan.game.providerGameId)!.snapshot;
    const paidProjectionShadow = paidProjectionShadows[plan.game.providerGameId];
    const rosterAndDepth = awayDepth.roster.length > 0 && homeDepth.roster.length > 0;
    const expectedQuarterbacks = awayDepth.expectedStartingQuarterback !== null && homeDepth.expectedStartingQuarterback !== null;
    const playbookCoverage = completePlaybookSplits(playbookSplits);
    const modelSplitCoverage = completeSharpApiNflSplitSet(sharpSplits ?? undefined) &&
      Object.values(sharpSplits!).every((split) => {
        const age = Date.parse(capturedAt) - Date.parse(split.providerFetchedAt ?? split.capturedAt);
        return Number.isFinite(age) && age >= 0 && age <= 120 * 60_000;
      });
    const sharpApiCoverage = modelSplitCoverage && sharpSplits?.moneyline.provider === "sharpapi";
    const owlsCoverage = displaySharpSplits?.moneyline.provider === "owls" &&
      completeSharpApiNflSplitSet(displaySharpSplits);
    const weatherCoverage = plan.stage === "unlocked" || weather.status !== "provider_unavailable";
    const collectedEvidenceHolds = [
      !rosterAndDepth ? "roster_depth_unavailable" : null,
      !expectedQuarterbacks ? "expected_quarterback_unavailable" : null,
      injuries === null ? "injury_report_unavailable" : null,
      !playbookCoverage ? "playbook_splits_unavailable" : null,
      !modelSplitCoverage ? owlsCoverage
        ? qualifiedOwls.qualifiedMarkets.length > 0
          ? "owls_splits_model_partial_contract_coverage"
          : "owls_splits_model_unqualified"
        : "named_book_splits_unavailable" : null,
      comparableCurrentBooks.length < 2 ? "multibook_consensus_unavailable" : null,
      comparableCurrentBooks.length < 3 ? "r6_leave_one_out_consensus_unavailable" : null,
      !weatherCoverage ? "weather_unavailable" : null,
      plan.stage === "t60" && (t60LagMinutes ?? 0) > NFL_T60_MAX_CAPTURE_LAG_MINUTES
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
      capturedAt,
      t60LagMinutes,
      coverageHealthHolds: collectedEvidenceHolds,
      currentSeasonState,
    });
    const holds = [...new Set([
      ...collectedEvidenceHolds,
      ...shadowMoneyline.health.blockingReasons,
    ])].sort();
    const weeklyRawSignal = !paidProjectionShadow && currentSeasonState && current.spread &&
      !hasNflV1WeekOneOutcomeForecast(plan.game.providerGameId)
      ? buildNflWeeklyPossessionMargin({
          currentSeasonState,
          homeTeam: plan.game.home.abbreviation,
          awayTeam: plan.game.away.abbreviation,
          marketHomeMargin: -current.spread.homeLine,
        })
      : null;
    const exactProviderScoreContext = args.exactProviderCandidate && currentSeasonState
      ? buildNflExactProviderScoreContext({ game: plan.game, currentSeasonState, weather })
      : null;
    const exactProviderScore = exactProviderScoreContext && currentSeasonState
      ? buildNflExactProviderIndependentScore({
          currentSeasonState,
          context: exactProviderScoreContext,
        })
      : null;
    const legacyBaseOutcome = getNflV1WeekOneOutcomeForecast({
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      weeklyFallback: exactProviderScore
        ? {
            projectedHomeMargin: exactProviderScore.expectedHomeMargin,
            marketTotal: exactProviderScore.expectedTotal,
          }
        : shadowMoneyline.footballProjection && current.total
        ? {
            projectedHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
            marketTotal: current.total.line,
          }
        : undefined,
    });
    const baseOutcome = exactProviderScore
      ? buildNflIndependentScoreBaseForecast({
          baseForecast: legacyBaseOutcome,
          independentScore: exactProviderScore,
        })
      : paidProjectionShadow
      ? buildNflPaidTeamScoreBaseForecast({
          baseForecast: legacyBaseOutcome,
          paidTeamScore: paidProjectionShadow,
        })
      : legacyBaseOutcome;
    const incumbentOutcome = shadowMoneyline.footballProjection
      ? (exactProviderScore ? buildNflNoWeightMarketEvidenceOutcomeForecast : buildNflMarketEvidenceOutcomeForecast)({
          baseForecast: baseOutcome,
          footballHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
          current,
          operationalOpening: opening,
          playbookLine,
          playbookSplits,
          sharpSplits,
          spreadDirectionCandidate: true,
          totalDirectionCandidate: true,
          movementCurrent: current,
          weeklyRawSignal: weeklyRawSignal ? {
            release: NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
            independentHomeMargin: weeklyRawSignal.independentHomeMargin,
            directionHomeCoverProbability: weeklyRawSignal.directionHomeCoverProbability,
            directionHomeMarginCorrection: weeklyRawSignal.directionHomeMarginCorrection,
          } : undefined,
          paidTeamScore: paidProjectionShadow,
          evaluatedAt: capturedAt,
        })
      : baseOutcome;
    const resolved = resolveNflTargetExcludedProduction({
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      gameStartsAt: plan.game.scheduledStart,
      evaluatedAt: capturedAt,
      baseOutcome,
      incumbentOutcome,
      current,
      comparableCurrentBooks,
      operationalOpening: opening,
      shadowMoneyline,
      playbookLine,
      playbookSplits,
      sharpSplits,
      pricedNeutralTotalCandidate: true,
      totalDirectionCandidate: true,
      weeklyRawSignal: weeklyRawSignal ? {
        release: NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
        independentHomeMargin: weeklyRawSignal.independentHomeMargin,
        directionHomeCoverProbability: weeklyRawSignal.directionHomeCoverProbability,
        directionHomeMarginCorrection: weeklyRawSignal.directionHomeMarginCorrection,
      } : undefined,
      paidTeamScore: paidProjectionShadow,
      namedSequenceAuthorityFactory: (excludedFamiliesByMarket, contract) => buildNflNamedMarketSequenceAuthority({
        evaluatedAt: capturedAt,
        snapshots: namedSequenceSnapshots,
        current: contract ?? current,
        playbookLine,
        playbookSplits,
        sharpSplits,
        excludedFamiliesByMarket,
        minimumFollowerSources: 2,
      }),
      professionalMarketAuthorityFactory: (excludedFamiliesByMarket, contract) => buildNflProfessionalMarketAuthority({
        evaluatedAt: capturedAt,
        snapshots: namedSequenceSnapshots,
        current: contract ? { ...contract, sportsbook: current.sportsbook } : current,
        playbookLine,
        playbookSplits,
        sharpSplits,
        excludedFamiliesByMarket,
      }),
      threeStateMarketAuthorityFactory: exactProviderScore
        ? (excludedFamiliesByMarket) => buildNflThreeStateMarketAuthority({
            evaluatedAt: capturedAt,
            snapshots: namedSequenceSnapshots,
            current,
            comparableCurrentBooks,
            playbookLine,
            playbookSplits,
            sharpSplits,
            excludedFamilies: excludedFamiliesByMarket.moneyline,
          })
        : undefined,
      marketStateSnapshots: exactProviderScore && plan.stage === "t60" ? namedSequenceSnapshots : undefined,
      ...(exactProviderScore ? {
        marketOutcomeBuilder: buildNflNoWeightMarketEvidenceOutcomeForecast,
        // If the evaluated sportsbook cannot be removed from a stable market
        // tuple, absence of target-free evidence is neutral. Do not allow the
        // target's own quote to become the categorical correction evidence.
        fallbackOutcome: baseOutcome,
      } : {}),
    });
    const existingLockedRecord = hasImmutableNflLockedRecord(historicalExisting, plan.game.providerGameId);
    const semantic = stabilizeNflFullGameEvidenceTargets({
      baselineProduction: resolved.production, releasedForecast: resolved.outcome,
      homeTeam: plan.game.home.abbreviation,
      build: (evaluationTargets) => {
    const excludedFamiliesByMarket = nflFullGameExcludedFamilies(evaluationTargets.evaluatedBets);
    const axes = resolveNflTargetExcludedMarketAxes({
      books: comparableCurrentBooks,
      requireSameLineTotalPrices: true,
      marginExcludedSportsbooks: excludedFamiliesByMarket.moneyline,
      totalExcludedSportsbooks: excludedFamiliesByMarket.total,
      evaluatedAt: capturedAt,
    });
    const moneylineAnchor = resolveNflTargetExcludedMoneylineAnchor({
      books: comparableCurrentBooks,
      excludedSportsbooks: excludedFamiliesByMarket.moneyline,
      evaluatedAt: capturedAt,
    });
    const moneylineHomeFairProbability = moneylineAnchor?.homeFairProbability ?? null;
    const moneylineMargin = moneylineHomeFairProbability !== null ? inferNflTargetExcludedMoneylineMean({
      independentForecast: baseOutcome, homeWinFairProbability: moneylineHomeFairProbability,
    }) : null;
    const spreadMargin = axes.margin ? inferNflTargetExcludedSpreadMean({
      independentForecast: baseOutcome,
      homeMarginBoundary: axes.margin.homeMargin,
      homeCoverFairProbability: axes.margin.spreadHomeFairProbability,
    }) : null;
    const marketImpliedTotal = axes.total ? inferNflTargetExcludedTotalMean({
      independentForecast: baseOutcome,
      totalLine: axes.total.total,
      overFairProbability: axes.total.totalOverFairProbability,
    }) : null;
    const availableMarkets = ([moneylineMargin !== null && "moneyline", spreadMargin !== null && "spread",
      marketImpliedTotal !== null && "total"].filter(Boolean)) as Array<"moneyline" | "spread" | "total">;
    const marketImpliedMargin = spreadMargin ?? moneylineMargin;
    const candidateMargin = moneylineMargin ?? spreadMargin ?? (resolved.outcome.expectedHomeScore - resolved.outcome.expectedAwayScore);
    const candidateTotal = marketImpliedTotal ?? (resolved.outcome.expectedHomeScore + resolved.outcome.expectedAwayScore);
    const marketScoreCandidate = availableMarkets.length > 0 && candidateTotal > Math.abs(candidateMargin)
      ? {
          expectedAwayScore: (candidateTotal - candidateMargin) / 2,
          expectedHomeScore: (candidateTotal + candidateMargin) / 2,
        } : null;
    // Unavailable coordinates below are render-only placeholders. availableMarkets
    // causes the ledger to emit null/unavailable, never independent-as-price evidence.
    const targetExcludedAnchor = availableMarkets.length > 0 ? {
      homeMargin: axes.margin?.homeMargin ?? 0,
      spreadHomeFairProbability: axes.margin?.spreadHomeFairProbability ?? 0.5,
      total: axes.total?.total ?? 0,
      totalOverFairProbability: axes.total?.totalOverFairProbability ?? 0.5,
      marginFamilyCount: axes.margin?.marginFamilyCount ?? 0,
      moneylineFamilyCount: moneylineAnchor?.familyCount ?? 0,
      totalFamilyCount: axes.total?.totalFamilyCount ?? 0,
      availableMarkets,
    } : null;
    const evaluatedContract = deriveNflEvaluatedMarketContract({
      baselineProduction: evaluationTargets, homeTeam: plan.game.home.abbreviation,
    });
    const semanticSharpSplits = displaySharpSplits?.moneyline.provider === "owls"
      ? qualifyNflOwlsSplitsForModel({
          splits: displaySharpSplits, providerGameId: plan.game.providerGameId, evaluatedAt: capturedAt,
          currentHomeSpread: evaluatedContract.spread?.homeLine ?? null,
          currentTotal: evaluatedContract.total?.line ?? null,
        }).splits
      : sharpSplits;
    const marketStates = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      buildNflMarketState({
        market,
        evaluatedAt: capturedAt,
        snapshots: namedSequenceSnapshots,
        excludedFamilies: excludedFamiliesByMarket[market],
        current: evaluatedContract,
        playbookLine,
        playbookSplits,
        sharpSplits: semanticSharpSplits,
      }),
    ])) as Record<"moneyline" | "spread" | "total", ReturnType<typeof buildNflMarketState>>;
    const fromMarginTotal = (margin: number, total: number) => ({
      expectedAwayScore: (total - margin) / 2,
      expectedHomeScore: (total + margin) / 2,
    });
    const candidate = applyNflFullGameEvidenceRuntime({
      providerGameId: plan.game.providerGameId,
      awayTeam: plan.game.away.abbreviation,
      homeTeam: plan.game.home.abbreviation,
      gameStartsAt: plan.game.scheduledStart,
      evaluatedAt: capturedAt,
      releasedForecast: resolved.outcome,
      baselineProduction: resolved.production,
      evaluatedProduction: evaluationTargets,
      current,
      comparableCurrentBooks,
      shadowMoneyline,
      targetExcludedMarket: targetExcludedAnchor
        ? { ...targetExcludedAnchor, moneylineHomeFairProbability: moneylineHomeFairProbability ?? 0.5 }
        : null,
      states: marketStates,
      excludedFamiliesByMarket,
      playbookSplits,
      sharpSplits: semanticSharpSplits,
      forecastCandidates: [
        {
          source: "independent_exact_stat",
          forecast: exactProviderScore
            ? fromMarginTotal(exactProviderScore.expectedHomeMargin, exactProviderScore.expectedTotal)
            : null,
        },
        {
          source: "player_aware",
          forecast: paidProjectionShadow
            ? fromMarginTotal(paidProjectionShadow.projectedHomeMargin, paidProjectionShadow.projectedTotal)
            : null,
        },
        { source: "target_excluded_paired_price_score", forecast: marketScoreCandidate,
          authoritativeMarkets: availableMarkets,
          marketValues: { ...(moneylineMargin !== null ? { moneyline: moneylineMargin } : {}),
            ...(spreadMargin !== null ? { spread: spreadMargin } : {}),
            ...(marketImpliedTotal !== null ? { total: marketImpliedTotal } : {}) } },
        { source: "released_current", forecast: resolved.outcome },
      ],
      availability: {
        injuriesAvailable: injuries !== null,
        injuryReportUpdatedAt: injuries?.reportUpdatedAt ?? null,
        injuryPlayerCount: injuries?.teams.reduce((sum, team) => sum + team.players.length, 0) ?? null,
        expectedQuarterbacksAvailable: expectedQuarterbacks,
        playerAwareForecastAvailable: Boolean(paidProjectionShadow),
        weatherAvailable: weatherCoverage,
      },
      existingLockedRecord,
    });
    return { ...candidate, marketImpliedMargin, marketImpliedTotal };
      },
    });
    const { outcome, production, marketImpliedMargin, marketImpliedTotal } = semantic;
    const finalContract = deriveNflEvaluatedMarketContract({ baselineProduction: production, homeTeam: plan.game.home.abbreviation });
    const finalQualifiedOwls = qualifyNflOwlsSplitsForModel({
      splits: displaySharpSplits, providerGameId: plan.game.providerGameId, evaluatedAt: capturedAt,
      currentHomeSpread: finalContract.spread?.homeLine ?? null,
      currentTotal: finalContract.total?.line ?? null,
    });
    if (args.auditSemanticImpact && !existingLockedRecord) {
      const decisions = (rows: typeof production.evaluatedBets) => rows.map((bet) => ({
        market: bet.market, side: bet.side, grade: bet.grade,
      }));
      semanticImpactRows.push({
        providerGameId: plan.game.providerGameId,
        game: `${plan.game.away.abbreviation}@${plan.game.home.abbreviation}`,
        upstreamScore: [resolved.outcome.expectedAwayScore, resolved.outcome.expectedHomeScore],
        finalScore: [outcome.expectedAwayScore, outcome.expectedHomeScore],
        upstreamDecisions: decisions(resolved.production.evaluatedBets),
        finalDecisions: decisions(production.evaluatedBets),
        sideStory: semantic.arbitration.sideStory,
        totalStory: semantic.arbitration.totalStory,
        marketResolutions: semantic.arbitration.marketResolutions,
        status: semantic.arbitration.status,
      });
    }
    if (args.auditJointImpact && exactProviderScore && currentSeasonState && !existingLockedRecord) {
      const history = (namedPriceResult.result?.historyByGame[plan.game.providerGameId] ?? [])
        .flatMap((receipt) => receipt.books);
      jointImpactRows.push(auditNflJointMarketImpact({
        providerGameId: plan.game.providerGameId,
        awayTeam: plan.game.away.abbreviation,
        homeTeam: plan.game.home.abbreviation,
        gameStartsAt: plan.game.scheduledStart,
        capturedAt,
        statisticalKnowledgeAt: currentSeasonState.updatedAt,
        baseOutcome,
        incumbentOutcome: outcome,
        production,
        history,
        baselineExclusions: nflFullGameExcludedFamilies(production.evaluatedBets),
        current,
        comparableCurrentBooks,
        shadowMoneyline,
        upstreamOutcome: resolved.outcome,
        targetExclusionStatus: resolved.targetExclusion.status,
        arbiterStatus: semantic.arbitration.status,
        arbiterSideStory: semantic.arbitration.sideStory,
        arbiterTotalStory: semantic.arbitration.totalStory,
        marketContexts: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market, {
          namedDirection: semantic.ledger.marketContexts[market].namedDirection,
          resistance: semantic.ledger.marketContexts[market].resistance,
          followerSources: semantic.ledger.marketContexts[market].followerSources,
        }])) as NflJointMarketImpactAuditRow["marketContexts"],
        pairedPriceScore: { margin: marketImpliedMargin, total: marketImpliedTotal },
      }));
    }
    const availabilityArbitrationShadow = exactProviderScore && paidProjectionShadow
      ? buildNflAvailabilityArbitrationShadow({
          providerDepth: { away: providerAwayDepth, home: providerHomeDepth },
          availabilityAdjustedDepth: { away: awayDepth, home: homeDepth },
          exactProviderScore,
          playerAwareScore: paidProjectionShadow,
          targetExcludedProfessionalAuthority: resolved.diagnosticProfessionalAuthority,
          targetExclusionStatus: resolved.targetExclusion.status,
        })
      : null;
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
      requireDecisionSideFromForecast: true,
      publicScoreDirectionTolerancePoints: NFL_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS,
      decisionSideProbabilityConvention: "exclude_push",
    });
    const trackingEligibility = nflForwardT60TrackingEligibility({
      stage: plan.stage,
      captureTiming: plan.captureTiming,
      t60LagMinutes,
      capturedAt,
      providerGameId: plan.game.providerGameId,
      gameStartsAt: plan.game.scheduledStart,
      decisions: production.evaluatedBets,
      outcomeConfidence: production.outcomeConfidence,
      publicationApproved: production.publicationEnabled,
      officialRegistryLaunched: isPublicallyTracked(
        "nfl",
        computeSlateDate("nfl", plan.game.scheduledStart),
      ),
    });
    const payload: NflForwardEvidencePayload = {
      schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
      runId: args.runId,
      season: args.season,
      week: args.week,
      slateGameCount: slate.games.length,
      stage: plan.stage,
      captureTiming: plan.captureTiming,
      capturedAt,
      cutoffAt: plan.cutoffAt,
      t60LagMinutes,
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
        sharpApiSplits: displaySharpSplits,
      },
      startersAndDepth: { away: awayDepth, home: homeDepth },
      providerStartersAndDepth: { away: providerAwayDepth, home: providerHomeDepth },
      injuries,
      weather,
      outcomeForecast: outcome,
      ...(!existingLockedRecord ? {
        fullGameEvidenceInterpretation: {
          runtimeRelease: semantic.release,
          targetResolution: semantic.targetResolution,
          ledgerRelease: semantic.ledger.release,
          arbiterRelease: semantic.arbitration.release,
          status: semantic.arbitration.status,
          sideStory: semantic.arbitration.sideStory,
          totalStory: semantic.arbitration.totalStory,
          marketResolutions: semantic.arbitration.marketResolutions,
          interpretationAccounting: semantic.arbitration.interpretationAccounting,
          signalInterpretations: semantic.arbitration.signalInterpretations,
        },
      } : {}),
      ...(paidProjectionShadow ? { paidProjectionShadow } : {}),
      ...(exactProviderScore ? { exactProviderScoreShadow: exactProviderScore } : {}),
      ...(availabilityArbitrationShadow ? { availabilityArbitrationShadow } : {}),
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
        sharpApiSplits: Boolean(sharpApiCoverage), owlsSplits: owlsCoverage,
        owlsModelQualifiedMarkets: finalQualifiedOwls.qualifiedMarkets,
        weather: weatherCoverage, healthHolds: holds,
        quarterbackHistory: shadowMoneyline.quarterbackContext,
        forecastTargetExclusion: outcome.targetExclusion ?? resolved.targetExclusion,
        paidProjectionShadow: Boolean(paidProjectionShadow),
      },
      requestBudget: {
        balldontlieSlate: slate.providerRequests, balldontlieRoster: rosters.requests,
        balldontlieInjuriesMaximum: availabilityRequestsMaximum, playbook: playbook ? 2 : 0,
        balldontlieWeeklyProjectionsMaximum: paidProjectionRequestsMaximum,
        sharpApi: sharpResult.sharpApiRequests,
        owls: sharpResult.owlsCapture.requests,
        weather: weatherRequests, totalMaximum: apiCallsMaximum,
      },
    };
    const hasTargetFreePrior = Boolean(exactProviderScore) || Boolean(paidProjectionShadow) || hasNflV1WeekOneOutcomeForecast(plan.game.providerGameId);
    const contextualEvidenceCapture = buildNflForwardContextCapture({
      payload: {
        ...payload,
        market: { ...payload.market, sharpApiSplits: sharpSplits },
      },
      captureCurrentBooks: contextCurrentBooks,
      openingBooks: contextOpeningBooks,
      independentForecast: baseOutcome,
      independentTargetFree: hasTargetFreePrior,
      independentRelease: hasTargetFreePrior
        ? exactProviderScore
          ? NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE
          : paidProjectionShadow
          ? NFL_V1_PAID_TEAM_SCORE_MODEL_RELEASE
          : NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE
        : NFL_V1_WEEKLY_OUTCOME_MODEL_RELEASE,
      authoritativeForecast: outcome,
    });
    const marketBrainPriceManifests = slate.rawPriceResponseManifests
      ? [slate.rawPriceResponseManifests.opening, slate.rawPriceResponseManifests.current]
      : [];
    let marketBrainShadow: NflForwardEvidencePayload["marketBrainShadow"];
    let marketBrainRawParserInputs: NflForwardEvidencePayload["marketBrainRawParserInputs"];
    if (marketBrainCaptureEnabled && marketBrainCanaryGames.has(plan.game.providerGameId) &&
      !existingLockedRecord) {
      marketBrainRawParserInputs = marketBrainPriceManifests.flatMap((manifest) =>
        manifest.rawParserInput ? [manifest.rawParserInput] : []);
      try {
        const independentForecastAvailableAt = hasTargetFreePrior
          ? exactProviderScore
            ? retrievalCompletedAt
            : paidProjectionShadow
            ? paidProjectionFetch?.byGame[plan.game.providerGameId]
              ? retrievalCompletedAt
              : paidProjectionShadow.fetchedAt
            : "2026-08-23T00:00:00.000Z"
          : null;
        const independentPriorInputLineage = hasTargetFreePrior && independentForecastAvailableAt
          ? buildNflIndependentPriorInputLineage({
              eventId: plan.game.providerGameId,
              independentRelease: exactProviderScore
                ? NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE
                : paidProjectionShadow
                ? NFL_V1_PAID_TEAM_SCORE_MODEL_RELEASE
                : NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
              availableAt: independentForecastAvailableAt,
              exactProviderScoreContext,
              currentSeasonState,
              paidProjectionShadow,
            })
          : null;
        marketBrainShadow = buildNflMarketBrainShadow({
          game: plan.game,
          capture: contextualEvidenceCapture,
          injuries,
          weather,
          independentForecast: hasTargetFreePrior ? baseOutcome : null,
          authoritativeForecast: outcome,
          independentForecastAvailableAt,
          independentForecastProvenance: !hasTargetFreePrior
            ? "unavailable"
            : exactProviderScore
            ? "fresh"
            : paidProjectionShadow
            ? paidProjectionFetch?.byGame[plan.game.providerGameId]
              ? "fresh"
              : paidProjectionRefreshDue && paidProjectionFetch === null
              ? "stored_after_failed_refresh"
              : "stored_cache"
            : "static_artifact",
          independentPriorInputLineage,
          retrievalCompletedAt,
          knownPriorArtifactSha256: [...(knownPriorArtifactsByGame.get(plan.game.providerGameId) ?? [])],
          rawPriceResponseManifests: marketBrainPriceManifests,
          identifiedSplitEvidence: marketBrainOwlsSplitByGame[plan.game.providerGameId] ??
            buildNflOwlsMarketBrainSplitEvidence({
              gameId: plan.game.providerGameId,
              evaluatedAt: capturedAt,
              rows: [],
            }),
        });
        if ("case" in marketBrainShadow) {
          const sha256 = marketBrainPriorArtifactSha256(marketBrainShadow.case.prior);
          if (sha256) {
            const artifacts = knownPriorArtifactsByGame.get(plan.game.providerGameId) ?? new Set<string>();
            artifacts.add(sha256);
            knownPriorArtifactsByGame.set(plan.game.providerGameId, artifacts);
          }
        }
      } catch (error) {
        // Shadow evidence may report its own failure, but it must never block or alter production output.
        marketBrainShadow = nflMarketBrainCaptureFailure({ eventId: plan.game.providerGameId, capturedAt, error });
      }
    }
    return [{
      ...payload,
      contextualEvidenceCapture,
      ...(marketBrainShadow ? { marketBrainShadow } : {}),
      ...(marketBrainShadow ? {
        marketBrainCaptureAttemptId: marketBrainAttemptIds.get(`${plan.game.providerGameId}:${plan.stage}`),
      } : {}),
      ...(marketBrainRawParserInputs ? { marketBrainRawParserInputs } : {}),
    }];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown_payload_failure";
      payloadBuildHolds.push(`game_${plan.game.providerGameId}_held_${reason}`);
      return [];
    }
  });

  args.auditJointImpact?.(jointImpactRows);
  args.auditSemanticImpact?.(semanticImpactRows);
  args.auditPayloads?.(payloads);
  const authoritativePayloads = payloads.map(withoutMarketBrainShadow);
  const write = await appendNflForwardEvidence({
    client: args.client,
    runId: args.runId,
    payloads: authoritativePayloads,
    apply: args.apply,
  });
  const memberSnapshot = await refreshCompactMemberSnapshot({
    client: args.client,
    existing: historicalExisting,
    payloads: authoritativePayloads,
    season: args.season,
    week: args.week,
    now: args.now,
    apply: args.apply,
  });
  const tracking = await writeOfficialTrackingFromPayloads({
    client: args.client,
    payloads: [...currentT60Payloads(existing), ...authoritativePayloads.filter((payload) => payload.stage === "t60")],
    apply: args.apply,
  });
  let marketBrainWrite = {
    proposed: payloads.filter((payload) => payload.marketBrainShadow).length,
    inserted: 0,
    existing: 0,
  };
  let marketBrainWriteError: string | null = null;
  if (marketBrainCaptureEnabled) {
    const writeAbort = new AbortController();
    const writeTimeout = setTimeout(() => writeAbort.abort(), 2_000);
    try {
      marketBrainWrite = await appendNflMarketBrainShadows({
        client: args.client,
        runId: args.runId,
        payloads,
        apply: args.apply,
        signal: writeAbort.signal,
      });
    } catch (error) {
      // Every authoritative/member/tracking write has already completed. Research persistence is last and fail-open.
      marketBrainWriteError = error instanceof Error ? error.message : "unknown_market_brain_shadow_append_failure";
    } finally {
      clearTimeout(writeTimeout);
    }
  }
  const publishedEvaluations = payloads.flatMap((payload) => payload.decisions.evaluatedBets);
  const marketBrainCaptureFailureReasons = [
    ...(marketBrainConfigurationError ? [marketBrainConfigurationError] : []),
    ...payloads.flatMap((payload) => {
      const shadow = payload.marketBrainShadow;
      return shadow && "status" in shadow && shadow.status === "capture_failed" ? [shadow.reason] : [];
    }),
  ];
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
      namedPriceResult.error ? "nfl_named_price_history_unavailable" : null,
      namedPriceResult.result && uniquePlannedGames(plans.map((plan) => plan.game)).some((game) =>
        !["circa", "pinnacle"].every((book) =>
          (namedPriceBooksByGame[game.providerGameId] ?? []).some((row) =>
            row.sportsbook === book && row.moneyline && row.spread && row.total)))
        ? "nfl_named_price_history_partial" : null,
    ].filter((value): value is string => value !== null))].sort(),
    publicationAttempted: args.apply,
    marketBrainShadowsProposed: marketBrainWrite.proposed,
    marketBrainShadowsInserted: marketBrainWrite.inserted,
    marketBrainShadowsExisting: marketBrainWrite.existing,
    marketBrainCaptureFailures: marketBrainCaptureFailureReasons.length,
    marketBrainCaptureFailureReasons: [...new Set(marketBrainCaptureFailureReasons)].sort(),
    marketBrainPersistenceAttempted: marketBrainCaptureEnabled && args.apply && marketBrainWrite.proposed > 0,
    marketBrainPersistenceError: [marketBrainReadError, marketBrainOwlsSplitReadError, marketBrainWriteError]
      .filter(Boolean).join("; ") || null,
    owlsCapture: sharpResult.owlsCapture,
    namedPriceCapture: {
      attempted: true,
      queries: namedPriceResult.result?.queries ?? 0,
      rows: namedPriceResult.result?.rows ?? 0,
      rejectedPairs: namedPriceResult.result?.rejectedPairs ?? 0,
      matchedGames: Object.keys(namedPriceResult.result?.historyByGame ?? {}).length,
      completeGames: uniquePlannedGames(plans.map((plan) => plan.game)).filter((game) =>
        ["circa", "pinnacle"].every((book) =>
          (namedPriceBooksByGame[game.providerGameId] ?? []).some((row) =>
            row.sportsbook === book && row.moneyline && row.spread && row.total))).length,
      error: namedPriceResult.error,
    },
    ...memberSnapshot,
    ...tracking,
  };
}

function latestLegacyNflSharpSplits(
  existing: NflForwardStoredEvidence[],
  providerGameId: string,
): NflRegularSharpSplitSet | null {
  return existing
    .filter((row) => row.providerGameId === providerGameId)
    .sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))
    .map((row) => nflModelSharpSplits(row.payload.market.sharpApiSplits))
    .find((value): value is NflRegularSharpSplitSet => value !== null) ?? null;
}

function latestStoredPaidProjectionShadows(existing: NflForwardStoredEvidence[]): Record<string, NflPaidProjectionShadow> {
  const byGame: Record<string, NflPaidProjectionShadow> = {};
  for (const row of existing) {
    const shadow = row.payload.paidProjectionShadow;
    if (!shadow) continue;
    const current = byGame[row.providerGameId];
    if (!current || Date.parse(shadow.fetchedAt) > Date.parse(current.fetchedAt)) {
      byGame[row.providerGameId] = shadow;
    }
  }
  return byGame;
}

function depthForTeam(
  team: string,
  current: Record<string, NflForwardTeamDepthSnapshot>,
  previous: NflForwardStoredEvidence | null,
  side: "away" | "home",
): NflForwardTeamDepthSnapshot {
  const fresh = current[team];
  if (fresh) return fresh;
  const stored = previous?.payload.providerStartersAndDepth?.[side]
    ?? previous?.payload.startersAndDepth[side];
  if (!previous || !stored || stored.team !== team) throw new Error(`NFL depth snapshot is unavailable for ${team}.`);
  return { ...stored, sourceSnapshotId: previous.id };
}

function operationalOpening(args: {
  previous: NflForwardStoredEvidence | null;
  providerOpening: NflPreviewBookOdds | null;
  current: NflPreviewBookOdds;
  capturedAt: string;
  /** Never true for T-60 or started games; immutable locks are not reinterpreted. */
  allowProviderUpgrade: boolean;
}): NflForwardOperationalOpening {
  if (args.previous) {
    const previous = args.previous.payload.market.operationalOpening;
    if (
      args.allowProviderUpgrade &&
      previous.provenance === "first_observed" &&
      args.providerOpening &&
      normalizeBook(args.providerOpening.sportsbook) === normalizeBook(previous.quote.sportsbook) &&
      Date.parse(args.providerOpening.observedAt) <= Date.parse(previous.capturedAt)
    ) {
      return {
        provenance: "provider_opening",
        capturedAt: args.providerOpening.observedAt,
        quote: args.providerOpening,
      };
    }
    return previous;
  }
  return args.providerOpening
    ? { provenance: "provider_opening", capturedAt: args.providerOpening.observedAt, quote: args.providerOpening }
    : { provenance: "first_observed", capturedAt: new Date(args.capturedAt).toISOString(), quote: args.current };
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nflFullGameExcludedFamilies(
  decisions: NflForwardEvidencePayload["decisions"]["evaluatedBets"],
): Record<"moneyline" | "spread" | "total", string[]> {
  const selected = (market: "moneyline" | "spread" | "total") => normalizeBook(
    decisions.find((decision) => decision.market === market)?.evaluatedQuote.sportsbook ?? "",
  );
  const margin = [...new Set([selected("moneyline"), selected("spread")].filter(Boolean))];
  return { moneyline: margin, spread: margin, total: [selected("total")].filter(Boolean) };
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

/** Preserve provider provenance while containing continuity to one exact game. */
export function latestVerifiedInjuriesForGame(
  rows: NflForwardStoredEvidence[],
  providerGameId: string,
): NflForwardEvidencePayload["injuries"] {
  return rows
    .filter((row) => row.providerGameId === providerGameId && row.payload.injuries !== null)
    .sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))[0]
    ?.payload.injuries ?? null;
}

/** Exact stored lock boundary; semantic candidates may never reinterpret this row. */
export function hasImmutableNflLockedRecord(
  rows: NflForwardStoredEvidence[],
  providerGameId: string,
): boolean {
  return rows.some((row) => row.providerGameId === providerGameId && row.stage === "t60" &&
    row.payload.stage === "t60" && row.payload.decisions.trackingEnabled === true &&
    row.payload.decisions.evaluatedBets.length === 3 &&
    row.payload.decisions.evaluatedBets.every((decision) =>
      decision.stage === "t60_locked" && decision.lockedAt !== null));
}

/** Ensure a provider quote can never appear newer than the decision consuming it. */
export function nflEvidenceCapturedAt(writerNow: string, books: NflPreviewBookOdds[]): string {
  const writerTime = Date.parse(writerNow);
  if (!Number.isFinite(writerTime)) throw new Error("NFL writer capture time is invalid.");
  const latestQuoteTime = books.reduce((latest, book) => {
    const observedAt = Date.parse(book.observedAt);
    if (!Number.isFinite(observedAt)) throw new Error(`NFL quote time is invalid for ${book.sportsbook}.`);
    return Math.max(latest, observedAt);
  }, writerTime);
  return new Date(latestQuoteTime).toISOString();
}

/** Keep per-market source clocks; a fresh Total cannot refresh an old ML quote. */
export function usableNflNamedPriceBooks(books: NflPreviewBookOdds[], evaluatedAt: string): NflPreviewBookOdds[] {
  const evaluationMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluationMs)) throw new Error("NFL named-price evaluation time is invalid.");
  return books.flatMap((book) => {
    const usable = (market: "moneyline" | "spread" | "total") => {
      const observedAt = book.marketObservedAt?.[market] ?? book.observedAt;
      const ageMinutes = (evaluationMs - Date.parse(observedAt)) / 60_000;
      return Number.isFinite(ageMinutes) && ageMinutes >= 0 &&
        ageMinutes <= NFL_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES ? observedAt : null;
    };
    const moneylineAt = book.moneyline ? usable("moneyline") : null;
    const spreadAt = book.spread ? usable("spread") : null;
    const totalAt = book.total ? usable("total") : null;
    const observed = [moneylineAt, spreadAt, totalAt].filter((value): value is string => value !== null);
    if (observed.length === 0) return [];
    return [{
      ...book,
      observedAt: observed.sort((first, second) => Date.parse(second) - Date.parse(first))[0]!,
      targetEligible: false,
      marketObservedAt: {
        ...(moneylineAt ? { moneyline: moneylineAt } : {}),
        ...(spreadAt ? { spread: spreadAt } : {}),
        ...(totalAt ? { total: totalAt } : {}),
      },
      moneyline: moneylineAt ? book.moneyline : null,
      spread: spreadAt ? book.spread : null,
      total: totalAt ? book.total : null,
    }];
  });
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

/**
 * Outcome-blind deterministic stratified canary sampling. It avoids selecting
 * whichever fixtures the provider happened to return first and spreads a tiny
 * canary across kickoff, favorite direction, spread size, and total regime.
 */
export function selectNflMarketBrainCanaryGames(args: {
  games: NflPreviewGame[];
  currentOddsByGame: Record<string, NflPreviewBookOdds>;
  season: number;
  week: number;
  maximumGames: number;
}): NflPreviewGame[] {
  if (args.maximumGames === 0) return [];
  const candidates = uniquePlannedGames(args.games).map((game) => {
    const odds = args.currentOddsByGame[game.providerGameId];
    const homeLine = odds?.spread?.homeLine ?? null;
    const total = odds?.total?.line ?? null;
    const kickoffHour = new Date(game.scheduledStart).getUTCHours();
    const stratum = [
      kickoffHour < 21 ? "early" : kickoffHour < 24 ? "middle" : "late",
      homeLine === null ? "favorite_unknown" : homeLine < 0 ? "home_favorite" : homeLine > 0 ? "away_favorite" : "pickem",
      homeLine === null ? "spread_unknown" : Math.abs(homeLine) < 3 ? "spread_close" : Math.abs(homeLine) < 7 ? "spread_mid" : "spread_large",
      total === null ? "total_unknown" : total < 42 ? "total_low" : total < 48 ? "total_mid" : "total_high",
    ].join("|");
    return { game, stratum, rank: marketBrainSha256({
      release: "nfl_market_brain_canary_stratified_v1", season: args.season,
      week: args.week, eventId: game.providerGameId,
    }) };
  }).sort((a, b) => a.rank.localeCompare(b.rank));
  const distinct: typeof candidates = [];
  const repeats: typeof candidates = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.stratum)) repeats.push(candidate);
    else { seen.add(candidate.stratum); distinct.push(candidate); }
  }
  return [...distinct, ...repeats].slice(0, args.maximumGames).map((candidate) => candidate.game);
}

export function resolveNflMarketBrainCaptureAttempt(args: {
  key: string;
  capturedAt: string;
  schedule: Array<{ attemptId: string; windowOpensAt: string; windowClosesAt: string }>;
}): string {
  const capturedAt = Date.parse(args.capturedAt);
  const matches = args.schedule.filter((attempt) => {
    const opens = Date.parse(attempt.windowOpensAt);
    const closes = Date.parse(attempt.windowClosesAt);
    return Number.isFinite(opens) && Number.isFinite(closes) && opens <= capturedAt && capturedAt <= closes;
  });
  if (matches.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(matches[0]?.attemptId ?? "")) {
    throw new Error(`NFL Market Brain capture attempt was missing or ambiguous for ${args.key}.`);
  }
  return matches[0]!.attemptId;
}

export function validateNflMarketBrainCaptureAttemptSchedule(
  schedule: Parameters<typeof runNflForwardEvidenceWriter>[0]["marketBrainCaptureAttemptSchedule"],
  capturedAt: string,
): void {
  const captureMs = Date.parse(capturedAt);
  if (!Number.isFinite(captureMs) || !schedule || Object.keys(schedule).length === 0) {
    throw new Error("NFL Market Brain capture schedule is absent or the capture time is invalid.");
  }
  const attemptIds = new Set<string>();
  let activeWindows = 0;
  for (const [key, windows] of Object.entries(schedule)) {
    if (!/^[^:]+:(opening|unlocked|t60)$/.test(key) || !Array.isArray(windows) || windows.length === 0) {
      throw new Error(`NFL Market Brain capture schedule entry is invalid for ${key}.`);
    }
    const ordered = windows.map((window) => {
      const opens = Date.parse(window.windowOpensAt);
      const closes = Date.parse(window.windowClosesAt);
      if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens > closes ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(window.attemptId)) {
        throw new Error(`NFL Market Brain capture schedule window is invalid for ${key}.`);
      }
      if (attemptIds.has(window.attemptId)) {
        throw new Error(`NFL Market Brain capture schedule reuses attempt ${window.attemptId}.`);
      }
      attemptIds.add(window.attemptId);
      if (opens <= captureMs && captureMs <= closes) activeWindows += 1;
      return { opens, closes };
    }).sort((left, right) => left.opens - right.opens);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.opens <= ordered[index - 1]!.closes) {
        throw new Error(`NFL Market Brain capture schedule windows overlap for ${key}.`);
      }
    }
  }
  if (activeWindows === 0) {
    throw new Error("NFL Market Brain capture schedule has no active window for this run.");
  }
}

function stageCounts(payloads: NflForwardEvidencePayload[]): Record<"opening" | "unlocked" | "t60", number> {
  return {
    opening: payloads.filter((payload) => payload.stage === "opening").length,
    unlocked: payloads.filter((payload) => payload.stage === "unlocked").length,
    t60: payloads.filter((payload) => payload.stage === "t60").length,
  };
}

function withoutMarketBrainShadow(payload: NflForwardEvidencePayload): NflForwardEvidencePayload {
  const {
    marketBrainShadow: _marketBrainShadow,
    marketBrainCaptureAttemptId: _marketBrainCaptureAttemptId,
    marketBrainRawParserInputs: _marketBrainRawParserInputs,
    ...authoritative
  } = payload;
  return authoritative as NflForwardEvidencePayload;
}

async function boundedMarketBrainPriorArtifactRead(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 2_000);
  try {
    const rows = await readNflMarketBrainPriorArtifactIndex({
      client: args.client,
      season: args.season,
      week: args.week,
      signal: abort.signal,
    });
    return { rows, error: null as string | null };
  } catch (error) {
    return {
      rows: [] as Awaited<ReturnType<typeof readNflMarketBrainPriorArtifactIndex>>,
      error: error instanceof Error ? error.message : "unknown_market_brain_shadow_read_failure",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedMarketBrainOwlsSplitRead(args: {
  client: SupabaseClient;
  games: NflPreviewGame[];
  evaluatedAt: string;
  reader: typeof readNflOwlsMarketBrainSplitEvidence;
}) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 2_000);
  try {
    const byGame = await args.reader({
      client: args.client,
      games: args.games,
      evaluatedAt: args.evaluatedAt,
      signal: abort.signal,
    });
    return { byGame, error: null as string | null };
  } catch (error) {
    return {
      byGame: {} as Awaited<ReturnType<typeof readNflOwlsMarketBrainSplitEvidence>>,
      error: error instanceof Error ? error.message : "unknown_nfl_owls_market_brain_split_read_failure",
    };
  } finally {
    clearTimeout(timeout);
  }
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
    marketBrainShadowsProposed: 0,
    marketBrainShadowsInserted: 0,
    marketBrainShadowsExisting: 0,
    marketBrainCaptureFailures: 0,
    marketBrainCaptureFailureReasons: [],
    marketBrainPersistenceAttempted: false,
    marketBrainPersistenceError: null,
    owlsCapture: {
      attempted: false,
      requests: 0,
      events: 0,
      rows: 0,
      matchedGames: 0,
      feedStatus: null,
      partialReason: null,
      rejected: 0,
      error: null,
    },
    namedPriceCapture: {
      attempted: false,
      queries: 0,
      rows: 0,
      rejectedPairs: 0,
      matchedGames: 0,
      completeGames: 0,
      error: null,
    },
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
    const candidateFixture = buildNflWeekOneHeldMemberFixture(rows);
    const previousSnapshot = await readNflForwardMemberSnapshot({
      client: args.client,
      season: args.season,
      week: args.week,
      now: args.now,
    }).catch(() => null);
    const invalidT60GameIds = new Set(rows
      .filter((row) => row.stage === "t60" && row.payload.decisions.evaluatedBets.length === 0)
      .map((row) => row.providerGameId));
    const fixture = preserveVerifiedNflLockedGames({
      candidate: candidateFixture,
      previous: previousSnapshot?.fixture ?? null,
      invalidT60GameIds,
    });
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

export function preserveVerifiedNflLockedGames(args: {
  candidate: NflWeekOneHeldMemberFixture;
  previous: NflWeekOneHeldMemberFixture | null;
  invalidT60GameIds: ReadonlySet<string>;
}): NflWeekOneHeldMemberFixture {
  if (!args.previous || args.invalidT60GameIds.size === 0) return args.candidate;
  const previousById = new Map(args.previous.snapshot.games.map((game) => [game.id, game]));
  return {
    ...args.candidate,
    snapshot: {
      ...args.candidate.snapshot,
      games: args.candidate.snapshot.games.map((game) => {
        const providerGameId = game.id.replace(/^nfl-/, "");
        const previous = previousById.get(game.id);
        return args.invalidT60GameIds.has(providerGameId) &&
          previous?.lockState === "locked" && previous.status.linesLocked
          ? previous
          : game;
      }),
    },
  };
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
export async function writeOfficialTrackingFromPayloads(args: {
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
      outcomeConfidence: payload.decisions.outcomeConfidence,
      publicationApproved: payload.decisions.publicationEnabled,
      officialRegistryLaunched: isPublicallyTracked(
        "nfl",
        computeSlateDate("nfl", payload.game.scheduledStart),
      ),
    });
    // Recompute from the immutable T-60 tuple instead of trusting a stored
    // boolean produced by an older tracking allowlist. This permits delayed
    // append-only serialization of a genuinely on-time, writer-approved
    // payload without reconstructing any prediction after kickoff.
    if (boundary.eligible) {
      eligibleByGame.set(payload.game.providerGameId, payload);
    }
  }
  const payloads = [...eligibleByGame.values()];
  const trackingGames = payloads.map((payload) => ({
    externalId: nflProviderIntegerId(payload.game.providerGameId, "game"),
    decisions: nflTrackingMarketsForPayload(payload).map((market) => ({ market })),
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
  if (decisionReleases.size > 1) throw new Error("NFL T-60 tracking payloads carry incoherent decision releases.");
  const decisionRelease = [...decisionReleases][0] ?? NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE;
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
    let built: ReturnType<typeof buildNflOfficialTrackingRecords>;
    try {
      built = buildNflOfficialTrackingRecords({
        payload,
        gameId,
        trackingBoundaryRevalidated: true,
      });
    } catch (strictError) {
      try {
        built = buildNflImmutableT60RecoveryRecords({
          payload,
          gameId,
          trackingBoundaryRevalidated: true,
        });
      } catch (recoveryError) {
        throw new AggregateError(
          [strictError, recoveryError],
          `NFL tracking serialization failed for immutable T-60 game ${payload.game.providerGameId}.`,
        );
      }
    }
    return built
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

function buildNflIndependentPriorInputLineage(args: {
  eventId: string;
  independentRelease: string;
  availableAt: string;
  exactProviderScoreContext: NflExactProviderScoreContext | null;
  currentSeasonState: NflPlayerPropsCurrentSeasonState | null;
  paidProjectionShadow: NflPaidProjectionShadow | null;
}): MarketBrainPriorInputLineage {
  const shapeComponent = {
    id: "nfl_discrete_score_shape",
    category: "model_artifact" as const,
    release: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
    availableAt: "2026-08-23T00:00:00.000Z",
    sha256: NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_SHA256,
    marketRelation: "excluded_by_construction" as const,
  };
  if (args.exactProviderScoreContext && args.currentSeasonState) {
    return bindMarketBrainPriorInputLineage({
      eventId: args.eventId,
      modelPath: "nfl_exact_provider",
      modelRelease: args.independentRelease,
      asOf: args.availableAt,
      declaredMarketInputPolicy: "market_inputs_prohibited",
      components: [
        shapeComponent,
        {
          id: "nfl_exact_provider_model_artifact",
          category: "model_artifact",
          release: NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE,
          availableAt: "2026-10-15T00:00:00.000Z",
          sha256: NFL_EXACT_PROVIDER_SCORE_ARTIFACT_SHA256,
          marketRelation: "excluded_by_construction",
        },
        {
          id: "nfl_completed_game_state",
          category: "team_statistics",
          release: args.currentSeasonState.release,
          availableAt: args.currentSeasonState.updatedAt,
          sha256: marketBrainSha256({
            release: args.currentSeasonState.release,
            season: args.currentSeasonState.season,
            completeThroughWeek: args.currentSeasonState.completeThroughWeek,
            games: args.currentSeasonState.games,
            teamStats: args.currentSeasonState.teamStats,
            playMetrics: args.currentSeasonState.playMetrics,
          }),
          marketRelation: "excluded_by_construction",
        },
        {
          id: "nfl_pregame_schedule_venue_context",
          category: "venue_context",
          release: NFL_EXACT_PROVIDER_SCORE_CONTEXT_RELEASE,
          availableAt: args.availableAt,
          sha256: marketBrainSha256(args.exactProviderScoreContext),
          marketRelation: "excluded_by_construction",
        },
      ],
    });
  }
  if (args.paidProjectionShadow) {
    return bindMarketBrainPriorInputLineage({
      eventId: args.eventId,
      modelPath: "external_projection",
      modelRelease: args.independentRelease,
      asOf: args.availableAt,
      declaredMarketInputPolicy: "unknown",
      components: [
        shapeComponent,
        {
          id: "balldontlie_weekly_projection",
          category: "external_projection",
          release: args.paidProjectionShadow.release,
          availableAt: args.paidProjectionShadow.fetchedAt,
          sha256: marketBrainSha256(args.paidProjectionShadow),
          marketRelation: "unknown",
        },
      ],
    });
  }
  return bindMarketBrainPriorInputLineage({
    eventId: args.eventId,
    modelPath: "nfl_week_one_static_artifact",
    modelRelease: args.independentRelease,
    asOf: args.availableAt,
    declaredMarketInputPolicy: "market_inputs_prohibited",
    components: [shapeComponent],
  });
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
