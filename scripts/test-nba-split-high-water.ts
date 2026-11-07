import assert from "node:assert/strict";
import {readNbaSplitHighWater} from "../lib/services/nba/nbaSplitHighWater";
import type {SupabaseClient} from "@supabase/supabase-js";
async function main(){
 let fallback=0,calls=0;let result:any={data:999,error:null};const ids=["current","future"];
 const q={select(v:string){assert.equal(v,"id");return q;},eq(k:string,v:string){assert.equal(k,"league");assert.equal(v,"nba");return q;},in(k:string,v:string[]){assert.equal(k,"canonical_event_id");assert.equal(v,ids);return q;},order(k:string,v:unknown){assert.equal(k,"id");assert.deepEqual(v,{ascending:false});return q;},limit(n:number){assert.equal(n,1);return q;},async maybeSingle(){fallback++;return {data:{id:999},error:null};}};
 const db={async rpc(name:string,args:unknown){calls++;assert.equal(name,"nba_market_split_observation_high_water");assert.deepEqual(args,{p_event_ids:ids});return result;},from(name:string){assert.equal(name,"market_split_observations_v2");return q;}} as unknown as SupabaseClient;
 assert.deepEqual(await readNbaSplitHighWater(db,ids),{id:999,error:null});assert.equal(fallback,0);
 result={data:null,error:null};assert.deepEqual(await readNbaSplitHighWater(db,ids),{id:0,error:null});
 for(const error of [{code:"57014",message:"statement timeout"},{code:"42501",message:"permission denied"}]){result={data:null,error};assert.equal((await readNbaSplitHighWater(db,ids)).error,error);assert.equal(fallback,0);}
 result={data:null,error:{code:"PGRST202",message:"Could not find public.nba_market_split_observation_high_water in schema cache"}};
 assert.deepEqual(await readNbaSplitHighWater(db,ids),{id:999,error:null});assert.equal(fallback,1);assert.equal(calls,5);
 console.log("PASS exact scoped split frontier, legitimate empty future history, narrow missing-migration fallback and real-error retention");
}main().catch(e=>{console.error(e);process.exitCode=1;});
