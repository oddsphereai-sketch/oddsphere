import type { supabase } from "@/lib/db/supabase";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import { CbbBallDontLieClient } from "@/lib/cbb/ballDontLie";
import { cbbCanonicalStatus } from "@/lib/cbb/canonicalFixture";
import { matchCbbProviderVenue as matchCbbVenue } from "@/lib/cbb/providerVenueIdentity";
import {readCbbMarketBehavior} from "@/lib/cbb/marketBehaviorCandidate";
import {cbbIndependentInputKey,cbbOriginalMarketAnchors,cbbBehaviorFlows,cbbHistoryAtDecision} from "./cbbMarketBehaviorInputs";
import {CBB_CURRENT_SCORE_RELEASE} from "@/lib/cbb/currentScoreRuntime";
import type {CbbForecast} from "@/lib/cbb/types";
import { forecastCbbCurrentBatch } from "@/lib/cbb/currentScoreRuntime";
import { normalizeCbbOwlsCurrent } from "@/lib/cbb/owlsMarketEvidence";
import { cbbCurrentSplitEvidence } from "@/lib/cbb/owlsSplitEvidence";
import { buildCbbProvisionalBoard, chooseCbbSupportedTargetBook } from "@/lib/cbb/provisionalBoard";
import {mergeCbbCurrentProviderQuotes} from "@/lib/cbb/currentProviderQuotes";
import type { CbbGame, CbbTrainingGame, CbbOdds, CbbQuote } from "@/lib/cbb/types";
import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import type { RawOwlsOddsResponse } from "@/lib/providers/owls/owlsSharpBookOdds";
import type { RawOwlsSplitsResponse } from "@/lib/providers/owls/owlsSharpBookSplits";
import { addDaysToSlate, computeSlateDate } from "@/lib/dates/slateDate";
import { cbbDailyEdgeResponse,adaptCbbProvisionalGame } from "./adaptCbbProvisionalToDailyEdge";
import { cbbMemberGameForReader, readCbbMemberGames, writeCbbMemberGame } from "./cbbMemberGameStore";
import { fetchCbbDayEvents } from "./fetchCbbDayEvents";
import { loadCbbRollingSchedule } from "./cbbRollingSchedule";
import { dailyEdgeSnapshotKey, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";
import { writeLockedCbbTracking } from "./cbbTrackingWriter";
import { readCbbCapturedMarketHistory,readCbbCapturedNamedSplits } from "./cbbCapturedMarketHistory";
import { mergeCbbCapturedNamedSplitEvidence,mergeCbbDraftKingsSplitEvidence,mergeCbbReaderEvidence,readCbbCapturedPublicSplits,type CbbPreparedNamedSplitSections,type CbbPreparedPublicSplitSections } from "./cbbReaderMarketEvidence";
import { readStoredDraftKingsNetworkSplits,applyDraftKingsNetworkSplitFallback } from "@/lib/providers/draftkings/draftKingsNetworkSplits";
import { applySharpApiCurrentSplitOverlay } from "@/lib/providers/real_api/sharpApiCurrentSplits";
import { advanceCbbProvisionalSnapshot } from "@/lib/cbb/provisionalLifecycle";
import { isOwnerApprovedCbbMemberExclusion } from "@/lib/cbb/memberBoardScope";
import {readCbbCanonicalReaderHistory} from "./cbbCanonicalReaderHistory";
import {pairCbbCanonicalMarketEvidence} from "./cbbCanonicalMarketEvidence";
import {cbbCanonicalBehaviorInputs} from "./cbbCanonicalBehaviorInputs";
import {retainCbbLevelInput,cbbRetainedNormalizationQuarantine} from "@/lib/cbb/retainedLevelInput";
import {cbbDecisionSplitContext} from "@/lib/cbb/decisionSplitContext";

export const CBB_MEMBER_PIPELINE_RELEASE="cbb_member_pipeline_2026_11_03_r21_predecision_split_context" as const;
const dateWindow=(anchor:string)=>Array.from({length:7},(_,i)=>addDaysToSlate(anchor,i));

/** The sole leased writer publishes the same exact locked/unlocked tuples the
 * member page reads. No request-time model or market recomputation. */
export async function refreshCbbMemberBoard(args:{anchorDate:string;season:number;now?:string;bdlKey:string;owlsKey:string;
  trainingGames:CbbTrainingGame[];nowClock?:()=>string;db?:typeof supabase;provider?:CbbBallDontLieClient;owls?:OwlsInsightClient;
  fetcher?:typeof fetch;loadSchedule?:typeof loadCbbRollingSchedule;canonicalHistoryReader?:typeof readCbbCanonicalReaderHistory;
  fallbackOdds?:CbbOdds[];saveSnapshot?:typeof upsertLabResponseSnapshot;syncFixtures?:(games:CbbGame[])=>Promise<unknown>}){
  const db=args.db??(await import("@/lib/db/supabase")).supabase;
  const provider=args.provider??new CbbBallDontLieClient(args.bdlKey,{maxRequests:160});
  const owls=args.owls??new OwlsInsightClient(args.owlsKey,{timeoutMs:8_000});
  const dates=dateWindow(args.anchorDate),providerDates=[addDaysToSlate(args.anchorDate,-1),...dates];
  const nowClock=args.nowClock??(()=>args.now??new Date().toISOString());
  const oddsRequestedAt=nowClock();
  const [a,b,initialSchedule,oddsReceipt,splitsReceipt]=await Promise.all([
    provider.gamesForDates(providerDates.slice(0,7),args.season),
    provider.gamesForDates(providerDates.slice(7),args.season),
    (args.loadSchedule??loadCbbRollingSchedule)(args.anchorDate),
    owls.odds<RawOwlsOddsResponse>("ncaab").then(response=>({response,fetchedAt:nowClock()})),
    owls.splits<RawOwlsSplitsResponse>("ncaab").then(response=>({response,fetchedAt:nowClock()})),
  ]);
  const odds=oddsReceipt.response,splits=splitsReceipt.response;
  if(odds.body.success!==true||!odds.body.data)throw new Error("CBB named sportsbook feed unavailable");
  // Capture time is taken after the remote response; never predate a quote
  // verification just because the cron began several seconds earlier.
  let asOf=nowClock();
  const byId=new Map<number,CbbGame>();
  for(const game of [...a,...b]){
    if(byId.has(game.id)&&JSON.stringify(byId.get(game.id))!==JSON.stringify(game))throw new Error("CBB provider duplicate game conflict");
    byId.set(game.id,game);
  }
  const games=[...byId.values()].filter(game=>dates.includes(computeSlateDate("cbb",game.date))&&
    (game.home_team.conference_id||game.visitor_team.conference_id)).sort((x,y)=>x.date.localeCompare(y.date)||x.id-y.id);
  let schedule=initialSchedule;
  if(args.syncFixtures){
    const indexed=new Map(schedule.games.map(game=>[game.externalId,game]));
    const changed=games.filter(game=>{
      const prior=indexed.get(game.id);
      return !prior||Date.parse(prior.gameStartAt)!==Date.parse(game.date)||prior.status!==cbbCanonicalStatus(game)||
        prior.homeTeamDisplayName!==game.home_team.full_name||prior.awayTeamDisplayName!==game.visitor_team.full_name;
    });
    if(changed.length){await args.syncFixtures(changed);schedule=await (args.loadSchedule??loadCbbRollingSchedule)(args.anchorDate);}
  }
  const scheduled=new Map(schedule.games.map(game=>[game.externalId,game]));
  const candidateGames=games.filter(game=>{
    const canonical=cbbCanonicalStatus(game);
    return canonical==="STATUS_SCHEDULED"||canonical==="STATUS_FINAL"||canonical==="STATUS_IN_PROGRESS";
  });
  const prior=await readCbbMemberGames(candidateGames.map(game=>game.id),db);
  const namedById=new Map<number,{quotes:CbbQuote[];rejected:Array<{reason:string;book:string|null}>}>(candidateGames.filter(game=>Date.parse(game.date)>Date.parse(asOf))
    .map(game=>{
      const evidence=normalizeCbbOwlsCurrent(game,odds.body,oddsReceipt.fetchedAt,asOf);
      evidence.quotes=evidence.quotes.map(quote=>({...quote,requestedAt:oddsRequestedAt}));
      return [game.id,evidence] as const;
    }));
  const providerWarnings:string[]=[];
  const [bookHistory,capturedSplits,draftKingsFeed]=await Promise.all([
    readCbbCapturedMarketHistory(db).catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB captured history unavailable");return null;}),
    readCbbCapturedNamedSplits(db).catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB captured splits unavailable");return null;}),
    readStoredDraftKingsNetworkSplits("cbb",db).catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB stored DraftKings splits unavailable");return null;}),
  ]);
  const needsFallback=candidateGames.filter(game=>!prior.get(game.id)?.snapshot.lockedAt&&Date.parse(game.date)>Date.parse(asOf)&&
    !["moneyline","spread","total"].every(market=>namedById.get(game.id)?.quotes.some(q=>q.market===market)));
  if(needsFallback.length){
    try{
      const quoteDates=[...new Set(needsFallback.map(game=>game.date.slice(0,10)))];
      const rows=args.fallbackOdds??(typeof provider.odds==="function"?await provider.odds(quoteDates,"current"):[]);
      asOf=nowClock();
      for(const game of candidateGames.filter(game=>Date.parse(game.date)>Date.parse(asOf)&&!prior.get(game.id)?.snapshot.lockedAt)){
        const primary=namedById.get(game.id)!;
        primary.quotes=mergeCbbCurrentProviderQuotes(primary.quotes,rows,game,asOf);
      }
    }catch(error){providerWarnings.push(`BDL odds gap fill unavailable: ${error instanceof Error?error.message:"source failure"}`);}
  }
  const sourceGames=candidateGames.filter(game=>{
    const existing=prior.get(game.id),identity=scheduled.get(game.id);
    if(existing?.snapshot.lockedAt)return true;
    return !!identity&&
      (existing!==undefined||chooseCbbSupportedTargetBook(namedById.get(game.id)?.quotes??[])!==null);
  });
  const missingIdentity=candidateGames.filter(game=>!scheduled.has(game.id)).length;
  const missingLogosOnSchedule=candidateGames.filter(game=>{const identity=scheduled.get(game.id);
    return identity&&(!identity.homeTeamLogo||!identity.awayTeamLogo);}).length;
  // Forecast only rows that can still accept a new candidate. Recomputing a
  // locked/started game is both unused and rejected by the point-in-time model;
  // one completed game must not stop fresh predictions for the rest of the slate.
  const forecastGames=sourceGames.filter(game=>!prior.get(game.id)?.snapshot.lockedAt&&
    Date.parse(asOf)<Date.parse(game.date)-60*60_000);
  const contextDays=[...new Set(forecastGames.map(game=>computeSlateDate("cbb",game.date)))];
  const [eventRows,canonicalHistory]=await Promise.all([
    Promise.all(contextDays.map(async date=>[date,await fetchCbbDayEvents(date,args.fetcher)] as const)),
    (args.canonicalHistoryReader??readCbbCanonicalReaderHistory)({db,gameIds:forecastGames.map(game=>game.id),asOf}),
  ]);
  const dayEvents=new Map(eventRows);
  if(!canonicalHistory.complete)providerWarnings.push(`CBB canonical reader history incomplete: price=${canonicalHistory.price.reason}; split=${canonicalHistory.split.reason}`);
  // Partition once. No selected-card request, additional collector or writer.
  // An incomplete family is retained only in telemetry, never presented as a
  // complete historical episode to the model.
  const priceById=new Map<number,typeof canonicalHistory.priceRows>();
  const splitById=new Map<number,typeof canonicalHistory.splitRows>();
  if(canonicalHistory.price.complete)for(const item of canonicalHistory.priceRows){const id=Number(item.canonical_event_id);const rows=priceById.get(id)??[];rows.push(item);priceById.set(id,rows);}
  if(canonicalHistory.split.complete)for(const item of canonicalHistory.splitRows){const id=Number(item.canonical_event_id);const rows=splitById.get(id)??[];rows.push(item);splitById.set(id,rows);}
  const canonicalEvidenceById=new Map(forecastGames.map(game=>[game.id,pairCbbCanonicalMarketEvidence({game,decisionAt:asOf,
    priceRows:priceById.get(game.id),splitRows:splitById.get(game.id)})]));
  const canonicalById=new Map(forecastGames.map(game=>[game.id,cbbCanonicalBehaviorInputs(canonicalEvidenceById.get(game.id)!)]));
  const forecasts=forecastCbbCurrentBatch(forecastGames.map(game=>{
    const evidence=dayEvents.get(computeSlateDate("cbb",game.date));
    const venue=evidence?matchCbbVenue(game,evidence.events,evidence.fetchedAt):null;
    return {id:game.id,date:game.date,season:game.season,homeId:game.home_team.id,
      awayId:game.visitor_team.id,neutral:venue?.timeConfirmed?venue.neutral:null};
  }),asOf,args.trainingGames);
  const forecastById=new Map(forecasts.map(row=>[row.game.id,row.forecast]));
  const memberGames:DailyEdgeGameDto[]=[],problems:string[]=[],unpublishedIncomplete:number[]=[],ownerApprovedExclusions:number[]=[];
  const splitEvidenceById=new Map(forecastGames.map(game=>[game.id,cbbCurrentSplitEvidence(game,odds.body,splits.body,splitsReceipt.fetchedAt,asOf)]));
  const publicRows=await readCbbCapturedPublicSplits(db,forecastGames.map(game=>game.id),Date.parse(asOf))
    .catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB captured public splits unavailable");return [];});
  const decisionSplitsById=new Map(forecastGames.map(game=>[game.id,cbbDecisionSplitContext({game,allGames:candidateGames,asOf,
    direct:splitEvidenceById.get(game.id)!,canonical:canonicalEvidenceById.get(game.id)!.splitPairs,
    publicRows,draftKings:draftKingsFeed})]));
  // Original r3 quote receipts may seed an anchor only when today's frozen
  // independent runtime exactly reproduces that earlier published baseline.
  // Batch by its real decision clock; no per-game/provider/DB refresh is added.
  const earlierGroups=new Map<string,typeof forecasts>();
  for(const row of forecasts){const previous=prior.get(row.game.id)?.snapshot;
    if(previous&&!previous.lockedAt&&previous.board.modelRelease===CBB_CURRENT_SCORE_RELEASE){
      const clock=previous.board.asOf;earlierGroups.set(clock,[...(earlierGroups.get(clock)??[]),row]);
    }}
  const earlierIndependent=new Map<number,CbbForecast>();
  const earlierInputKeys=new Map<number,string>();
  for(const [clock,rows] of earlierGroups){
    const history=cbbHistoryAtDecision(args.trainingGames,clock);
    try{for(const row of forecastCbbCurrentBatch(rows.map(row=>row.game),clock,history)){
      earlierIndependent.set(row.game.id,row.forecast);
      earlierInputKeys.set(row.game.id,cbbIndependentInputKey(row.game,history));
    }}catch{/* An unreproducible independent baseline cannot attest a legacy anchor. */}
  }
  const retainedInputCounts={captured:0,preserved_valid:0,preserved_invalid:0,unavailable:0};
  const boardCandidates=new Map(forecasts.map(row=>{
    const quotes=namedById.get(row.game.id)?.quotes??[],baseline=buildCbbProvisionalBoard(row.forecast,quotes);
    const targets=baseline.rows.flatMap(market=>{const target=quotes.find(q=>q.market===market.market&&q.sportsbook===market.targetBook&&q.providerObservedAt===market.quoteObservedAt&&q.line===market.line);return target?[target]:[];});
    const key=cbbIndependentInputKey(row.game,args.trainingGames),previous=prior.get(row.game.id)?.snapshot??null;
    const native=canonicalById.get(row.game.id)!;
    const storedRead=previous?.board.marketContext.verifiedMarketRead;
    const anchors=!storedRead&&native.historyQuotes.length?null:
      cbbOriginalMarketAnchors(previous,earlierInputKeys.get(row.game.id)??key,earlierIndependent.get(row.game.id)??null);
    const read=readCbbMarketBehavior({independent:row.forecast,independentInputKey:key,startsAt:row.game.date,targets,currentQuotes:quotes,anchors,
      flows:cbbBehaviorFlows(splitEvidenceById.get(row.game.id)!),historyQuotes:native.historyQuotes,historyFlows:native.historyFlows,
      splitContext:decisionSplitsById.get(row.game.id),
      previousPath:storedRead?.pathTape,quarantinedSources:native.quarantinedSources,
      historyCompleteness:{price:canonicalHistory.price.complete,split:canonicalHistory.split.complete}});
    const board=buildCbbProvisionalBoard(read.forecast,quotes,{marketBehavior:read.receipt});
    const checkpoint=retainCbbLevelInput({existing:previous?.board.marketContext.retainedLevelInput,
      independent:row.forecast,independentInputKey:key,startsAt:row.game.date,asOf,
      // Qualification must see pre-filter native/current frames as well as
      // retained states: an invalid newest frame cannot revive an older price.
      sourceQuotes:[...quotes,...native.historyQuotes,...read.receipt.currentProfessionalQuotes],targets,
      quarantinedSources:[...cbbRetainedNormalizationQuarantine(namedById.get(row.game.id)?.rejected??[]),...native.quarantinedSources,...read.receipt.anchors.quarantinedKeys?.map(source=>{
        const [book,market]=source.split(":");return {book,market:market as "moneyline"|"spread"|"total",reason:"retained_source_quarantine"};
      })??[]],historyCompleteness:read.receipt.historyCompleteness});
    board.marketContext.retainedLevelInput=checkpoint.checkpoint;
    retainedInputCounts[checkpoint.disposition]++;
    return [row.game.id,board] as const;
  }));
  const publishableGames=sourceGames.filter(game=>{
    const previous=prior.get(game.id);
    if(previous&&isOwnerApprovedCbbMemberExclusion(previous.memberGame)){
      ownerApprovedExclusions.push(game.id);return false;
    }
    if(previous?.snapshot.lockedAt)return true;
    const forecast=forecastById.get(game.id),candidate=boardCandidates.get(game.id)??previous?.snapshot.board;
    const evaluated=(forecast?forecast.inputStatus==="complete":!!previous)&&candidate?.rows.some(row=>
      row.grade!=="Held"&&row.price!==null&&Number.isFinite(row.price)&&row.probability!==null&&Number.isFinite(row.probability));
    if(!evaluated){unpublishedIncomplete.push(game.id);problems.push(`${game.id}:incomplete_evaluation_unpublished`);}
    return !!evaluated;
  });
  const previousReady=sourceGames.some(game=>{
    const previous=prior.get(game.id);
    return previous&&!previous.snapshot.lockedAt&&Date.parse(game.date)>Date.parse(asOf)&&
      previous.snapshot.board.rows.some(row=>row.grade!=="Held"&&row.price!==null&&row.probability!==null);
  });
  if(previousReady&&!publishableGames.some(game=>!prior.get(game.id)?.snapshot.lockedAt&&Date.parse(game.date)>Date.parse(asOf)))
    throw new Error("CBB current-evaluation coverage absent; preserving the prior published board");
  if(unpublishedIncomplete.length)providerWarnings.push(`CBB incomplete evaluations remain internal (${unpublishedIncomplete.join(",")})`);
  // Prepare actual candidate DTOs once, with the full board as identity context.
  // Reuse the reader's qualified captured-source rule before the sole write;
  // never make per-game provider/DB requests or append evidence to a lock.
  const preparedSections=new Map<number,CbbPreparedNamedSplitSections>();
  const preparedPublic=new Map<number,CbbPreparedPublicSplitSections>();
  if(capturedSplits||publicRows.length||draftKingsFeed){
    const previews=publishableGames.flatMap(game=>{
      const previous=prior.get(game.id),identity=scheduled.get(game.id),candidate=boardCandidates.get(game.id);
      if(previous?.snapshot.lockedAt||Date.parse(asOf)>=Date.parse(game.date)-60*60_000||!candidate||!identity)
        return previous?[previous.memberGame]:[];
      const snapshot=advanceCbbProvisionalSnapshot({existing:previous?.snapshot??null,candidate,startsAt:game.date,now:asOf});
      return [adaptCbbProvisionalGame({game,snapshot,homeLogo:identity.homeTeamLogo,awayLogo:identity.awayTeamLogo,now:asOf})];
    });
    const enriched=mergeCbbDraftKingsSplitEvidence(mergeCbbCapturedNamedSplitEvidence(mergeCbbReaderEvidence(cbbDailyEdgeResponse(args.anchorDate,previews,asOf),null,publicRows,Date.parse(asOf)),capturedSplits,
      applySharpApiCurrentSplitOverlay,Date.parse(asOf)),draftKingsFeed,applyDraftKingsNetworkSplitFallback,Date.parse(asOf));
    for(const game of enriched.games){
      const sections:CbbPreparedNamedSplitSections={};
      for(const key of ["moneyline","first_inning","total"] as const){const section=game.markets[key].sportsbookSplits;if(section)sections[key]=section;}
      preparedSections.set(game.external_id,sections);
      preparedPublic.set(game.external_id,Object.fromEntries(Object.entries(game.markets).filter(([,market])=>market.publicSplits.length===2).map(([key,market])=>[key,market.publicSplits])));
    }
  }
  let written=0,locked=0,held=0,missingLogos=0,trackingInserted=0;
  for(const game of publishableGames){
    const identity=scheduled.get(game.id);
    const previous=prior.get(game.id)??null;
    const seededStart=identity?Date.parse(identity.gameStartAt):NaN;
    const providerStart=Date.parse(game.date);
    if(!identity||!Number.isFinite(seededStart)||!Number.isFinite(providerStart)||seededStart!==providerStart||
      identity.homeTeamDisplayName!==game.home_team.full_name||
      identity.awayTeamDisplayName!==game.visitor_team.full_name){
      if(previous?.snapshot.lockedAt){
        memberGames.push(structuredClone(previous.memberGame));locked++;
        problems.push(`${game.id}:locked_provider_conflict_preserved`);continue;
      }
      problems.push(`${game.id}:seed_identity_missing_or_changed`);continue;
    }
    if(!identity.homeTeamLogo||!identity.awayTeamLogo)missingLogos++;
    const afterCutoff=Date.parse(asOf)>=Date.parse(game.date)-60*60_000;
    if(afterCutoff&&!previous){problems.push(`${game.id}:prelock_snapshot_missing`);continue;}
    let candidate=null,splitEvidence=null;
    if(!afterCutoff&&!previous?.snapshot.lockedAt){
      candidate=boardCandidates.get(game.id)!;
      splitEvidence=splitEvidenceById.get(game.id)!;
      if(splitEvidence.rows.length===0)problems.push(`${game.id}:verified_splits_unavailable:${splitEvidence.reason}`);
      if(candidate.rows.some(row=>row.grade==="Held"))held++;
    }
    const result=await writeCbbMemberGame({game,candidate,homeLogo:identity.homeTeamLogo,
      awayLogo:identity.awayTeamLogo,now:asOf,splitEvidence,marketQuotes:namedById.get(game.id)?.quotes??[],bookHistory,
      capturedNamedSections:preparedSections.get(game.id),capturedPublicSections:preparedPublic.get(game.id)},db);
    if(result.written)written++;
    if(result.record.snapshot.lockedAt)locked++;
    trackingInserted+=await writeLockedCbbTracking(result.record,db);
    memberGames.push(cbbMemberGameForReader(result.record,game));
  }
  if(problems.some(problem=>problem.includes("prelock_snapshot_missing")))throw new Error(`CBB board cannot publish after a missed lock: ${problems.join(",")}`);
  if(memberGames.length!==publishableGames.length)throw new Error(`CBB member board lost exact games: ${problems.join(",")}`);
  const response=cbbDailyEdgeResponse(args.anchorDate,memberGames,asOf);
  response.cbbScheduleCoverage={
    eligibleGameIds:[...byId.values()].filter(game=>dates.includes(computeSlateDate("cbb",game.date))&&
      (game.home_team.conference_id||game.visitor_team.conference_id)).map(game=>game.id),
    modelEligibleGameIds:publishableGames.map(game=>game.id),
  };
  const saved=await (args.saveSnapshot??upsertLabResponseSnapshot)({snapshotKey:dailyEdgeSnapshotKey({sport:"cbb",requestedDate:args.anchorDate,allowStale:false,copyPreview:false}),
    kind:"daily_edge",sport:"cbb",slateDate:args.anchorDate,payload:response,source:"cbb_prediction_pipeline",
    payloadVersion:CBB_MEMBER_PIPELINE_RELEASE,ttlMs:15*60_000,staleMs:24*60*60_000});
  if(!saved.ok)throw new Error(`CBB member snapshot publication failed: ${saved.error}`);
  return {release:CBB_MEMBER_PIPELINE_RELEASE,requestedDates:dates,sourceGames:sourceGames.length,published:memberGames.length,
    scheduleOnly:candidateGames.length-memberGames.length,missingIdentity,missingLogosOnSchedule,
    written,locked,held,missingLogos,trackingInserted,problems,unpublishedIncomplete,ownerApprovedExclusions,providerWarnings,
    canonicalHistory:{release:canonicalHistory.release,complete:canonicalHistory.complete,price:canonicalHistory.price,split:canonicalHistory.split,elapsedMs:canonicalHistory.elapsedMs},
    retainedInputCounts,
    providerCalls:provider.calls,owlsCalls:2};
}
