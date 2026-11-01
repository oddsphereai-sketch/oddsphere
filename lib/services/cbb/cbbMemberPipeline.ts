import type { supabase } from "@/lib/db/supabase";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import { CbbBallDontLieClient } from "@/lib/cbb/ballDontLie";
import { cbbCanonicalStatus } from "@/lib/cbb/canonicalFixture";
import { matchCbbVenue } from "@/lib/cbb/dataset";
import { forecastCbbCandidateR2Batch } from "@/lib/cbb/candidateR2Runtime";
import { normalizeCbbOwlsCurrent } from "@/lib/cbb/owlsMarketEvidence";
import { cbbCurrentSplitEvidence } from "@/lib/cbb/owlsSplitEvidence";
import { buildCbbProvisionalBoard } from "@/lib/cbb/provisionalBoard";
import { chooseCbbCompleteTargetBook } from "@/lib/cbb/totalOnlyMarketResearch";
import type { CbbGame, CbbTrainingGame } from "@/lib/cbb/types";
import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import type { RawOwlsOddsResponse } from "@/lib/providers/owls/owlsSharpBookOdds";
import type { RawOwlsSplitsResponse } from "@/lib/providers/owls/owlsSharpBookSplits";
import { addDaysToSlate, computeSlateDate } from "@/lib/dates/slateDate";
import { cbbDailyEdgeResponse } from "./adaptCbbProvisionalToDailyEdge";
import { cbbMemberGameForReader, readCbbMemberGames, writeCbbMemberGame } from "./cbbMemberGameStore";
import { fetchCbbDayEvents } from "./fetchCbbDayEvents";
import { loadCbbRollingSchedule } from "./cbbRollingSchedule";
import { dailyEdgeSnapshotKey, upsertLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";
import { writeLockedCbbTracking } from "./cbbTrackingWriter";

export const CBB_MEMBER_PIPELINE_RELEASE="cbb_member_pipeline_2026_11_01_r5_locked_refresh_continuity" as const;
const dateWindow=(anchor:string)=>Array.from({length:7},(_,i)=>addDaysToSlate(anchor,i));

/** The sole leased writer publishes the same exact locked/unlocked tuples the
 * member page reads. No request-time model or market recomputation. */
export async function refreshCbbMemberBoard(args:{anchorDate:string;season:number;now?:string;bdlKey:string;owlsKey:string;
  trainingGames:CbbTrainingGame[];db?:typeof supabase;provider?:CbbBallDontLieClient;owls?:OwlsInsightClient;
  fetcher?:typeof fetch;loadSchedule?:typeof loadCbbRollingSchedule;
  saveSnapshot?:typeof upsertLabResponseSnapshot;syncFixtures?:(games:CbbGame[])=>Promise<unknown>}){
  const db=args.db??(await import("@/lib/db/supabase")).supabase;
  const provider=args.provider??new CbbBallDontLieClient(args.bdlKey,{maxRequests:160});
  const owls=args.owls??new OwlsInsightClient(args.owlsKey,{timeoutMs:8_000});
  const dates=dateWindow(args.anchorDate),providerDates=[addDaysToSlate(args.anchorDate,-1),...dates];
  const [a,b,initialSchedule,odds,splits]=await Promise.all([
    provider.gamesForDates(providerDates.slice(0,7),args.season),
    provider.gamesForDates(providerDates.slice(7),args.season),
    (args.loadSchedule??loadCbbRollingSchedule)(args.anchorDate),
    owls.odds<RawOwlsOddsResponse>("ncaab"),
    owls.splits<RawOwlsSplitsResponse>("ncaab"),
  ]);
  if(odds.body.success!==true||!odds.body.data)throw new Error("CBB named sportsbook feed unavailable");
  // Capture time is taken after the remote response; never predate a quote
  // verification just because the cron began several seconds earlier.
  const asOf=args.now??new Date().toISOString();
  const byId=new Map<number,CbbGame>();
  for(const game of [...a,...b]){
    if(byId.has(game.id)&&JSON.stringify(byId.get(game.id))!==JSON.stringify(game))throw new Error("CBB provider duplicate game conflict");
    byId.set(game.id,game);
  }
  const games=[...byId.values()].filter(game=>dates.includes(computeSlateDate("cbb",game.date))&&
    game.home_team.conference_id&&game.visitor_team.conference_id).sort((x,y)=>x.date.localeCompare(y.date)||x.id-y.id);
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
  const namedById=new Map(candidateGames.filter(game=>Date.parse(game.date)>Date.parse(asOf))
    .map(game=>[game.id,normalizeCbbOwlsCurrent(game,odds.body,asOf,asOf)] as const));
  const sourceGames=candidateGames.filter(game=>{
    const existing=prior.get(game.id),identity=scheduled.get(game.id);
    if(existing?.snapshot.lockedAt)return true;
    return !!identity?.homeTeamLogo&&!!identity.awayTeamLogo&&
      (existing!==undefined||chooseCbbCompleteTargetBook(namedById.get(game.id)?.quotes??[])!==null);
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
  const dayEvents=new Map(await Promise.all(contextDays.map(async date=>[date,await fetchCbbDayEvents(date,args.fetcher)] as const)));
  const forecasts=forecastCbbCandidateR2Batch(forecastGames.map(game=>{
    const evidence=dayEvents.get(computeSlateDate("cbb",game.date));
    const venue=evidence?matchCbbVenue(game,evidence.events,evidence.fetchedAt):null;
    return {id:game.id,date:game.date,season:game.season,homeId:game.home_team.id,
      awayId:game.visitor_team.id,neutral:venue?.timeConfirmed?venue.neutral:null};
  }),asOf,args.trainingGames);
  const forecastById=new Map(forecasts.map(row=>[row.game.id,row.forecast]));
  const memberGames:DailyEdgeGameDto[]=[],problems:string[]=[];
  let written=0,locked=0,held=0,missingLogos=0,trackingInserted=0;
  for(const game of sourceGames){
    const identity=scheduled.get(game.id);
    const seededStart=identity?Date.parse(identity.gameStartAt):NaN;
    const providerStart=Date.parse(game.date);
    if(!identity||!Number.isFinite(seededStart)||!Number.isFinite(providerStart)||seededStart!==providerStart||
      identity.homeTeamDisplayName!==game.home_team.full_name||
      identity.awayTeamDisplayName!==game.visitor_team.full_name){problems.push(`${game.id}:seed_identity_missing_or_changed`);continue;}
    if(!identity.homeTeamLogo||!identity.awayTeamLogo)missingLogos++;
    const previous=prior.get(game.id)??null;
    const afterCutoff=Date.parse(asOf)>=Date.parse(game.date)-60*60_000;
    if(afterCutoff&&!previous){problems.push(`${game.id}:prelock_snapshot_missing`);continue;}
    let candidate=null,splitEvidence=null;
    if(!afterCutoff&&!previous?.snapshot.lockedAt){
      const forecast=forecastById.get(game.id)!;
      candidate=buildCbbProvisionalBoard(forecast,namedById.get(game.id)?.quotes??[]);
      splitEvidence=cbbCurrentSplitEvidence(game,odds.body,splits.body,asOf,asOf);
      if(splitEvidence.rows.length===0)problems.push(`${game.id}:verified_splits_unavailable:${splitEvidence.reason}`);
      if(candidate.rows.some(row=>row.grade==="Held"))held++;
    }
    const result=await writeCbbMemberGame({game,candidate,homeLogo:identity.homeTeamLogo,
      awayLogo:identity.awayTeamLogo,now:asOf,splitEvidence,marketQuotes:namedById.get(game.id)?.quotes??[]},db);
    if(result.written)written++;
    if(result.record.snapshot.lockedAt)locked++;
    trackingInserted+=await writeLockedCbbTracking(result.record,db);
    memberGames.push(cbbMemberGameForReader(result.record,game));
  }
  if(problems.some(problem=>problem.includes("prelock_snapshot_missing")))throw new Error(`CBB board cannot publish after a missed lock: ${problems.join(",")}`);
  if(memberGames.length!==sourceGames.length)throw new Error(`CBB member board lost exact games: ${problems.join(",")}`);
  const response=cbbDailyEdgeResponse(args.anchorDate,memberGames,asOf);
  const saved=await (args.saveSnapshot??upsertLabResponseSnapshot)({snapshotKey:dailyEdgeSnapshotKey({sport:"cbb",requestedDate:args.anchorDate,allowStale:false,copyPreview:false}),
    kind:"daily_edge",sport:"cbb",slateDate:args.anchorDate,payload:response,source:"cbb_prediction_pipeline",
    payloadVersion:CBB_MEMBER_PIPELINE_RELEASE,ttlMs:15*60_000,staleMs:24*60*60_000});
  if(!saved.ok)throw new Error(`CBB member snapshot publication failed: ${saved.error}`);
  return {release:CBB_MEMBER_PIPELINE_RELEASE,requestedDates:dates,sourceGames:sourceGames.length,published:memberGames.length,
    scheduleOnly:candidateGames.length-memberGames.length,missingIdentity,missingLogosOnSchedule,
    written,locked,held,missingLogos,trackingInserted,problems,providerCalls:provider.calls,owlsCalls:2};
}
