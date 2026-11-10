/** Disposable local PostgreSQL only. Every HTTP request is forbidden. */
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {syntheticNflIdentityFailureArgs} from './test-player-props-ai-nfl-identity-failure-evidence';
import {buildNflIdentityFailureEvidence,type NflIdentityFailureRecord,type NflIdentityFailureArgs} from '../lib/playerPropsAi/nflIdentityFailureEvidence';
globalThis.fetch=async()=>{throw Error('Disposable source-failure PostgreSQL proof forbids HTTP');};
async function main(){
 const modulePath=process.argv[2],ci=process.env.GITHUB_ACTIONS==='true'&&process.env.MARKET_BRAIN_POSTGRES_PROOF_DISPOSABLE==='YES'&&process.argv[3]==='--ci-disposable';
 assert(modulePath&&(ci?realpathSync(modulePath).startsWith(realpathSync(process.env.RUNNER_TEMP!)+'/'):realpathSync(modulePath).startsWith('/private/tmp/')),'Only explicitly disposable dependencies are permitted');
 const {default:pg}=await import(pathToFileURL(modulePath).href),url=ci?new URL(process.env.MARKET_BRAIN_POSTGRES_URL!):null;
 if(url){assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5432');assert.equal(url.pathname,'/oddsphere_market_brain_test');assert.equal(url.username,'postgres');assert.equal(url.search,'');}
 const host=process.argv[3]??'/private/tmp/oddsphere-props-r18-pg-20261109/socket',port=Number(process.argv[4]??55588);
 assert(ci||(host.startsWith('/private/tmp/')&&Number.isSafeInteger(port)&&port>=1024&&port<=65535),'Only disposable local IPC is permitted');
 const config=url?{host:url.hostname,port:5432,user:'postgres',password:decodeURIComponent(url.password)}:{host,port,user:'postgres'};
 const admin=new pg.Client({...config,database:'postgres'});await admin.connect();const database=`props_source_failure_${Date.now()}`;await admin.query(`CREATE DATABASE ${database}`);
 const db=new pg.Client({...config,database}),other=new pg.Client({...config,database});await db.connect();await other.connect();
 try{
  for(const role of ['anon','authenticated','service_role'])await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  for(const file of ['v61-player-props-ai-runtime','v62-player-props-ai-wallet','v64-player-props-ai-budget-target','v63-player-props-ai-site-control','v66-player-props-ai-slate-capacity','v68-player-props-ai-standard-primary-escrow','v69-player-props-ai-source-failures'])await db.query(readFileSync(`lib/db/schema-migration-${file}.sql`,'utf8'));
  await db.query(readFileSync('lib/db/schema-migration-v69-player-props-ai-source-failures.sql','utf8'));
  await db.query("CREATE TABLE cron_job_leases(job_name text PRIMARY KEY,run_id text,lease_expires_at timestamptz); INSERT INTO cron_job_leases VALUES('prediction_pipeline:nfl','synthetic-owner',clock_timestamp()+interval '1 hour')");
  await db.query("INSERT INTO player_props_ai_budgets(month_key,cap_micro) VALUES('2026-11',60000000)");
  const now=Date.parse((await db.query('SELECT clock_timestamp()::text AS at')).rows[0].at);
  const make=(key:string,closed=false,tooLate=false)=>{
   const args=syntheticNflIdentityFailureArgs(new Date(now-(tooLate?12*60000:closed?5*60000:5000)).toISOString());args.job.job_key=key;args.job.game_id=`funded-${key}`;
   if(closed){const lock=new Date(now-(tooLate?11*60000:2*60000)).toISOString();args.window.lock=lock;args.job.lock_at=lock;args.job.state='expired';}
   args.capturedAt=new Date(tooLate?now-10*60000:now-1000).toISOString();return args;
  };
  const fixtures=[make('normal'),make('closed',true),make('late',true,true),make('race'),make('final')];fixtures[4].job.stage='final';fixtures[4].window.stage='final';
  for(const args of fixtures)await db.query('INSERT INTO player_props_ai_reviews(job_key,sport,game_id,game_day,stage,scheduled_start,lock_at,due_at,billing_month,state,reserved_micro) VALUES($1,\'nfl\',$2,\'2026-11-09\',$3,$4,$5,$6,\'2026-11\',$7,0)',[args.job.job_key,args.job.game_id,args.job.stage,args.job.scheduled_start,args.job.lock_at,args.job.due_at,args.job.state]);
  const record=(args:NflIdentityFailureArgs)=>{const c=buildNflIdentityFailureEvidence(args);if(c.kind!=='ready')throw Error(c.reason);return c.record;};
  const original=record(fixtures[0]),archiveBefore=JSON.stringify(original.archive);
  const snapshot=async()=>JSON.stringify((await db.query("SELECT (SELECT jsonb_agg(to_jsonb(b) ORDER BY month_key) FROM player_props_ai_budgets b) budgets,(SELECT jsonb_agg(to_jsonb(j) ORDER BY job_key) FROM player_props_ai_reviews j) jobs,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM player_props_ai_attempts a) attempts")).rows[0]);
  const protectedBefore=await snapshot();
  const append=async(c:NflIdentityFailureRecord,owner='synthetic-owner',conn=db)=>{const result=await conn.query('SELECT public.player_props_ai_append_source_failure_v1($1,$2::jsonb) AS v',[owner,JSON.stringify(c)]);return result.rows[0].v as {status:string;id?:string};};
  for(const role of ['anon','authenticated']){
   await db.query(`SET ROLE ${role}`);await assert.rejects(db.query('SELECT * FROM player_props_ai_nfl_source_failures'),/permission denied/);await assert.rejects(append(original),/permission denied/);await db.query('RESET ROLE');
  }
  await db.query('SET ROLE service_role');
  for(const sql of ["INSERT INTO player_props_ai_nfl_source_failures(job_key,kind,writer_run_id,observed_at,capture) VALUES('x','overflow','x',now(),'{}')","UPDATE player_props_ai_nfl_source_failures SET capture='{}'","DELETE FROM player_props_ai_nfl_source_failures","TRUNCATE player_props_ai_nfl_source_failures"])await assert.rejects(db.query(sql),/permission denied/);
  assert.equal((await append(original,'wrong-owner')).status,'unavailable');
  assert.equal((await append({...original,purpose:'authority'} as unknown as NflIdentityFailureRecord)).status,'unavailable');
  assert.equal((await append({...original,semanticSha256:'f'.repeat(64)})).status,'unavailable');
  assert.equal((await append({...original,identityRelease:'wrong'} as unknown as NflIdentityFailureRecord)).status,'unavailable');
  assert.equal((await append({...original,status:'other'} as unknown as NflIdentityFailureRecord)).status,'unavailable');
  assert.equal((await append({...original,observedAt:original.lock})).status,'unavailable');
  const futureObserved=new Date(now+60000).toISOString();assert.equal((await append({...original,observedAt:futureObserved,capturedAt:futureObserved})).status,'unavailable');
  const oversized={...original,extra:'x'.repeat(650000)};assert.equal((await append(oversized)).status,'unavailable');
  const added=await append(original);assert.equal(added.status,'stored');assert.equal((await append(original)).status,'duplicate');
  const churn=structuredClone(fixtures[0]);churn.observations.observations.forEach(row=>{row.providerObservationId+='-new';row.americanPrice=140;});const churnRecord=record(churn);assert.equal(churnRecord.semanticSha256,original.semanticSha256);assert.equal((await append(churnRecord)).status,'duplicate');
  const read=await db.query('SELECT capture FROM player_props_ai_nfl_source_failures WHERE id=$1',[added.id]);assert.deepEqual(read.rows[0].capture.archive,JSON.parse(archiveBefore),'First exact packet archive remains unchanged despite repeated price/ID polls');
  for(let i=0;i<3;i++){const next=structuredClone(fixtures[0]);next.observations.observations[0].providerPlayerId=`different-${i}`;assert.equal((await append(record(next))).status,'stored');}
  const overflow=structuredClone(fixtures[0]);overflow.observations.observations[0].providerPlayerId='overflow';assert.equal((await append(record(overflow))).status,'overflow');overflow.observations.observations[0].providerPlayerId='later-overflow';assert.equal((await append(record(overflow))).status,'overflow_already_recorded');
  assert.equal((await db.query("SELECT count(*)::integer n FROM player_props_ai_nfl_source_failures WHERE job_key='normal'")).rows[0].n,5);
  assert.equal((await append(record(fixtures[1]))).status,'stored','A just-closed slot retains its genuinely observed pre-lock source without reopening the job');assert.equal((await append(record(fixtures[2]))).status,'unavailable','A slot closed more than ten minutes cannot gain an archive now');assert.equal((await append(record(fixtures[4]))).status,'stored');
  await db.query('RESET ROLE');await db.query("UPDATE cron_job_leases SET lease_expires_at=clock_timestamp()-interval '1 second'");await db.query('SET ROLE service_role');assert.equal((await append(record(fixtures[3]))).status,'unavailable');await db.query('RESET ROLE');await db.query("UPDATE cron_job_leases SET lease_expires_at=clock_timestamp()+interval '1 hour'");
  await db.query('SET ROLE service_role');await other.query('SET ROLE service_role');const race=record(fixtures[3]),races=await Promise.all([append(race),append(race,'synthetic-owner',other)]);assert(races.some(r=>r.status==='stored'));assert.equal((await db.query("SELECT count(*)::integer n FROM player_props_ai_nfl_source_failures WHERE job_key='race'")).rows[0].n,1);assert.equal((await append(race)).status,'duplicate','Lost acknowledgement/retry is idempotent');await db.query('RESET ROLE');await other.query('RESET ROLE');
  await assert.rejects(db.query("UPDATE player_props_ai_nfl_source_failures SET capture='{}'"),/append_only/);await assert.rejects(db.query('DELETE FROM player_props_ai_nfl_source_failures'),/append_only/);await assert.rejects(db.query('TRUNCATE player_props_ai_nfl_source_failures'),/append_only/);
  assert.equal(await snapshot(),protectedBefore,'Appending diagnostics never mutates funded jobs, budgets or paid attempts');
  console.log('Disposable NFL source-failure SQL proof passed: force-RLS/ACL, exact lease/owner and due/closed windows, immutable first archive, idempotent dedup, four states plus one overflow, bounded invalid body refusal and unchanged funded jobs/budgets/attempts. No HTTP or paid calls.');
 }finally{await other.end();await db.end();await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
