import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isMissingRpcFunction } from "../lib/db/missingRpcFunction";
import { readMarketPriceHighWater } from "../lib/services/marketPriceHighWater";
import type { SupabaseClient } from "@supabase/supabase-js";

async function main() {
  const calls: {method: string; value: unknown}[] = [];
  type RpcError = {code: string; message: string} | null;
  let rpcError: RpcError = null;
  const client = {
    async rpc(name: string, row: unknown) { calls.push({method: name,value: row});return {data: null,error: rpcError}; },
    from(table: string) { assert.equal(table,"lab_response_snapshots");return {
      async upsert(row: unknown, options: unknown) { calls.push({method: "legacy",value: row});assert.equal(JSON.stringify(options),JSON.stringify({onConflict:"snapshot_key"}));return {error: null}; },
    }; },
  };
  const exported: Record<string, unknown> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("lib/services/labResponseSnapshots.ts","utf8"),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText,{exports:exported,Date,console:{warn(){}},require(name: string) {
    if(name==="@/lib/db/supabase")return {supabase:client};
    if(name==="../db/missingRpcFunction")return {isMissingRpcFunction};
    throw new Error(`Unexpected dependency ${name}`);
  }});
  const write = exported.upsertLabResponseSnapshot as (input: Record<string,unknown>) => Promise<{ok:boolean}>;
  const payload=Object.freeze({lockedAt:"2026-11-02T20:00:00Z",probability:.56789,projection:Object.freeze({home:22.12345,away:17.99999}),grade:"Lean",price:-115,stake:1.25,payload_sha256:"original"});
  const input={snapshotKey:"original",kind:"daily_edge",payload,ttlMs:1200000,staleMs:86400000,payloadVersion:"original-release"};
  const inputBefore=JSON.stringify(input);
  assert.equal((await write(input)).ok,true);assert.equal(calls.length,1);
  assert.equal(calls[0]!.method,"upsert_lab_response_snapshot");
  const row=calls[0]!.value as Record<string,unknown>;
  assert.equal(row.payload,payload);assert.equal(row.payload_version,"original-release");
  assert.equal(Object.keys(row).length,11);
  assert.equal(new Date(row.expires_at as string).getTime()-new Date(row.generated_at as string).getTime(),1200000);
  assert.equal(row.generated_at,row.updated_at);assert.equal(JSON.stringify(input),inputBefore);
  calls.length=0;rpcError={code:"PGRST202",message:"Could not find public.upsert_lab_response_snapshot in schema cache"};
  assert.equal((await write(input)).ok,true);assert.equal(calls.length,2);
  assert.equal(calls[0]!.value,calls[1]!.value,"migration fallback reuses the identical row and timestamp");
  for(const error of [{code:"42501",message:"permission denied"},{code:"57014",message:"statement timeout"},{code:"PGRST202",message:"other_function missing"}]){
    calls.length=0;rpcError=error;assert.equal((await write(input)).ok,false);assert.equal(calls.length,1,"real failures never trigger a second write");
  }
  const highCalls: unknown[]=[];
  let highResult:{data:number|null;error:RpcError}={data:99,error:null};
  const events=["a","b","missing"];
  const highClient={async rpc(name:string,args:unknown){assert.equal(name,"market_price_observation_high_water");highCalls.push(args);return highResult;},
    from(table:string){assert.equal(table,"market_price_observations_v2");return {select(columns:string){assert.equal(columns,"id");return this;},eq(key:string,value:string){assert.equal(key,"league");assert.equal(value,"nba");return this;},in(key:string,value:string[]){assert.equal(key,"canonical_event_id");assert.equal(value,events);return this;},order(key:string,value:unknown){assert.equal(key,"id");assert.deepEqual(value,{ascending:false});return this;},limit(n:number){assert.equal(n,1);return this;},async maybeSingle(){highCalls.push("legacy");return {data:{id:99},error:null};}};}} as unknown as SupabaseClient;
  assert.deepEqual(await readMarketPriceHighWater(highClient,"nba",events),{id:99,error:null});
  assert.deepEqual(highCalls,[{p_league:"nba",p_event_ids:events}]);
  highResult={data:null,error:null};assert.deepEqual(await readMarketPriceHighWater(highClient,"nba",events),{id:0,error:null});
  highResult={data:null,error:{code:"42883",message:"function market_price_observation_high_water does not exist"}};
  assert.deepEqual(await readMarketPriceHighWater(highClient,"nba",events),{id:99,error:null});
  assert.equal(highCalls.at(-1),"legacy");
  const count=highCalls.length;highResult={data:null,error:{code:"57014",message:"statement timeout"}};
  assert.equal((await readMarketPriceHighWater(highClient,"nba",events)).error,highResult.error);assert.equal(highCalls.length,count+1);
  console.log("PASS identical snapshot row and input immutability, narrow migration fallback, no duplicate writes on failure, exact high-water arguments and existing fail-closed behavior");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
