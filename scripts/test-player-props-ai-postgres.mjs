// Disposable task-owned Unix-socket PostgreSQL only. Never accept a hosted DB URL.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const modulePath=process.argv[2];
if(!modulePath?.startsWith("/private/tmp/"))throw Error("Supply a local pg module path; production database connections are forbidden");
const {default:pg}=await import(pathToFileURL(modulePath).href);
const config={host:"/private/tmp/oddsphere-props-ai-pg-20261106/socket",port:55583,user:"postgres"};
const admin=new pg.Client({...config,database:"postgres"});await admin.connect();
const database=`props_ai_test_${Date.now()}`;await admin.query(`CREATE DATABASE ${database}`);
const db=new pg.Client({...config,database}),other=new pg.Client({...config,database});await db.connect();await other.connect();
try{
  for(const role of ["anon","authenticated","service_role"])await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  const migration=readFileSync("lib/db/schema-migration-v61-player-props-ai-runtime.sql","utf8");
  await db.query(migration);await db.query(migration); // Exact production migration applies idempotently.
  // Only the business-clock calls are substituted in this disposable DB for deterministic boundary tests.
  await db.query("CREATE TABLE test_clock(at timestamptz); INSERT INTO test_clock VALUES('2026-11-06T18:00:00Z'); CREATE FUNCTION props_ai_test_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT at FROM test_clock'");
  const funcs=await db.query("SELECT pg_get_functiondef(p.oid) AS body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'player_props_ai_%'");
  for(const f of funcs.rows)await db.query(f.body.replaceAll("clock_timestamp()","props_ai_test_clock()"));
  const jobs=Array.from({length:20},(_,i)=>["early","final"].map(stage=>({key:`game-${i}|${stage}`,sport:"nba",gameId:`game-${i}`,gameDay:"2026-11-06",stage,start:"2026-11-06T22:00:00Z",lock:"2026-11-06T21:00:00Z",dueAt:"2026-11-06T17:00:00Z"}))).flat();
  await assert.rejects(db.query("SELECT player_props_ai_plan($1,$2,$3,$4,false)",["2026-11",JSON.stringify(jobs),"hash","{}"]),/full_calendar_required/);
  await db.query("SELECT player_props_ai_plan($1,$2,$3,$4,true)",["2026-11",JSON.stringify(jobs),"hash","{}"]);
  const amount=async()=> (await db.query("SELECT * FROM player_props_ai_budgets WHERE month_key='2026-11'")).rows[0];
  assert.equal(Number((await amount()).core_reserved_micro),1280000);
  await db.query("SELECT player_props_ai_plan($1,$2,$3,$4,true)",["2026-11",JSON.stringify(jobs),"hash","{}"]);
  assert.equal(Number((await amount()).core_reserved_micro),1280000); // Repeated cron cannot reserve twice.
  const requests=JSON.stringify(Array.from({length:2},()=>({input_tokens:145000,max_output_tokens:10000,strong_input_tokens:145000})));
  const claims=await Promise.all([db.query("SELECT player_props_ai_claim('game-0|early','input',$1,false) AS v",[requests]),other.query("SELECT player_props_ai_claim('game-0|early','input',$1,false) AS v",[requests])]);
  assert.equal(claims.filter(r=>r.rows[0].v.claimed).length,1);
  const token=claims.find(r=>r.rows[0].v.claimed).rows[0].v.token;
  const a=(await db.query("SELECT player_props_ai_send($1,$2,1,1) AS v",["game-0|early",token])).rows[0].v;
  await assert.rejects(db.query("SELECT player_props_ai_send($1,$2,1,1)",["game-0|early",token]),/already_claimed/);
  await db.query("SELECT player_props_ai_receipt($1,$2,NULL,'resp-unknown',NULL)",[a.id,token]);
  await db.query("SELECT player_props_ai_finish($1,$2,NULL,'network_unknown')",["game-0|early",token]);
  assert.equal(Number((await amount()).consumed_micro),19705); // Unsent part refunded; unknown sent part held.
  await db.query("SELECT player_props_ai_receipt($1,$2,15000,'resp-unknown','{}')",[a.id,token]);
  assert.equal(Number((await amount()).consumed_micro),15000); // Late receipt reconciles conservatively held money.
  await assert.rejects(db.query("SELECT player_props_ai_receipt($1,$2,10000,'different-response','{}')",[a.id,token]),/immutable_usage_receipt_conflict/);
  const strong=(await db.query("SELECT player_props_ai_claim('game-0|final','input-final',$1,true) AS v",[requests])).rows[0].v;
  assert.equal(strong.job.model,"gpt-6.1-terra");
  const sendComplete=async(key,t,phase,part)=>{const row=(await db.query("SELECT player_props_ai_send($1,$2,$3,$4) AS v",[key,t,phase,part])).rows[0].v;await db.query("SELECT player_props_ai_receipt($1,$2,10000,$3,'{}')",[row.id,t,`r-${key}-${phase}-${part}`]);};
  await sendComplete("game-0|final",strong.token,1,1);await sendComplete("game-0|final",strong.token,1,2);
  assert.equal((await db.query("SELECT player_props_ai_repair($1,$2) AS v",["game-0|final",strong.token])).rows[0].v,true);
  assert.equal((await db.query("SELECT player_props_ai_repair($1,$2) AS v",["game-0|final",strong.token])).rows[0].v,false);
  await sendComplete("game-0|final",strong.token,2,1);await sendComplete("game-0|final",strong.token,2,2);
  const accepted=(await db.query("SELECT player_props_ai_finish($1,$2,$3,NULL) AS v",["game-0|final",strong.token,JSON.stringify({release:"synthetic",players:[]})])).rows[0].v;
  assert.equal(accepted.state,"completed");
  const retained=(await db.query("SELECT player_props_ai_finish($1,$2,$3,NULL) AS v",["game-0|final",strong.token,JSON.stringify({release:"replacement"})])).rows[0].v;
  assert.deepEqual(retained.result,accepted.result); // Accepted review cannot be replaced by a later cron visit.
  assert.equal(Number((await amount()).consumed_micro),55000);
  assert.equal(Number((await amount()).recovery_remaining_micro),2980000);
  await db.query("SET ROLE authenticated");await assert.rejects(db.query("SELECT * FROM player_props_ai_reviews"),/permission denied/);await assert.rejects(db.query("SELECT player_props_ai_reap()"),/permission denied/);await db.query("RESET ROLE");
  const excessive=Array.from({length:1600},(_,i)=>({...jobs[0],key:`exp-${i}`,gameId:`exp-${Math.floor(i/2)}`,stage:i%2?"final":"early",gameDay:"2027-04-06",start:"2027-04-06T22:00:00Z",lock:"2027-04-06T21:00:00Z",dueAt:"2027-04-06T17:00:00Z"}));
  await assert.rejects(db.query("SELECT player_props_ai_plan($1,$2,'excess','{}',true)",["2027-04",JSON.stringify(excessive)]),/exceeds_monthly_cap/);
  assert.equal((await db.query("SELECT count(*) FROM player_props_ai_reviews WHERE billing_month='2027-04'")).rows[0].count,"0");
  await db.query("UPDATE test_clock SET at='2026-11-06T21:00:00Z'");
  assert.equal((await db.query("SELECT player_props_ai_claim('game-1|early','late',$1,false) AS v",[requests])).rows[0].v.reason,"after_lock");
  console.log("Native PostgreSQL: atomic whole-month funding, concurrent duplicate claims, unknown costs, late receipts, one repair, immutable accepted review, cap rollback, lock cutoff and RLS passed.");
}finally{await other.end();await db.end();await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin.end();}
