import {reviewPropsForSite} from "../../playerPropsAi/siteRuntime";
import {liveNbaPacket} from "../../playerPropsAi/liveSources";
import {applyNbaSiteAi} from "../../playerPropsAi/siteBindings";
import {propsAiSiteConfig} from "../../playerPropsAi/siteConfig";
import type {EnrichedSource} from "../../playerPropsAi/cachedEnrichment";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalNbaAbbreviation, fetchEspnNbaGameInjuries } from "./espnNbaInjuries";
import {
  buildNbaPlayerPropsForwardDecisions,
  type NbaPlayerPropsForwardDecision,
} from "./nbaPlayerPropsFrozenRuntime";
import { advanceNbaPlayerPropsCandidateLifecycle } from "./nbaPlayerPropsLifecycle";
import { collectNbaPlayerPropsLiveMarket } from "./nbaPlayerPropsLiveCollector";
import {
  collectNbaPlayerPropsCurrentState,
  readNbaPlayerPropsCurrentState,
  writeNbaPlayerPropsCurrentState,
} from "./nbaPlayerPropsCurrentState";
import {
  buildNbaPlayerPropsSameBookMovement,
  selectNbaPlayerPropsMovementTarget,
} from "./nbaPlayerPropsMovement";
import {
  mergeNbaPlayerPropsMarketHistory,
  readNbaPlayerPropsMarketHistory,
  readNbaPlayerPropsPrivateSnapshot,
  writeNbaPlayerPropsMarketHistory,
  writeNbaPlayerPropsPrivateSnapshot,
} from "./nbaPlayerPropsPrivateStore";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
} from "./nbaPlayerPropsPointInTimeFeatures";
import { buildNbaPlayerPropsMemberSnapshot, type NbaPlayerPropsMemberDecision } from "./nbaPlayerPropsProductContract";
import { buildNbaPlayerPropsReaderEvidence } from "./nbaPlayerPropsReaderContract";
import { captureNbaPlayerPropsPrivateTracking } from "./nbaPlayerPropsPrivateTrackingStore";
import { settleNbaPlayerPropsTrackedSlates,hasNbaPropsUnsettledTrackedSlates } from "./nbaPlayerPropsSettlementStore";
import type { NbaRollingScheduleGame } from "./nbaRollingSchedule";
import { buildNbaPlayerPropsMemberPrices } from "./nbaPlayerPropsMemberPrices";

export const NBA_PLAYER_PROPS_PRIVATE_WRITER_RELEASE =
  "nba_player_props_private_writer_2026_11_04_r12_settlement_catchup" as const;

export function nbaPlayerPropsForecastIsPublishable(
  row: Pick<NbaPlayerPropsForwardDecision, "independentProjection" | "finalProjection">,
): boolean {
  return Number.isFinite(row.independentProjection)
    && Number.isFinite(row.finalProjection)
    && row.independentProjection > 0
    && row.finalProjection > 0;
}

export type NbaPlayerPropsPrivateWriterResult = Readonly<{
  release: typeof NBA_PLAYER_PROPS_PRIVATE_WRITER_RELEASE;
  publicEnabled: false;
  status: "published_private" | "no_games" | "bootstrap_required" | "last_known_good_preserved";
  providerRequests: number;
  theOddsApiCreditsUsed: number;
  observationsAdded: number;
  observationsRefreshed: number;
  observationConflictsPreserved: number;
  featureRows: number;
  decisions: number;
  locked: number;
  findings: readonly string[];
  settlement?:Awaited<ReturnType<typeof settleNbaPlayerPropsTrackedSlates>>|null;
}>;

export async function refreshNbaPlayerPropsPrivateCandidate(args: {
  client: SupabaseClient;
  writerRunId?: string;
  slateDate: string;
  season: number;
  schedule: readonly NbaRollingScheduleGame[];
  ballDontLieApiKey: string;
  theOddsApiKey?: string | null;
  owlsInsightApiKey?: string | null;
  fullRefresh: boolean;
  now?: string;
  fetchImpl?: typeof fetch;
}): Promise<NbaPlayerPropsPrivateWriterResult> {
  const now = args.now ?? new Date().toISOString();
  const slateSchedule = args.schedule.filter((game) => game.slateDate === args.slateDate);
  if (slateSchedule.length === 0 && (!args.fullRefresh
    ||!await hasNbaPropsUnsettledTrackedSlates(args.client,args.season))) return result("no_games");

  const previousState = await readNbaPlayerPropsCurrentState({ client: args.client, season: args.season });
  const priorState = slateSchedule.length ? await readNbaPlayerPropsCurrentState({ client: args.client, season: args.season - 1 }):null;
  if (slateSchedule.length&&(!priorState || priorState.games.length < 100 || priorState.boxes.length < 500)) {
    return { ...result("bootstrap_required"), findings: ["prior_season_player_state_missing"] };
  }
  let currentState = previousState;
  let stateRequests = 0;
  let stateCorrections = 0;
  if (args.fullRefresh) {
    const collected = await collectNbaPlayerPropsCurrentState({
      previous: previousState,
      season: args.season,
      dates: recentDates(now, 7),
      apiKey: args.ballDontLieApiKey,
      fetchImpl: args.fetchImpl,
    });
    currentState = collected.state;
    stateRequests = collected.providerRequests;
    stateCorrections = collected.corrected;
    await writeNbaPlayerPropsCurrentState({ client: args.client, state: collected.state });
  }

  // A rest day cannot strand yesterday's locks. Reuse the same bounded stats
  // collector and settlement path only while tracking receipts are incomplete.
  // No market-provider request or prediction publication is needed here.
  if(slateSchedule.length===0){
    const settlement=currentState?await settleNbaPlayerPropsTrackedSlates({client:args.client,season:args.season,
      slateDates:recentDates(now,7),state:currentState,observedAt:now}):null;
    return{...result("no_games"),providerRequests:stateRequests,settlement};
  }
  if(!priorState)throw new Error("NBA props prior state missing after readiness check");

  const players = new Map([...priorState.players, ...(currentState?.players ?? [])].map((row) => [row.playerId, row]));
  const canonicalPlayersByName = Object.fromEntries([...players.values()].flatMap((player) => player.playerName
    ? [[normalize(player.playerName), `nba-bdl-player:${player.playerId}`] as const]
    : []));
  const live = await collectNbaPlayerPropsLiveMarket({
    slateDate: args.slateDate,
    ballDontLieApiKey: args.ballDontLieApiKey,
    theOddsApiKey: args.theOddsApiKey,
    owlsInsightApiKey: args.owlsInsightApiKey,
    includeOpenings: args.fullRefresh,
    canonicalPlayersByName,
    knownPlayerIdentitiesById: Object.fromEntries([...players.values()].map((player) => [String(player.playerId), {
      playerName: player.playerName,
      playerTeam: player.latestTeamId === null ? null : String(player.latestTeamId),
    }])),
    fetchImpl: args.fetchImpl,
  });
  const previousMarket = await readNbaPlayerPropsMarketHistory({ client: args.client, slateDate: args.slateDate });
  const mergedMarket = mergeNbaPlayerPropsMarketHistory({
    previous: previousMarket,
    current: live.observations,
    slateDate: args.slateDate,
    capturedAt: now,
  });
  if (mergedMarket.added > 0 || mergedMarket.refreshed > 0
    || previousMarket?.release !== mergedMarket.history.release) {
    await writeNbaPlayerPropsMarketHistory({ client: args.client, history: mergedMarket.history });
  }
  const missingScheduledGames = slateSchedule.filter((scheduled) => !live.games.some((game) =>
    nbaPlayerPropsScheduleGameMatches(scheduled, game)));
  if (missingScheduledGames.length > 0) {
    return {
      ...result("last_known_good_preserved"),
      providerRequests: stateRequests + live.providerRequests.balldontlie + live.providerRequests.theOddsApi + live.providerRequests.owls,
      theOddsApiCreditsUsed: live.theOddsApiCreditsUsed,
      observationsAdded: mergedMarket.added,
      observationsRefreshed: mergedMarket.refreshed,
      observationConflictsPreserved: mergedMarket.conflicts,
      findings: [...live.findings, ...missingScheduledGames.map((game) => `scheduled_game_missing_from_prop_provider:${game.id}`)],
    };
  }

  const stateGames = [...priorState.games, ...(currentState?.games ?? [])];
  const stateBoxes = [...priorState.boxes, ...(currentState?.boxes ?? [])];
  const stateAdvanced = [...priorState.advanced, ...(currentState?.advanced ?? [])];
  const candidates: NbaPlayerPropCandidate[] = [];
  const candidateKeys = new Set<string>();
  const upcomingGames = live.games.flatMap((game) => {
    const ids = live.teamIdsByGame[game.canonicalGameId];
    if (!ids) return [];
    return [{
      gameId: Number(game.providerGameId),
      season: args.season,
      startTime: game.scheduledStart,
      homeTeamId: ids.home,
      awayTeamId: ids.away,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
    }];
  });
  const gameById = new Map(upcomingGames.map((game) => [game.gameId, game]));
  for (const observation of mergedMarket.history.observations) {
    if (!observation.canonicalGameId) continue;
    const gameId = Number(observation.canonicalGameId.replace(/^.*:/, ""));
    const playerId = playerIdFromObservation(observation);
    const game = gameById.get(gameId);
    if (!game || playerId === null) continue;
    const identity = players.get(playerId);
    const providerTeam = Number(observation.playerTeam);
    const teamId = [providerTeam, identity?.latestTeamId]
      .find((value) => value === game.homeTeamId || value === game.awayTeamId);
    if (!teamId) continue;
    const key = `${gameId}|${playerId}`;
    if (candidateKeys.has(key)) continue;
    candidateKeys.add(key);
    candidates.push({
      gameId,
      playerId,
      playerName: observation.playerName ?? identity?.playerName ?? null,
      teamId,
    });
  }
  const emitGameIds = new Set(upcomingGames.map((game) => game.gameId));
  const features = buildNbaPlayerPropsPointInTimeFeatures({
    games: stateGames,
    upcomingGames,
    boxes: stateBoxes,
    advanced: stateAdvanced,
    candidates,
    emitGameIds,
  });
  const outPlayers = await explicitOutPlayers(slateSchedule, args.fetchImpl);
  const eligibleFeatures = features.filter((feature) => !outPlayers.has(normalize(feature.player_name ?? "")));
  const forward = buildNbaPlayerPropsForwardDecisions({
    features: eligibleFeatures,
    observations: mergedMarket.history.observations,
    currentObservations: live.observations,
    evaluatedAt: now,
  });
  const invalidForecasts = forward.filter((row) => !nbaPlayerPropsForecastIsPublishable(row));
  const publishableForward = forward.filter(nbaPlayerPropsForecastIsPublishable);
  const minimumCoverage = Math.max(1, Math.floor(candidates.length * 0.80));
  if (eligibleFeatures.length < minimumCoverage || publishableForward.length === 0) {
    return {
      ...result("last_known_good_preserved"),
      providerRequests: stateRequests + live.providerRequests.balldontlie + live.providerRequests.theOddsApi + live.providerRequests.owls,
      theOddsApiCreditsUsed: live.theOddsApiCreditsUsed,
      observationsAdded: mergedMarket.added,
      observationsRefreshed: mergedMarket.refreshed,
      observationConflictsPreserved: mergedMarket.conflicts,
      featureRows: eligibleFeatures.length,
      findings: [
        ...live.findings,
        ...(eligibleFeatures.length < minimumCoverage
          ? [`feature_coverage_below_80_percent:${eligibleFeatures.length}/${candidates.length}`]
          : []),
        ...(publishableForward.length === 0 ? ["no_publishable_forward_decisions"] : []),
      ],
    };
  }
  const featureByScope = new Map(eligibleFeatures.map((row) => [`${row.game_id}|${row.player_id}`, row]));
  const memberDecisions = publishableForward.flatMap((row): NbaPlayerPropsMemberDecision[] => {
    const feature = featureByScope.get(`${row.gameId}|${row.playerId}`);
    const game = live.games.find((candidate) => Number(candidate.providerGameId) === row.gameId);
    if (!feature || !game || !row.playerName) return [];
    const scopeObservations = mergedMarket.history.observations.filter((observation) =>
      observation.canonicalGameId === game.canonicalGameId
      && observation.canonicalPlayerId === `nba-bdl-player:${row.playerId}`
      && observation.market === row.market);
    const exactObservations = scopeObservations.filter((observation) => observation.line === row.line);
    const target = selectNbaPlayerPropsMovementTarget({
      observations: exactObservations,
      sportsbook: row.sportsbook,
      side: row.side,
      line: row.line,
      americanPrice: row.americanPrice,
    });
    if (!target) return [];
    const movement = buildNbaPlayerPropsSameBookMovement({ observations: scopeObservations, target });
    const reader = buildNbaPlayerPropsReaderEvidence(feature, row.market);
    const team = feature.team_id === gameById.get(row.gameId)?.homeTeamId ? game.homeTeam : game.awayTeam;
    const opponent = team === game.homeTeam ? game.awayTeam : game.homeTeam;
    return [{
      decisionKey: [row.release, row.gameId, row.playerId, row.market, row.line].join("|"),
      gameId: game.canonicalGameId,
      scheduledStart: game.scheduledStart,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      playerId: `nba-bdl-player:${row.playerId}`,
      playerName: row.playerName,
      team,
      opponent,
      market: row.market,
      line: row.line,
      projection: row.finalProjection,
      independentProjection: row.independentProjection,
      independentProbability: row.independentProbability,
      modelRelease: row.modelRelease,
      calibrationRelease: row.calibrationRelease,
      decisionRelease: row.decisionRelease,
      side: row.side,
      probability: row.probability,
      grade: row.grade,
      sportsbook: row.sportsbook,
      americanPrice: row.americanPrice,
      expectedValue: row.expectedValue,
      targetExcludedProbability: row.targetExcludedProbability,
      targetExcludedBooks: row.targetExcludedBooks,
      targetExcludedReferenceBooks: row.targetExcludedReferenceBooks,
      marketEvidenceMode: row.marketEvidenceMode,
      gradePolicySource: row.gradePolicySource,
      ...reader,
      priceLadder: buildNbaPlayerPropsMemberPrices({ current: live.observations, target }),
      movement,
      evaluatedAt: now,
      lockedAt: null,
    }];
  });
  const games = live.games.map((game) => ({
    gameId: game.canonicalGameId,
    scheduledStart: game.scheduledStart,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
  }));
  let candidate = buildNbaPlayerPropsMemberSnapshot({
    mode: "private_forward_candidate",
    generatedAt: now,
    slateDate: args.slateDate,
    games,
    decisions: memberDecisions,
    inputRows: mergedMarket.history.observations.length,
  });
  const aiBaseline=candidate;
  if(propsAiSiteConfig().integrated&&priorState&&currentState){
    const contexts=await args.client.from("lab_response_snapshots").select("payload,generated_at").eq("sport","nba").like("snapshot_key","%current-only::live-copy%").order("generated_at",{ascending:false}).limit(4);
    const ai=await reviewPropsForSite({client:args.client,sport:"nba",writerRunId:args.writerRunId,deadline:Date.parse(now)+260000,
      games:games.map(g=>({id:g.gameId,start:g.scheduledStart,away:g.awayTeam,home:g.homeTeam})),
      load:(game,window)=>liveNbaPacket({game,window,snapshot:aiBaseline,market:mergedMarket.history,prior:priorState,current:currentState!,context:contexts.error?[]:contexts.data as EnrichedSource["nbaContext"]})});
    for(const game of ai.games)candidate=applyNbaSiteAi(candidate,game.packet,game.decisions,new Date().toISOString());
  }
  const previous = await readNbaPlayerPropsPrivateSnapshot({ client: args.client, slateDate: args.slateDate });
  const publicationNow=propsAiSiteConfig().integrated?new Date().toISOString():now;
  const lifecycle = advanceNbaPlayerPropsCandidateLifecycle({ now:publicationNow, previous, candidate });
  await writeNbaPlayerPropsPrivateSnapshot({
    client: args.client,
    snapshot: lifecycle.snapshot,
    source: NBA_PLAYER_PROPS_PRIVATE_WRITER_RELEASE,
  });
  const tracking = await captureNbaPlayerPropsPrivateTracking({
    client: args.client,
    season: args.season,
    slateDate: args.slateDate,
    evaluatedAt: now,
    snapshot: lifecycle.snapshot,
  });
  const settlement = args.fullRefresh && currentState
    ? await settleNbaPlayerPropsTrackedSlates({
        client: args.client,
        season: args.season,
        slateDates: recentDates(now, 7),
        state: currentState,
        observedAt: now,
      })
    : null;
  return {
    release: NBA_PLAYER_PROPS_PRIVATE_WRITER_RELEASE,
    publicEnabled: false,
    status: "published_private",
    providerRequests: stateRequests + live.providerRequests.balldontlie + live.providerRequests.theOddsApi + live.providerRequests.owls,
    theOddsApiCreditsUsed: live.theOddsApiCreditsUsed,
    observationsAdded: mergedMarket.added,
    observationsRefreshed: mergedMarket.refreshed,
    observationConflictsPreserved: mergedMarket.conflicts,
    featureRows: eligibleFeatures.length,
    decisions: lifecycle.snapshot.decisions.length,
    locked: lifecycle.snapshot.decisions.filter((row) => row.lockedAt !== null).length,
    settlement,
    findings: [
      ...live.findings,
      ...(invalidForecasts.length > 0 ? [`invalid_nonpositive_forecasts_excluded:${invalidForecasts.length}`] : []),
      ...(tracking.conflicts > 0 ? [`locked_tracking_conflicts_preserved:${tracking.conflicts}`] : []),
      ...(stateCorrections > 0 ? [`official_source_corrections_ingested:${stateCorrections}`] : []),
      ...(settlement?.corrected ? [`official_stat_corrections_recorded:${settlement.corrected}`] : []),
    ],
  };
}

export function nbaPlayerPropsScheduleGameMatches(
  scheduled: Pick<NbaRollingScheduleGame, "homeTeam" | "awayTeam">,
  provider: Readonly<{ homeTeam: string; awayTeam: string }>,
): boolean {
  return canonicalNbaAbbreviation(provider.homeTeam) === canonicalNbaAbbreviation(scheduled.homeTeam)
    && canonicalNbaAbbreviation(provider.awayTeam) === canonicalNbaAbbreviation(scheduled.awayTeam);
}

async function explicitOutPlayers(
  games: readonly NbaRollingScheduleGame[],
  fetchImpl?: typeof fetch,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const game of games) {
    const report = await fetchEspnNbaGameInjuries(game.externalId, game.awayTeam, game.homeTeam, { fetchImpl });
    if (!report) continue;
    for (const injuries of report.teams.values()) {
      for (const injury of injuries) if (injury.status === "out") out.add(normalize(injury.name));
    }
  }
  return out;
}

function recentDates(now: string, count: number): string[] {
  const timestamp = Date.parse(now);
  return Array.from({ length: count }, (_, index) =>
    new Date(timestamp - index * 86_400_000).toISOString().slice(0, 10));
}

function result(status: NbaPlayerPropsPrivateWriterResult["status"]): NbaPlayerPropsPrivateWriterResult {
  return {
    release: NBA_PLAYER_PROPS_PRIVATE_WRITER_RELEASE,
    publicEnabled: false,
    status,
    providerRequests: 0,
    theOddsApiCreditsUsed: 0,
    observationsAdded: 0,
    observationsRefreshed: 0,
    observationConflictsPreserved: 0,
    featureRows: 0,
    decisions: 0,
    locked: 0,
    findings: [],
  };
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function playerIdFromObservation(observation: { canonicalPlayerId: string | null; providerPlayerId: string | null }): number | null {
  const value = observation.canonicalPlayerId?.match(/^nba-bdl-player:(\d+)$/)?.[1] ?? observation.providerPlayerId;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
