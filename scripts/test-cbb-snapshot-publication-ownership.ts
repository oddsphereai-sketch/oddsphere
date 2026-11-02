import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type {Sport} from "../lib/types/domain/Sport";

async function main(){
  const reads: string[]=[];
  const writes: Record<string,unknown>[]=[];
  let expirations=0;
  let nextPayload: Record<string,unknown>={};
  const dependencies: Record<string,unknown>={
    "@/lib/services/labResponseSnapshots":{
      DAILY_EDGE_PUBLISHED_MEMBER_CACHE_TAG:"published",
      dailyEdgeSnapshotKey:({sport,requestedDate}:{sport:Sport;requestedDate:string})=>`${sport}::${requestedDate}::current-only::live-copy`,
      async upsertLabResponseSnapshot(input:Record<string,unknown>){writes.push(input);return {ok:true,expiresAt:"unchanged-ttl",staleUntil:"unchanged-stale"};},
      async readLatestLabResponseSnapshot(){throw Error("unexpected stored record read");},
    },
    "@/lib/services/nba/nbaPublishedLockMetadata":{},
    "@/lib/db/supabase":{supabase:{from(){throw Error("unexpected DB access");}}},
    "@/app/api/lab/daily-edge/route":{async GET(request:Request){reads.push(request.url);return Response.json(nextPayload);}},
    "next/cache":{revalidateTag(tag:string,options:unknown){assert.equal(tag,"published");assert.deepEqual(JSON.parse(JSON.stringify(options)),{expire:0});expirations++;}},
  };
  const exports:Record<string,unknown>={};
  vm.runInNewContext(ts.transpileModule(readFileSync("lib/services/labResponseSnapshotWriter.ts","utf8"),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText,{exports,Request,Response,URL,console,process:{env:{}},require(name:string){assert.ok(Object.hasOwn(dependencies,name),`unexpected module ${name}`);return dependencies[name];}});
  const publish=exports.refreshDailyEdgeResponseSnapshot as (input:{sport:Sport;date:string;source:string})=>Promise<{ok:boolean;error?:string}>;
  const denied=await publish({sport:"cbb",date:"2026-11-02",source:"public_splits_observations_refresh"});
  assert.equal(denied.ok,false);
  assert.ok(denied.error?.includes(String(exports.CBB_SNAPSHOT_PUBLICATION_RELEASE)));
  assert.equal(reads.length,0);assert.equal(writes.length,0);assert.equal(expirations,0,"a generic copy cannot renew the CBB TTL or invalidate the good cached board");
  for(const sport of ["mlb","wnba","nba","nhl","nfl","cfb","soccer","ucl"] as Sport[]){
    nextPayload={sport,date:"2026-11-02",slateState:"ready",games:[{id:7,lockedAt:"2026-11-02T10:00:00Z",markets:{spread:{pick:"original",price:-112,probability:.61,grade:"Lean",evidence:{sourceObservedAt:"original-clock"}}}}]};
    const result=await publish({sport,date:"2026-11-02",source:"original-writer"});
    assert.equal(result.ok,true);
    const write=writes.at(-1)!;
    assert.equal(write.source,"original-writer");assert.equal(write.snapshotKey,`${sport}::2026-11-02::current-only::live-copy`);
    assert.deepEqual(write.payload,nextPayload,"other sports retain exact stored locked and unlocked fields");
    const url=new URL(reads.at(-1)!);assert.equal(url.searchParams.get("sport"),sport);assert.equal(url.searchParams.get("snapshotBypass"),"true");
  }
  assert.equal(reads.length,8);assert.equal(writes.length,8);assert.equal(expirations,8);
  console.log("PASS generic publication cannot read/write/retimestamp CBB; all other sports preserve their exact payload, source, cache invalidation and lock fields");
}
main().catch(e=>{console.error(e);process.exitCode=1});
