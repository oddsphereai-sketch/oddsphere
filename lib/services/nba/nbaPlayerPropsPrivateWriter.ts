import {propsAiTwoPhaseCompletionWindowMs} from "../../playerPropsAi/completionWindow";
import {buildPropsSourceContextAuditSlate,retainedPropsSourceContextAudits,type PropsSourceContextAudit} from "../../playerPropsAi/sourceContextAudit";
import {digest} from "../../playerPropsAi/evidence";
import {reviewPropsForSite} from "../../playerPropsAi/siteRuntime";
import {liveNbaPacket} from "../../playerPropsAi/liveSources";
import {applyNbaSiteAi,restoreNbaNativeGame} from "../../playerPropsAi/siteBindings";
import {siteAiDecisions} from "../../playerPropsAi/publication";
import {observeNbaSourceAuthority,captureNbaHandoffBundle,mergeNbaHandoffs,captureNbaWithdrawalAuthority,NBA_PROPS_WITHDRAWAL_AUTHORITY_RELEASE,type NbaLockHandoff} from "../../playerPropsAi/nbaLockAuthority";
import type {GamePacket} from "../../playerPropsAi/evidenceContract";
import type {AcceptedGameReview} from "../../playerPropsAi/reviewer";
import type {CapturedNbaParticipationReport} from "../../playerPropsAi/participationEligibility";
import {propsAiSiteConfig} from "../../playerPropsAi/siteConfig";
import type {EnrichedSource} from "../../playerPropsAi/cachedEnrichment";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalNbaAbbreviation, fetchEspnNbaGameInjuries,type EspnNbaGameInjuries } from "./espnNbaInjuries";
import {
  buildNbaPlayerPropsForwardDecisions,
  type NbaPlayerPropsForwardDecision,
} from "./nbaPlayerPropsFrozenRuntime";
import {PROPS_AI_NBA_CURRENT_SOURCE_RELEASE} from "../../playerPropsAi/nbaSourceIdentity";
import { advanceNbaPlayerPropsCandidateLifecycle,NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES } from "./nbaPlayerPropsLifecycle";
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
import { buildNbaPlayerPropsMemberSnapshot, type NbaPlayerPropsMemberDecision,type NbaPlayerPropsMemberSnapshot } from "./nbaPlayerPropsProductContract";
import { buildNbaPlayerPropsReaderEvidence } from "./nbaPlayerPropsReaderContract";
import { captureNbaPlayerPropsPrivateTracking } from "./nbaPlayerPropsPrivateTrackingStore";
import { settleNbaPlayerPropsTrackedSlates,hasNbaPropsUnsettledTrackedSlates } from "./nbaPlayerPropsSettlementStore";
import type { NbaRollingScheduleGame } from "./nbaRollingSchedule";
import { buildNbaPlayerPropsMemberPrices } from "./nbaPlayerPropsMemberPrices";

export const NBA_PLAYER_PROPS_PRIVATE_WRITER_RELEASE =
  "nba_player_props_private_writer_2026_11_11_r21_source_mean_admission" as const;

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
  /** Absolute invocation budget, including time spent waiting for the shared lease. */
  aiDeadline?: number;
  /** Due-slot priority/rescue only: retain room for both paid phases before collecting. */
  reserveReviewWindow?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<NbaPlayerPropsPrivateWriterResult> {
  const now = args.now ?? new Date().toISOString();
  if(args.aiDeadline!==undefined&&!Number.isFinite(args.aiDeadline))throw new Error("invalid_props_ai_absolute_deadline");
  // Source collection and every existing fetch share the invocation's
  // original deadline. Leave the minimum complete two-phase window intact;
  // preparation later discovers actual parts and admits their larger window.
  // This is derived from the review contract, never a new per-source timeout.
  const sourceDeadline = args.aiDeadline === undefined ? null
    : args.aiDeadline - (args.reserveReviewWindow ? propsAiTwoPhaseCompletionWindowMs(1) : 0);
  const assertSourceWindow = () => {
    if (sourceDeadline !== null && Date.now() >= sourceDeadline) throw new Error("nba_props_source_preparation_window_exhausted");
  };
  const sourceFetch: typeof fetch = sourceDeadline === null ? args.fetchImpl ?? fetch : async (input, init) => {
    assertSourceWindow();
    const timeout = AbortSignal.timeout(Math.max(1, Math.floor(sourceDeadline - Date.now())));
    const response = await (args.fetchImpl ?? fetch)(input, {...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout});
    assertSourceWindow();
    return response;
  };
  assertSourceWindow();
  const slateSchedule = args.schedule.filter((game) => game.slateDate === args.slateDate);
  if (slateSchedule.length === 0 && (!args.fullRefresh
    ||!await hasNbaPropsUnsettledTrackedSlates(args.client,args.season))) return result("no_games");

  const previousState = await readNbaPlayerPropsCurrentState({ client: args.client, season: args.season });
  const priorState = slateSchedule.length ? await readNbaPlayerPropsCurrentState({ client: args.client, season: args.season - 1 }):null;
  if (slateSchedule.length&&(!priorState || priorState.games.length < 100 || priorState.boxes.length < 500)) {
    return { ...result("bootstrap_required"), findings: ["prior_season_player_state_missing"] };
  }
  assertSourceWindow();
  let currentState = previousState;
  let stateRequests = 0;
  let stateCorrections = 0;
  if (args.fullRefresh) {
    const collected = await collectNbaPlayerPropsCurrentState({
      previous: previousState,
      season: args.season,
      dates: recentDates(now, 7),
      apiKey: args.ballDontLieApiKey,
      fetchImpl: sourceFetch,
    });
    assertSourceWindow();
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
    fetchImpl: sourceFetch,
  });
  assertSourceWindow();
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

  assertSourceWindow();
  const integrated=propsAiSiteConfig().integrated;
  if(integrated&&!args.writerRunId)throw new Error("NBA integrated publication requires the existing sport lease owner");
  const initialPrevious=await readNbaPlayerPropsPrivateSnapshot({client:args.client,slateDate:args.slateDate});
  const emptyCurrentGames=new Set(live.games.filter(game=>!live.observations.some(q=>q.canonicalGameId===game.canonicalGameId&&!q.isOpening&&!q.isLive)).map(game=>game.canonicalGameId));
  const withdrawalOnly=integrated&&live.games.every(game=>emptyCurrentGames.has(game.canonicalGameId))
    &&Boolean(initialPrevious?.decisions.length);
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
  const availability = await explicitOutPlayers(slateSchedule, sourceFetch);
  assertSourceWindow();
  const participationReports:CapturedNbaParticipationReport[]=availability.reports.flatMap(capture=>live.games.filter(game=>nbaPlayerPropsScheduleGameMatches(game,capture.game)&&Date.parse(game.scheduledStart)===Date.parse(capture.game.gameStartAt)).map(game=>({
    gameId:game.canonicalGameId,start:game.scheduledStart,awayTeam:game.awayTeam,homeTeam:game.homeTeam,expectedEventId:String(capture.game.externalId),availableAt:capture.availableAt,report:capture.report,
  })));
  const isOut=(gameId:number,teamId:number,name:string|null)=>{
    const game=gameById.get(gameId);if(!game)return false;
    const team=teamId===game.homeTeamId?game.homeTeam:teamId===game.awayTeamId?game.awayTeam:null;
    return team!==null&&availability.out.has(outPlayerScope(game.startTime,game.awayTeam,game.homeTeam,team,name??""));
  };
  const eligibleFeatures = features.filter((feature) => !isOut(feature.game_id,feature.team_id,feature.player_name));
  const forward = buildNbaPlayerPropsForwardDecisions({
    features: eligibleFeatures,
    observations: mergedMarket.history.observations,
    currentObservations: live.observations,
    evaluatedAt: now,
  });
  const invalidForecasts = forward.filter((row) => !nbaPlayerPropsForecastIsPublishable(row));
  const publishableForward = forward.filter(nbaPlayerPropsForecastIsPublishable);
  // Known unavailable actors are intentionally excluded from native features.
  // They are still part of the AI source/review; counting them as missing
  // features could block every healthy actor and retain yesterday's Leans.
  const availableCandidates = candidates.filter(candidate => !isOut(candidate.gameId,candidate.teamId,candidate.playerName));
  const minimumCoverage = availableCandidates.length ? Math.max(1, Math.floor(availableCandidates.length * 0.80)) : 0;
  const allCandidatesUnavailable = candidates.length > 0 && availableCandidates.length === 0;
  const noNativeForwardRequired = (allCandidatesUnavailable&&integrated)||withdrawalOnly;
  if ((!withdrawalOnly&&eligibleFeatures.length < minimumCoverage) || (publishableForward.length === 0 && !noNativeForwardRequired)) {
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
          ? [`feature_coverage_below_80_percent:${eligibleFeatures.length}/${availableCandidates.length}`]
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
      independentSide: row.independentSide,
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
    decisions: [...memberDecisions,...(integrated?initialPrevious?.decisions.filter(row=>emptyCurrentGames.has(row.gameId)&&!memberDecisions.some(current=>current.gameId===row.gameId&&current.playerId===row.playerId&&current.market===row.market))??[]:[])],
    inputRows: mergedMarket.history.observations.length,
  });
  const aiBaseline=candidate;
  const lockFrames:NbaLockHandoff[]=[];
  const retainedAudits=retainedPropsSourceContextAudits(initialPrevious?.diagnostics.sourceContextAudits,{slateDate:args.slateDate,generatedAt:initialPrevious?.generatedAt??now,games:initialPrevious?.games??[]});
  const sourceAudits=new Map<string,PropsSourceContextAudit>(retainedAudits.audits.map(audit=>[audit.gameId,audit]));
  const withSourceAudits=(snapshot:NbaPlayerPropsMemberSnapshot):NbaPlayerPropsMemberSnapshot=>sourceAudits.size||retainedAudits.status==='unavailable'
    ?{...snapshot,diagnostics:{...snapshot.diagnostics,sourceContextAudits:{...buildPropsSourceContextAuditSlate([...sourceAudits.values()]),...(retainedAudits.status==='unavailable'&&!sourceAudits.size?{comparisonComplete:false}:{} )},...(retainedAudits.status==='unavailable'?{sourceContextAuditRetention:'prior_metadata_unavailable' as const}:{} )}}
    :snapshot;
  // This remains the sole sport-leased writer. Ready games commit through one
  // awaited queue, before unrelated review work can consume the route budget.
  // A callback never writes a stale copy over a sibling game's publication.
  let previous=initialPrevious;
  let publicationQueue:Promise<void>=Promise.resolve();
  let publicationFailure:unknown;
  let trackingConflicts=0;
  const unreadyGames=new Set<string>();
  type WithdrawalReceipt={release:typeof NBA_PROPS_WITHDRAWAL_AUTHORITY_RELEASE;gameId:string;start:string;cutoff:string;observedAt:string;sourcePacketHash:string};
  const receipts=(snapshot:NbaPlayerPropsMemberSnapshot|null)=>(snapshot as (NbaPlayerPropsMemberSnapshot&{sourceWithdrawals?:WithdrawalReceipt[]})|null)?.sourceWithdrawals??[];
  type PublicationSource={packet:GamePacket;frame:NbaLockHandoff};
  const commit=async(snapshot:NbaPlayerPropsMemberSnapshot,publicationNow:string,source?:PublicationSource,
    withdrawalAuthority?:Parameters<typeof writeNbaPlayerPropsPrivateSnapshot>[0]['withdrawalAuthority'])=>{
    await writeNbaPlayerPropsPrivateSnapshot({client:args.client,snapshot,
      source:NBA_PLAYER_PROPS_PRIVATE_WRITER_RELEASE,...(integrated?{writerRunId:args.writerRunId,expectedSnapshot:previous}:{}),
      ...(source?{publicationBefore:source.packet.lock,sourceCutoff:source.packet.cutoff}:{}),
      ...(withdrawalAuthority?{withdrawalAuthority}:{})});
    previous=snapshot;
    const tracking=await captureNbaPlayerPropsPrivateTracking({client:args.client,season:args.season,
      slateDate:args.slateDate,evaluatedAt:publicationNow,snapshot});
    trackingConflicts+=tracking.conflicts;
  };
  const persist=async(publicationNow:string,source?:PublicationSource)=>{
    const gameId=source?(source.packet.sourceGameId??source.packet.gameId):null;
    let canonicalOtherRows=gameId?(previous??aiBaseline).decisions.filter(row=>row.gameId!==gameId):null;
    // Before a later game advances the shared publication header, latch any
    // already-due game from the actual canonical publication and existing source
    // authority. A row's evaluation clock alone never establishes publication.
    // The checkpoint stays bounded by these existing serial callbacks and uses
    // the same leased/CAS store and tracking path; it adds no job or refresh.
    if(gameId&&previous&&previous.decisions.some(row=>row.gameId!==gameId&&row.lockedAt===null
      &&Date.parse(publicationNow)>=Date.parse(row.scheduledStart)-NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES*60000)){
      const prepared=candidate;
      let due=advanceNbaPlayerPropsCandidateLifecycle({now:publicationNow,previous,candidate:previous,
        ...(integrated?{lockHandoff:mergeNbaHandoffs(lockFrames)}:{})}).snapshot;
      if(receipts(previous).length)due={...due,sourceWithdrawals:receipts(previous)} as NbaPlayerPropsMemberSnapshot;
      due=withSourceAudits(due);
      canonicalOtherRows=due.decisions.filter(row=>row.gameId!==gameId);
      // If every old unlocked row is ineligible, the ordinary empty-board
      // guard still applies. Compose those removals with this valid ready game
      // in the same final write rather than blocking its independent handoff.
      if(due.decisions.length)await commit(due,publicationNow);
      candidate=buildNbaPlayerPropsMemberSnapshot({...prepared,generatedAt:publicationNow,
        decisions:[...due.decisions.filter(row=>row.gameId!==gameId),...prepared.decisions.filter(row=>row.gameId===gameId)],
        inputRows:aiBaseline.diagnostics.inputRows});
    }
    // The current callback then advances its complete game while retaining the
    // other canonical payloads, including the checkpoint's exact first locks.
    const scoped=(snapshot:NbaPlayerPropsMemberSnapshot)=>gameId?buildNbaPlayerPropsMemberSnapshot({...snapshot,
      games:snapshot.games.filter(g=>g.gameId===gameId),decisions:snapshot.decisions.filter(r=>r.gameId===gameId),inputRows:snapshot.diagnostics.inputRows}):snapshot;
    const lifecycle={...advanceNbaPlayerPropsCandidateLifecycle({now:publicationNow,previous:previous?scoped(previous):null,candidate:scoped(candidate),
      ...(integrated?{lockHandoff:mergeNbaHandoffs(lockFrames)}:{})})};
    if(gameId)lifecycle.snapshot=buildNbaPlayerPropsMemberSnapshot({...candidate,generatedAt:publicationNow,
      decisions:[...canonicalOtherRows!,...lifecycle.snapshot.decisions],inputRows:aiBaseline.diagnostics.inputRows});
    lifecycle.snapshot=withSourceAudits(lifecycle.snapshot);
    const priorReceipts=receipts(previous).filter(receipt=>receipt.gameId!==gameId);
    const withdrawn=source?.packet.sourceOfferSetStatus==='empty';
    const nextReceipts=[...priorReceipts,...(withdrawn&&source?[{release:NBA_PROPS_WITHDRAWAL_AUTHORITY_RELEASE,gameId:gameId!,start:source.packet.start,cutoff:source.packet.cutoff,observedAt:publicationNow,sourcePacketHash:source.frame.observations[0].sourcePacketHash}]:[])];
    if(nextReceipts.length)lifecycle.snapshot={...lifecycle.snapshot,sourceWithdrawals:nextReceipts} as NbaPlayerPropsMemberSnapshot;
    // An already empty board needs no refreshed publication clock. This also
    // avoids laundering old withdrawal evidence through a later final sweep.
    if(previous&&previous.decisions.length===0&&lifecycle.snapshot.decisions.length===0){candidate=previous;return{...lifecycle,snapshot:previous};}
    const withdrawalAuthority=withdrawn&&source&&previous?captureNbaWithdrawalAuthority({packet:source.packet,source:source.frame,
      currentObservations:live.observations,collectorFindings:live.findings,previous,candidate:lifecycle.snapshot}):undefined;
    await commit(lifecycle.snapshot,publicationNow,source,withdrawalAuthority);
    candidate=lifecycle.snapshot;
    return lifecycle;
  };
  if(integrated&&priorState&&currentState){
    const lastObservation=new Map<string,{packetHash:string;reviewHash:string|null;lookupAvailable:boolean}>();
    const observe=(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable:boolean):Promise<void>=>{
      const work=publicationQueue.then(async()=>{
        const gameId=packet.sourceGameId??packet.gameId;
        if(packet.sourceInputRelease!==PROPS_AI_NBA_CURRENT_SOURCE_RELEASE||!Array.isArray(packet.executionQuotes)
          ||!games.some(game=>game.gameId===gameId&&Date.parse(game.scheduledStart)===Date.parse(packet.start))
          ||Date.parse(packet.lock)!==Date.parse(packet.start)-NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES*60000)throw new Error("NBA publication source identity or complete execution authority unavailable");
        const packetHash=digest(packet),reviewHash=review?digest(review):null,last=lastObservation.get(gameId);
        if(last?.packetHash===packetHash&&last.reviewHash===reviewHash&&last.lookupAvailable===lookupAvailable)return;
        const sourceFrame=observeNbaSourceAuthority(packet,review,lookupAvailable);
        lockFrames.push(sourceFrame);
        // Sample when this game actually leaves the queue. Callback arrival or
        // paid-job completion never backdates a new publication across lock.
        const observedAt=sourceFrame.observations[0].observedAt;
        if(Date.parse(observedAt)>=Date.parse(packet.lock))return;
        if(receipts(previous).some(receipt=>receipt.gameId===gameId&&Date.parse(receipt.observedAt)>Date.parse(packet.cutoff)))throw new Error("NBA current source predates its canonical withdrawal");
        const native=captureNbaHandoffBundle(aiBaseline.decisions,packet,review,"native");
        lockFrames.push(native);
        const durableBase=previous??aiBaseline;
        candidate=restoreNbaNativeGame(durableBase,aiBaseline,packet,observedAt);
        if(review&&lookupAvailable)candidate=applyNbaSiteAi(candidate,packet,siteAiDecisions(packet,review,observedAt),observedAt);
        const ai=captureNbaHandoffBundle(candidate.decisions,packet,review,"ai");
        lockFrames.push(ai);
        // The complete current game uses only actual source-qualified native
        // rows or validated reviewed rows. Withdrawn quotes cannot resurrect
        // yesterday's AI or an unconfirmed native preselection.
        const readyRows=new Map([...native.proofs,...ai.proofs].map(proof=>[
          JSON.stringify([proof.row.gameId,proof.row.playerId,proof.row.market]),proof.row]));
        const protectedRows=durableBase.decisions.filter(row=>row.gameId===gameId&&row.lockedAt!==null);
        for(const row of protectedRows)readyRows.set(JSON.stringify([row.gameId,row.playerId,row.market]),row);
        // Unavailable or declined actors may have no source-qualified numeric
        // rows. Preserve the original LKG clock until a complete representation
        // is ready; this is neither an empty-source withdrawal nor a fresh review.
        if(readyRows.size===0&&packet.sourceOfferSetStatus!=="empty"){
          candidate=durableBase;unreadyGames.add(gameId);return;
        }
        candidate=buildNbaPlayerPropsMemberSnapshot({...candidate,generatedAt:observedAt,
          decisions:[...candidate.decisions.filter(row=>row.gameId!==gameId),...readyRows.values()],
          inputRows:aiBaseline.diagnostics.inputRows});
        await persist(observedAt,{packet,frame:sourceFrame});
        unreadyGames.delete(gameId);
        lastObservation.set(gameId,{packetHash,reviewHash,lookupAvailable});
      });
      // Runtime reports callback errors as operational fallback. Keep a sticky
      // failure so its later return cannot claim a successful final write.
      publicationQueue=work.catch(error=>{publicationFailure??=error;});
      return work;
    };
    const contexts=await args.client.from("lab_response_snapshots").select("payload,generated_at").eq("sport","nba").like("snapshot_key","%current-only::live-copy%").order("generated_at",{ascending:false}).limit(4);
    assertSourceWindow();
    await reviewPropsForSite({client:args.client,sport:"nba",writerRunId:args.writerRunId,deadline:Math.min(Date.parse(now)+480000,args.aiDeadline??Infinity),
      onSourceAudit:audit=>{sourceAudits.set(audit.gameId,audit);},
      games:games.map(g=>({id:g.gameId,start:g.scheduledStart,away:g.awayTeam,home:g.homeTeam})),
      load:(game,window)=>liveNbaPacket({game,window,snapshot:aiBaseline,market:mergedMarket.history,currentObservations:live.observations,prior:priorState,current:currentState!,context:contexts.error?[]:contexts.data as EnrichedSource["nbaContext"],participationReports}),
      onSourceReady:(packet,review,_at,lookupAvailable)=>observe(packet,review,lookupAvailable),
      onReviewObserved:(packet,review,lookupAvailable)=>observe(packet,review,lookupAvailable),
      onReviewReady:(packet,review)=>observe(packet,review,true)});
  }
  await publicationQueue;
  if(publicationFailure)throw publicationFailure;
  if(unreadyGames.size)throw new Error(`NBA current source has no ready forecast; last-known-good preserved:${[...unreadyGames].sort().join(",")}`);
  const publicationNow=integrated?new Date().toISOString():now;
  const lifecycle=await persist(publicationNow);
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
      ...(trackingConflicts > 0 ? [`locked_tracking_conflicts_preserved:${trackingConflicts}`] : []),
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
): Promise<{out:Set<string>;reports:{game:NbaRollingScheduleGame;availableAt:string;report:EspnNbaGameInjuries}[]}> {
  const out = new Set<string>();
  const reports:{game:NbaRollingScheduleGame;availableAt:string;report:EspnNbaGameInjuries}[]=[];
  for (const game of games) {
    const report = await fetchEspnNbaGameInjuries(game.externalId, game.awayTeam, game.homeTeam, { fetchImpl });
    if (!report) continue;
    const teams=[...report.teams.keys()].map(canonicalNbaAbbreviation);
    if(String(report.eventId)!==String(game.externalId)||teams.length!==2||new Set(teams).size!==2||![game.awayTeam,game.homeTeam].every(team=>teams.includes(canonicalNbaAbbreviation(team))))continue;
    reports.push({game,availableAt:new Date().toISOString(),report});
    for (const [team,injuries] of report.teams) {
      for (const injury of injuries) if (injury.status === "out") out.add(outPlayerScope(game.gameStartAt,game.awayTeam,game.homeTeam,team,injury.name));
    }
  }
  return {out,reports};
}
function outPlayerScope(start:string,away:string,home:string,team:string,name:string){
  return JSON.stringify([Date.parse(start),canonicalNbaAbbreviation(away),canonicalNbaAbbreviation(home),canonicalNbaAbbreviation(team),normalize(name)]);
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
