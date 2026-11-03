import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(!process.argv[2])throw new Error('Supply a local PGlite module path; no database URL is accepted.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
 CREATE TABLE public.lab_response_snapshots(snapshot_key text PRIMARY KEY,kind text NOT NULL,sport text,slate_date date,payload jsonb NOT NULL,payload_version text NOT NULL,source text NOT NULL,generated_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,stale_until timestamptz NOT NULL,updated_at timestamptz NOT NULL);
 ALTER TABLE public.lab_response_snapshots ENABLE ROW LEVEL SECURITY;
 CREATE POLICY service_cache ON public.lab_response_snapshots TO service_role USING(true) WITH CHECK(true);
 GRANT SELECT,INSERT,UPDATE ON public.lab_response_snapshots TO service_role;
 CREATE TABLE public.market_price_observations_v2(id bigint PRIMARY KEY,league text NOT NULL,canonical_event_id text NOT NULL);
 CREATE INDEX event_lookup ON public.market_price_observations_v2(canonical_event_id);
 ALTER TABLE public.market_price_observations_v2 ENABLE ROW LEVEL SECURITY;
 CREATE POLICY service_prices ON public.market_price_observations_v2 FOR SELECT TO service_role USING(true);
 GRANT SELECT ON public.market_price_observations_v2 TO service_role;
 INSERT INTO public.market_price_observations_v2 VALUES(1,'nba','a'),(99,'nba','b'),(200,'nfl','a'),(300,'nba','other');
 CREATE TABLE locked_guard(id int,payload jsonb);
 INSERT INTO locked_guard VALUES(1,'{"locked":true,"pick":"Under","price":-115,"probability":0.56789,"stake":1.25,"grade":"Lean","evidence":{"original":true}}');`);
 const guard=(await db.query('SELECT * FROM locked_guard')).rows;
 const migration=readFileSync('lib/db/schema-migration-v57-bounded-response-transport.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 const signatures=['public.upsert_lab_response_snapshot(jsonb)','public.market_price_observation_high_water(text,text[])'];
 for(const signature of signatures){
  const flags=(await db.query('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0];
  assert.equal(flags.prosecdef,false);assert(flags.proconfig.includes('search_path=pg_catalog'));
  for(const role of ['anon','authenticated'])assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,signature])).rows[0].allowed,false);
 }
 const payload={lockedAt:'2026-11-02T20:00:00Z',projection:{home:22.12345,away:17.99999},pick:'Under',probability:.56789,grade:'Lean',price:-115,stake:1.25,payload_sha256:'original',evidence:Array.from({length:1201},(_,i)=>({id:i,original:true}))};
 const row={snapshot_key:'same-key',kind:'daily_edge',sport:'nba',slate_date:'2026-11-02',payload,payload_version:'original-release',source:'existing-writer',generated_at:'2026-11-02T20:00:00.123Z',expires_at:'2026-11-02T20:20:00.123Z',stale_until:'2026-11-03T20:00:00.123Z',updated_at:'2026-11-02T20:00:00.123Z'};
 // Compare every column to the actual previous json_to_record INSERT shape.
 const columns=Object.keys(row);
 const types={slate_date:'date',payload:'jsonb',generated_at:'timestamptz',expires_at:'timestamptz',stale_until:'timestamptz',updated_at:'timestamptz'};
 const legacy=`INSERT INTO lab_response_snapshots(${columns}) SELECT ${columns} FROM json_to_record($1::json) AS x(${columns.map(k=>`${k} ${types[k]??'text'}`)}) ON CONFLICT(snapshot_key) DO UPDATE SET ${columns.map(k=>`${k}=excluded.${k}`)} RETURNING to_jsonb(lab_response_snapshots) AS row`;
 const reference=(await db.query(legacy,[JSON.stringify(row)])).rows[0].row;
 await db.query('DELETE FROM lab_response_snapshots WHERE snapshot_key=$1',[row.snapshot_key]);
 await db.exec('SET ROLE service_role');
 await db.query('SELECT public.upsert_lab_response_snapshot($1::jsonb)',[JSON.stringify(row)]);
 assert.deepEqual((await db.query('SELECT to_jsonb(t) AS row FROM lab_response_snapshots t')).rows[0].row,reference);
 await db.query('SELECT public.upsert_lab_response_snapshot($1::jsonb)',[JSON.stringify(row)]);
 assert.deepEqual((await db.query('SELECT to_jsonb(t) AS row FROM lab_response_snapshots t')).rows[0].row,reference,'repeat preserves every locked value and original stored release');
 for(const events of [[],['missing'],['a'],['a','a','missing'],['a','b'],['a','b','other']]){
  const expected=(await db.query('SELECT id FROM market_price_observations_v2 WHERE league=$1 AND canonical_event_id=ANY($2::text[]) ORDER BY id DESC LIMIT 1',['nba',events])).rows[0]?.id??null;
  const actual=(await db.query('SELECT market_price_observation_high_water($1,$2::text[]) AS id',['nba',events])).rows[0].id;
  assert.equal(actual,expected);
 }
 // SECURITY INVOKER must still enforce the table grant and RLS.
 await db.exec('RESET ROLE;REVOKE SELECT ON market_price_observations_v2 FROM service_role;SET ROLE service_role');
 await assert.rejects(db.query("SELECT market_price_observation_high_water('nba',ARRAY['a'])"),/permission denied/);
 await db.exec('RESET ROLE;GRANT SELECT ON market_price_observations_v2 TO service_role;ALTER POLICY service_prices ON market_price_observations_v2 USING(false);SET ROLE service_role');
 assert.equal((await db.query("SELECT market_price_observation_high_water('nba',ARRAY['a']) AS id")).rows[0].id,null);
 for(const role of ['anon','authenticated']){
  await db.exec(`RESET ROLE;SET ROLE ${role}`);
  await assert.rejects(db.query('SELECT public.upsert_lab_response_snapshot($1::jsonb)',[JSON.stringify(row)]),/permission denied/);
  await assert.rejects(db.query("SELECT market_price_observation_high_water('nba',ARRAY['a'])"),/permission denied/);
 }
 await db.exec('RESET ROLE');
 assert.deepEqual((await db.query('SELECT * FROM locked_guard')).rows,guard,'unrelated locked public records remain unchanged');
 console.log('PASS exact legacy eleven-column snapshot parity, locked payload preservation, idempotency, exact high-water predicate, empty/duplicate/mixed events, invoker grants/RLS and anonymous/member denial');
}finally{await db.close();}
