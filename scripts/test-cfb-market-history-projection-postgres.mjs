// Disposable PostgreSQL only; never accepts a production database URL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(!process.argv[2])throw new Error('Supply a local PGlite module path.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    CREATE TABLE public.cfb_forward_evidence_snapshots(id text PRIMARY KEY,season int,week int,
      evidence_release text,provider_game_id text,stage text,captured_at timestamptz,game_start_at timestamptz,payload_sha256 text,payload jsonb);
    ALTER TABLE public.cfb_forward_evidence_snapshots ENABLE ROW LEVEL SECURITY;`);
  const shapes=[null,{},[],42,true,'legacy',{
    schemaRelease:'original-release',game:{providerGameId:'game-1'},stage:'opening',capturedAt:'2026-08-25T00:00:00Z',
    market:{current:{price:-110},currentBooks:[{book:'circa',price:100}],displayBooks:[{original:true}],providerOpening:{price:-105},operationalOpening:{price:-101},playbookSplits:{money:57},sharpApiSplits:{bets:42}},
    requestBudget:{requests:1},contextualEvidenceCapture:{markets:{moneyline:{families:[{original:true}],targetExcludedFamilies:['a']},spread:{families:['b'],targetExcludedFamilies:['c']},total:{families:['d'],targetExcludedFamilies:['e']}}}
  }];
  for(const v of [null,'',0,false,[],[1],{price:10}])shapes.push({schemaRelease:v,game:v,stage:v,capturedAt:v,market:v,requestBudget:v,contextualEvidenceCapture:v});
  for(let i=0;i<shapes.length;i++)await db.query(`INSERT INTO cfb_forward_evidence_snapshots VALUES($1,2026,1,'original-release','game-1','opening','2026-08-25Z','2026-08-26Z','original-hash',$2::jsonb)`,[String(i),shapes[i]===null?null:JSON.stringify(shapes[i])]);
  await db.exec(`INSERT INTO cfb_forward_evidence_snapshots VALUES('json-null',2026,1,'original-release','game-1','opening','2026-08-25Z','2026-08-26Z','original-hash','null'::jsonb)`);
  const before=(await db.query('SELECT * FROM cfb_forward_evidence_snapshots ORDER BY id')).rows;
  const sql=readFileSync('lib/db/schema-migration-v54-cfb-market-history-projection.sql','utf8');await db.exec(sql);await db.exec(sql);
  const source=readFileSync('lib/services/football/cfbForwardEvidenceStore.ts','utf8');
  const region=source.match(/const CFB_FORWARD_MARKET_HISTORY_SELECT = \[([\s\S]*?)\]\.join\(","\)/)[1];
  const fields=[...region.matchAll(/"([^"]+)"/g)].map(m=>m[1]);
  const legacy=fields.map(field=>{const [alias,expr]=field.split(':');if(!expr)return `p.${alias}`;return `p.${expr.replace(/(->>?)([A-Za-z_][A-Za-z_0-9]*)/g,"$1'$2'")} AS ${alias}`;}).join(',');
  const mismatch=(await db.query(`WITH a AS(SELECT ${legacy} FROM cfb_forward_evidence_snapshots p),b AS(SELECT ${legacy} FROM cfb_forward_market_history_projection p) SELECT a.id FROM a FULL JOIN b USING(id) WHERE to_jsonb(a) IS DISTINCT FROM to_jsonb(b)`)).rows;
  assert.deepEqual(mismatch,[],'all transported fields must preserve exact legacy values, including null/scalar payloads');
  assert.deepEqual((await db.query(`SELECT p.id FROM cfb_forward_evidence_snapshots p JOIN cfb_forward_market_history_projection v USING(id) WHERE p.payload IS DISTINCT FROM v.payload`)).rows,[],"full payload and SQL-null/JSON-null distinction must be identical");
  assert.deepEqual((await db.query('SELECT * FROM cfb_forward_evidence_snapshots ORDER BY id')).rows,before,'existing locked payloads and hashes must remain unchanged');
  const access=(await db.query(`SELECT has_table_privilege('service_role','cfb_forward_market_history_projection','SELECT') AS read,has_table_privilege('service_role','cfb_forward_market_history_projection','INSERT,UPDATE,DELETE') AS write,has_table_privilege('anon','cfb_forward_market_history_projection','SELECT') AS public_read`)).rows[0];
  assert.deepEqual(access,{read:true,write:false,public_read:false});
  assert((await db.query(`SELECT reloptions FROM pg_class WHERE oid='cfb_forward_market_history_projection'::regclass`)).rows[0].reloptions.includes('security_invoker=true'));
  await db.exec(`ANALYZE (BUFFER_USAGE_LIMIT '1MB',SKIP_LOCKED) cfb_forward_evidence_snapshots(id,season,week,evidence_release,provider_game_id,stage,captured_at)`);
  assert.deepEqual((await db.query('SELECT * FROM cfb_forward_evidence_snapshots ORDER BY id')).rows,before,'column-statistics maintenance must not change snapshots');
  console.log(`CFB PG projection ${fields.length} fields × ${before.length} legacy shapes, unchanged frozen rows/hashes, rerun, invoker permissions and metadata-only ANALYZE: PASS`);
}finally{await db.close();}
