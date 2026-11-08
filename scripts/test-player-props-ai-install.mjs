/** Disposable native PostgreSQL proof. No provider/OpenAI access. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const modulePath=process.argv[2];assert.ok(modulePath?.startsWith('/private/tmp/'));
const {default:pg}=await import(pathToFileURL(modulePath).href);
const config={host:'/private/tmp/oddsphere-props-wallet-pg-20261107/socket',port:55587,user:'postgres'};
const admin=new pg.Client({...config,database:'postgres'});await admin.connect();
const database=`props_install_${Date.now()}`;await admin.query(`CREATE DATABASE ${database}`);
const db=new pg.Client({...config,database});await db.connect();
try{
 for(const role of ['anon','authenticated','service_role'])await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
 for(let pass=0;pass<2;pass++)for(const file of ['v61-player-props-ai-runtime','v62-player-props-ai-wallet','v63-player-props-ai-site-control','v64-player-props-ai-budget-target','v66-player-props-ai-slate-capacity'])await db.query(readFileSync(`lib/db/schema-migration-${file}.sql`,'utf8'));
 assert.equal((await db.query('select paid_enabled from player_props_ai_control')).rows[0].paid_enabled,false);
 assert.match((await db.query("select pg_get_functiondef('public.player_props_ai_claim(text,text,jsonb,boolean,text)'::regprocedure) body")).rows[0].body,/WHERE state='running'\)>=16/);
 await db.query("UPDATE player_props_ai_control SET paid_enabled=true");
 await assert.rejects(db.query(readFileSync('lib/db/schema-migration-v66-player-props-ai-slate-capacity.sql','utf8')),/pause_paid_reviews_before_v66/);
 await db.query("ROLLBACK");
 await db.query("UPDATE player_props_ai_control SET paid_enabled=false");
 await db.query("INSERT INTO player_props_ai_budgets(month_key) VALUES('2026-11')");
 await db.query("INSERT INTO player_props_ai_reviews(job_key,sport,game_id,game_day,stage,scheduled_start,lock_at,due_at,billing_month,reserved_micro) VALUES('synthetic','nba','synthetic','2026-11-07','early','2026-11-07T23:00:00Z','2026-11-07T22:00:00Z','2026-11-07T15:00:00Z','2026-11',0)");
 await assert.rejects(db.query("UPDATE player_props_ai_reviews SET state='running' WHERE job_key='synthetic'"),/paid_runs_disabled/);
 assert.equal((await db.query("SELECT state FROM player_props_ai_reviews WHERE job_key='synthetic'")).rows[0].state,'pending');
 const sources=JSON.stringify(Object.fromEntries(['nba','nfl','mlb'].map(s=>[s,{complete:true,source:'synthetic complete no-games source'}])));
 const planArgs=['2026-11','[]','[]','synthetic',sources,'player_props_ai_budget_2026_11_08_r4_target_and_emergency'];
 assert.equal((await db.query('SELECT player_props_ai_plan_v3($1,$2,$3,$4,$5,$6) v',planArgs)).rows[0].v.funded,true);
 assert.equal((await db.query("SELECT state FROM player_props_ai_reviews WHERE job_key='synthetic'")).rows[0].state,'cancelled');
 const invalid=[...planArgs];invalid[4]='{}';assert.equal((await db.query('SELECT player_props_ai_plan_v3($1,$2,$3,$4,$5,$6) v',invalid)).rows[0].v.funded,false);
 assert.equal((await db.query("SELECT full_calendar FROM player_props_ai_budgets WHERE month_key='2026-11'")).rows[0].full_calendar,false);
 await db.query("INSERT INTO player_props_ai_attempts(job_key,phase,part,model,reserved_micro) VALUES('synthetic',1,1,'gpt-6-luna',1)");
 await assert.rejects(db.query("UPDATE player_props_ai_attempts SET state='sending' WHERE job_key='synthetic'"),/paid_runs_disabled/);
 assert.equal((await db.query("SELECT state FROM player_props_ai_attempts WHERE job_key='synthetic'")).rows[0].state,'reserved');
 // A schema reinstall cannot activate spending or reset the configured switch.
 await db.query(readFileSync('lib/db/schema-migration-v63-player-props-ai-site-control.sql','utf8'));
 assert.equal((await db.query('select paid_enabled from player_props_ai_control')).rows[0].paid_enabled,false);
 for(const role of ['anon','authenticated']){
  const grants=(await db.query("SELECT has_table_privilege($1,'player_props_ai_control','SELECT') OR has_table_privilege($1,'player_props_ai_calendars','SELECT') allowed",[role])).rows[0];assert.equal(grants.allowed,false);
 }
 assert.equal((await db.query("select has_function_privilege('anon','player_props_ai_plan_v3(text,jsonb,jsonb,text,jsonb,text)','EXECUTE') allowed")).rows[0].allowed,false);
 console.log('Native PostgreSQL installation proof passed: all five migrations idempotent; paid-off claim guard rolls back; reinstall stays off; source/control tables and funding RPC private to service role. No network/API calls.');
}finally{await db.end();await admin.query(`DROP DATABASE ${database}`);await admin.end();}
