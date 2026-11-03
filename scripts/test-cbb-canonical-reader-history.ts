import assert from "node:assert/strict";
import { readCbbCanonicalReaderHistory } from "../lib/services/cbb/cbbCanonicalReaderHistory";

type DataRow={id:number;canonical_event_id:string;fetched_at:string;inserted_at:string};
const at="2026-11-02T20:00:00Z";
const data:DataRow[]=Array.from({length:1002},(_,i)=>({id:i+1,canonical_event_id:"777",fetched_at:"2026-11-02T19:00:00Z",inserted_at:"2026-11-02T19:00:01Z"}));
function mock(rows:DataRow[],fault=false){
 const calls:Array<{table:string;fields:string;filters:Array<[string,string,unknown]>;limit:number}>=[];
 const db={from:(table:string)=>({select:(fields:string)=>{
   const c={table,fields,filters:[] as Array<[string,string,unknown]>,limit:1000};calls.push(c);
   let descending=false,single=false;
   const query={eq:(k:string,v:unknown)=>{c.filters.push(["eq",k,v]);return query;},in:(k:string,v:unknown)=>{c.filters.push(["in",k,v]);return query;},
     gte:(k:string,v:unknown)=>{c.filters.push(["gte",k,v]);return query;},lte:(k:string,v:unknown)=>{c.filters.push(["lte",k,v]);return query;},
     gt:(k:string,v:unknown)=>{c.filters.push(["gt",k,v]);return query;},order:(_k:string,v:{ascending:boolean})=>{descending=!v.ascending;return query;},
     limit:(n:number)=>{c.limit=n;return query;},maybeSingle:()=>{single=true;return query;},abortSignal:(signal:AbortSignal)=>{assert.ok(signal instanceof AbortSignal);return query;},
     then:(resolve:(r:unknown)=>unknown)=>{
       let selected=rows.filter(row=>c.filters.every(([op,k,v])=>k==="id"?op==="gt"?row.id>Number(v):row.id<=Number(v):true));
       if(descending)selected=[...selected].reverse();selected=selected.slice(0,c.limit);
       return resolve(fault?{data:null,error:{message:"bounded source unavailable"}}:{data:single?selected[0]??null:selected,error:null});
     }};
   return query;
 }})} as unknown as Parameters<typeof readCbbCanonicalReaderHistory>[0]["db"];
 return {db,calls};
}
async function main(){
 const good=mock(data),result=await readCbbCanonicalReaderHistory({db:good.db,gameIds:[777],asOf:at});
 assert.equal(result.complete,true);assert.equal(result.priceRows.length,1002);assert.equal(result.splitRows.length,1002);
 assert.equal(result.price.queries,3);assert.equal(result.split.queries,3);
 assert.ok(good.calls.every(c=>c.filters.some(f=>f[1]==="league"&&f[2]==="cbb")&&c.filters.some(f=>f[1]==="canonical_event_id")&&c.filters.some(f=>f[1]==="inserted_at"&&f[2]===at)),"all pages retain exact as-of and fixture scope");
 const books=good.calls.filter(c=>c.table==="market_price_observations_v2").map(c=>c.filters.find(f=>f[0]==="in"&&f[1]==="sportsbook")?.[2]);
 assert.ok(books.every(list=>JSON.stringify(list)===JSON.stringify(["circa","pinnacle","ps3838","bookmaker"])||JSON.stringify(list)===JSON.stringify(["draftkings","betmgm"])));
 assert.ok(books.some(list=>JSON.stringify(list)===JSON.stringify(["draftkings","betmgm"])),"retail history is a separate bounded context family, never a professional expert");
 assert.equal(result.retailPrice.complete,true);assert.equal(result.retailPriceRows.length,1002);
 const capped=await readCbbCanonicalReaderHistory({db:mock(data).db,gameIds:[777],asOf:at,maxRowsPerFamily:1000});
 assert.equal(capped.complete,false);assert.equal(capped.price.reason,"row_budget_exceeded");assert.equal(capped.priceRows.length,1000,"partial history remains explicitly partial");
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
