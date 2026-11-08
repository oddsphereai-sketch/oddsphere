// Disposable PostgreSQL only; accepts a local PGlite module, never a hosted URL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(!process.argv[2])throw Error('Supply the installed local PGlite module path.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(readFileSync('lib/db/schema-migration-v39-nfl-player-props-tracking.sql','utf8'));
  const insert=`INSERT INTO public.nfl_player_prop_records
    (tracking_key,provider_game_id,provider_player_id,player_name,team,market,line,side,sportsbook,
    locked_price,locked_probability,locked_expected_value,play_grade,locked_at,model_release,calibration_release,decision_release,snapshot_json)
    VALUES ($1,'synthetic-game','synthetic-player','Synthetic player','TST','anytime_td',0.5,'yes','Synthetic book',
    2200,0.58,$2,'Lean','2026-11-08T20:25:00Z','original-model','original-calibration','original-decision',$3::jsonb)
    ON CONFLICT(tracking_key,decision_release) DO NOTHING`;
  const legacy={decision:{projection:0.5799999999999998,expectedValue:2.12345678,grade:'Lean',lockedAt:'2026-11-08T20:25:00Z'},legacy:[null,false,'']};
  await db.query(insert,['legacy','2.12345678',JSON.stringify(legacy)]);
  const old=(await db.query("SELECT to_jsonb(r)::text AS row FROM public.nfl_player_prop_records r WHERE tracking_key='legacy'")).rows;
  const catalog=()=>db.query(`SELECT attname,atttypid,atttypmod,attnotnull FROM pg_attribute
    WHERE attrelid='public.nfl_player_prop_records'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`);
  const columns=(await catalog()).rows;
  await assert.rejects(db.query(insert,['long-odds','12.34',JSON.stringify({decision:{expectedValue:12.339999999999996}})]),/numeric field overflow/);
  const migration=readFileSync('lib/db/schema-migration-v67-nfl-props-tracking-value-capacity.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  const after=(await catalog()).rows;
  assert.deepEqual(after.filter(c=>c.attname!=='locked_expected_value'),columns.filter(c=>c.attname!=='locked_expected_value'));
  assert.equal(after.find(c=>c.attname==='locked_expected_value').attnotnull,true);
  for(const [key,value] of [['long-odds','12.34'],['price-bound','21474835.47'],['negative','-0.12345678']])
    await db.query(insert,[key,value,JSON.stringify({decision:{expectedValue:Number(value),grade:'Lean'}})]);
  assert.equal((await db.query("SELECT locked_expected_value::text value FROM public.nfl_player_prop_records WHERE tracking_key='long-odds'")).rows[0].value,'12.34000000');
  await db.query(insert,['legacy','99.99',JSON.stringify({decision:{grade:'Best Angle'}})]);
  assert.deepEqual((await db.query("SELECT to_jsonb(r)::text AS row FROM public.nfl_player_prop_records r WHERE tracking_key='legacy'")).rows,old,'migration and ordinary duplicate writer must preserve every stored locked field');
  assert.deepEqual((await db.query("SELECT snapshot_json FROM public.nfl_player_prop_records WHERE tracking_key='legacy'")).rows[0].snapshot_json,legacy,'the stored legacy snapshot remains the authoritative reader payload');
  const access=(await db.query(`SELECT relrowsecurity,
    has_table_privilege('anon',oid,'SELECT') anon_read,
    has_table_privilege('authenticated',oid,'SELECT') member_read,
    has_table_privilege('service_role',oid,'INSERT') service_insert
    FROM pg_class WHERE oid='public.nfl_player_prop_records'::regclass`)).rows[0];
  assert.deepEqual(access,{relrowsecurity:true,anon_read:false,member_read:false,service_insert:true});
  console.log('NFL tracking PostgreSQL capacity: former overflow reproduced; valid long odds accepted; eight-decimal scale, all legacy locked fields, duplicate writer immutability, reader payload and RLS/grants preserved; migration rerun passed.');
}finally{await db.close();}
