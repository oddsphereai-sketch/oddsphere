/** Disposable native PostgreSQL wallet proof. Synthetic data; no HTTP or application env. */
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [pgModule,socket,portText,repo]=process.argv.slice(2);
const privatePath=p=>typeof p==='string'&&realpathSync(p).startsWith('/private/tmp/');
const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.MARKET_BRAIN_POSTGRES_PROOF_DISPOSABLE==='YES'&&socket==='--ci-disposable';
assert.ok(ci ? realpathSync(pgModule).startsWith(realpathSync(process.env.RUNNER_TEMP)+'/')&&realpathSync(repo)===realpathSync(process.cwd()) : privatePath(pgModule)&&privatePath(socket)&&privatePath(repo),'Explicit disposable test paths required');
let config;
if(ci){
 const url=new URL(process.env.MARKET_BRAIN_POSTGRES_URL);
 assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5432');assert.equal(url.pathname,'/oddsphere_market_brain_test');assert.equal(url.username,'postgres');assert.equal(url.search,'');
 config={host:url.hostname,port:5432,user:'postgres',password:decodeURIComponent(url.password),connectionTimeoutMillis:3000};
}else{
 const port=Number(portText);assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 assert.ok(statSync(join(socket,`.s.PGSQL.${port}`)).isSocket());
 assert.equal(readFileSync(join(socket,'DISPOSABLE_OFFLINE_PROPS_WALLET_TEST'),'utf8'),'DISPOSABLE_OFFLINE_PROPS_WALLET_TEST\n');
 config={host:realpathSync(socket),port,user:'postgres',connectionTimeoutMillis:3000};
}
const {default:pg}=await import(pathToFileURL(realpathSync(pgModule)).href);
const admin=new pg.Client({...config,database:'postgres'});await admin.connect();
if(!ci){const settings=(await admin.query("SELECT current_setting('data_directory') d,current_setting('listen_addresses') a")).rows[0];assert.ok(privatePath(settings.d));assert.equal(settings.a,'');}
const database=`props_escrow_proposal_${process.pid}_${Date.now()}`;
await admin.query(`CREATE DATABASE ${database}`);
const clients=[];
const connect=async()=>{const c=new pg.Client({...config,database});await c.connect();clients.push(c);return c;};
const db=await connect();
const report={privateOnly:true,syntheticCalendar:{nba:214,nfl:71,mlb:0,realCalendar:false},cases:[]};
const passed=(name,details={})=>report.cases.push({name,...details});
const R5='player_props_ai_budget_2026_11_09_r5_standard_primary_and_early';
const OLD='player_props_ai_budget_2026_11_08_r4_target_and_emergency';
const sources={nba:{complete:true,source:'fictional 214-NBA synthetic assumption'},nfl:{complete:true,source:'fictional 71-NFL synthetic assumption'},mlb:{complete:true,source:'synthetic no games'}};
const requests=sport=>Array.from({length:sport==='nfl'?8:3},()=>({input_tokens:sport==='nfl'?60000:70000,strong_input_tokens:sport==='nfl'?60000:70000,max_output_tokens:7000}));
const quote=rs=>rs.reduce((s,r)=>s+Math.ceil((r.input_tokens+2048)/10+r.max_output_tokens/2),0);
const calendar=(month,nba,nfl)=>{
 const jobs=[];for(const [sport,n] of [['nba',nba],['nfl',nfl]])for(let i=0;i<n;i++)for(const stage of ['early','final']){
  const gameDay=`${month}-15`,gameId=`synthetic-${sport}-${i}`,key=`props-ai|${sport}|${gameId}|${gameDay}|${stage}`;
  jobs.push({key,sport,gameId,gameDay,stage,start:`${gameDay}T23:00:00Z`,lock:`${gameDay}T22:00:00Z`,dueAt:`${gameDay}T${stage==='early'?'15:00':'21:35'}:00Z`,billingMonth:month,requests:requests(sport)});
 }return {month,jobs,companions:jobs.map(({requests,...j})=>{void requests;return j;})};
};
const value=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0].v;
const budget=async(month)=>(await db.query('SELECT * FROM player_props_ai_budgets WHERE month_key=$1',[month])).rows[0];
const balance=b=>['consumed_micro','core_reserved_micro','fallback_remaining_micro','recovery_remaining_micro'].map(k=>Number(b[k]));
const job=async(key)=>(await db.query('SELECT * FROM player_props_ai_reviews WHERE job_key=$1',[key])).rows[0];
const at=async(t)=>db.query('UPDATE test_clock SET at=$1',[t]);
const plan=async(c,release=R5)=>value(db,'SELECT player_props_ai_plan_v3($1,$2,$3,$4,$5,$6) v',[c.month,JSON.stringify(c.jobs),JSON.stringify(c.companions),`synthetic-hash-${c.month}`,JSON.stringify(sources),release]);
const claim=(c,j,strong=false)=>value(c,'SELECT player_props_ai_claim($1,$2,$3,$4,$5) v',[j.key,`synthetic-input-${j.key}`,JSON.stringify(j.requests),strong,'synthetic-owner']);
const fallback=(c,j,t,parts)=>value(c,'SELECT player_props_ai_fallback($1,$2,$3,$4) v',[j.key,t,parts,'synthetic known-rejection or paid invalid draft']);
const finish=(c,j,t,result={synthetic:true},error=null)=>value(c,'SELECT player_props_ai_finish($1,$2,$3,$4) v',[j.key,t,result===null?null:JSON.stringify(result),error]);
const attempts=(key,phase)=>db.query('SELECT * FROM player_props_ai_attempts WHERE job_key=$1 AND phase=$2 ORDER BY part',[key,phase]);
async function receipts(c,j,t,phase,actuals){
 const sent=[];
 for(let i=0;i<actuals.length;i++){
  const a=await value(c,'SELECT player_props_ai_send($1,$2,$3,$4) v',[j.key,t,phase,i+1]);
  assert.equal(a.requested_tier,'default');sent.push(a);
 }
 // Overrun freezes new sends, not billing receipts for already in-flight parts.
 for(let i=0;i<actuals.length;i++){
  const a=sent[i];
  const actual=actuals[i]==='bound'?Number(a.reserved_micro):actuals[i];
  await c.query('SELECT player_props_ai_receipt($1,$2,$3,$4,$5)',[a.id,t,actual,`synthetic-${a.id}`,JSON.stringify({synthetic:true,kind:actual===0?'synthetic_known_zero_ledger':actual===null?'unknown':'known_usage'})]);
 }
}
async function secondPartReceipt(c,j,t){
 const a=await value(c,'SELECT player_props_ai_send($1,$2,2,2) v',[j.key,t]);
 await c.query('SELECT player_props_ai_receipt($1,$2,$3,$4,$5)',[a.id,t,a.reserved_micro,`synthetic-${a.id}`,JSON.stringify({synthetic:true})]);
}
try{
 for(const role of ['anon','authenticated','service_role'])await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
 for(const migration of ['v61-player-props-ai-runtime','v62-player-props-ai-wallet','v63-player-props-ai-site-control','v64-player-props-ai-budget-target','v66-player-props-ai-slate-capacity'])await db.query(readFileSync(join(repo,`lib/db/schema-migration-${migration}.sql`),'utf8'));
 const transition=calendar('2044-11',1,0);assert.equal((await plan(transition,OLD)).funded,true);
 const oldPending=await job(transition.jobs[0].key),oldBudget=await budget(transition.month);
 // Historic closed review/receipt and an unfunded current-policy row are preserved.
 await db.query("INSERT INTO player_props_ai_budgets(month_key,consumed_micro,policy_release) VALUES('2034-11',123,$1)",[OLD]);
 await db.query("INSERT INTO player_props_ai_reviews(job_key,sport,game_id,game_day,stage,scheduled_start,lock_at,due_at,billing_month,state,reserved_micro,result,parts,phase,claim_token) VALUES('old-immutable','nba','old','2034-11-15','early','2034-11-15T23:00Z','2034-11-15T22:00Z','2034-11-15T15:00Z','2034-11','completed',0,'{\"lockedEvidence\":\"exact\"}',1,1,gen_random_uuid())");
 await db.query("INSERT INTO player_props_ai_attempts(job_key,phase,part,model,reserved_micro,actual_micro,state,response_id,usage) VALUES('old-immutable',1,1,'gpt-6-luna',1000,123,'completed','old-exact','{\"exactReceipt\":true}')");
 const historic=async()=>value(db,"SELECT jsonb_build_array((SELECT to_jsonb(b) FROM player_props_ai_budgets b WHERE month_key='2034-11'),(SELECT to_jsonb(r) FROM player_props_ai_reviews r WHERE job_key='old-immutable'),(SELECT to_jsonb(a) FROM player_props_ai_attempts a WHERE job_key='old-immutable')) v");
 const before=await historic(),sql=readFileSync(join(repo,'lib/db/schema-migration-v68-player-props-ai-standard-primary-escrow.sql'),'utf8');
 await db.query('UPDATE player_props_ai_control SET paid_enabled=true');
 await assert.rejects(db.query(sql),/explicit_paid_pause_required/);await db.query('ROLLBACK');
 await db.query('UPDATE player_props_ai_control SET paid_enabled=false');
 await db.query(sql);await db.query(sql);assert.deepEqual(await historic(),before);
 assert.deepEqual(await job(transition.jobs[0].key),oldPending);assert.deepEqual(await budget(transition.month),oldBudget);
 passed('migration prerequisites, installed body guards, idempotence and byte-equivalent old JSON');
 await db.query("CREATE TABLE test_clock(at timestamptz); INSERT INTO test_clock VALUES('2035-11-15T15:05Z'); CREATE FUNCTION props_escrow_test_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT at FROM test_clock'");
 for(const {body} of (await db.query("SELECT pg_get_functiondef(oid) body FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'player_props_ai_%'")).rows)await db.query(body.replaceAll('clock_timestamp()','props_escrow_test_clock()'));
 await db.query("CREATE TABLE cron_job_leases(job_name text PRIMARY KEY,run_id text,lease_expires_at timestamptz); INSERT INTO cron_job_leases VALUES('prediction_pipeline:nba','synthetic-owner','2050-01-01T00:00:00Z'),('prediction_pipeline:nfl','synthetic-owner','2050-01-01T00:00:00Z'); UPDATE player_props_ai_control SET paid_enabled=true");
 await at('2044-11-15T15:05Z');assert.equal((await claim(db,transition.jobs[0])).reason,'complete_month_not_funded');
 assert.equal((await plan(transition)).funded,true);assert.equal(Number((await budget(transition.month)).core_reserved_micro),2*quote(transition.jobs[0].requests));
 assert.equal((await job(transition.jobs[0].key)).requested_tier,'default');passed('genuine R4 pending plan stays unchanged at migration and is funded/requested at Standard only on R5 full-calendar replan');
 await at('2035-11-15T15:05Z');
 const pool=await Promise.all(Array.from({length:16},connect));
 const full=calendar('2035-11',214,71),standard=full.jobs.reduce((s,j)=>s+quote(j.requests),0);
 assert.equal((await plan(full)).funded,true);let b=await budget(full.month);
 assert.equal(Number(b.core_reserved_micro),standard);assert.equal(Number(b.planned_games),285);
 assert.equal(full.jobs.length,570);const protectedBefore=[Number(b.fallback_remaining_micro),Number(b.recovery_remaining_micro)];
 assert.equal(protectedBefore[0],29*quote(requests('nfl')));
 for(const j of full.jobs){const r=await job(j.key);assert.equal(Number(r.reserved_micro),quote(j.requests));assert.equal(Number(r.planned_primary_micro),quote(j.requests));assert.equal(r.requested_tier,'default');}
 passed('570 slots and both remaining primary stages funded and requested at Standard',{standard_micro:standard,protected_pools:protectedBefore});
 // A stale R4 label cannot unlock new claims; restoring R5 follows a real replan.
 await db.query('UPDATE player_props_ai_budgets SET policy_release=$1 WHERE month_key=$2',[OLD,full.month]);
 assert.equal((await claim(db,full.jobs[0])).reason,'complete_month_not_funded');
 assert.equal((await plan(full)).funded,true);
 passed('old discounted-policy funding stamp cannot authorize new claims');
 const early=full.jobs.filter(j=>j.stage==='early');
 for(let off=0;off<early.length;off+=16){
  const batch=early.slice(off,off+16),claims=await Promise.all(batch.map((j,i)=>claim(pool[i],j)));
  claims.forEach(c=>{assert.equal(c.claimed,true);assert.equal(c.job.model,'gpt-6-luna');assert.equal(c.job.requested_tier,'default');});
  if(off===0){assert.equal((await claim(db,early[16])).reason,'global_concurrency_busy');passed('16 independent clients claim concurrently; 17th remains pending');}
  await Promise.all(batch.map((j,i)=>receipts(pool[i],j,claims[i].token,1,j.requests.map(()=>'bound'))));
  await Promise.all(batch.map(async(j,i)=>{
   assert.equal((await finish(pool[i],j,claims[i].token)).state,'completed');
   assert.equal((await attempts(j.key,2)).rows.length,0);
  }));
 }
 await at('2035-11-15T21:40Z');
 for(const j of full.jobs.filter(j=>j.stage==='final')){const c=await claim(db,j);assert.equal(c.claimed,true);assert.equal(c.job.requested_tier,'default');await receipts(db,j,c.token,1,j.requests.map(()=>'bound'));assert.equal((await finish(db,j,c.token)).state,'completed');}
 b=await budget(full.month);assert.equal(Number(b.consumed_micro),standard);assert.equal(Number(b.core_reserved_micro),0);assert.deepEqual([Number(b.fallback_remaining_micro),Number(b.recovery_remaining_micro)],protectedBefore);
 assert.equal(Number((await db.query("SELECT count(*) n FROM player_props_ai_reviews WHERE billing_month=$1 AND state='completed'",[full.month])).rows[0].n),570);
 assert.equal((await claim(db,early[0])).reason,'not_pending');
 passed('all 285 Standard Luna early primaries plus 285 final Standard primaries finish at full bound in phase1; no protected-pool spend',{consumed_micro:Number(b.consumed_micro)});
 // Deliberately remove every dollar of spare liquidity in this test database.
 const tight=calendar('2036-11',1,0);await at('2036-11-15T15:05Z');assert.equal((await plan(tight)).funded,true);
 const tj=tight.jobs[0],tc=await claim(db,tj);await receipts(db,tj,tc.token,1,tj.requests.map(()=>0));
 await db.query('UPDATE player_props_ai_budgets SET fallback_remaining_micro=0,recovery_remaining_micro=0,cap_micro=core_reserved_micro+consumed_micro WHERE month_key=$1',[tight.month]);
 const tightBefore=balance(await budget(tight.month));assert.equal(await fallback(db,tj,tc.token,[1,2,3]),true);assert.deepEqual(balance(await budget(tight.month)),tightBefore);
 await receipts(db,tj,tc.token,2,tj.requests.map(()=>'bound'));assert.equal((await finish(db,tj,tc.token)).state,'completed');passed('synthetic known-zero ledger case: zero extra liquidity needs no new money; not a claim that Standard 429 is unbilled');
 // Two-part mixed scenarios; accepted part1 is never bought again.
 for(const [year,mode] of [[2037,'reuse'],[2038,'paid_invalid'],[2039,'unknown'],[2040,'overrun']]){
  const cal=calendar(`${year}-11`,1,0);cal.jobs.forEach(j=>j.requests=j.requests.slice(0,2));await at(`${year}-11-15T15:05Z`);assert.equal((await plan(cal)).funded,true);
  const j=cal.jobs[0],c=await claim(db,j),p=quote([j.requests[0]]),R=2*p;
  const actual=mode==='reuse'?[Math.floor(p/4),Math.floor(p/4)]:mode==='unknown'?[0,null]:mode==='overrun'?[p+1,0]:[p,p];
  await receipts(db,j,c.token,1,actual);const prior=balance(await budget(cal.month));
  const ok=await fallback(db,j,c.token,[2]);assert.equal(ok,!['unknown','overrun'].includes(mode));
  if(ok){const expected=Math.max(0,actual[0]+actual[1]+p-R);assert.equal(balance(await budget(cal.month))[0]-prior[0],expected);assert.equal((await attempts(j.key,2)).rows.length,1);assert.equal((await attempts(j.key,2)).rows[0].part,2);assert.equal(await fallback(db,j,c.token,[2]),false);await secondPartReceipt(db,j,c.token);assert.equal((await finish(db,j,c.token)).state,'completed');}
  else{assert.equal((await attempts(j.key,2)).rows.length,0);await finish(db,j,c.token,null,'synthetic failure');assert.equal((await claim(db,j)).reason,'not_pending');}
  passed(`mixed phase1 ${mode}: exact additional escrow, no accepted-part replay, <=2 phases`);
 }
 // Existing Standard-funded stronger final includes its primary fallback contingency.
 const upgrade=calendar('2041-11',214,71);await at('2041-11-15T21:40Z');assert.equal((await plan(upgrade)).funded,true);
 const finals=upgrade.jobs.filter(j=>j.stage==='final'&&j.sport==='nfl');
 for(const [i,j] of finals.slice(0,29).entries()){
  const c=await claim(db,j,true);assert.equal(c.claimed,true);assert.equal(c.job.model,i<28?'gpt-6.1-terra':'gpt-6-luna');
  await receipts(db,j,c.token,1,j.requests.map(()=>'bound'));
  if(i===0){const prior=balance(await budget(upgrade.month));assert.equal(await fallback(db,j,c.token,[1]),true);assert.deepEqual(balance(await budget(upgrade.month)),prior);const a=await value(db,'SELECT player_props_ai_send($1,$2,2,1) v',[j.key,c.token]);await db.query('SELECT player_props_ai_receipt($1,$2,$3,$4,$5)',[a.id,c.token,a.reserved_micro,`synthetic-${a.id}`,JSON.stringify({synthetic:true})]);}
  assert.equal((await finish(db,j,c.token)).state,'completed');
 }
 b=await budget(upgrade.month);assert.equal(Number(b.stronger_finals),28);assert.equal(Number(b.target_micro),50_000_000);assert.equal(Number(b.cap_micro),60_000_000);
 passed('monthly/daily 10% upgrades, $50 target/$60 ceiling, Terra contingency retained unchanged');
 // Guard refusals do not create phase2 attempts, even when sufficient budget exists.
 const guards=calendar('2042-11',1,0);await at('2042-11-15T15:05Z');assert.equal((await plan(guards)).funded,true);const gj=guards.jobs[0],gc=await claim(db,gj);await receipts(db,gj,gc.token,1,gj.requests.map(()=>0));
 assert.equal(await fallback(db,gj,'00000000-0000-0000-0000-000000000000',[1]),false);
 await db.query("UPDATE cron_job_leases SET run_id='different-owner' WHERE job_name='prediction_pipeline:nba'");assert.equal(await fallback(db,gj,gc.token,[1]),false);
 await db.query("UPDATE cron_job_leases SET run_id='synthetic-owner' WHERE job_name='prediction_pipeline:nba'");
 await at('2042-11-15T21:59:40Z');assert.equal(await fallback(db,gj,gc.token,[1]),false);
 await at('2042-11-15T22:01Z');await finish(db,gj,gc.token,null,'after_lock');assert.equal(await fallback(db,gj,gc.token,[1]),false);assert.equal((await claim(db,gj)).reason,'not_pending');
 assert.equal((await attempts(gj.key,2)).rows.length,0);passed('wrong token, sport lease, 20-second boundary, closed slot and phase guards retained');
 const infeasible=calendar('2043-11',214,71);infeasible.jobs.forEach(j=>j.requests=Array.from({length:16},()=>({input_tokens:145000,max_output_tokens:7000})));
 await at('2043-11-15T15:05Z');assert.equal((await plan(infeasible)).funded,false);
 assert.equal(Number((await db.query('SELECT count(*) n FROM player_props_ai_reviews WHERE billing_month=$1',[infeasible.month])).rows[0].n),0);passed('truthful full-calendar infeasible state when actual Standard envelopes exceed cap; no partial funding');
 assert.deepEqual(await historic(),before);passed('historical budget/review/receipt JSON unchanged after entire test');
 
 console.log(JSON.stringify(report,null,2));
}finally{
 for(const c of clients.reverse())await c.end().catch(()=>{});
 await admin.query(`DROP DATABASE ${database}`);await admin.end();
}
