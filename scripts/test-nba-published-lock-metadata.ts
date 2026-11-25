import assert from "node:assert/strict";
import type {DailyEdgeGameDto, DailyEdgeResponse} from "../app/lab/lib/labTypes";
import {applyNbaPublishedLockMetadata,NBA_MEMBER_LOCK_PUBLICATION_RELEASE} from "../lib/services/nba/nbaPublishedLockMetadata";
import {buildNbaLockedMemberCapture,readNbaLockedMemberCards} from "../lib/services/nba/nbaLockedMemberSnapshot";
import {refreshNbaPublishedLockMetadata} from "../lib/services/labResponseSnapshotWriter";

async function main(){
 const previousFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error("unexpected real IO");};
 try{
 const lockedAt="2026-11-24T02:03:01.216Z",externalId=401910045,gameId=7;
 const captured={id:`nba-${externalId}`,external_id:externalId,gameStartAt:"2026-11-24T03:00:00Z",scheduledLockAt:"2026-11-24T02:00:00Z",lockState:"open",lockedAt:null,
  projected:{home:107.18254147811753,away:118.09783166030464},predictions:{total:{pick:"OVER 223.5",line:223.5,grade:"market_watch"}},
  markets:{moneyline:{pick:"SA ML",currentPriceAmerican:-300,verdict:{key:"watchlist"}},first_inning:{pick:"SA -8.5",currentPriceAmerican:-102,line:-8.5,verdict:{key:"watchlist"}},total:{pick:"OVER 223.5",currentPriceAmerican:-108,line:223.5,modelProb:.5388536762363073,verdict:{key:"watchlist"}}},breakdown:{source:"original saved evidence"}} as unknown as DailyEdgeGameDto;
 const stale=structuredClone(captured);stale.projected={home:107.29235490890645,away:118.20764509109355};stale.markets.total.pick="UNDER 225.5";stale.markets.total.line=225.5;stale.markets.total.currentPriceAmerican=-105;stale.markets.total.modelProb=.5;
 const oldLocked={...structuredClone(stale),id:"nba-9000",external_id:9000,lockState:"locked",lockedAt:"2026-11-24T00:00:00Z"} as DailyEdgeGameDto;
 const future={...structuredClone(stale),id:"nba-9001",external_id:9001,gameStartAt:"2026-11-25T00:00:00Z"};
 const payload={sport:"nba",date:"2026-11-23",as_of:"2026-11-24T02:01:02Z",games:[stale,oldLocked,future]} as DailyEdgeResponse;
 const map=new Map([[externalId,gameId],[9000,8],[9001,9]]);
 const dto={game_external_id:externalId,matchup:"SA @ SAC",projection:{home_score:captured.projected!.home,away_score:captured.projected!.away,total:225.28037313842217,spread_home:-10.91529018218711},intelligence:{original:true}};
 const capture=buildNbaLockedMemberCapture({gameDto:dto as never,memberGame:captured});
 const rows=["moneyline","spread","total"].map(market=>({game_id:gameId,market,locked_at:lockedAt,snapshot_json:structuredClone(capture)}));
 const metadata=[...rows.map(r=>({game_id:r.game_id,market:r.market,locked_at:r.locked_at})),...["moneyline","spread","total"].map(market=>({game_id:8,market,locked_at:oldLocked.lockedAt}))];
 const originalBytes=JSON.stringify({payload,rows});
 const originals=readNbaLockedMemberCards({externalIds:[externalId],dbIdByExternalId:map,rows});
 const patched=applyNbaPublishedLockMetadata({payload,dbIdByExternalId:map,rows:metadata,lockedMemberGamesByExternalId:originals});
 assert.equal(patched.changedGames,1);assert.equal(patched.lockedGames,2);
 assert.equal(patched.payload.games[0]!.markets.total.pick,"OVER 223.5","cannot lock the older UNDER at the old line");
 assert.equal(patched.payload.games[0]!.markets.total.currentPriceAmerican,-108);
 assert.deepEqual(patched.payload.games[0],{...captured,scheduledLockAt:"2026-11-24T02:00:00.000Z",lockState:"locked",lockedAt});
 assert.strictEqual(patched.payload.games[1],oldLocked,"already published legacy locks remain opaque");assert.strictEqual(patched.payload.games[2],future);
 assert.equal(JSON.stringify({payload,rows}),originalBytes,"neither original stored card nor any lock record is mutated");
 for(const [cachedGrade,originalGrade]of [["lean","watchlist"],["watchlist","lean"]] as const){
  const earlier=structuredClone(stale),saved=structuredClone(originals.get(externalId)!);
  earlier.markets.total.verdict.key=cachedGrade;saved.markets.total.verdict.key=originalGrade;
  const copied=applyNbaPublishedLockMetadata({payload:{...payload,games:[earlier]},dbIdByExternalId:map,rows,lockedMemberGamesByExternalId:new Map([[externalId,saved]])});
  assert.strictEqual(copied.payload.games[0],saved,"both grade directions must copy original truth without a new policy");
 }
 const repeated=applyNbaPublishedLockMetadata({payload:patched.payload,dbIdByExternalId:map,rows:metadata,lockedMemberGamesByExternalId:new Map()});
 assert.strictEqual(repeated.payload,patched.payload);assert.equal(repeated.changedGames,0);
 assert.throws(()=>applyNbaPublishedLockMetadata({payload,dbIdByExternalId:map,rows:metadata,lockedMemberGamesByExternalId:new Map()}),/exact saved lock card/);
 assert.throws(()=>applyNbaPublishedLockMetadata({payload,dbIdByExternalId:map,rows:metadata.slice(1),lockedMemberGamesByExternalId:originals}),/tuple is incomplete/);
 assert.throws(()=>applyNbaPublishedLockMetadata({payload,dbIdByExternalId:map,rows:metadata.map((r,i)=>i===1?{...r,locked_at:"2026-11-24T02:04:00Z"}:r),lockedMemberGamesByExternalId:originals}),/tuple is incomplete/);
 const equivalentClock={...oldLocked,lockedAt:"2026-11-24T00:00:00.000Z"};
 const equivalent=applyNbaPublishedLockMetadata({payload:{...payload,games:[equivalentClock]},dbIdByExternalId:map,rows:metadata,lockedMemberGamesByExternalId:new Map()});assert.strictEqual(equivalent.payload.games[0],equivalentClock,"equivalent clock formatting preserves original bytes");
 const wrongClock={...oldLocked,lockedAt:"2026-11-23T23:59:00Z"};
 assert.throws(()=>applyNbaPublishedLockMetadata({payload:{...payload,games:[wrongClock]},dbIdByExternalId:map,rows:metadata,lockedMemberGamesByExternalId:originals}),/existing published lock timestamp mismatch/);

 async function writerCase(args:{source?:typeof rows;failure?:string;board?:DailyEdgeResponse}={}){
  let writes=0,expires=0,captureReads=0;let saved:DailyEdgeResponse|undefined;
  const reads:Array<{table:string;fields:string;ids:unknown[]}>=[];
  const client={from:(table:string)=>{let fields="",ids:unknown[]=[];const query={
   select:(v:string)=>{fields=v;return query;},eq:()=>query,in:(_k:string,v:unknown[])=>{ids=v;return query;},not:()=>query,
   then:(resolve:(v:unknown)=>unknown)=>{reads.push({table,fields,ids});const isCapture=fields.includes("snapshot_json");if(isCapture)captureReads++;
    return Promise.resolve(table==="games"?{data:[...map].map(([external_id,id])=>({id,external_id})),error:null}:isCapture?{data:args.source??rows,error:args.failure?{message:args.failure}:null}:{data:metadata,error:null}).then(resolve);},
   insert:()=>{throw Error("record insert forbidden");},update:()=>{throw Error("record update forbidden");},upsert:()=>{throw Error("record upsert forbidden");},
  };return query;}};
  const board=args.board??payload,bytes=JSON.stringify(board);
  const result=await refreshNbaPublishedLockMetadata({date:"2026-11-23"},{client:client as never,
   readSnapshot:async()=>({payload:board,generatedAt:"2026-11-24T02:01:03Z",expiresAt:"old-expiry",staleUntil:"old-stale",cacheState:"DB_SNAPSHOT_STALE"}),
   saveSnapshot:async input=>{writes++;saved=input.payload as DailyEdgeResponse;assert.equal(input.payloadVersion,NBA_MEMBER_LOCK_PUBLICATION_RELEASE);return{ok:true,snapshotKey:input.snapshotKey,expiresAt:"new-expiry",staleUntil:"new-stale"};},
   expireMemberCache:async()=>{expires++;}});
  assert.equal(JSON.stringify(board),bytes);assert.equal(JSON.stringify({payload,rows}),originalBytes);
  assert(reads.filter(r=>r.fields.includes("snapshot_json")).every(r=>JSON.stringify(r.ids)==="[7]"),"load original JSON only for newly locking game, never old locks/future games");
  return{result,writes,expires,captureReads,saved};
 }
 const good=await writerCase();assert.equal(good.result.ok,true);assert.deepEqual(good.saved,patched.payload);assert.equal(good.writes,1);assert.equal(good.expires,1);assert.equal(good.captureReads,1);
 const noop=await writerCase({board:patched.payload});assert.equal(noop.result.ok,true);assert.equal(noop.writes,0);assert.equal(noop.expires,0);assert.equal(noop.captureReads,0);assert.equal(noop.result.expiresAt,"old-expiry","idempotence cannot renew freshness");
 const mismatched=structuredClone(rows);mismatched[1]!.snapshot_json.nba_daily_edge_game_at_capture={...captured,projected:{home:1,away:2}};
 const missingMember=structuredClone(rows);for(const r of missingMember)delete r.snapshot_json.nba_daily_edge_game_at_capture;
 const foreign=structuredClone(rows);for(const r of foreign)r.game_id=999;
 for(const source of [[],rows.slice(0,1),rows.slice(0,2),[...rows,{...rows[0]!,game_id:999}],mismatched,missingMember,foreign]){
  const failed=await writerCase({source});assert.equal(failed.result.ok,false);assert.equal(failed.writes,0);assert.equal(failed.expires,0);
 }
 const failed=await writerCase({failure:"mock capture read unavailable"});assert.equal(failed.result.ok,false);assert.equal(failed.writes,0);assert.equal(failed.expires,0);
 assert.equal(network,0);
 console.log("PASS NBA exact lock-card handoff: old UNDER/new OVER and price/projection reproduction, exact original card, immutable legacy/future/input records, complete three-market cohort, real writer single scoped capture read, zero failed/idempotent writes or freshness, zero real IO");
 }finally{globalThis.fetch=previousFetch;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
