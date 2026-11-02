import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(!process.argv[2])throw new Error('Supply a local PGlite module path; no database URL is accepted.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
   CREATE TABLE public.locked_guard(id int,payload jsonb);
   INSERT INTO public.locked_guard VALUES(1,'{"locked":true,"probability":0.6123,"evidence":"original"}');`);
 const before=(await db.query('SELECT * FROM public.locked_guard')).rows;
 const sql=readFileSync('lib/db/schema-migration-v56-operator-backend-memory-probe.sql','utf8');
 await db.exec(sql);await db.exec(sql);
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query(`SELECT has_function_privilege($1,'public.operator_backend_memory_probe()','EXECUTE') AS allowed`,[role])).rows[0].allowed,false);
  await db.exec(`SET ROLE ${role}`);
  await assert.rejects(db.query('SELECT public.operator_backend_memory_probe()'),/permission denied/);
  await db.exec('RESET ROLE');
 }
 // A hostile public-schema name cannot shadow a pg_catalog dependency.
 await db.exec(`CREATE FUNCTION public.pg_backend_pid() RETURNS int LANGUAGE sql AS 'SELECT -999';SET ROLE service_role`);
 const sample=(await db.query('SELECT public.operator_backend_memory_probe() AS sample')).rows[0].sample;
 await db.exec('RESET ROLE');
 assert(sample.backend_pid>0);assert(sample.total_bytes>0);assert(sample.used_bytes>0);
 assert.equal(sample.total_bytes,sample.used_bytes+sample.free_bytes);
 assert.equal(sample.release,'operator_backend_memory_probe_2026_11_02_r1');
 assert(sample.largest_contexts.length<=12);
 assert(sample.largest_contexts.every(c=>Object.keys(c).sort().join(',')==='free_bytes,name,total_bytes,used_bytes'));
 assert.deepEqual(Object.keys(sample).sort(),['backend_pid','context_count','free_bytes','largest_contexts','prepared_statement_count','prepared_statement_text_bytes','release','sampled_at','total_bytes','used_bytes'].sort());
 const def=(await db.query(`SELECT prosecdef,pronargs,proconfig FROM pg_proc WHERE oid='public.operator_backend_memory_probe()'::regprocedure`)).rows[0];
 assert.equal(def.prosecdef,true);assert.equal(def.pronargs,0);assert(def.proconfig.includes('search_path=pg_catalog'));
 assert.deepEqual((await db.query('SELECT * FROM public.locked_guard')).rows,before);
 console.log('Operator probe: bounded metadata only, explicit service-only execute, anon/member denial, fixed search path, idempotency and unchanged locked rows PASS');
}finally{await db.close();}
