import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCfbForwardMarketHistory, CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES } from "../lib/services/football/cfbForwardEvidenceStore";

async function main() {
  const view = "cfb_forward_market_history_projection";
  const gameIds = Array.from({length:22}, (_,i)=>String(100+i));
  const after = "2026-11-02T00:00:00.000Z";
  for (const error of [null,
    {code:"PGRST205",message:`missing ${view}`},
    {code:"42P01",message:`missing ${view}`},
    {code:"57014",message:"timeout"},
    {code:"42501",message:`permission denied for ${view}`},
    {code:"42P01",message:"unrelated missing relation"},
  ]) {
    const calls:Array<{table:string;select?:string;filters:unknown[]}> = [];
    const client = {from(table:string){
      const call:{table:string;select?:string;filters:unknown[]}={table,filters:[]}; calls.push(call);
      const q={
        select(s:string){call.select=s;return q;},
        eq(k:string,v:unknown){call.filters.push(["eq",k,v]);return q;},
        in(k:string,v:unknown){call.filters.push(["in",k,v]);return q;},
        or(v:string){call.filters.push(["or",v]);return q;},
        order(k:string,v:unknown){call.filters.push(["order",k,v]);return q;},
        range(a:number,b:number){call.filters.push(["range",a,b]);return Promise.resolve({data:[],error:table===view?error:null});},
      };return q;
    }} as unknown as SupabaseClient;
    const run=()=>readCfbForwardMarketHistory({client,season:2026,providerGameIds:[...gameIds,gameIds[0]],capturedAfter:after});
    const missing=error&&["PGRST205","42P01"].includes(error.code)&&error.message.includes(view);
    if(error&&!missing){await assert.rejects(run,/CFB forward market history read failed/);assert.equal(calls.length,1);continue;}
    assert.deepEqual(await run(),[]);
    assert.equal(calls.length,missing?4:3);
    assert(calls[0].table===view);
    if(missing){
      assert(calls.slice(1).every(c=>c.table==="cfb_forward_evidence_snapshots"));
      assert.equal(calls[0].select,calls[1].select,"the exact legacy JSON paths must remain unchanged");
      assert.deepEqual(calls[0].filters,calls[1].filters,"retry the same page without losing opening history");
    }
    for(const call of calls){
      assert.deepEqual(call.filters[0],["eq","season",2026]);
      assert.deepEqual(call.filters[1],["in","evidence_release",[...CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES]]);
      assert.deepEqual(call.filters[3],["or",`stage.eq.opening,captured_at.gte.${after}`]);
      assert.deepEqual(call.filters.slice(-3),[["order","captured_at",{ascending:true}],["order","id",{ascending:true}],["range",0,999]]);
      assert(!call.select!.split(",").includes("payload"));
    }
  }
  console.log("CFB market projection: unchanged releases/openings/windows/batches, safe missing-view fallback and real-error non-retry PASS");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
