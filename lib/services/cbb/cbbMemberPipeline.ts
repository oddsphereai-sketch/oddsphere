import {fetchCbbTheOddsApiCurrent,type CbbTheOddsApiReceipt} from "./cbbTheOddsApiCurrent";
import {mergeCbbCurrentSourceQuotes} from "@/lib/cbb/currentSourceQuotes";
import type { supabase } from "@/lib/db/supabase";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import { CbbBallDontLieClient } from "@/lib/cbb/ballDontLie";
import { cbbCanonicalStatus } from "@/lib/cbb/canonicalFixture";
import { matchCbbProviderVenue as matchCbbVenue } from "@/lib/cbb/providerVenueIdentity";
import {cbbBehaviorFlows,cbbContextAtFixtureClock} from "./cbbMarketBehaviorInputs";
import {assembleCbbContextualReaderInput} from "./cbbContextualReaderInput";
import {loadCbbContextualOutcomeRuntime,readCbbContextualOutcomeEvidence,type CbbContextualOutcomeRuntime} from "./cbbContextualOutcomeRuntime";
import { forecastCbbCurrentBatch } from "@/lib/cbb/currentScoreRuntime";
import { normalizeCbbOwlsCurrent } from "@/lib/cbb/owlsMarketEvidence";
import { cbbCurrentSplitEvidence } from "@/lib/cbb/owlsSplitEvidence";
import { chooseCbbSupportedTargetBook } from "@/lib/cbb/provisionalBoard";
import {cbbCurrentProviderQuotes} from "@/lib/cbb/currentProviderQuotes";
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
import { applySharpApiCurrentSplitOverlay,currentSplitReadDates } from "@/lib/providers/real_api/sharpApiCurrentSplits";
import { advanceCbbProvisionalSnapshot,CbbFixtureClockError } from "@/lib/cbb/provisionalLifecycle";
import { isOwnerApprovedCbbMemberExclusion } from "@/lib/cbb/memberBoardScope";
import {readCbbCanonicalReaderHistory} from "./cbbCanonicalReaderHistory";
import {pairCbbCanonicalMarketEvidence} from "./cbbCanonicalMarketEvidence";
import {cbbDecisionSplitContext} from "@/lib/cbb/decisionSplitContext";
import {CBB_FULL_D1_COVERAGE_START} from "@/lib/cbb/crossDivisionPrior";
import type {CrossDivisionGame} from "@/lib/cbb/crossDivisionPrior";
import {cbbDivisionOneFixture} from "@/lib/cbb/divisionOneMembership";
import {cbbCrossDivisionContext} from "@/lib/cbb/crossDivisionIdentity";
import {forecastCbbFullDivisionOneBatch} from "@/lib/cbb/fullDivisionOneForecast";
import {buildCbbGameForecastBoard} from "@/lib/cbb/gameForecastBoard";
import type {CbbProvisionalBoard} from "@/lib/cbb/provisionalLifecycle";

export const CBB_MEMBER_PIPELINE_RELEASE="cbb_member_pipeline_2026_11_06_r54_verified_school_identity" as const;
/** Book/contract choice only. No prior projection, probability or grade runs. */
export function selectCbbContextualPipelineTargets(quotes:CbbQuote[]):CbbQuote[]{
  const boardBook=chooseCbbSupportedTargetBook(quotes);
  return (["moneyline","spread","total"] as const).flatMap(market=>{
    const book=quotes.some(q=>q.sportsbook===boardBook&&q.market===market)?boardBook:chooseCbbSupportedTargetBook(quotes.filter(q=>q.market===market));
    const target=quotes.find(q=>q.sportsbook===book&&q.market===market);return target?[target]:[];
  });
}
const dateWindow=(anchor:string)=>Array.from({length:7},(_,i)=>addDaysToSlate(anchor,i));
const expandedFixture=(game:CbbGame)=>computeSlateDate("cbb",game.date)>=CBB_FULL_D1_COVERAGE_START;
const eligibleFixture=(game:CbbGame)=>expandedFixture(game)?cbbDivisionOneFixture(game).eligible:
  !!(game.home_team.conference_id||game.visitor_team.conference_id);

/** The sole leased writer publishes the same exact locked/unlocked tuples the
 * member page reads. No request-time model or market recomputation. */
export async function refreshCbbMemberBoard(args:{anchorDate:string;season:number;now?:string;bdlKey:string;owlsKey:string;theOddsApiKey?:string;
  theOddsApiReader?:typeof fetchCbbTheOddsApiCurrent;
  loadContextualRuntime?:()=>Promise<Pick<CbbContextualOutcomeRuntime,"evaluate">>;
  trainingGames:CbbTrainingGame[];crossTrainingGames?:CrossDivisionGame[];nowClock?:()=>string;db?:typeof supabase;provider?:CbbBallDontLieClient;owls?:OwlsInsightClient;
  fetcher?:typeof fetch;loadSchedule?:typeof loadCbbRollingSchedule;canonicalHistoryReader?:typeof readCbbCanonicalReaderHistory;
  fallbackOdds?:CbbOdds[];saveSnapshot?:typeof upsertLabResponseSnapshot;syncFixtures?:(games:CbbGame[])=>Promise<unknown>}){
  const started=Date.now();
  const trace=(stage:string)=>console.info(`[cbb-member-pipeline] release=${CBB_MEMBER_PIPELINE_RELEASE} stage=${stage} elapsed_ms=${Date.now()-started}`);
  trace("start");
  const db=args.db??(await import("@/lib/db/supabase")).supabase;
  const provider=args.provider??new CbbBallDontLieClient(args.bdlKey,{maxRequests:160});
  const owls=args.owls??new OwlsInsightClient(args.owlsKey,{timeoutMs:8_000});
  // Provider date filters use UTC. Include the following UTC day so late ET
  // tips on the seventh slate are captured before the exact ET filter below.
  const dates=dateWindow(args.anchorDate),providerDates=[addDaysToSlate(args.anchorDate,-1),...dates,addDaysToSlate(dates.at(-1)!,1)];
  const nowClock=args.nowClock??(()=>args.now??new Date().toISOString());
  const oddsRequestedAt=nowClock();
  const [a,b,initialSchedule,oddsReceipt,splitsReceipt]=await Promise.all([
    provider.gamesForDates(providerDates.slice(0,7),args.season),
    provider.gamesForDates(providerDates.slice(7),args.season),
    (args.loadSchedule??loadCbbRollingSchedule)(args.anchorDate),
    owls.odds<RawOwlsOddsResponse>("ncaab").then(response=>({response,fetchedAt:nowClock(),error:null as string|null}))
      .catch(()=>({response:{body:{success:false,data:[] as NonNullable<RawOwlsOddsResponse["data"]>}},fetchedAt:nowClock(),error:"Owls current odds request failed"})),
    owls.splits<RawOwlsSplitsResponse>("ncaab").then(response=>({response,fetchedAt:nowClock(),error:null as string|null}))
      .catch(()=>({response:{body:{success:false,data:[] as NonNullable<RawOwlsSplitsResponse["data"]>}},fetchedAt:nowClock(),error:"Owls current splits request failed"})),
  ]);
  trace("provider_capture_complete");
  const odds=oddsReceipt.response,splits=splitsReceipt.response;
  const oddsUnavailable=odds.body.success!==true||!odds.body.data;
  if(oddsUnavailable&&!oddsReceipt.error)oddsReceipt.error="Owls current odds response unavailable";
  // Capture time is taken after the remote response; never predate a quote
  // verification just because the cron began several seconds earlier.
  let asOf=nowClock();
  const byId=new Map<number,CbbGame>();
  for(const game of [...a,...b]){
    if(byId.has(game.id)&&JSON.stringify(byId.get(game.id))!==JSON.stringify(game))throw new Error("CBB provider duplicate game conflict");
    byId.set(game.id,game);
  }
  const games=[...byId.values()].filter(game=>dates.includes(computeSlateDate("cbb",game.date))&&
    eligibleFixture(game)).sort((x,y)=>x.date.localeCompare(y.date)||x.id-y.id);
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
  }).map(game=>{
    const canonical=scheduled.get(game.id);
    if(!expandedFixture(game)||!canonical||Date.parse(canonical.gameStartAt)!==Date.parse(game.date)||
      canonical.homeTeamDisplayName!==game.home_team.full_name||canonical.awayTeamDisplayName!==game.visitor_team.full_name)return game;
    return {...game,home_team:game.home_team.abbreviation?.trim()?game.home_team:{...game.home_team,abbreviation:canonical.homeTeam},
      visitor_team:game.visitor_team.abbreviation?.trim()?game.visitor_team:{...game.visitor_team,abbreviation:canonical.awayTeam}};
  });
  trace("fixture_sync_complete");
  const prior=await readCbbMemberGames(candidateGames.map(game=>game.id),db);
  trace("prior_members_read");
  const namedById=new Map<number,{quotes:CbbQuote[];rejected:ReturnType<typeof normalizeCbbOwlsCurrent>["rejected"]}>(candidateGames.filter(game=>Date.parse(game.date)>Date.parse(asOf))
    .map(game=>{
      const evidence=normalizeCbbOwlsCurrent(game,odds.body,oddsReceipt.fetchedAt,asOf);
      evidence.quotes=evidence.quotes.map(quote=>({...quote,requestedAt:oddsRequestedAt}));
      return [game.id,evidence] as const;
    }));
  const providerWarnings:string[]=[oddsReceipt.error,splitsReceipt.error].filter((e):e is string=>e!==null);
  const [bookHistory,capturedSplits,draftKingsFeed]=await Promise.all([
    readCbbCapturedMarketHistory(db).catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB captured history unavailable");return null;}),
    readCbbCapturedNamedSplits(db,currentSplitReadDates(args.anchorDate,candidateGames.map(game=>game.date))).catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB captured splits unavailable");return null;}),
    readStoredDraftKingsNetworkSplits("cbb",db).catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB stored DraftKings splits unavailable");return null;}),
  ]);
  const sourceCovered=(quotes:CbbQuote[])=>["moneyline","spread","total"].every(market=>quotes.some(q=>q.market===market)&&
    quotes.some(q=>q.market===market&&["pinnacle","ps3838","circa","bookmaker"].includes(q.sportsbook)));
  const needsFallback=candidateGames.filter(game=>!prior.get(game.id)?.snapshot.lockedAt&&Date.parse(game.date)>Date.parse(asOf)&&
    !sourceCovered(namedById.get(game.id)?.quotes??[]));
  if(needsFallback.length){
    try{
      const quoteDates=[...new Set(needsFallback.map(game=>game.date.slice(0,10)))];
      const bdlRequestedAt=args.fallbackOdds===undefined&&typeof provider.odds==="function"?nowClock():undefined;
      const rows=args.fallbackOdds??(typeof provider.odds==="function"?await provider.odds(quoteDates,"current"):[]);
      asOf=nowClock();
      for(const game of candidateGames.filter(game=>Date.parse(game.date)>Date.parse(asOf)&&!prior.get(game.id)?.snapshot.lockedAt)){
        const primary=namedById.get(game.id)!;
        // Retain every complete transport pair until the one final three-source
        // merge. A preliminary conflict must not be erased and revived later.
        primary.quotes.push(...cbbCurrentProviderQuotes(rows,game,asOf,bdlRequestedAt));
      }
    }catch(error){providerWarnings.push(`BDL odds gap fill unavailable: ${error instanceof Error?error.message:"source failure"}`);}
  }
  // All transports feed the same canonical book/market resolver and sole
  // leased writer. A retail quote cannot hide a missing professional source.
  const sourceScope=candidateGames.filter(game=>!prior.get(game.id)?.snapshot.lockedAt&&Date.parse(game.date)>Date.parse(asOf));
  const sourceGaps=sourceScope.filter(game=>{
    const preview=mergeCbbCurrentSourceQuotes(namedById.get(game.id)?.quotes??[],game.id,asOf);
    return !sourceCovered(preview.quotes);
  });
  let theOddsApi:CbbTheOddsApiReceipt|null=null,theOddsApiRequests=0,theOddsApiPaidAttempts=0;
  if(sourceGaps.length&&args.theOddsApiKey?.trim()){
    try{
      // One board read includes all open fixtures in the requested window, so a
      // new source can update an existing book as well as fill an empty market.
      theOddsApi=await (args.theOddsApiReader??fetchCbbTheOddsApiCurrent)({apiKey:args.theOddsApiKey,games:sourceScope,now:nowClock,
        onRequest:kind=>{theOddsApiRequests++;if(kind==="current")theOddsApiPaidAttempts++;}});
      asOf=nowClock();
      if(theOddsApi.status!=="read")providerWarnings.push(`The Odds API CBB source: ${theOddsApi.status}`);
    }catch{providerWarnings.push("The Odds API CBB current source failed; other qualified providers retained");}
  }
  const sourceCoverage={release:"cbb_current_source_coverage_2026_11_05_r1_three_provider_join",theOddsApiConfigured:!!args.theOddsApiKey?.trim(),
    requestedGames:sourceScope.length,gapGames:sourceGaps.length,theOddsApiStatus:theOddsApi?.status??(sourceGaps.length?args.theOddsApiKey?.trim()?"read_failed":"missing_key":"not_needed"),
    theOddsApiRequests,theOddsApiPaidAttempts,theOddsApiCreditsUsed:theOddsApi?.creditsUsed??null,
    theOddsApiCreditsRemaining:theOddsApi?.creditsRemaining??null,eventsReturned:theOddsApi?.eventsReturned??0,theOddsApiRejections:theOddsApi?.rejections??[],theOddsApiUnmatchedEvents:theOddsApi?.unmatchedEvents??[],theOddsApiUnmatchedEventCount:theOddsApi?.unmatchedEventCount??0,
    quotesByProvider:{} as Record<string,number>,unpricedGameIds:[] as number[],quarantined:0,duplicates:0};
  const extraById=new Map<number,CbbQuote[]>();
  for(const quote of theOddsApi?.quotes??[])extraById.set(quote.gameId,[...(extraById.get(quote.gameId)??[]),quote]);
  for(const game of sourceScope){
    const evidence=namedById.get(game.id)!;
    const joined=mergeCbbCurrentSourceQuotes([...evidence.quotes,...extraById.get(game.id)??[]],game.id,asOf);
    evidence.quotes=joined.quotes;
    evidence.rejected.push(...joined.quarantined,...(theOddsApi?.rejections??[]).filter(r=>r.gameId===game.id).map(({gameId,...reason})=>{void gameId;return reason;}));
    sourceCoverage.quarantined+=joined.quarantined.length;sourceCoverage.duplicates+=joined.duplicates;
    for(const quote of evidence.quotes){const origin=quote.provider??"unknown";sourceCoverage.quotesByProvider[origin]=(sourceCoverage.quotesByProvider[origin]??0)+1;}
    if(!evidence.quotes.length)sourceCoverage.unpricedGameIds.push(game.id);
  }
  trace("current_quotes_complete");
  const unsupportedCrossGameIds:number[]=[];
  const sourceGames=candidateGames.filter(game=>{
    const existing=prior.get(game.id),identity=scheduled.get(game.id);
    if(existing?.snapshot.lockedAt)return true;
    // Owner withdrew unsupported cross-domain priors from the public board.
    // Keep collecting real markets, but do not replace a missing statistical
    // input with a generic 99.9% winner or manufacture a market-only score law.
    if(expandedFixture(game)&&cbbDivisionOneFixture(game).crossDivision){unsupportedCrossGameIds.push(game.id);return false;}
    if(expandedFixture(game)&&!existing&&Date.parse(asOf)>=Date.parse(game.date)-60*60_000)return false;
    return !!identity&&
      (existing!==undefined||expandedFixture(game)||chooseCbbSupportedTargetBook(namedById.get(game.id)?.quotes??[])!==null);
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
  trace("official_and_canonical_evidence_complete");
  const dayEvents=new Map(eventRows);
  if(forecastGames.some(expandedFixture))asOf=nowClock();
  if(!canonicalHistory.complete)providerWarnings.push(`CBB canonical reader history incomplete: price=${canonicalHistory.price.reason}; split=${canonicalHistory.split.reason}`);
  // Partition once. No selected-card request, additional collector or writer.
  // An incomplete family is retained only in telemetry, never presented as a
  // complete historical episode to the model.
  const priceById=new Map<number,typeof canonicalHistory.priceRows>();
  const splitById=new Map<number,typeof canonicalHistory.splitRows>();
  if(canonicalHistory.price.complete)for(const item of canonicalHistory.priceRows){const id=Number(item.canonical_event_id);const rows=priceById.get(id)??[];rows.push(item);priceById.set(id,rows);}
  for(const item of canonicalHistory.retailObservedRows??canonicalHistory.retailPriceRows??[]){const id=Number(item.canonical_event_id);const rows=priceById.get(id)??[];rows.push(item);priceById.set(id,rows);}
  if(canonicalHistory.split.complete)for(const item of canonicalHistory.splitRows){const id=Number(item.canonical_event_id);const rows=splitById.get(id)??[];rows.push(item);splitById.set(id,rows);}
  const canonicalEvidenceById=new Map(forecastGames.map(game=>[game.id,pairCbbCanonicalMarketEvidence({game,decisionAt:asOf,
    priceRows:priceById.get(game.id),splitRows:splitById.get(game.id),consumerPriceContext:true})]));
  const legacyGames=forecastGames.filter(game=>!expandedFixture(game));
  const forecasts:Array<ReturnType<typeof forecastCbbCurrentBatch>[number]&{
    coverage?:ReturnType<typeof forecastCbbFullDivisionOneBatch>[number]["coverage"]}>=forecastCbbCurrentBatch(legacyGames.map(game=>{
    const evidence=dayEvents.get(computeSlateDate("cbb",game.date));
    const venue=evidence?matchCbbVenue(game,evidence.events,evidence.fetchedAt):null;
    return {id:game.id,date:game.date,season:game.season,homeId:game.home_team.id,
      awayId:game.visitor_team.id,neutral:venue?.timeConfirmed?venue.neutral:null};
  }),asOf,args.trainingGames);
  const expandedReady=forecastGames.filter(game=>{
    if(!expandedFixture(game)||Date.parse(asOf)>=Date.parse(game.date)-60*60_000)return false;
    if(!cbbDivisionOneFixture(game).crossDivision)return true;
    const evidence=dayEvents.get(computeSlateDate("cbb",game.date));
    return !!evidence&&!!cbbCrossDivisionContext(game,evidence.events,evidence.fetchedAt);
  });
  if(expandedReady.length)forecasts.push(...forecastCbbFullDivisionOneBatch(expandedReady,asOf,args.trainingGames,dayEvents,args.crossTrainingGames));
  trace("independent_forecasts_complete");
  const forecastById=new Map(forecasts.map(row=>[row.game.id,row.forecast]));
  const memberGames:DailyEdgeGameDto[]=[],problems:string[]=[],unpublishedIncomplete:number[]=[],ownerApprovedExclusions:number[]=[];
  const splitEvidenceById=new Map(forecastGames.map(game=>[game.id,cbbCurrentSplitEvidence(game,odds.body,splits.body,splitsReceipt.fetchedAt,asOf)]));
  const publicRows=await readCbbCapturedPublicSplits(db,forecastGames.map(game=>game.id),Date.parse(asOf))
    .catch(error=>{providerWarnings.push(error instanceof Error?error.message:"CBB captured public splits unavailable");return [];});
  const decisionSplitsById=new Map(forecastGames.map(game=>[game.id,cbbDecisionSplitContext({game,allGames:candidateGames,asOf,
    direct:splitEvidenceById.get(game.id)!,canonical:canonicalEvidenceById.get(game.id)!.splitPairs,
    publicRows,draftKings:draftKingsFeed})]));
  trace("decision_split_context_complete");
  // R38's source-outage LKG policy remains authoritative. It does not stamp
  // an old score as the new release or silently invoke an alternate reader.
  const preservedQuoteOutages=forecasts.filter(row=>oddsUnavailable&&!(namedById.get(row.game.id)?.quotes.length)&&
    prior.get(row.game.id)?.snapshot.board.rows.some(market=>market.price!==null)).map(row=>row.game.id);
  if(preservedQuoteOutages.length)providerWarnings.push(`CBB source outage preserved prior priced forecasts (${preservedQuoteOutages.join(",")})`);
  const completeForecasts=forecasts.filter(row=>row.forecast.inputStatus==="complete"&&!preservedQuoteOutages.includes(row.game.id));
  const contextualRows=completeForecasts.filter(row=>row.coverage?.kind!=="cross_division"&&row.coverage?.kind!=="d1_newcomer");
  // One checked private artifact per eligible batch, never a per-game provider
  // or database request. Load/evaluation failure precedes every member write.
  const contextualRuntime=contextualRows.length?await(args.loadContextualRuntime??loadCbbContextualOutcomeRuntime)():null;
  trace("contextual_runtime_ready");
  const contextualInputCounts={evaluated:0,continued:0,migrated:0,unpriced:0,noWagerDomain:0};
  const boardCandidates=new Map<number,CbbProvisionalBoard>(completeForecasts.map(row=>{
    const quotes=namedById.get(row.game.id)?.quotes??[],previous=cbbContextAtFixtureClock(prior.get(row.game.id)?.snapshot??null,row.game.date);
    // These original score domains remain forecast-only. Empty targets avoid
    // even discarded old price/probability/grade calculations; raw observations
    // still reach the existing member evidence publication below.
    if(row.coverage?.kind==="cross_division"||row.coverage?.kind==="d1_newcomer"){
      contextualInputCounts.noWagerDomain++;
      return[row.game.id,buildCbbGameForecastBoard(row.forecast,row.coverage,[])] as const;
    }
    if(!contextualRuntime)throw Error("CBB contextual runtime missing for complete incumbent");
    const retained=previous?readCbbContextualOutcomeEvidence(previous.board):null;
    const legacy=previous?.board.marketContext.verifiedMarketRead;
    const anchors=legacy?.anchors;
    if(anchors&&(anchors.gameId!==row.game.id||!Number.isFinite(Date.parse(anchors.startsAt))||Date.parse(anchors.startsAt)!==Date.parse(row.game.date)))throw Error("CBB legacy price anchor fixture mismatch");
    const assembled=assembleCbbContextualReaderInput({independent:row.forecast,startsAt:row.game.date,currentQuotes:quotes,
      canonical:canonicalEvidenceById.get(row.game.id)!,splitContext:decisionSplitsById.get(row.game.id)??[],
      currentSourceProblems:(namedById.get(row.game.id)?.rejected??[]).flatMap(problem=>problem.book&&problem.market?
        [{book:problem.book,market:problem.market,reason:problem.reason,sourceAt:problem.sourceAt}]:[]),
      flows:cbbBehaviorFlows(splitEvidenceById.get(row.game.id)!),previousInput:retained?.input??null,
      previousPath:retained?.input.pathTape??legacy?.pathTape,
      legacyAnchorQuotes:anchors?.quotes.map(q=>({...q,anchorCapturedAt:q.anchorCapturedAt??anchors.capturedAt})),
      historyComplete:{price:canonicalHistory.price.complete,split:canonicalHistory.split.complete,consumer:canonicalHistory.retailPrice?.complete??false}});
    const targets=selectCbbContextualPipelineTargets(quotes);
    const board=contextualRuntime.evaluate({input:assembled.input,independent:row.forecast,targets,coverage:assembled.coverage});
    contextualInputCounts.evaluated++;if(retained)contextualInputCounts.continued++;else if(legacy)contextualInputCounts.migrated++;
    if(!targets.length)contextualInputCounts.unpriced++;
    return[row.game.id,board] as const;
  }));
  const publishableGames=sourceGames.filter(game=>{
    const previous=prior.get(game.id);
    if(previous&&isOwnerApprovedCbbMemberExclusion(previous.memberGame)){
      ownerApprovedExclusions.push(game.id);return false;
    }
    if(previous?.snapshot.lockedAt)return true;
    if(expandedFixture(game)&&!previous&&Date.parse(asOf)>=Date.parse(game.date)-60*60_000){
      unpublishedIncomplete.push(game.id);problems.push(`${game.id}:no_new_forecast_after_cutoff`);return false;
    }
    const forecast=forecastById.get(game.id),candidate=boardCandidates.get(game.id)??previous?.snapshot.board;
    const evaluated=(forecast?.inputStatus==="complete"||!!previous&&candidate===previous.snapshot.board)&&
      (expandedFixture(game)&&!!candidate?.gameForecast||candidate?.rows.some(row=>
      row.grade!=="Held"&&row.price!==null&&Number.isFinite(row.price)&&row.probability!==null&&Number.isFinite(row.probability)));
    if(!evaluated){unpublishedIncomplete.push(game.id);problems.push(`${game.id}:incomplete_evaluation_unpublished`);}
    return !!evaluated;
  });
  trace("market_forecasts_complete");
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
  trace("member_evidence_prepared");
  let written=0,locked=0,held=0,missingLogos=0,trackingInserted=0;
  for(const game of publishableGames){
    // Computation may cross T-60. Keep the data/forecast cutoff exact, but
    // eligibility and freezing must use the actual clock at this game's write.
    const writeNow=nowClock(),writeAt=Date.parse(writeNow),dataAt=Date.parse(asOf);
    if(!Number.isFinite(writeAt)||!Number.isFinite(dataAt)||writeAt<dataAt)throw Error("CBB write clock invalid or before data cutoff");
    const identity=scheduled.get(game.id);
    const previous=prior.get(game.id)??null;
    if(previous?.snapshot.lockedAt&&Date.parse(previous.snapshot.startsAt)!==Date.parse(game.date)){
      memberGames.push(structuredClone(previous.memberGame));locked++;
      problems.push(`${game.id}:locked_fixture_clock_change_preserved`);continue;
    }
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
    const afterCutoff=writeAt>=Date.parse(game.date)-60*60_000;
    if(afterCutoff&&!previous){problems.push(`${game.id}:prelock_snapshot_missing`);continue;}
    if(!afterCutoff&&previous&&!boardCandidates.has(game.id)){
      problems.push(`${game.id}:incomplete_refresh_preserved_prior_forecast`);
      memberGames.push(structuredClone(previous.memberGame));continue;
    }
    let candidate=null,splitEvidence=null;
    if(!afterCutoff&&!previous?.snapshot.lockedAt){
      candidate=boardCandidates.get(game.id)!;
      splitEvidence=splitEvidenceById.get(game.id)!;
      if(splitEvidence.rows.length===0)problems.push(`${game.id}:verified_splits_unavailable:${splitEvidence.reason}`);
      if(candidate.rows.some(row=>row.grade==="Held"))held++;
    }
    let result;
    try{result=await writeCbbMemberGame({game,candidate,homeLogo:identity.homeTeamLogo,
      awayLogo:identity.awayTeamLogo,now:writeNow,splitEvidence,marketQuotes:namedById.get(game.id)?.quotes??[],bookHistory,
      capturedNamedSections:preparedSections.get(game.id),capturedPublicSections:preparedPublic.get(game.id)},db);
    }catch(error){
      if(!(error instanceof CbbFixtureClockError)||!previous)throw error;
      problems.push(`${game.id}:fixture_clock_correction_requires_prelock_evidence`);
      memberGames.push(structuredClone(previous.memberGame));continue;
    }
    if(result.written)written++;
    if(written>0&&written%25===0)trace(`member_writes_${written}`);
    if(result.record.snapshot.lockedAt)locked++;
    trackingInserted+=await writeLockedCbbTracking(result.record,db);
    memberGames.push(cbbMemberGameForReader(result.record,game));
  }
  if(problems.some(problem=>problem.includes("prelock_snapshot_missing")))throw new Error(`CBB board cannot publish after a missed lock: ${problems.join(",")}`);
  if(memberGames.length!==publishableGames.length)throw new Error(`CBB member board lost exact games: ${problems.join(",")}`);
  const response=cbbDailyEdgeResponse(args.anchorDate,memberGames,asOf);
  const publishedIds=new Set(memberGames.map(game=>game.external_id));
  response.cbbScheduleCoverage={
    eligibleGameIds:[...byId.values()].filter(game=>dates.includes(computeSlateDate("cbb",game.date))&&
      eligibleFixture(game)&&(!expandedFixture(game)||publishedIds.has(game.id))).map(game=>game.id),
    modelEligibleGameIds:publishableGames.map(game=>game.id),
  };
  const saved=await (args.saveSnapshot??upsertLabResponseSnapshot)({snapshotKey:dailyEdgeSnapshotKey({sport:"cbb",requestedDate:args.anchorDate,allowStale:false,copyPreview:false}),
    kind:"daily_edge",sport:"cbb",slateDate:args.anchorDate,payload:response,source:"cbb_prediction_pipeline",
    payloadVersion:CBB_MEMBER_PIPELINE_RELEASE,ttlMs:15*60_000,staleMs:24*60*60_000});
  if(!saved.ok)throw new Error(`CBB member snapshot publication failed: ${saved.error}`);
  trace("snapshot_published");
  return {release:CBB_MEMBER_PIPELINE_RELEASE,unsupportedCrossGameIds,currentSourceCoverage:sourceCoverage,requestedDates:dates,sourceGames:sourceGames.length,published:memberGames.length,
    scheduleOnly:candidateGames.length-memberGames.length,missingIdentity,missingLogosOnSchedule,
    written,locked,held,missingLogos,trackingInserted,problems,unpublishedIncomplete,ownerApprovedExclusions,providerWarnings,
    canonicalHistory:{release:canonicalHistory.release,complete:canonicalHistory.complete,price:canonicalHistory.price,split:canonicalHistory.split,elapsedMs:canonicalHistory.elapsedMs},
    contextualInputCounts,
    providerCalls:provider.calls,owlsCalls:2};
}
