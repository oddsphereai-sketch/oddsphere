import assert from 'node:assert/strict';
/** Exact shipped SQL in a deliberately disposable database. HTTP is forbidden. */
import {readFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {makePropsWalletPlan} from '../lib/playerPropsAi/walletPlan';
import {reviewSlots} from '../lib/playerPropsAi/schedule';
globalThis.fetch=async()=>{throw Error('No HTTP allowed');};
const ROOT=process.cwd();
const sources={nba:{complete:true as const,source:'synthetic complete'},nfl:{complete:true as const,source:'synthetic complete'},mlb:{complete:true as const,source:'synthetic none'}};
async function main(){
 const modulePath=process.argv[2],ci=process.env.GITHUB_ACTIONS==='true'&&process.env.MARKET_BRAIN_POSTGRES_PROOF_DISPOSABLE==='YES'&&process.argv[3]==='--ci-disposable';
 assert(modulePath&&(ci?realpathSync(modulePath).startsWith(realpathSync(process.env.RUNNER_TEMP!)+'/'):realpathSync(modulePath).startsWith('/private/tmp/')),'Disposable dependency required');const {default:pg}=await import(pathToFileURL(modulePath).href);
 const url=ci?new URL(process.env.MARKET_BRAIN_POSTGRES_URL!):null;
 if(url){assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5432');assert.equal(url.pathname,'/oddsphere_market_brain_test');assert.equal(url.username,'postgres');assert.equal(url.search,'');}
 const config=url?{host:url.hostname,port:5432,user:'postgres',password:decodeURIComponent(url.password)}:{host:'/private/tmp/oddsphere-props-r18-pg-20261109/socket',port:55588,user:'postgres'};
 const admin=new pg.Client({...config,database:'postgres'});await admin.connect();const database=`props_calendar_lifecycle_${Date.now()}`;await admin.query(`CREATE DATABASE ${database}`);
 const db=new pg.Client({...config,database}),other=new pg.Client({...config,database});await db.connect();await other.connect();
 const rpc=async(name:string,args:Record<string,unknown>,connection=db)=>{const entries=Object.entries(args);const r=await connection.query(`SELECT public.${name}(${entries.map(([k],i)=>k+'=> $'+(i+1)).join(',')}) AS v`,entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));return r.rows[0].v;};
 const at=async(value:string)=>db.query('UPDATE test_clock SET at=$1',[value]);
 const games=[{sport:'nba' as const,id:'espn:nba:1',start:'2030-11-17T21:00:00Z',lock:'2030-11-17T20:00:00Z',away:'LAL',home:'ATL',confirmed:true},{sport:'nfl' as const,id:'espn:nfl:2',start:'2030-11-17T22:00:00Z',lock:'2030-11-17T21:00:00Z',away:'BUF',home:'MIN',confirmed:true}];
 const plan=(gs=games)=>makePropsWalletPlan({month:'2030-11',now:'2030-11-17T12:00:00Z',games:gs,bounds:Object.fromEntries(gs.map(g=>[g.sport+'|'+g.id,Array.from({length:16},()=>({input_tokens:1000,max_output_tokens:7000}))])),sources});
 const fund=async(p:ReturnType<typeof plan>)=>rpc('player_props_ai_plan_v3',{p_month:p.month,p_jobs:p.jobs,p_companions:p.companionSlots,p_plan_hash:p.hash,p_sources:p.sources,p_release:p.release});
 const claim=async(key:string,parts=1)=>rpc('player_props_ai_claim',{p_key:key,p_hash:'synthetic-input',p_requests:Array.from({length:parts},()=>({input_tokens:1000,max_output_tokens:7000,strong_input_tokens:null})),p_prefer_stronger:false,p_writer_run:'synthetic-owner'});
 const send=async(key:string,token:string,part:number)=>rpc('player_props_ai_send',{p_key:key,p_token:token,p_phase:1,p_part:part});
 const receipt=async(id:string,token:string)=>rpc('player_props_ai_receipt',{p_id:id,p_token:token,p_actual:0,p_response:'synthetic-'+id,p_usage:{synthetic:true}});
 const finish=async(key:string,token:string,result:unknown)=>rpc('player_props_ai_finish',{p_key:key,p_token:token,p_result:result,p_error:null});
 const readProtected=async(key:string)=>JSON.stringify((await db.query('SELECT (SELECT to_jsonb(r) FROM player_props_ai_reviews r WHERE job_key=$1) AS job,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM player_props_ai_attempts a WHERE job_key=$1) AS attempts',[key])).rows[0]);
 try{
  for(const role of ['anon','authenticated','service_role'])await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  for(const v of ['v61-player-props-ai-runtime','v62-player-props-ai-wallet','v64-player-props-ai-budget-target','v63-player-props-ai-site-control','v66-player-props-ai-slate-capacity','v68-player-props-ai-standard-primary-escrow','v70-player-props-ai-calendar-lifecycle'])await db.query(readFileSync(`${ROOT}/lib/db/schema-migration-${v}.sql`,'utf8'));
  await db.query(readFileSync(`${ROOT}/lib/db/schema-migration-v70-player-props-ai-calendar-lifecycle.sql`,'utf8')); // idempotent before the test-clock seam
  await db.query("UPDATE player_props_ai_control SET paid_enabled=true"); // disposable database only
  await db.query("CREATE TABLE test_clock(at timestamptz);INSERT INTO test_clock VALUES('2030-11-17T12:00:00Z');CREATE FUNCTION props_ai_test_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT at FROM test_clock'");
  for(const f of (await db.query("SELECT pg_get_functiondef(oid) body FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'player_props_ai_%'")).rows)await db.query(f.body.replaceAll('clock_timestamp()','props_ai_test_clock()'));
  await db.query("CREATE TABLE cron_job_leases(job_name text PRIMARY KEY,run_id text,lease_expires_at timestamptz);INSERT INTO cron_job_leases VALUES('prediction_pipeline:nba','synthetic-owner','2030-11-18T00:00:00Z'),('prediction_pipeline:nfl','synthetic-owner','2030-11-18T00:00:00Z')");
  assert.equal((await fund(plan())).funded,true);
  const early=reviewSlots(games[0])[0].key;await at('2030-11-17T13:01:00Z');const c=await claim(early);assert(c.claimed);const a=await send(early,c.token,1);await receipt(a.id,c.token);assert.equal((await finish(early,c.token,{release:'synthetic',immutableOriginal:true})).state,'completed');
  const protectedBefore=await readProtected(early);
  const sameDay=[{...games[0],start:'2030-11-17T21:30:00Z',lock:'2030-11-17T20:30:00Z'},games[1]];
  const sameDayResult=await fund(plan(sameDay));assert.equal(sameDayResult.funded,true);assert.equal(sameDayResult.retained_started_slots,1);assert.equal(await readProtected(early),protectedBefore);
  await at('2030-11-17T14:01:00Z');const unrelatedClaim=await claim(reviewSlots(games[1])[0].key);assert.equal(unrelatedClaim.claimed,true);const unrelatedAttempt=await send(reviewSlots(games[1])[0].key,unrelatedClaim.token,1);await receipt(unrelatedAttempt.id,unrelatedClaim.token);await finish(reviewSlots(games[1])[0].key,unrelatedClaim.token,{release:'synthetic',unrelated:true});
  assert.equal((await fund(plan())).funded,true,'Restoring exact original fixtures funds the unchanged base');
  const nextDay=[{...games[0],start:'2030-11-18T21:00:00Z',lock:'2030-11-18T20:00:00Z'},games[1]];
  const nextDayResult=await fund(plan(nextDay));assert.equal(nextDayResult.funded,true);assert.equal(await readProtected(early),protectedBefore);const oldFinal=(await db.query('SELECT state FROM player_props_ai_reviews WHERE job_key=$1',[reviewSlots(games[0])[1].key])).rows[0];assert.equal(oldFinal.state,'cancelled');
  // Restore original pending final through the existing no-attempt reconciliation.
  assert.equal((await fund(plan())).funded,true);await at('2030-11-17T19:40:00Z');const final=reviewSlots(games[0])[1].key,fc=await claim(final,16);assert(fc.claimed);
  for(let p=1;p<=8;p++){const a=await send(final,fc.token,p);await receipt(a.id,fc.token);}
  await at('2030-11-17T19:42:40Z');const second=[];for(let p=9;p<=16;p++)second.push(await send(final,fc.token,p));
  await at('2030-11-17T19:45:01Z');assert.equal((await db.query("SELECT player_props_ai_has_writer('nba','synthetic-owner') yes")).rows[0].yes,true);
  const reaped=(await db.query('SELECT player_props_ai_reap() n')).rows[0].n;
  const reapedJob=(await db.query('SELECT state,error_code FROM player_props_ai_reviews WHERE job_key=$1',[final])).rows[0];assert.equal(reaped,0);assert.equal(reapedJob.state,'running');assert.equal(reapedJob.error_code,null);
  await at('2030-11-17T19:45:20Z');for(const a of second)await receipt(a.id,fc.token);const lateHealthyFinish=await finish(final,fc.token,{release:'synthetic',all16PartsNowComplete:true});assert.equal(lateHealthyFinish.state,'completed','An exact still-live writer owns its full bounded review window');
  assert.equal(await readProtected(early),protectedBefore);
  // Exact-owner crash/lock cleanup must retain unresolved charges, not mistake
  // another run's or another sport's lease for ownership of this job.
  const pendingNflFinal=reviewSlots(games[1])[1].key;await at('2030-11-17T20:36:00Z');const orphan=await claim(pendingNflFinal);assert(orphan.claimed);const unknownAttempt=await send(pendingNflFinal,orphan.token,1);
  await db.query("UPDATE cron_job_leases SET run_id='another-owner' WHERE job_name='prediction_pipeline:nfl'");await at('2030-11-17T20:42:00Z');
  const reserveBefore=(await db.query('SELECT consumed_micro FROM player_props_ai_budgets WHERE month_key=\'2030-11\'')).rows[0].consumed_micro;
  assert.equal((await db.query('SELECT player_props_ai_reap() n')).rows[0].n,1);
  const orphanRow=(await db.query('SELECT state,actual_micro,reserved_micro FROM player_props_ai_attempts WHERE id=$1',[unknownAttempt.id])).rows[0];assert.equal(orphanRow.state,'unknown');assert.equal(orphanRow.actual_micro,null);assert(orphanRow.reserved_micro>0);
  assert.equal((await db.query('SELECT consumed_micro FROM player_props_ai_budgets WHERE month_key=\'2030-11\'')).rows[0].consumed_micro,reserveBefore,'Unknown sent charge remains held');
  await db.query("UPDATE cron_job_leases SET run_id='synthetic-owner' WHERE job_name='prediction_pipeline:nfl'");

  // Atomic day updates from separate sport writers retain one another and the
  // original full-month capture clock. New and legacy stale planners are inert.
  await at('2030-11-17T19:46:10Z');
  const legacyCalendar={release:'player_props_ai_calendar_2026_11_07_r1_complete_month',month:'2030-11',capturedAt:'2030-11-17T12:00:00Z',games,sources};
  await db.query('INSERT INTO player_props_ai_calendars(month_key,release,captured_at,payload) VALUES($1,$2,$3,$4)',[legacyCalendar.month,legacyCalendar.release,legacyCalendar.capturedAt,JSON.stringify(legacyCalendar)]);
  const update=(sport:'nba'|'nfl',fixture:typeof games[number],availableAt:string)=>({p_month:'2030-11',p_writer_run:'synthetic-owner',p_sport:sport,p_day:'2030-11-17',p_full_capture_at:legacyCalendar.capturedAt,p_update:{release:'player_props_ai_calendar_day_2026_11_10_r1_bounded_official_reconciliation',requestedAt:'2030-11-17T19:45:30Z',availableAt,source:`https://site.api.espn.com/apis/site/v2/sports/${sport==='nba'?'basketball/nba':'football/nfl'}/scoreboard?dates=20301117&limit=100`,fixtureHash:'a'.repeat(64),fixtureIds:[fixture.id],fixtures:[fixture]}});
  const nbaNew={...games[0],start:'2030-11-17T21:30:00Z',lock:'2030-11-17T20:30:00Z'},nflNew={...games[1],start:'2030-11-17T22:30:00Z',lock:'2030-11-17T21:30:00Z'};
  const merged=await Promise.all([rpc('player_props_ai_merge_calendar_day_v1',update('nba',nbaNew,'2030-11-17T19:46:00Z')),rpc('player_props_ai_merge_calendar_day_v1',update('nfl',nflNew,'2030-11-17T19:46:05Z'),other)]);assert(merged.every(r=>r.status==='merged'));
  const cached=async()=>(await db.query('SELECT payload,captured_at FROM player_props_ai_calendars WHERE month_key=\'2030-11\'')).rows[0];
  const mergedCalendar=(await cached()).payload;assert.equal(new Date((await cached()).captured_at).toISOString(),'2030-11-17T12:00:00.000Z');assert.equal(mergedCalendar.capturedAt,legacyCalendar.capturedAt);assert.equal(mergedCalendar.games.find((g:{sport:string})=>g.sport==='nba').start,nbaNew.start);assert.equal(mergedCalendar.games.find((g:{sport:string})=>g.sport==='nfl').start,nflNew.start);assert.equal(Object.keys(mergedCalendar.dayUpdates).length,2);
  const planArgs=(p:ReturnType<typeof plan>)=>({p_month:p.month,p_jobs:p.jobs,p_companions:p.companionSlots,p_plan_hash:p.hash,p_sources:p.sources,p_release:p.release});
  const walletBefore=JSON.stringify((await db.query('SELECT * FROM player_props_ai_budgets ORDER BY month_key')).rows);
  const staleLegacy=await fund(plan());assert.equal(staleLegacy.reason,'calendar_reference_changed');assert.equal(JSON.stringify((await db.query('SELECT * FROM player_props_ai_budgets ORDER BY month_key')).rows),walletBefore);
  const currentPlan=plan([nbaNew,nflNew]),v4args={...planArgs(currentPlan),p_reconciliation_release:'player_props_ai_reconciliation_2026_11_10_r1_immutable_consumed_slots',p_calendar_capture_at:mergedCalendar.capturedAt,p_calendar_revision:mergedCalendar.revision};
  assert.equal((await rpc('player_props_ai_plan_v4',v4args)).funded,true);assert.equal((await rpc('player_props_ai_plan_v4',{...v4args,p_calendar_revision:'stale'})).reason,'calendar_reference_changed');
  const beforeLegacyWrite=JSON.stringify((await cached()).payload);
  await db.query('UPDATE player_props_ai_calendars SET captured_at=$1,payload=$2 WHERE month_key=\'2030-11\'',['2030-11-17T19:45:30Z',JSON.stringify({...legacyCalendar,capturedAt:'2030-11-17T19:45:30Z'})]);assert.equal(JSON.stringify((await cached()).payload),beforeLegacyWrite,'An in-flight old capture cannot clobber newer day receipts');
  const capture={...mergedCalendar,revision:'11111111-1111-4111-8111-111111111111',capturedAt:'2030-11-17T19:46:10Z',captureRelease:'player_props_ai_calendar_capture_2026_11_10_r2_response_completion',captureClockMeaning:'response_completion',sources:{...sources,_calendar_revision:{revision:'11111111-1111-4111-8111-111111111111',fullCapturedAt:'2030-11-17T19:46:10Z'}}};
  const staleCapture=await rpc('player_props_ai_store_calendar_v1',{p_month:'2030-11',p_expected_capture_at:legacyCalendar.capturedAt,p_expected_revision:null,p_calendar:capture});assert.equal(staleCapture.status,'superseded');assert.equal(JSON.stringify((await cached()).payload),beforeLegacyWrite);
  const goodCapture=await rpc('player_props_ai_store_calendar_v1',{p_month:'2030-11',p_expected_capture_at:legacyCalendar.capturedAt,p_expected_revision:mergedCalendar.revision,p_calendar:capture});assert.equal(goodCapture.status,'stored');
  for(const role of ['anon','authenticated']){await db.query(`SET ROLE ${role}`);await assert.rejects(rpc('player_props_ai_plan_v4',v4args),/permission denied/);await assert.rejects(rpc('player_props_ai_merge_calendar_day_v1',update('nba',nbaNew,'2030-11-17T19:46:00Z')),/permission denied/);await db.query('RESET ROLE');}
  assert.equal((await db.query("SELECT has_function_privilege('service_role','public.player_props_ai_plan_v3_legacy(text,jsonb,jsonb,text,jsonb,text)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal(await readProtected(early),protectedBefore);
  // A consumed early companion stays in its original UTC billing month; its
  // still-pending final may move in the new month's verified calendar.
  await at('2031-01-31T18:01:00Z');await db.query("UPDATE cron_job_leases SET run_id='synthetic-owner',lease_expires_at='2031-04-02T00:00:00Z'");
  const boundary={sport:'nba' as const,id:'espn:nba:3',start:'2031-02-01T02:00:00Z',lock:'2031-02-01T01:00:00Z'};
  const bound=Array.from({length:2},()=>({input_tokens:1000,max_output_tokens:7000}));
  const january=makePropsWalletPlan({month:'2031-01',now:'2031-01-31T18:01:00Z',games:[boundary],bounds:{'nba|espn:nba:3':bound},sources});assert.equal((await fund(january)).funded,true);
  const boundaryEarly=reviewSlots(boundary)[0].key,bc=await claim(boundaryEarly);assert(bc.claimed);const ba=await send(boundaryEarly,bc.token,1);await receipt(ba.id,bc.token);await finish(boundaryEarly,bc.token,{release:'synthetic',january:true});const boundaryProtected=await readProtected(boundaryEarly);
  await at('2031-02-01T00:10:00Z');const boundaryShift={...boundary,start:'2031-02-01T02:30:00Z',lock:'2031-02-01T01:30:00Z'};
  const february=makePropsWalletPlan({month:'2031-02',now:'2031-02-01T00:10:00Z',games:[boundaryShift],bounds:{'nba|espn:nba:3':bound},sources});const feb=await fund(february);assert.equal(feb.funded,true);assert.equal(await readProtected(boundaryEarly),boundaryProtected);
  assert.equal((await db.query("SELECT billing_month FROM player_props_ai_reviews WHERE job_key=$1",[boundaryEarly])).rows[0].billing_month,'2031-01');assert.equal((await db.query("SELECT count(*)::integer n FROM player_props_ai_reviews WHERE billing_month='2031-02'")).rows[0].n,1);
  const febBefore=JSON.stringify((await db.query("SELECT * FROM player_props_ai_budgets WHERE month_key IN ('2031-01','2031-02') ORDER BY month_key")).rows);
  await assert.rejects(rpc('player_props_ai_plan_v4',{...planArgs(february),p_jobs:february.jobs.map((j,i)=>i?j:{...j,billingMonth:'2031-03'}),p_reconciliation_release:'player_props_ai_reconciliation_2026_11_10_r1_immutable_consumed_slots',p_calendar_capture_at:null,p_calendar_revision:null}),/invalid_submitted_calendar_contract/);
  assert.equal(JSON.stringify((await db.query("SELECT * FROM player_props_ai_budgets WHERE month_key IN ('2031-01','2031-02') ORDER BY month_key")).rows),febBefore,'Invalid submitted month cannot be laundered through a consumed slot or poison funding');
  // Reap after the real lock even with an otherwise valid owner, preserving
  // sent unknown reservations and never constructing a completed review.
  await at('2031-02-01T01:06:00Z');const boundaryFinal=reviewSlots(boundaryShift)[1].key,bf=await claim(boundaryFinal);assert(bf.claimed);const bfAttempt=await send(boundaryFinal,bf.token,1);await at('2031-02-01T01:30:00Z');assert.equal((await db.query('SELECT player_props_ai_reap() n')).rows[0].n,1);assert.equal((await db.query('SELECT state FROM player_props_ai_reviews WHERE job_key=$1',[boundaryFinal])).rows[0].state,'expired');assert.equal((await db.query('SELECT state,actual_micro FROM player_props_ai_attempts WHERE id=$1',[bfAttempt.id])).rows[0].state,'unknown');assert.equal(await readProtected(boundaryEarly),boundaryProtected);
  console.log('Calendar lifecycle SQL passed: immutable consumed slots, same/next-day and cross-month reconciliation, unrelated funding, exact active-owner completion, lost-owner and after-lock unknown holds, atomic cross-sport merge, unchanged full TTL, stale new/legacy planner isolation, full-capture CAS, wrong-month refusal and private ACL. No HTTP or paid calls.');
 }finally{await other.end();await db.end();await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
