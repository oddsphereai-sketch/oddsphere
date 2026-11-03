import type {DailyEdgeResponse} from "@/app/lab/lib/labTypes";
import {readCurrentUclMemberSnapshot} from "./uclMemberSnapshotStore";
import {applyDraftKingsNetworkSplitFallback,readStoredDraftKingsNetworkSplits,refreshDraftKingsNetworkSplitSource,DRAFTKINGS_NETWORK_SPLIT_DISPLAY_MAX_AGE_MS,type DraftKingsNetworkSplitFeed} from "@/lib/providers/draftkings/draftKingsNetworkSplits";

export const UCL_PUBLIC_SPLIT_SOURCE_RELEASE="ucl_public_split_source_2026_11_03_r4_fresh_capture_continuity" as const;
export const UCL_PUBLIC_SPLIT_REFRESH_MS=15*60_000;

/** Member consumption is read-only and never invokes the collector/continuity writer. */
export async function populateStoredUclPublicSplits(response:DailyEdgeResponse,readFeed=()=>readStoredDraftKingsNetworkSplits("ucl")){
 const feed=await readFeed().catch(()=>null);
 return applyDraftKingsNetworkSplitFallback(response,feed);
}

/** Only the established forecast writers call this. Member reads remain read-only.
 * New locks carry a genuine previously published pre-T60 receipt, never a fresh
 * post-cutoff overlay. Existing locked payloads remain wholly authoritative. */
export async function captureStoredUclPublicSplits(response:DailyEdgeResponse,previous:DailyEdgeResponse|null,args:{now?:Date;readFeed?:()=>Promise<DraftKingsNetworkSplitFeed|null>}={}){
 const feed=await(args.readFeed??(()=>readStoredDraftKingsNetworkSplits('ucl')))().catch(()=>null);
 const now=(args.now??new Date()).getTime(),capturedAt=new Date(now).toISOString();
 const priorFor=(id:number|string)=>previous?.games.filter(g=>g.external_id===id)??[];
 const existingLock=(id:number|string)=>priorFor(id).some(g=>g.lockedAt||g.lockState==='locked');
 const unique=(id:number|string)=>response.games.filter(g=>g.external_id===id).length===1;
 const eligible=response.games.filter(g=>unique(g.external_id)&&g.lockState==='open'&&!g.lockedAt&&!existingLock(g.external_id)&&Date.parse(g.scheduledLockAt??'')>now);
 const populated=applyDraftKingsNetworkSplitFallback({...response,games:eligible},feed);
 for(const g of eligible)for(const m of Object.values(g.markets)){
  const s=m.sportsbookSplits,observed=Date.parse(s?.sourceObservedAt??'');
  if(s?.sourceBook==='draftkings_network'&&s.rows.length===2&&Number.isFinite(observed)&&observed<=now&&now-observed<=UCL_PUBLIC_SPLIT_REFRESH_MS)
   m.sportsbookSplits={...s,memberCapturedAt:capturedAt,captureRelease:UCL_PUBLIC_SPLIT_SOURCE_RELEASE};
 }
 let carried=0;
 for(const g of response.games){
  const cutoff=Date.parse(g.scheduledLockAt??''),kickoff=Date.parse(g.gameStartAt??'');
  if(!unique(g.external_id)||g.lockedAt||!['open','locking'].includes(g.lockState??'')||existingLock(g.external_id)||!Number.isFinite(cutoff)||now<cutoff||now>=kickoff)continue;
  const prior=priorFor(g.external_id);
  if(prior.length!==1)continue;const p=prior[0]!;
  if(p.lockState!=='open'||p.lockedAt||p.id!==g.id||p.gameStartAt!==g.gameStartAt||Date.parse(p.scheduledLockAt??'')!==cutoff||p.awayTeam!==g.awayTeam||p.homeTeam!==g.homeTeam
   ||!g.awayTeamDisplayName||!g.homeTeamDisplayName||p.awayTeamDisplayName!==g.awayTeamDisplayName||p.homeTeamDisplayName!==g.homeTeamDisplayName
   ||g.soccerCompetitionContext?.competition!=='uefa_champions_league'||p.soccerCompetitionContext?.competition!=='uefa_champions_league')continue;
  for(const key of ['moneyline','total','first_inning'] as const){
   if(g.markets[key].sportsbookSplits?.rows.length)continue;
   const s=p.markets[key].sportsbookSplits,at=Date.parse(s?.sourceObservedAt??''),saved=Date.parse(s?.memberCapturedAt??'');
   if(!s||![UCL_PUBLIC_SPLIT_SOURCE_RELEASE,'ucl_public_split_source_2026_11_03_r2_capture_before_lock'].includes(s.captureRelease??'')||s.rows.length!==2||!Number.isFinite(at)||!Number.isFinite(saved)
    ||at>saved||saved-at>UCL_PUBLIC_SPLIT_REFRESH_MS||saved>cutoff||at>cutoff||cutoff-at>DRAFTKINGS_NETWORK_SPLIT_DISPLAY_MAX_AGE_MS)continue;
   g.markets[key].sportsbookSplits=structuredClone(s);carried++;
  }
 }
 return{release:UCL_PUBLIC_SPLIT_SOURCE_RELEASE,populatedMarkets:populated.populatedMarkets,carriedPrelockMarkets:carried,providerRequests:0};
}

/** Existing source-observation job and soccer prediction lease own this work.
 * No prediction, grade, locked record or paid API is touched here. */
export async function refreshScheduledUclPublicSplits(args:{
 now?:Date;
 readMember?:()=>Promise<DailyEdgeResponse|null>;
 readFeed?:()=>Promise<DraftKingsNetworkSplitFeed|null>;
 refreshFeed?:()=>Promise<DraftKingsNetworkSplitFeed|null>;
}={}){
 const now=(args.now??new Date()).getTime();
 const member=await(args.readMember??readCurrentUclMemberSnapshot)();
 const active=member?.games.filter(game=>game.lockState==="open"&&!game.lockedAt&&
  Date.parse(game.gameStartAt??"")>now&&Date.parse(game.gameStartAt??"")<=now+8*86400000)??[];
 if(!active.length)return{release:UCL_PUBLIC_SPLIT_SOURCE_RELEASE,skipped:true,reason:"no_unlocked_ucl_fixtures",refreshed:false,fresh:true,games:0,fetchedAt:null,paidProviderRequests:0,expectedGames:0,matchedGames:0,freshMoneylineGames:0};
 const previous=await(args.readFeed??(()=>readStoredDraftKingsNetworkSplits("ucl")))();
 const ageOf=(at:string|null|undefined)=>(args.now?.getTime()??Date.now())-Date.parse(at??"");
 const withinCadence=(at:string|null|undefined)=>{const age=ageOf(at);return Number.isFinite(age)&&age>=0&&age<UCL_PUBLIC_SPLIT_REFRESH_MS;};
 const coverage=(feed:DraftKingsNetworkSplitFeed|null)=>{
  const probe:DailyEdgeResponse={...member!,games:active.map(game=>({...game,markets:{
   moneyline:{...game.markets.moneyline,sportsbookSplits:null},total:{...game.markets.total,sportsbookSplits:null},first_inning:{...game.markets.first_inning,sportsbookSplits:null},
  }}))};
  const matched=applyDraftKingsNetworkSplitFallback(probe,feed);
  const freshMoneylineGames=probe.games.filter(game=>{const section=game.markets.moneyline.sportsbookSplits;
   return section?.rows.length===2&&withinCadence(section.sourceObservedAt);}).length;
  return{expectedGames:active.length,matchedGames:matched.matchedGames,freshMoneylineGames};
 };
 const previousCoverage=coverage(previous);
 if(withinCadence(previous?.fetchedAt)){const fresh=previousCoverage.freshMoneylineGames===active.length;
  return{release:UCL_PUBLIC_SPLIT_SOURCE_RELEASE,skipped:true,reason:fresh?"source_within_fifteen_minute_cadence":"retained_stale_markets_within_cadence",refreshed:false,fresh,games:previous!.games.length,fetchedAt:previous!.fetchedAt,paidProviderRequests:0,...previousCoverage};}
 const feed=await(args.refreshFeed??(()=>refreshDraftKingsNetworkSplitSource("ucl",{awaitDurableRefresh:true})))();
 // The shared source preserves its last complete feed on a fetch failure.
 // Retained data is not a successful fresh capture and must not be restamped.
 const currentCoverage=coverage(feed);
 const fresh=withinCadence(feed?.fetchedAt)&&currentCoverage.freshMoneylineGames===active.length;
 return{release:UCL_PUBLIC_SPLIT_SOURCE_RELEASE,skipped:false,reason:fresh?null:"fresh_public_source_unavailable",refreshed:withinCadence(feed?.fetchedAt)&&feed?.fetchedAt!==previous?.fetchedAt,fresh,games:feed?.games.length??0,fetchedAt:feed?.fetchedAt??null,paidProviderRequests:0,...currentCoverage};
}
