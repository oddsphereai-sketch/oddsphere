import type {DailyEdgeResponse} from "@/app/lab/lib/labTypes";
import {readCurrentUclMemberSnapshot} from "./uclMemberSnapshotStore";
import {applyDraftKingsNetworkSplitFallback,readStoredDraftKingsNetworkSplits,refreshDraftKingsNetworkSplitSource,type DraftKingsNetworkSplitFeed} from "@/lib/providers/draftkings/draftKingsNetworkSplits";

export const UCL_PUBLIC_SPLIT_SOURCE_RELEASE="ucl_public_split_source_2026_11_03_r1_scheduled_durable_refresh" as const;
export const UCL_PUBLIC_SPLIT_REFRESH_MS=15*60_000;

/** Member consumption is read-only and never invokes the collector/continuity writer. */
export async function populateStoredUclPublicSplits(response:DailyEdgeResponse,readFeed=()=>readStoredDraftKingsNetworkSplits("ucl")){
 const feed=await readFeed().catch(()=>null);
 return applyDraftKingsNetworkSplitFallback(response,feed);
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
