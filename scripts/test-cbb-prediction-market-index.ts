import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as zlib from "node:zlib";
import type {DailyEdgeGameDto,DailyEdgeResponse} from "../app/lab/lib/labTypes";
import {publishedMarketIdentities,verifiedPublishedMarketDetail,PUBLISHED_MARKET_READER_RELEASE} from "../lib/services/dailyEdge/predictionMarketPublishedIdentity";
import {publicMarketDisplayBook} from "../app/lab/lib/publicMarketDisplayTrail";
import {readerHistoryContractSelection} from "../lib/providers/owls/predictionMarketContracts";
import {mergeCbbCapturedNamedSplitEvidence,cbbQualifiedNamedSplitSection} from "../lib/services/cbb/cbbReaderMarketEvidence";
import {applySharpApiCurrentSplitOverlay} from "../lib/providers/real_api/sharpApiCurrentSplits";

async function main(){
 const fixture=JSON.parse(readFileSync("scripts/fixtures/cbb-byu-market-reader-20261102.json","utf8"));
 const game=fixture.game as DailyEdgeGameDto,now=Date.parse(fixture.at),bytes=JSON.stringify(game);
 const games=Array.from({length:117},(_,i)=>({...game,id:`cbb-${10882500+i}`,external_id:10882500+i}));
 games[77]=game;
 // Current history alone exceeded 8 MB. Additional non-chart evidence must
 // never influence whether an exact published game can open its graph.
 const oversized=games.map(g=>({...g,breakdown:{padding:"x".repeat(75_000)}})) as unknown as DailyEdgeGameDto[];
 assert.ok(Buffer.byteLength(JSON.stringify(oversized))>8_000_000);
 assert.throws(()=>zlib.gunzipSync(zlib.gzipSync(JSON.stringify(oversized)),{maxOutputLength:8_000_000}));
 const index=publishedMarketIdentities(oversized);
 assert.ok(Buffer.byteLength(JSON.stringify(index))<40_000,"identity cache stays small without dropping published games");
 assert.equal(index.length,117);assert.strictEqual(verifiedPublishedMarketDetail(index[77],game),game);
 for(const changes of [{external_id:999},{homeTeam:"UTAH"},{gameStartAt:"2026-11-04T02:00:00Z"}])
  assert.throws(()=>verifiedPublishedMarketDetail(index[77],{...game,...changes}),/identity changed/);
 assert.throws(()=>publishedMarketIdentities([game,game]),/ambiguous/);
 let boardReads=0,detailReads=0;
 const details=new Map<number,DailyEdgeGameDto>([[game.external_id,game]]);
 const dependencies:Record<string,unknown>={
  "next/cache":{unstable_cache(callback:(...args:unknown[])=>Promise<unknown>){const cache=new Map<string,Promise<unknown>>();return (...args:unknown[])=>{const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,callback(...args));return cache.get(key);};}},
  "@/lib/db/supabase":{supabase:{from:()=>({select:()=>{const query={eq:()=>query,maybeSingle:async()=>{boardReads++;return {data:{payload:{games:oversized}},error:null};}};return query;}})}},
  "@/lib/dates/slateDate":{currentSlateDate:()=>"2026-11-02",currentDailyEdgeBoardDate:()=>"2026-11-02"},
  "./predictionMarketPublishedIdentity":{publishedMarketIdentities,verifiedPublishedMarketDetail,PUBLISHED_MARKET_READER_RELEASE},
  "../cbb/cbbMemberGameStore":{readCbbMemberGame:async(id:number)=>{detailReads++;const memberGame=details.get(id);return memberGame?{memberGame}:null;}},
  "node:zlib":zlib,
 };
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync("lib/services/dailyEdge/predictionMarketDisplayFeed.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {exports,Buffer,console,require:(name:string)=>dependencies[name]??{}});
 const read=exports.readPublishedPredictionMarketGame as (sport:string,id:number)=>Promise<DailyEdgeGameDto|null>;
 assert.strictEqual(await read("cbb",game.external_id),game,"actual API read path returns original complete detail above old board limit");
 assert.strictEqual(await read("cbb",game.external_id),game);
 assert.equal(boardReads,1);assert.equal(detailReads,1,"warm chart reads do not repeat full-board or per-game database downloads");
 assert.equal(await read("cbb",999),null,"unpublished/excluded records cannot be authorized by direct member-store lookup");
 assert.equal(detailReads,1);
 const locked={...game,external_id:10882501,id:"cbb-10882501",lockedAt:"2026-11-02T18:00:00Z",lockState:"locked" as const};
 details.set(locked.external_id,locked);
 assert.strictEqual(await read("cbb",locked.external_id),locked,"actual locked detail takes precedence over cached unlocked index");
 for(const key of ["moneyline","total","first_inning"] as const){
  assert.deepEqual(readerHistoryContractSelection(game,key),readerHistoryContractSelection(verifiedPublishedMarketDetail(index[77],game),key));
  assert.deepEqual(publicMarketDisplayBook(game.markets[key]),publicMarketDisplayBook((await read("cbb",game.external_id))!.markets[key]),"every real book point and terminal threshold stays exact");
 }
 const feed={source:"owls_current_splits" as const,release:"owls_current_splits_2026_10_27_r1_complete_named_book" as const,sport:"cbb" as const,fetchedAt:fixture.at,rows:[fixture.retainedSplitRow]};
 const response={sport:"cbb",date:"2026-11-02",games:[game]} as DailyEdgeResponse;
 const rendered=mergeCbbCapturedNamedSplitEvidence(response,feed,applySharpApiCurrentSplitOverlay,now).games[0];
 for(const key of ["moneyline","total","first_inning"] as const){
  const section=rendered.markets[key].sportsbookSplits!;assert.equal(section.rows.length,2);assert.equal(section.sourceBook,"draftkings");
  assert.equal(section.lastUpdated,"2026-11-02T15:00:04.150Z");
  assert.equal(cbbQualifiedNamedSplitSection(null,section,now),false,"retained display never becomes fresh decision evidence");
  const {sportsbookSplits,sharpBookAvailability,...actual}=rendered.markets[key];void sportsbookSplits;void sharpBookAvailability;
  const {sportsbookSplits:old,sharpBookAvailability:availability,...expected}=game.markets[key];void old;void availability;
  assert.deepEqual(actual,expected,"retained display cannot change score, probabilities, prices, grades or trails");
 }
 const frozenResponse={...response,games:[locked]},frozen=JSON.stringify(frozenResponse);
 assert.equal(JSON.stringify(mergeCbbCapturedNamedSplitEvidence(frozenResponse,feed,applySharpApiCurrentSplitOverlay,now)),frozen,"existing locks cannot acquire retained sources");
 assert.equal(JSON.stringify(game),bytes,"source member payload remains immutable");
 console.log("PASS CBB oversized chart API: bounded identity index, cached exact details, membership/lock precedence, unchanged book trails and retained source time without decision authority.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
