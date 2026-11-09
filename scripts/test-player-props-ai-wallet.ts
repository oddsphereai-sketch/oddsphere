/** Real PostgreSQL + real reviewer + mock HTTP. No credentials, Internet or paid calls. */
import assert from "node:assert/strict";
import {gunzipSync} from "node:zlib";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PropsAiStore, usageMicroUsd, type PropsAiJob } from "../lib/playerPropsAi/budget";
import { dispatchFundedPropsReviews } from "../lib/playerPropsAi/dispatch";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makePropsWalletPlan, type CalendarSources } from "../lib/playerPropsAi/walletPlan";
import { reviewSlots } from "../lib/playerPropsAi/schedule";
import { runPropsReview } from "../lib/playerPropsAi/reviewer";
import { playerSubset, prepareReviewParts } from "../lib/playerPropsAi/partitions";
import { readerEvidence, READER_AREAS } from "../lib/playerPropsAi/readerCoverage";
import { evidenceAliases } from "../lib/playerPropsAi/input";
import { PRODUCT_RELEASE, type GamePacket } from "../lib/playerPropsAi/evidenceContract";
import { PROPS_AI_WIRE_RELEASE } from "../lib/playerPropsAi/scenarioCoordinates";
import { digest } from "../lib/playerPropsAi/evidence";

async function main(){
const modulePath=process.argv[2];
assert.ok(modulePath?.startsWith("/private/tmp/"),"Only a private local pg module is allowed");
const {default:pg}=await import(pathToFileURL(modulePath).href);
const host=process.argv[3]??"/private/tmp/oddsphere-props-wallet-pg-20261107/socket",port=Number(process.argv[4]??55587);
assert.ok(host.startsWith("/private/tmp/")&&Number.isSafeInteger(port)&&port>=1024&&port<=65535,"Only a disposable local Unix-socket test database is allowed");
const config={host,port,user:"postgres"};
const admin=new pg.Client({...config,database:"postgres"});await admin.connect();
const database=`props_wallet_${Date.now()}`;await admin.query(`CREATE DATABASE ${database}`);
const db=new pg.Client({...config,database}),other=new pg.Client({...config,database});await db.connect();await other.connect();
const sources:CalendarSources={nba:{complete:true,source:"synthetic complete NBA calendar"},nfl:{complete:true,source:"synthetic no NFL games"},mlb:{complete:true,source:"synthetic no MLB games"}};
const game=(id:string)=>({sport:"nba" as const,id,start:"2026-11-07T23:00:00Z",lock:"2026-11-07T22:00:00Z"});
const bounds=[{input_tokens:1000,max_output_tokens:7000},{input_tokens:1000,max_output_tokens:7000}];
const keys=(id:string)=>reviewSlots(game(id)).map(s=>s.key);
const plan=(count:number,prefix="g")=>makePropsWalletPlan({month:"2026-11",now:"2026-11-07T21:40:00Z",games:Array.from({length:count},(_,i)=>game(`${prefix}${i}`)),bounds:Object.fromEntries(Array.from({length:count},(_,i)=>[`nba|${prefix}${i}`,bounds])),sources});
function store(client:typeof db){let queue:Promise<unknown>=Promise.resolve();return new PropsAiStore({rpc:async(name:string,args:Record<string,unknown>)=>{
  assert.match(name,/^player_props_ai_[a-z0-9_]+$/);
  const entries=Object.entries(args),sql=`SELECT public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(",")}) AS v`;
  try{const request=queue.then(()=>client.query(sql,entries.map(([key,value])=>value!==null&&typeof value==="object"&&key!=="p_parts"?JSON.stringify(value):value)));queue=request.then(()=>undefined,()=>undefined);const result=await request;return {data:result.rows[0].v,error:null};}
  catch(error){throw error;}
}} as unknown as SupabaseClient);}
const wallet=store(db),wallet2=store(other);
// Foundation wallet assertions target v2; site controls have their own installation test.
wallet.plan=(plan)=>wallet.rpc("player_props_ai_plan_v2",{p_month:plan.month,p_jobs:plan.jobs,p_companions:plan.companionSlots,p_plan_hash:plan.hash,p_sources:plan.sources,p_release:plan.release});
const budget=async()=> (await db.query("SELECT * FROM player_props_ai_budgets WHERE month_key='2026-11'")).rows[0];
const job=async(key:string)=>(await db.query("SELECT to_jsonb(r) v FROM player_props_ai_reviews r WHERE job_key=$1",[key])).rows[0].v as PropsAiJob;
const clock=()=>"2026-11-07T21:40:00Z";
const packet=(id:string,stage:"early"|"final"):GamePacket=>({release:PRODUCT_RELEASE,sport:"nba",gameId:id,start:game(id).start,lock:game(id).lock,cutoff:clock(),stage,sourceLimitations:[],quotes:[],players:["a","b"].map(p=>({id:p,name:`Synthetic ${p}`,team:"A",opponent:"B",markets:["points"],missing:[],evidence:[18,20,22].map((points,i)=>({id:`${p}:log:${i}`,kind:"recent_games" as const,availableAt:"2026-11-07T17:00:00Z",source:"synthetic",value:{game:{startTime:`2026-11-0${i+3}T23:00:00Z`,homeTeam:"A",awayTeam:"B"},box:{minutes:30,points}}}))}))});
function response(part:GamePacket,model:string,tier:string,id:string){
  const facts=readerEvidence(part),aliases=evidenceAliases(part);
  const players=Object.fromEntries(part.players.map(p=>[p.id,{assessment:"Conditional forecast using the supplied performance sample.",priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[p.id][area].status,factIds:facts[p.id][area].facts.slice(0,1).map(f=>f.id),effect:facts[p.id][area].status==="missing"?"unavailable":"uncertain",observation:area==="recent_form"&&facts[p.id][area].limitations.some(l=>l.includes("old_game_history"))?"The supplied history is dated and cannot establish current workload.":"The supplied sample requires contextual caution."}])),evidenceIds:[...aliases].filter(([,value])=>value===p.evidence[0].id).map(([alias])=>alias),gaps:[],law:{weights:Array(16).fill(1),outcomes:{points:Array(16).fill(20),rebounds:Array(16).fill(4),assists:Array(16).fill(3),threes:Array(16).fill(2)}},confidence:[1],exceptions:[null]}]));
  return {id,model,status:"completed",service_tier:tier,usage:{input_tokens:1000,output_tokens:100},output:[{content:[{type:"output_text",text:JSON.stringify({wireRelease:PROPS_AI_WIRE_RELEASE,players})}]}]};
}
async function run(id:string,stage:"early"|"final",failure:"none"|"capacity"|"timeout"|"invalid"|"semantic"|"physical"|"rate"|"quota"|"missingusage"|"invalidusage"="none",strong=false){
  const reviewNow=stage==="early"?"2026-11-07T21:00:00Z":clock();
  await db.query("UPDATE test_clock SET at=$1",[reviewNow]);
  const p={...packet(id,stage),cutoff:reviewNow},parts=p.players.map(player=>({packet:playerSubset(p,[player.id]),inputTokens:1000})),calls:{player:string;model:string;tier:string}[]=[];
  const seen=new Map<string,number>(),bodies:string[]=[];
  const fetchImpl=(async(url,options)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    bodies.push(String(options?.body));
    const request=JSON.parse(String(options?.body)),input=JSON.parse(request.input),player=input.document.players[0].id as string;
    calls.push({player,model:request.model,tier:request.service_tier});seen.set(player,(seen.get(player)??0)+1);
    if(player==="b"&&seen.get(player)===2&&failure==="invalid")assert.match(request.instructions,/Forecast wire release mismatch/);
    if(player==="b"&&seen.get(player)===2&&failure==="physical")assert.match(request.instructions,/P0 S0 PTS=1,3PM=2/);
    if(player==="b"&&seen.get(player)===2&&failure==="semantic")assert.match(request.instructions,/forecast_mean_outside_supplied_support/);
    if(player==="b"&&seen.get(player)===1){
      if(failure==="rate"||failure==="quota")return Response.json({error:{code:failure==="rate"?"rate_limit_exceeded":"insufficient_quota"}},{status:429,headers:{"x-request-id":"req_synthetic","retry-after":"60","x-ratelimit-limit-tokens":"1000000"}});
      if(failure==="missingusage"||failure==="invalidusage"){const value=response(parts[1].packet,request.model,request.service_tier,"unknown-usage");return Response.json({...value,usage:failure==="missingusage"?undefined:{input_tokens:-1,output_tokens:100}});}
      if(failure==="physical"){const value=response(parts[1].packet,request.model,request.service_tier,"physical-paid");const bad=JSON.parse(value.output[0].content[0].text);bad.players.b.law.outcomes.points=Array(16).fill(1);value.output[0].content[0].text=JSON.stringify(bad);return Response.json(value);}
      if(failure==="timeout")throw new Error("synthetic_transport_unknown");
      if(failure==="capacity")return Response.json({error:{code:"resource_unavailable"}},{status:429});
      if(failure==="semantic"){const value=response(parts[1].packet,request.model,request.service_tier,"semantic-paid");const bad=JSON.parse(value.output[0].content[0].text);bad.players.b.law.outcomes.points=Array(16).fill(100);value.output[0].content[0].text=JSON.stringify(bad);return Response.json(value);}
      if(failure==="invalid"){const value=response(parts[1].packet,request.model,request.service_tier,"invalid-paid");value.output[0].content[0].text="{}";return Response.json(value);}
    }
    return Response.json(response(parts.find(part=>part.packet.players[0].id===player)!.packet,request.model,request.service_tier,`r-${id}-${player}-${seen.get(player)}`));
  }) as typeof fetch;
  const result=await runPropsReview({packet:p,job:await job(keys(id)[stage==="early"?0:1]),store:wallet,key:"synthetic-never-real",writerRunId:"synthetic-owner",preferStronger:strong,clock:()=>reviewNow,prepare:async()=>parts,countStrong:async()=>7000,fetchImpl});
  return {result,calls,bodies};
}
try{
  for(const role of ["anon","authenticated","service_role"])await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.query(readFileSync("lib/db/schema-migration-v61-player-props-ai-runtime.sql","utf8"));
  const migration=readFileSync("lib/db/schema-migration-v62-player-props-ai-wallet.sql","utf8");await db.query(migration);await db.query(migration);
  const targetMigration=readFileSync("lib/db/schema-migration-v64-player-props-ai-budget-target.sql","utf8");await db.query(targetMigration);await db.query(targetMigration);
  await db.query(readFileSync("lib/db/schema-migration-v63-player-props-ai-site-control.sql","utf8"));
  await db.query(readFileSync("lib/db/schema-migration-v66-player-props-ai-slate-capacity.sql","utf8"));
  await db.query("UPDATE player_props_ai_control SET paid_enabled=true");
  await db.query("CREATE TABLE test_clock(at timestamptz); INSERT INTO test_clock VALUES('2026-11-07T21:40:00Z'); CREATE FUNCTION props_ai_test_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT at FROM test_clock'");
  const functions=await db.query("SELECT pg_get_functiondef(oid) body FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'player_props_ai_%'");
  for(const f of functions.rows)await db.query(f.body.replaceAll("clock_timestamp()","props_ai_test_clock()"));
  await db.query("CREATE TABLE cron_job_leases(job_name text PRIMARY KEY,run_id text,lease_expires_at timestamptz);INSERT INTO cron_job_leases VALUES('prediction_pipeline:nba','synthetic-owner','2027-01-01T00:00:00Z')");
  for(const input of [1,1000,145000])for(const output of [1,7000])for(const strong of [false,true])for(const flex of [false,true]){
    const sql=(await db.query("SELECT player_props_ai_quote($1,$2,$3) q",[JSON.stringify([{input_tokens:input,strong_input_tokens:input,max_output_tokens:output}]),strong,flex])).rows[0].q;
    assert.equal(Number(sql),usageMicroUsd(strong?"gpt-6.1-terra":"gpt-6-luna",{input_tokens:input+2048,output_tokens:output},flex?"flex":"default"));
  }
  const full=plan(20),before=digest(full);assert.equal((await wallet.plan(full)).funded,true);const first=await budget();
  assert.equal(Number(first.core_reserved_micro),20*(3806+7610));assert.equal(Number(first.fallback_remaining_micro),15220);
  assert.equal((await wallet.plan(full)).funded,true);assert.equal(Number((await budget()).core_reserved_micro),Number(first.core_reserved_micro));assert.equal(digest(full),before);
  await assert.rejects(wallet.plan({...full,jobs:full.jobs.slice(1)}),/omits_review|drop_pending/);
  await assert.rejects(wallet.plan({...full,sources:{...sources,nfl:{complete:false,source:"incomplete"}} as unknown as CalendarSources}),/calendar_sources_required/);
  // No optional balance: temporary Standard escrow must draw and restore the protected pool.
  await db.query("UPDATE player_props_ai_budgets SET cap_micro=core_reserved_micro+consumed_micro+fallback_remaining_micro+recovery_remaining_micro WHERE month_key='2026-11'");
  const capacity=await run("g0","early","capacity",true);assert.equal(capacity.result.status,"completed");
  assert.equal(Number((await budget()).fallback_remaining_micro),Number(first.fallback_remaining_micro));
  assert.equal(Number((await budget()).recovery_remaining_micro),3_000_000);
  await db.query("UPDATE player_props_ai_budgets SET cap_micro=50000000 WHERE month_key='2026-11'");
  assert.equal(capacity.calls.length,3);assert.equal(capacity.calls.filter(c=>c.player==="a").length,1);assert.equal(capacity.calls.at(-1)!.tier,"default");assert.ok(capacity.calls.every(c=>c.model==="gpt-6-luna"));
  const accepted=(await job(keys("g0")[0])).result as {players:unknown[];partProvenance:{phase:number}[]};assert.equal(accepted.players.length,2);assert.deepEqual(accepted.partProvenance.map(p=>p.phase),[1,2]);
  const duplicate=await run("g0","early");assert.equal(duplicate.result.status,"skipped");assert.equal(duplicate.calls.length,0);
  const unknown=await run("g1","early","timeout");assert.equal(unknown.result.status,"failed");assert.equal(unknown.calls.length,2);assert.equal((await job(keys("g1")[0])).result,null);
  const held=(await db.query("SELECT * FROM player_props_ai_attempts WHERE job_key=$1 AND part=2",[keys("g1")[0]])).rows[0],spent=Number((await budget()).consumed_micro);
  await wallet.receipt(held.id,(await job(keys("g1")[0])).claim_token!,123,"late-receipt",{late:true});
  assert.equal(Number((await budget()).consumed_micro),spent-Number(held.reserved_micro)+123);
  await assert.rejects(wallet.receipt(held.id,(await job(keys("g1")[0])).claim_token!,100,"different",{}),/immutable_usage_receipt_conflict/);
  const semantic=await run("g7","early","semantic");assert.equal(semantic.result.status,"completed");assert.equal(semantic.calls.length,3);assert.equal(semantic.calls.filter(c=>c.player==="a").length,1);
  const semanticReview=(await job(keys("g7")[0])).result as {partProvenance:{correctionReason?:string}[]};assert.match(semanticReview.partProvenance[1].correctionReason!,/forecast_mean_outside_supplied_support/);
  const physical=await run("g8","early","physical");assert.equal(physical.result.status,"completed");assert.equal(physical.calls.length,3);assert.equal(physical.calls.filter(c=>c.player==="a").length,1);
  const rejected=(await db.query("SELECT * FROM player_props_ai_attempts WHERE job_key=$1 AND phase=1 AND part=2",[keys("g8")[0]])).rows[0];
  assert.ok(rejected.actual_micro>0);assert.equal(rejected.usage.failureEvidence.physical.length,16);
  const archived=rejected.usage.failureEvidence;assert.equal(gunzipSync(Buffer.from(archived.request.data,"base64")).toString(),physical.bodies[1]);assert.equal(JSON.parse(gunzipSync(Buffer.from(archived.input.data,"base64")).toString()).players[0].id,"b");assert.equal(JSON.parse(gunzipSync(Buffer.from(archived.draft.data,"base64")).toString()).players.b.law.outcomes.points[0],1);
  await assert.rejects(wallet.receipt(rejected.id,(await job(keys("g8")[0])).claim_token!,Number(rejected.actual_micro),rejected.response_id,{...rejected.usage,changed:true}),/immutable_usage_receipt_conflict/);
  for(const [id,kind,code]of [["g9","rate","rate_limit_exceeded"],["g10","quota","insufficient_quota"]] as const){
    const failed=await run(id,"early",kind);assert.equal(failed.result.status,"failed");assert.equal(failed.calls.length,2);const attempt=(await db.query("SELECT * FROM player_props_ai_attempts WHERE job_key=$1 AND part=2",[keys(id)[0]])).rows[0];assert.equal(attempt.state,"unknown");assert.equal(attempt.actual_micro,null);assert.equal(attempt.usage.transport.code,code);assert.equal(attempt.usage.transport.rateLimits["x-ratelimit-limit-tokens"],"1000000");assert.equal(attempt.phase,1);assert.equal(await wallet.fallback(keys(id)[0],(await job(keys(id)[0])).claim_token!,[2],"no blind retry"),false);
  }
  for(const [id,kind]of [["g11","missingusage"],["g12","invalidusage"]] as const){const failed=await run(id,"early",kind);assert.equal(failed.result.status,"failed");assert.equal(failed.calls.length,2);const receipt=(await db.query("SELECT * FROM player_props_ai_attempts WHERE job_key=$1 AND part=2",[keys(id)[0]])).rows[0];assert.equal(receipt.actual_micro,null);assert.equal(receipt.state,"unknown");assert.ok(receipt.usage.failureEvidence.draft.data);}
  const strong=await run("g2","final","invalid",true);assert.equal(strong.result.status,"completed");assert.equal(strong.calls.filter(c=>c.player==="a").length,1);assert.equal(strong.calls[0].model,"gpt-6.1-terra");assert.equal(strong.calls.at(-1)!.model,"gpt-6-luna");
  assert.equal(((await job(keys("g2")[1])).result as {model:string}).model,"mixed_recorded_per_part");
  assert.equal((await run("g3","final","none",true)).calls[0].model,"gpt-6.1-terra");assert.equal((await run("g4","final","none",true)).calls[0].model,"gpt-6-luna");
  assert.equal(Number((await budget()).stronger_finals),2);
  const requests=bounds.map(b=>({...b,strong_input_tokens:null}));
  assert.equal((await wallet.claim(keys("g5")[1],"hash",requests,false,"wrong-owner")).reason,"shared_sport_writer_lease_required");
  const concurrent=await Promise.all([wallet.claim(keys("g5")[1],"hash",requests,false,"synthetic-owner"),wallet2.claim(keys("g5")[1],"hash",requests,false,"synthetic-owner")]);assert.equal(concurrent.filter(c=>c.claimed).length,1);
  const claim=concurrent.find(c=>c.claimed)!;const sent=await wallet.send(keys("g5")[1],claim.token!,1,1);
  await assert.rejects(wallet.send(keys("g5")[1],claim.token!,1,1),/already_claimed/);
  await wallet.receipt(sent.id,claim.token!,null,null,null);assert.equal(await wallet.fallback(keys("g5")[1],claim.token!,[1],"unknown"),false);
  await wallet.finish(keys("g5")[1],claim.token!,null,"unknown");
  const frozen=await job(keys("g0")[0]);const frozenAgain=await wallet.finish(frozen.job_key,frozen.claim_token!,{replacement:true},null);assert.deepEqual(frozenAgain.result,frozen.result);
  const pendingSum=Number((await db.query("SELECT coalesce(sum(reserved_micro),0) s FROM player_props_ai_reviews WHERE state='pending'")).rows[0].s);
  assert.equal(Number((await budget()).core_reserved_micro),pendingSum);
  const boundaryGame={...game("utc-boundary"),start:"2026-12-01T03:00:00Z",lock:"2026-12-01T02:00:00Z"};
  const boundary=makePropsWalletPlan({month:"2026-12",now:clock(),games:[boundaryGame],bounds:{"nba|utc-boundary":bounds},sources});assert.equal(boundary.jobs.length,1);assert.equal(boundary.companionSlots.length,2);assert.equal((await wallet.plan(boundary)).funded,true);
  const excessive=makePropsWalletPlan({month:"2027-04",now:clock(),games:Array.from({length:900},(_,i)=>({...game(`large${i}`),start:"2027-04-06T23:00:00Z",lock:"2027-04-06T22:00:00Z"})),bounds:Object.fromEntries(Array.from({length:900},(_,i)=>[`nba|large${i}`,Array.from({length:4},()=>({input_tokens:145000,max_output_tokens:7000}))])),sources});
  const denied=await wallet.plan(excessive);assert.equal(denied.funded,false);assert.ok(denied.required_micro!>60_000_000);assert.equal((await db.query("SELECT count(*) c FROM player_props_ai_reviews WHERE billing_month='2027-04'")).rows[0].c,"0");
  const largePacket={...packet("all-players","early"),players:Array.from({length:40},(_,i)=>({...packet("all-players","early").players[0],id:`large-player-${i}`,evidence:packet("all-players","early").players[0].evidence.map(e=>({...e,id:`large-${i}:${e.id}`}))}))};
  const largeParts=await prepareReviewParts(largePacket,{key:"synthetic",count:async()=>1000});assert.equal(largeParts.length,5);assert.equal(new Set(largeParts.flatMap(p=>p.packet.players.map(p=>p.id))).size,40);
  await db.query("SET ROLE authenticated");await assert.rejects(db.query("SELECT * FROM player_props_ai_budgets"),/permission denied/);await assert.rejects(db.query("SELECT player_props_ai_reap()"),/permission denied/);await db.query("RESET ROLE");
  await db.query("SET ROLE service_role");await assert.rejects(db.query("SELECT player_props_ai_release('x',1)"),/permission denied/);await db.query("RESET ROLE");
  await db.query("UPDATE test_clock SET at='2026-11-07T22:00:00Z'");assert.equal((await wallet.claim(keys("g6")[1],"late",requests,false,"synthetic-owner")).reason,"after_lock");
  await wallet.reap();assert.equal(Number((await budget()).core_reserved_micro),0);
  const boundaryGames=[...Array.from({length:20},(_,i)=>game(`g${i}`)),boundaryGame];
  const novemberCarry=makePropsWalletPlan({month:"2026-11",now:"2026-11-07T22:00:00Z",games:boundaryGames,bounds:{...Object.fromEntries(Array.from({length:20},(_,i)=>[`nba|g${i}`,bounds])),"nba|utc-boundary":bounds},sources});
  assert.equal((await wallet.plan(novemberCarry)).funded,true);assert.equal(Number((await budget()).core_reserved_micro),3806);
  await db.query("UPDATE test_clock SET at='2026-12-01T00:05:00Z'");
  const carry=makePropsWalletPlan({month:"2026-12",now:"2026-12-01T00:05:00Z",games:[boundaryGame],bounds:{"nba|utc-boundary":bounds},sources});
  assert.equal(carry.jobs.length,2);assert.equal((await wallet.plan(carry)).funded,true);assert.equal(Number((await budget()).core_reserved_micro),0);
  assert.equal((await db.query("SELECT count(*) c FROM player_props_ai_reviews WHERE game_id='utc-boundary'")).rows[0].c,"2");
  const carryKey=reviewSlots(boundaryGame)[0].key;assert.equal((await job(carryKey)).billing_month,"2026-12");
  const carried=await wallet.claim(carryKey,"carry",requests,false,"synthetic-owner");assert.equal(carried.claimed,true);await wallet.finish(carryKey,carried.token!,null,"synthetic_unsent");
  // Tight complete month: optional upgrades exhaust their own money, never core funds.
  const tightBounds=Array.from({length:3},()=>({input_tokens:120000,max_output_tokens:7000}));
  const tight=makePropsWalletPlan({month:"2027-04",now:"2027-04-06T21:40:00Z",games:Array.from({length:600},(_,i)=>({...game(`large${i}`),start:"2027-04-06T23:00:00Z",lock:"2027-04-06T22:00:00Z"})),bounds:Object.fromEntries(Array.from({length:600},(_,i)=>[`nba|large${i}`,tightBounds])),sources});
  await db.query("UPDATE test_clock SET at='2027-04-06T21:40:00Z';UPDATE cron_job_leases SET lease_expires_at='2027-05-01T00:00:00Z'");assert.equal((await wallet.plan(tight)).funded,true);
  let upgraded=0;
  for(let i=0;i<5;i++){
    const key=tight.jobs.find(j=>j.gameId===`large${i}`&&j.stage==="final")!.key;
    const c=await wallet.claim(key,`tight${i}`,tightBounds.map(b=>({...b,strong_input_tokens:120000})),true,"synthetic-owner");assert.equal(c.claimed,true);if(c.job!.model==="gpt-6.1-terra")upgraded++;
    for(let part=1;part<=3;part++){const a=await wallet.send(key,c.token!,1,part);await wallet.receipt(a.id,c.token!,null,null,null);}
    await wallet.finish(key,c.token!,null,"synthetic_unknown_held");
  }
  assert.equal(upgraded,4);const tightBudget=(await db.query("SELECT * FROM player_props_ai_budgets WHERE month_key='2027-04'")).rows[0];
  assert.equal(Number(tightBudget.core_reserved_micro),Number((await db.query("SELECT sum(reserved_micro) s FROM player_props_ai_reviews WHERE billing_month='2027-04' AND state='pending'")).rows[0].s));
  assert.ok(Number(tightBudget.core_reserved_micro)+Number(tightBudget.consumed_micro)+Number(tightBudget.fallback_remaining_micro)+Number(tightBudget.recovery_remaining_micro)<=50_000_000);
  const leaseKey=tight.jobs.find(j=>j.gameId==="large6"&&j.stage==="final")!.key;
  const leaseClaim=await wallet.claim(leaseKey,"lease",tightBounds.map(b=>({...b,strong_input_tokens:null})),false,"synthetic-owner");assert.equal(leaseClaim.claimed,true);
  await db.query("UPDATE cron_job_leases SET run_id='new-owner'");await assert.rejects(wallet.send(leaseKey,leaseClaim.token!,1,1),/expired_send/);
  await wallet.finish(leaseKey,leaseClaim.token!,{fake:true},null);assert.equal((await job(leaseKey)).state,"failed");
  await db.query("UPDATE cron_job_leases SET run_id='synthetic-owner'");
  const overKey=tight.jobs.find(j=>j.gameId==="large7"&&j.stage==="final")!.key;
  const over=await wallet.claim(overKey,"over",tightBounds.map(b=>({...b,strong_input_tokens:null})),false,"synthetic-owner");
  const overAttempts=[];for(let part=1;part<=3;part++)overAttempts.push(await wallet.send(overKey,over.token!,1,part));
  for(let part=1;part<=3;part++){const a=overAttempts[part-1];await wallet.receipt(a.id,over.token!,a.reserved_micro+(part===1?1:0),`over${part}`,{});}
  assert.equal(await wallet.fallback(overKey,over.token!,[1],"synthetic_bound_violation"),false);
  await wallet.finish(overKey,over.token!,null,"synthetic_vendor_overrun");
  const overBudget=(await db.query("SELECT * FROM player_props_ai_budgets WHERE month_key='2027-04'")).rows[0];assert.equal(Number(overBudget.unexpected_overrun_micro),1);assert.equal(overBudget.full_calendar,false);
  // A complete forty-player game goes through all five funded request parts.
  const bigGame={...game("all-players"),start:"2027-05-06T23:00:00Z",lock:"2027-05-06T22:00:00Z"};
  const bigNow="2027-05-06T21:00:00Z",bigPacket={...largePacket,start:bigGame.start,lock:bigGame.lock,cutoff:bigNow};
  const bigParts=largeParts.map(part=>({...part,packet:{...part.packet,start:bigGame.start,lock:bigGame.lock,cutoff:bigNow}}));
  const bigPlan=makePropsWalletPlan({month:"2027-05",now:bigNow,games:[bigGame],bounds:{"nba|all-players":bigParts.map(()=>({input_tokens:1000,max_output_tokens:7000}))},sources});
  await db.query("UPDATE test_clock SET at='2027-05-06T21:00:00Z';UPDATE cron_job_leases SET lease_expires_at='2027-06-01T00:00:00Z'");assert.equal((await wallet.plan(bigPlan)).funded,true);
  let bigCalls=0;
  const bigResult=await runPropsReview({packet:bigPacket,job:await job(reviewSlots(bigGame)[0].key),store:wallet,key:"synthetic",writerRunId:"synthetic-owner",preferStronger:false,clock:()=>bigNow,prepare:async()=>bigParts,fetchImpl:(async(_url,options)=>{
    bigCalls++;const request=JSON.parse(String(options?.body)),input=JSON.parse(request.input);const part=bigParts.find(p=>p.packet.players[0].id===input.document.players[0].id)!;
    return Response.json(response(part.packet,request.model,request.service_tier,`big-${bigCalls}`));
  }) as typeof fetch});
  assert.equal(bigResult.status,"completed",JSON.stringify(bigResult));assert.equal(bigCalls,5);assert.equal((bigResult.review as {players:unknown[]}).players.length,40);
  // Existing-writer dispatch hook, including its count API, also stays entirely mocked.
  wallet.due=async(sport,now,limit)=>(await db.query("SELECT to_jsonb(r) v FROM player_props_ai_reviews r WHERE sport=$1 AND state='pending' AND due_at<=$2 AND lock_at>$2 ORDER BY due_at LIMIT $3",[sport,now,limit])).rows.map((r:{v:PropsAiJob})=>r.v);
  await db.query("UPDATE test_clock SET at='2027-05-06T21:40:00Z'");
  const dispatchNow="2027-05-06T21:40:00Z",finalPacket={...bigPacket,stage:"final" as const,cutoff:dispatchNow};
  let dispatchCalls=0,countCalls=0;
  const dispatchArgs={sport:"nba" as const,writerRunId:"synthetic-owner",store:wallet,key:"synthetic",clock:()=>dispatchNow,loadFrozenPacket:async()=>finalPacket,fetchImpl:(async(url,options)=>{
    if(String(url).endsWith("/input_tokens")){countCalls++;return Response.json({input_tokens:1000});}
    assert.equal(String(url),"https://api.openai.com/v1/responses");dispatchCalls++;
    const request=JSON.parse(String(options?.body)),input=JSON.parse(request.input),ids=input.document.players.map((p:{id:string})=>p.id);
    return Response.json(response(playerSubset(finalPacket,ids),request.model,request.service_tier,`dispatch-${dispatchCalls}`));
  }) as typeof fetch};
  const deferred=await dispatchFundedPropsReviews({...dispatchArgs,deadline:Date.now()+1000});assert.equal(deferred[0].status,"deferred");assert.equal(dispatchCalls,0);
  const dispatched=await dispatchFundedPropsReviews(dispatchArgs);assert.equal(dispatched.length,1);assert.equal(dispatched[0].status,"completed",JSON.stringify(dispatched));assert.equal(dispatched[0].review!.players.length,40);assert.equal(dispatchCalls,5);assert.ok(countCalls>=5);
  assert.equal((await dispatchFundedPropsReviews(dispatchArgs)).length,0);assert.equal(dispatchCalls,5);
  // Coverage may use the approved emergency band; optional stronger work may not.
  const emergencyBounds=Array.from({length:3},()=>({input_tokens:145000,max_output_tokens:7000}));
  const emergencyGames=Array.from({length:600},(_,i)=>({...game(`emergency${i}`),start:"2030-04-06T23:00:00Z",lock:"2030-04-06T22:00:00Z"}));
  const emergencyPlan=makePropsWalletPlan({month:"2030-04",now:"2030-04-06T21:40:00Z",games:emergencyGames,bounds:Object.fromEntries(emergencyGames.map(g=>[`nba|${g.id}`,emergencyBounds])),sources});
  await db.query("UPDATE test_clock SET at='2030-04-06T21:40:00Z';UPDATE cron_job_leases SET lease_expires_at='2030-05-01T00:00:00Z'");
  const emergencyFunding=await wallet.plan(emergencyPlan);assert.equal(emergencyFunding.funded,true);
  const emergencyBudget=(await db.query("SELECT * FROM player_props_ai_budgets WHERE month_key='2030-04'")).rows[0];
  const obligations=Number(emergencyBudget.core_reserved_micro)+Number(emergencyBudget.fallback_remaining_micro)+Number(emergencyBudget.recovery_remaining_micro);
  assert.equal(Number(emergencyBudget.target_micro),50_000_000);assert.equal(Number(emergencyBudget.cap_micro),60_000_000);
  assert.ok(obligations>50_000_000&&obligations<60_000_000);
  const emergencyJob=emergencyPlan.jobs.find(j=>j.stage==="final")!;
  const primaryClaim=await wallet.claim(emergencyJob.key,"emergency-primary",emergencyBounds.map(b=>({...b,strong_input_tokens:145000})),true,"synthetic-owner");
  assert.equal(primaryClaim.claimed,true);assert.equal(primaryClaim.job!.model,"gpt-6-luna");
  await wallet.finish(emergencyJob.key,primaryClaim.token!,null,"synthetic_unsent");
  const emergencyDenied=makePropsWalletPlan({...{month:"2030-05",now:"2030-05-06T21:40:00Z",sources},games:Array.from({length:900},(_,i)=>({...game(`limit${i}`),start:"2030-05-06T23:00:00Z",lock:"2030-05-06T22:00:00Z"})),bounds:Object.fromEntries(Array.from({length:900},(_,i)=>[`nba|limit${i}`,emergencyBounds]))});
  assert.equal((await wallet.plan(emergencyDenied)).funded,false);
  // The monthly allowance cannot all be spent on stronger finals on the first busy day.
  const spreadGames=Array.from({length:100},(_,i)=>({...game(`spread${i}`),start:`2030-06-${String(6+Math.floor(i/20)).padStart(2,"0")}T23:00:00Z`,lock:`2030-06-${String(6+Math.floor(i/20)).padStart(2,"0")}T22:00:00Z`}));
  const spreadPlan=makePropsWalletPlan({month:"2030-06",now:"2030-06-06T21:40:00Z",games:spreadGames,bounds:Object.fromEntries(spreadGames.map(g=>[`nba|${g.id}`,bounds])),sources});
  await db.query("UPDATE test_clock SET at='2030-06-06T21:40:00Z';UPDATE cron_job_leases SET lease_expires_at='2030-07-01T00:00:00Z'");
  assert.equal((await wallet.plan(spreadPlan)).funded,true);
  for(let i=0;i<3;i++){const key=reviewSlots(spreadGames[i])[1].key,c=await wallet.claim(key,`spread${i}`,bounds.map(b=>({...b,strong_input_tokens:1000})),true,"synthetic-owner");assert.equal(c.claimed,true);assert.equal(c.job!.model,i<2?"gpt-6.1-terra":"gpt-6-luna");await wallet.finish(key,c.token!,null,"synthetic_unsent");}
  const alreadyRunning=Number((await db.query("SELECT count(*) n FROM player_props_ai_reviews WHERE state='running'")).rows[0].n);
  assert.ok(alreadyRunning<16);
  const batchClaims:{key:string;token:string}[]=[];
  for(let i=0;i<=16-alreadyRunning;i++){
    const key=reviewSlots(spreadGames[i])[0].key;
    const c=await wallet.claim(key,`capacity${i}`,bounds.map(b=>({...b,strong_input_tokens:null})),false,"synthetic-owner");
    if(i<16-alreadyRunning){assert.equal(c.claimed,true);batchClaims.push({key,token:c.token!});}
    else {assert.equal(c.claimed,false);assert.equal(c.reason,"global_concurrency_busy");}
  }
  for(const c of batchClaims)await wallet.finish(c.key,c.token,null,"synthetic_unsent");
  console.log("Native slate capacity proof passed: up to sixteen funded games claim atomically; the seventeenth is deferred; no generation or added spending.");
  console.log("Target/emergency proof passed: all core reviews fund above $50, optional upgrades stay below target and daily/monthly 10%, $60 authorizations stop, no AI HTTP for these cases.");
  console.log("Native wallet/reviewer integration passed: exact request funding, full coverage, two stages, partial Flex/strong fallback, unknown charges, duplicates/concurrency, immutable results, cap rejection, UTC boundaries, 40-player partitioning, lock cutoff and RLS. All AI HTTP was mocked; zero paid calls.");
}finally{await other.end();await db.end();await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin.end();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
