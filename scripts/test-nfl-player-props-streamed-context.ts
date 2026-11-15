import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import type {SupabaseClient} from "@supabase/supabase-js";
import {hashNflForwardEvidencePayload, NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload, type NflForwardStoredEvidence} from "../lib/services/football/nflForwardEvidence";
import {readNflForwardEvidence, visitNflForwardEvidence} from "../lib/services/football/nflForwardEvidenceStore";
import {buildNflPlayerPropsInferenceContextFromForwardEvidence, readNflPlayerPropsInferenceContextFromForwardEvidence}
  from "../lib/services/football/nflPlayerPropsInferenceContext";
import type {NflPlayerPropsObservationSnapshot} from "../lib/services/football/nflPlayerPropsContract";
import {reportNflWriterResourceStage} from "../lib/services/football/nflWriterResourceHealth";

globalThis.fetch=(()=>{throw new Error("Network forbidden in streamed-context proof");}) as typeof fetch;
const fixture=JSON.parse(gunzipSync(readFileSync(resolve("scripts/fixtures/nfl-publication-clock-current-evidence-20261106.json.gz"))).toString()) as Array<{payload:NflForwardEvidencePayload}>;
const template=fixture[0]!.payload, base=Date.parse(template.capturedAt), gameId=template.game.providerGameId;
const snapshot={snapshotRelease:"offline-original",generatedAt:new Date(base+10_000_000).toISOString(),
  season:template.season,week:template.week,phase:"regular",games:[{providerGameId:gameId,
    scheduledStart:template.game.scheduledStart,awayTeam:template.game.away.abbreviation,
    homeTeam:template.game.home.abbreviation}]} as unknown as NflPlayerPropsObservationSnapshot;
type Raw={id:string;provider_game_id:string;stage:string;captured_at:string;game_start_at:string;payload_sha256:string;payload:NflForwardEvidencePayload};
function raw(index:number, options:{injuries?:boolean;stage?:"opening"|"unlocked"|"t60";time?:number;id?:string;foreign?:boolean}={}):Raw{
  const payload=structuredClone(template);
  payload.capturedAt=new Date(options.time??base+index*1000).toISOString();payload.stage=options.stage??"unlocked";
  if(options.injuries===false)payload.injuries=null;
  if(options.foreign)payload.game.providerGameId="foreign";
  return {id:options.id??String(index).padStart(8,"0"),provider_game_id:payload.game.providerGameId,
    stage:payload.stage,captured_at:payload.capturedAt,game_start_at:payload.game.scheduledStart,
    payload_sha256:hashNflForwardEvidencePayload(payload),payload};
}
function normalize(r:Raw):NflForwardStoredEvidence{return{id:r.id,providerGameId:r.provider_game_id,stage:r.payload.stage,
  capturedAt:r.captured_at,gameStartAt:new Date(r.game_start_at).toISOString(),payloadSha256:r.payload_sha256,payload:r.payload};}
function mock(count:number,at:(i:number)=>Raw,failAt=-1,unavailableAt=-1){let requests=0,visited=0;const client={from(table:string){
  assert.equal(table,"nfl_forward_evidence_snapshots");const filters:unknown[]=[],orders:string[]=[];
  const q={select(s:string){assert.equal(s,"id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload");return q;},
    eq(k:string,v:unknown){filters.push([k,v]);return q;},order(k:string,o:{ascending:boolean}){assert(o.ascending);orders.push(k);return q;},
    async range(from:number,to:number){requests++;assert.deepEqual(filters,[["evidence_release",NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE],["season",template.season],["week",template.week]]);
      assert.deepEqual(orders,["captured_at","id"]);assert(to-from<50);
      if(from===failAt)return{data:null,error:{message:"last-page refusal"}};
      if(from===unavailableAt)return{data:null,error:null};
      const data=Array.from({length:Math.max(0,Math.min(count,to+1)-from)},(_,j)=>{visited++;return at(from+j);});return{data,error:null};}};return q;
  }} as unknown as SupabaseClient;return{client,requests:()=>requests,visited:()=>visited};}
const args={snapshot,capturedAt:new Date(base+100_000).toISOString()};
async function main(){
  const values=[raw(0,{stage:"opening"}),raw(1,{stage:"t60",time:base+1000,id:"first-tie"}),
    raw(2,{stage:"t60",time:base+1000,id:"later-id-same-time"}),raw(3,{injuries:false}),
    raw(4,{foreign:true}),raw(200,{id:"future"})];
  const original=JSON.stringify(values),db=mock(values.length,i=>values[i]!);
  const context=await readNflPlayerPropsInferenceContextFromForwardEvidence({...args,client:db.client});
  const eager=buildNflPlayerPropsInferenceContextFromForwardEvidence({...args,evidence:values.map(normalize)});
  assert.equal(JSON.stringify(context),JSON.stringify(eager));assert.equal(JSON.stringify(values),original);
  const expectedSources=[values[3]!,values[1]!].map(r=>({id:r.id,capturedAt:r.captured_at,sha256:r.payload_sha256}));
  const expectedSha=createHash("sha256").update(JSON.stringify({snapshot:snapshot.snapshotRelease,generatedAt:snapshot.generatedAt,
    capturedAt:args.capturedAt,evidence:expectedSources})).digest("hex");
  assert.equal(context.sourceSha256,expectedSha,"latest and earlier injury source retain original IDs/hashes and FIRST equal-rank tie");
  assert.equal(context.games[0]!.mainMarket.capturedAt,values[3]!.captured_at);
  assert.equal(context.games[0]!.injuries.reportUpdatedAt,values[1]!.payload.injuries!.reportUpdatedAt);
  for(const mode of ["late-error","late-corrupt-foreign","unavailable-terminal","overflow"]){
    let published=false;const n=mode==="overflow"||mode==="unavailable-terminal"?12000:151;
    const small=raw(0);
    if(n===12000){
      // Minimal checksum-valid synthetic rows isolate the terminal row bound
      // from the separately preserved compressed/hot-byte bounds.
      small.payload={schemaRelease:template.schemaRelease,season:template.season,week:template.week,
        capturedAt:small.captured_at,stage:small.payload.stage,game:small.payload.game} as NflForwardEvidencePayload;
      small.payload_sha256=hashNflForwardEvidencePayload(small.payload);
    }
    const db=mock(n+(mode==="overflow"?1:0),i=>{
      const r={...small,id:String(i)};if(mode==="late-corrupt-foreign"&&i===150)return{...r,provider_game_id:"foreign",payload_sha256:"invalid"};return r;
    },mode==="late-error"?150:-1,mode==="unavailable-terminal"?12000:-1);
    // The all-row visitor uses the exact same core, including terminal probes.
    await assert.rejects(visitNflForwardEvidence({client:db.client,season:template.season,week:template.week,onRow:()=>{}})
      .then(()=>{published=true;}),mode==="overflow"?/bounded 12000-row/:mode==="late-corrupt-foreign"?/immutable payload contract|checksum/:mode==="unavailable-terminal"?/unavailable page/:/last-page refusal/);
    assert.equal(published,false,"partial visited selections are never completed authority");
  }
  // Late database errors refuse a complete context even after valid winners.
  const late=mock(151,i=>raw(i),150);await assert.rejects(readNflPlayerPropsInferenceContextFromForwardEvidence({...args,client:late.client}),/last-page refusal/);
  const changed=raw(3);changed.payload.game.scheduledStart=new Date(Date.parse(template.game.scheduledStart)+3_600_000).toISOString();
  changed.game_start_at=changed.payload.game.scheduledStart;changed.payload_sha256=hashNflForwardEvidencePayload(changed.payload);
  const changedDb=mock(2,i=>i?changed:values[0]!);
  await assert.rejects(readNflPlayerPropsInferenceContextFromForwardEvidence({...args,client:changedDb.client}),/game identity mismatch/,
    "a changed latest source clock must not fall back to older convenient context");
  const eagerDb=mock(values.length,i=>values[i]!);const ordinary=await readNflForwardEvidence({client:eagerDb.client,season:template.season,week:template.week});
  assert.equal(JSON.stringify(ordinary),JSON.stringify(values.map(normalize)),"ordinary full-game history is byte-identical");
  const lines:unknown[][]=[],info=console.info;console.info=(...v:unknown[])=>{lines.push(v);};
  try{reportNflWriterResourceStage("test-release","context_ready",Date.now());}finally{console.info=info;}
  assert.equal(lines.length,1);const health=JSON.parse(String(lines[0]![1]));assert.deepEqual(Object.keys(health),["writerRelease","stage","elapsedMs","rssBytes","heapUsedBytes","externalBytes","arrayBufferBytes"]);
  assert(health.rssBytes>0);assert(!JSON.stringify(health).includes(gameId));
  const child=spawnSync(process.execPath,["--expose-gc","--max-old-space-size=192","--import","tsx",resolve(process.argv[1]!),"--worker"],
    {cwd:process.cwd(),encoding:"utf8",timeout:120_000,maxBuffer:500_000});
  assert.equal(child.status,0,`${child.error?.message??""}\n${child.stdout}\n${child.stderr}`);console.log(child.stdout.trim());
  console.log("NFL streamed context: all-row integrity/bounds/late refusal, exact latest+injury/tie/source hashes, ordinary history, private telemetry and >5k low-heap context passed; no network.");
}
async function worker(){const count=6000,db=mock(count,i=>raw(i,{injuries:i%2===0}));
  const cutoff=new Date(base+(count-1)*1000).toISOString();
  const context=await readNflPlayerPropsInferenceContextFromForwardEvidence({client:db.client,snapshot,capturedAt:cutoff});
  assert.equal(db.visited(),count);assert.equal(db.requests(),121);assert.equal(context.games[0]!.mainMarket.capturedAt,cutoff);
  assert.equal(context.games[0]!.injuries.reportUpdatedAt,template.injuries!.reportUpdatedAt);
  (globalThis as typeof globalThis&{gc:()=>void}).gc();
  assert(process.memoryUsage().arrayBuffers<24_000_000,"discarded history buffers are not retained by the context result");
  console.log(JSON.stringify({streamedRows:count,orderedReads:db.requests(),contextGames:context.games.length,...process.memoryUsage()}));}
void(process.argv.includes("--worker")?worker():main()).catch(e=>{console.error(e);process.exitCode=1;});
