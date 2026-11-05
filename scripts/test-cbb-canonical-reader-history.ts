import assert from "node:assert/strict";
import { readCbbCanonicalReaderHistory } from "../lib/services/cbb/cbbCanonicalReaderHistory";
import {CBB_CANONICAL_CONSUMER_CONTEXT_BOOKS} from "../lib/services/cbb/cbbCanonicalMarketEvidence";

type DataRow={id:number;canonical_event_id:string;fetched_at:string;inserted_at:string};
const at="2026-11-02T20:00:00Z";
const data:DataRow[]=Array.from({length:1002},(_,i)=>({id:i+1,canonical_event_id:"777",fetched_at:"2026-11-02T19:00:00Z",inserted_at:"2026-11-02T19:00:01Z"}));
function mock(rows:DataRow[],fault=false,watermark?:number,missingFunction=false){
 const calls:Array<{table:string;fields:string;filters:Array<[string,string,unknown]>;limit:number}>=[];
 const watermarks:unknown[]=[];
 const db={rpc:(name:string,args:unknown)=>{
   assert.equal(name,"market_price_observation_high_water");watermarks.push(args);
   return {abortSignal:(signal:AbortSignal)=>{assert.ok(signal instanceof AbortSignal);return Promise.resolve(
     missingFunction?{data:null,error:{code:"PGRST202",message:"Could not find the function public.market_price_observation_high_water"}}:
     fault?{data:null,error:{message:"bounded source unavailable"}}:{data:watermark??rows.at(-1)?.id??0,error:null});}};
 },from:(table:string)=>({select:(fields:string)=>{
   const c={table,fields,filters:[] as Array<[string,string,unknown]>,limit:1000};calls.push(c);
   let descending=false,single=false;
   const query={eq:(k:string,v:unknown)=>{c.filters.push(["eq",k,v]);return query;},in:(k:string,v:unknown)=>{c.filters.push(["in",k,v]);return query;},
     gte:(k:string,v:unknown)=>{c.filters.push(["gte",k,v]);return query;},lte:(k:string,v:unknown)=>{c.filters.push(["lte",k,v]);return query;},
     gt:(k:string,v:unknown)=>{c.filters.push(["gt",k,v]);return query;},lt:(k:string,v:unknown)=>{c.filters.push(["lt",k,v]);return query;},order:(_k:string,v:{ascending:boolean})=>{descending=!v.ascending;return query;},
     limit:(n:number)=>{c.limit=n;return query;},maybeSingle:()=>{single=true;return query;},abortSignal:(signal:AbortSignal)=>{assert.ok(signal instanceof AbortSignal);return query;},
     then:(resolve:(r:unknown)=>unknown)=>{
       let selected=rows.filter(row=>c.filters.every(([op,k,v])=>k==="id"?op==="gt"?row.id>Number(v):op==="lt"?row.id<Number(v):row.id<=Number(v):true));
       if(descending)selected=[...selected].reverse();selected=selected.slice(0,c.limit);
       return resolve(fault?{data:null,error:{message:"bounded source unavailable"}}:{data:single?selected[0]??null:selected,error:null});
     }};
   return query;
 }})} as unknown as Parameters<typeof readCbbCanonicalReaderHistory>[0]["db"];
 return {db,calls,watermarks};
}
async function main(){
 const good=mock(data),result=await readCbbCanonicalReaderHistory({db:good.db,gameIds:[777],asOf:at});
 assert.equal(result.complete,true);assert.equal(result.priceRows.length,1002);assert.equal(result.splitRows.length,1002);
 assert.equal(result.price.queries,3);assert.equal(result.split.queries,3);
 assert.ok(good.calls.every(c=>c.filters.some(f=>f[1]==="league"&&f[2]==="cbb")&&c.filters.some(f=>f[1]==="canonical_event_id")&&c.filters.some(f=>f[1]==="inserted_at"&&f[2]===at)),"all pages retain exact as-of and fixture scope");
 const books=good.calls.filter(c=>c.table==="market_price_observations_v2").map(c=>c.filters.find(f=>f[0]==="in"&&f[1]==="sportsbook")?.[2]);
 assert.ok(books.every(list=>JSON.stringify(list)===JSON.stringify(["circa","pinnacle","ps3838","bookmaker"])||JSON.stringify(list)===JSON.stringify(CBB_CANONICAL_CONSUMER_CONTEXT_BOOKS)));
 assert.ok(books.some(list=>JSON.stringify(list)===JSON.stringify(CBB_CANONICAL_CONSUMER_CONTEXT_BOOKS)),"all supported consumer books share a bounded context family, never a professional expert");
 assert.equal(good.watermarks.length,1,"retail and professional reads reuse one indexed watermark");
 assert.deepEqual(good.watermarks[0],{p_league:"cbb",p_event_ids:["777"]});
 const broader=await readCbbCanonicalReaderHistory({db:mock(data.slice(0,1000),false,9999).db,gameIds:[777],asOf:at,maxRowsPerFamily:1000});
 assert.equal(broader.price.complete,true,"a watermark outside this book/window cannot falsely exhaust an exact-size window");
 assert.equal(broader.priceRows.length,1000);
 assert.equal(broader.price.queries,3,"bounded final probe proves the filtered family is complete");
 const absent=await readCbbCanonicalReaderHistory({db:mock([],false,9999).db,gameIds:[777],asOf:at});
 assert.equal(absent.price.complete,true);assert.equal(absent.priceRows.length,0);
 const legacy=await readCbbCanonicalReaderHistory({db:mock(data,false,undefined,true).db,gameIds:[777],asOf:at});
 assert.deepEqual(legacy.priceRows,result.priceRows,"missing-function rollback retains the exact old filtered read");
 assert.equal(result.retailPrice.complete,true);assert.equal(result.retailPriceRows.length,1002);
 const capped=await readCbbCanonicalReaderHistory({db:mock(data).db,gameIds:[777],asOf:at,maxRowsPerFamily:1000});
 assert.equal(capped.complete,false);assert.equal(capped.price.reason,"row_budget_exceeded");assert.equal(capped.priceRows.length,1000,"partial history remains explicitly partial");
 assert.equal(capped.retailPrice.complete,false);assert.equal(capped.retailPriceRows.length,0,"legacy complete-only retail field stays empty on partial history");
 assert.deepEqual(capped.retailObservedRows.map(r=>r.id),data.slice(-1000).map(r=>r.id).reverse(),"partial consumer history retains the newest suffix with its coverage receipt");
 assert.equal(capped.retailPrice.highWaterId,1002);assert.equal(capped.retailPrice.lastId,3);assert.match(capped.retailHistoryOrder,/older_prefix/);
 const exact=await readCbbCanonicalReaderHistory({db:mock(data.slice(0,1000)).db,gameIds:[777],asOf:at,maxRowsPerFamily:1000});
 assert.equal(exact.complete,true,"exact cap can prove completion by its fixed high-water ID");
 const bytes=await readCbbCanonicalReaderHistory({db:mock(data).db,gameIds:[777],asOf:at,maxBytesPerFamily:10});
 assert.equal(bytes.complete,false);assert.equal(bytes.price.reason,"byte_budget_exceeded");assert.equal(bytes.priceRows.length,0);
 const failed=await readCbbCanonicalReaderHistory({db:mock(data,true).db,gameIds:[777],asOf:at});
 assert.equal(failed.price.complete,false);assert.match(failed.price.reason,/bounded source unavailable/);
 const empty=mock([]);assert.equal((await readCbbCanonicalReaderHistory({db:empty.db,gameIds:[],asOf:at})).complete,true);assert.equal(empty.calls.length,0);
 assert.equal(result.providerRequests,0);assert.equal(result.databaseWrites,0);
 console.log("PASS CBB canonical history: stable high-water pagination, fixture/as-of scope, timeout/row/byte boundaries, explicit partial family and no new collector or writer.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
