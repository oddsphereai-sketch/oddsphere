/** Exact V71 SQL against a newly created disposable database. No HTTP or live credentials. */
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {
  decodeNbaPlayerPropsPrivatePayload,encodeNbaPlayerPropsPrivatePayload,
  nbaPlayerPropsCandidateSnapshotKey,readNbaPlayerPropsPrivateSnapshot,writeNbaPlayerPropsPrivateSnapshot,
} from '../lib/services/nba/nbaPlayerPropsPrivateStore';
import {buildNbaPlayerPropsMemberSnapshot,type NbaPlayerPropsMemberSnapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {nbaAuthorityFixture} from './test-player-props-ai-nba-lock-authority';

globalThis.fetch=async()=>{throw Error('Disposable publication proof forbids HTTP');};
type RpcReceipt={written:boolean;status:string;checksum?:string;server_admitted_at?:string;server_write_completed_at?:string};
type SnapshotEnvelope=ReturnType<typeof encodeNbaPlayerPropsPrivatePayload>;
type SqlRow=Record<string,unknown>&{result:RpcReceipt;payload:SnapshotEnvelope;body:string;at:Date;allowed:boolean;last_value:string};
type QueryResult={rows:SqlRow[]};
type Connection={connect:()=>Promise<void>;end:()=>Promise<void>;query:(sql:string,values?:unknown[])=>Promise<QueryResult>};
const functionSignature='public.publish_nba_player_props_private_snapshot_v1(text,text,jsonb,timestamptz,timestamptz)';
const writer='synthetic-v71-owner',slateDate='2030-11-17',key=nbaPlayerPropsCandidateSnapshotKey(slateDate);

async function main(){
  const [modulePath,mode,socket,portText]=process.argv.slice(2);
  const ci=mode==='--ci-disposable'&&process.env.GITHUB_ACTIONS==='true'
    &&process.env.MARKET_BRAIN_POSTGRES_PROOF_DISPOSABLE==='YES';
  const local=mode==='--local-disposable';
  assert(modulePath&&(ci||local),'Pass an isolated pg module and explicit --local-disposable <socket> <port> or guarded --ci-disposable');
  assert(ci?process.env.RUNNER_TEMP&&realpathSync(modulePath).startsWith(realpathSync(process.env.RUNNER_TEMP)+'/')
    :realpathSync(modulePath).startsWith('/private/tmp/'),'Disposable pg dependency required');
  let config:Record<string,unknown>;
  if(ci){
    const url=new URL(process.env.MARKET_BRAIN_POSTGRES_URL!);
    assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5432');
    assert.equal(url.pathname,'/oddsphere_market_brain_test');assert.equal(url.username,'postgres');assert.equal(url.search,'');
    config={host:'127.0.0.1',port:5432,user:'postgres',password:decodeURIComponent(url.password)};
  }else{
    assert(socket&&realpathSync(socket).startsWith('/private/tmp/'),'Explicit disposable Unix socket required');
    const port=Number(portText);assert(Number.isSafeInteger(port)&&port>=1024&&port<=65535,'Explicit local port required');
    config={host:realpathSync(socket),port,user:'postgres'};
  }
  const {default:pg}=await import(pathToFileURL(modulePath).href);
  const admin:Connection=new pg.Client({...config,database:'postgres'});await admin.connect();
  const database=`props_nba_durable_${Date.now()}_${process.pid}`;
  const db:Connection=new pg.Client({...config,database}),other:Connection=new pg.Client({...config,database});
  let created=false,dbConnected=false,otherConnected=false;
  try{
    await admin.query(`CREATE DATABASE ${database}`);created=true;
    await db.connect();dbConnected=true;await other.connect();otherConnected=true;
    for(const role of ['anon','authenticated','service_role'])await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    for(const name of ['v31-cron-job-leases','v35-lab-response-snapshots'])await db.query(readFileSync(`lib/db/schema-migration-${name}.sql`,'utf8'));
    const sql=readFileSync('lib/db/schema-migration-v71-player-props-ai-durable-publication.sql','utf8');
    const serverNow=async()=>new Date((await db.query('SELECT clock_timestamp() AS at')).rows[0].at).getTime();
    const iso=(at:number)=>new Date(at).toISOString();
    const setLease=async(expiresAt:number,run=writer)=>db.query("INSERT INTO cron_job_leases(job_name,run_id,lease_expires_at) VALUES('prediction_pipeline:nba',$1,$2) ON CONFLICT(job_name) DO UPDATE SET run_id=excluded.run_id,lease_expires_at=excluded.lease_expires_at",[run,iso(expiresAt)]);
    const rawRpc=async(record:Record<string,unknown>,expected:string|null,options:{run?:string;before?:string|null;cutoff?:string|null;connection?:Connection}={})=>{
      const result=await(options.connection??db).query('SELECT public.publish_nba_player_props_private_snapshot_v1($1,$2,$3::jsonb,$4::timestamptz,$5::timestamptz) AS result',
        [options.run??writer,expected,JSON.stringify(record),options.before??null,options.cutoff??null]);return result.rows[0].result;
    };
    // pg turns a DATE into a JavaScript Date; the actual store RPC sends the
    // canonical YYYY-MM-DD string. Preserve that wire contract in raw probes.
    const readRecord=async(connection=db)=>(await connection.query('SELECT *,slate_date::text AS slate_date FROM lab_response_snapshots WHERE snapshot_key=$1',[key])).rows[0];
    const readAll=async()=>JSON.stringify((await db.query('SELECT * FROM lab_response_snapshots ORDER BY snapshot_key')).rows);
    const unchanged=async(action:()=>Promise<unknown>)=>{const before=await readAll();const result=await action();assert.equal(await readAll(),before,'Refused publication must not mutate any snapshot');return result as RpcReceipt;};
    const client={
      from(table:string){assert.equal(table,'lab_response_snapshots');let selectedKey='';
        const query={select(){return query;},eq(field:string,value:string){assert.equal(field,'snapshot_key');selectedKey=value;return query;},
          async maybeSingle(){const row=(await db.query('SELECT payload FROM lab_response_snapshots WHERE snapshot_key=$1',[selectedKey])).rows[0];return {data:row??null,error:null};},
          async upsert(record:Record<string,unknown>){const fields=Object.keys(record);assert(fields.every(f=>['snapshot_key','kind','sport','slate_date','payload','payload_version','source','generated_at','expires_at','stale_until','updated_at'].includes(f)));await db.query(`INSERT INTO lab_response_snapshots(${fields.join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(snapshot_key) DO UPDATE SET ${fields.filter(f=>f!=='snapshot_key').map(f=>f+'=excluded.'+f).join(',')}`,fields.map(f=>f==='payload'?JSON.stringify(record[f]):record[f]));return {error:null};},
        };return query;
      },
      async rpc(name:string,args:{p_record:Record<string,unknown>;p_expected_checksum:string|null;p_writer_run:string;p_admit_before?:string;p_source_cutoff?:string}){assert.equal(name,'publish_nba_player_props_private_snapshot_v1');const data=await rawRpc(args.p_record,args.p_expected_checksum,{run:args.p_writer_run,before:args.p_admit_before,cutoff:args.p_source_cutoff});return {data,error:null};},
    };
    const actualClient=client as unknown as Parameters<typeof writeNbaPlayerPropsPrivateSnapshot>[0]['client'];
    const now=await serverNow(),fixture=nbaAuthorityFixture(),start=iso(now+4*3600000),gameId='nba-bdl:71';
    const native={...fixture.row('a'),gameId,scheduledStart:start,evaluatedAt:iso(now-60000),lockedAt:iso(now-30000),playerName:'Exact legacy native name',americanPrice:-117,probability:.654321,projection:18.123456};
    const ai={...native,decisionKey:'legacy-ai',playerId:'legacy-ai',playerName:'Exact legacy AI name',americanPrice:121,probability:.321987,projection:16.987654,marketEvidenceMode:'ai_joint_law' as const,
      aiReview:{release:'immutable-old-release',selectedSide:'over',lawHash:'immutable-old-law',assessment:'Exact stored historical assessment.',evidence:{source:'unmodified stored evidence',nullValue:null,zero:0}}} as unknown as typeof native;
    const owned={...native,decisionKey:'owned-unlocked',playerId:'owned-unlocked',playerName:'Synthetic owned unlocked actor',lockedAt:null};
    const unrelated={...native,decisionKey:'other-game',gameId:'nba-bdl:72',playerId:'other-player',playerName:'Exact unrelated game row',lockedAt:null};
    const initial=buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:iso(now-10000),slateDate,
      games:[{gameId,scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'},{gameId:unrelated.gameId,scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'}],decisions:[native,ai,owned,unrelated],inputRows:12});
    // The unchanged old store entry point is exercised before installing V71.
    await writeNbaPlayerPropsPrivateSnapshot({client:actualClient,snapshot:initial,source:'nba_player_props_private_writer_legacy_test'});
    await db.query("INSERT INTO lab_response_snapshots(snapshot_key,kind,sport,slate_date,payload,expires_at,stale_until) VALUES('unrelated-nfl-fixture','daily_edge','nfl','2030-11-17','{\"locked\":true,\"original\":\"exact\"}',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days')");
    const oldRows=await readAll(),oldLeaseFunction=(await db.query("SELECT pg_get_functiondef('try_acquire_cron_job_lease(text,text,integer)'::regprocedure) AS body")).rows[0].body;
    await db.query(sql);await db.query(sql);
    assert.equal(await readAll(),oldRows,'V71 installation/idempotence never rewrites old records');
    assert.equal((await db.query("SELECT pg_get_functiondef('try_acquire_cron_job_lease(text,text,integer)'::regprocedure) AS body")).rows[0].body,oldLeaseFunction,'Existing lease entry point stays unchanged');
    await setLease(await serverNow()+60000);
    const initialRecord=await readRecord();
    for(const role of ['anon','authenticated']){await db.query(`SET ROLE ${role}`);try{await assert.rejects(rawRpc(initialRecord,initialRecord.payload.checksum),/permission denied/);}finally{await db.query('RESET ROLE');}}
    assert.equal((await db.query('SELECT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type=\'EXECUTE\') AS allowed',[functionSignature])).rows[0].allowed,false,'PUBLIC has no EXECUTE');
    assert.equal((await db.query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS allowed',[functionSignature])).rows[0].allowed,true);
    for(const run of ['wrong-owner',''])assert.equal((await unchanged(()=>rawRpc(initialRecord,initialRecord.payload.checksum,{run}))).written,false);
    await setLease(await serverNow()-1);assert.equal((await unchanged(()=>rawRpc(initialRecord,initialRecord.payload.checksum))).status,'lease_unavailable');await setLease(await serverNow()+60000);
    for(const patch of [{sport:'nfl'},{snapshot_key:'wrong-key'},{source:null},{slate_date:null},{payload:{...initialRecord.payload,checksum:null}},{payload:{...initialRecord.payload,payloadKind:'market_history'}}]){
      assert.equal((await unchanged(()=>rawRpc({...initialRecord,...patch},initialRecord.payload.checksum))).status,'invalid_contract');
    }
    // The actual application store independently protects all old locked fields.
    const prior=await readNbaPlayerPropsPrivateSnapshot({client:actualClient,slateDate});assert(prior);
    await assert.rejects(writeNbaPlayerPropsPrivateSnapshot({client:actualClient,snapshot:{...prior,decisions:prior.decisions.map(r=>r.lockedAt?{...r,probability:.111}:r)},source:'nba_player_props_private_writer_test',writerRunId:writer,expectedSnapshot:prior}),/stored lock/);
    const candidate=(label:string,at:number):NbaPlayerPropsMemberSnapshot=>({...initial,generatedAt:iso(at),decisions:initial.decisions.map(row=>row.lockedAt||row.gameId!==gameId?row:{...row,decisionKey:label,probability:label==='race-a'?.61:.62,evaluatedAt:iso(at)})});
    const before=await serverNow(),next=candidate('first-guarded',before-10);
    await db.query('SET ROLE service_role');let receipt:Awaited<ReturnType<typeof writeNbaPlayerPropsPrivateSnapshot>>;
    try{receipt=await writeNbaPlayerPropsPrivateSnapshot({client:actualClient,snapshot:next,source:'nba_player_props_private_writer_test',writerRunId:writer,expectedSnapshot:prior,publicationBefore:iso(before+60000),sourceCutoff:iso(before-1000)});}finally{await db.query('RESET ROLE');}
    assert(receipt.serverAdmittedAt&&receipt.serverWriteCompletedAt);assert(Date.parse(receipt.serverAdmittedAt)>=before-1000);assert(Date.parse(receipt.serverWriteCompletedAt)>=Date.parse(receipt.serverAdmittedAt));
    const read=await readNbaPlayerPropsPrivateSnapshot({client:actualClient,slateDate});assert.deepEqual(read,next);assert.deepEqual(read!.decisions.filter(r=>r.lockedAt),initial.decisions.filter(r=>r.lockedAt));
    const toRecord=(snapshot:NbaPlayerPropsMemberSnapshot,base:Record<string,unknown>)=>({...base,payload:encodeNbaPlayerPropsPrivatePayload(snapshot,'candidate_snapshot'),generated_at:snapshot.generatedAt,updated_at:snapshot.generatedAt});
    const raceBase=await readRecord(),raceAt=await serverNow(),races=[toRecord(candidate('race-a',raceAt),raceBase),toRecord(candidate('race-b',raceAt),raceBase)];
    const race=await Promise.all(races.map((record,i)=>rawRpc(record,raceBase.payload.checksum,{connection:i?other:db})));assert.equal(race.filter(r=>r.written).length,1);assert.equal(race.filter(r=>r.status==='superseded').length,1);
    const winner=race.findIndex(r=>r.written),raceStored=await readRecord();assert.deepEqual(raceStored.payload,races[winner].payload);assert.deepEqual(decodeNbaPlayerPropsPrivatePayload(raceStored.payload,'candidate_snapshot'),candidate(winner?'race-b':'race-a',raceAt));
    assert.equal((await unchanged(()=>rawRpc(races[1-winner],raceBase.payload.checksum))).status,'superseded');
    // An existing malformed checksum is never confused with an absent row.
    await db.query('UPDATE lab_response_snapshots SET payload=payload-\'checksum\' WHERE snapshot_key=$1',[key]);
    assert.equal((await unchanged(()=>rawRpc(raceStored,null))).status,'superseded');
    await db.query('UPDATE lab_response_snapshots SET payload=$2::jsonb WHERE snapshot_key=$1',[key,JSON.stringify(raceStored.payload)]);
    const current=await readRecord(),at=await serverNow(),future=toRecord(candidate('future-clock',at+60000),current);
    assert.equal((await unchanged(()=>rawRpc(current,current.payload.checksum,{before:iso(at-1),cutoff:iso(at-1000)}))).status,'publication_window_closed');
    assert.equal((await unchanged(()=>rawRpc(future,current.payload.checksum,{before:iso(at+120000),cutoff:iso(at+60000)}))).status,'publication_window_closed');
    assert.equal((await unchanged(()=>rawRpc(future,current.payload.checksum,{before:iso(at+120000),cutoff:iso(at-1000)}))).status,'publication_window_closed');
    assert.equal((await unchanged(()=>rawRpc(current,current.payload.checksum,{before:iso(at+10000)}))).status,'invalid_contract');
    // A real write executes, then a server trigger crosses the cutoff. The
    // function's nested transaction must roll the entire write back.
    await db.query("CREATE SEQUENCE test_write_attempts;CREATE FUNCTION test_publication_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF coalesce(current_setting('props_publication.test_delay',true),'')<>'' THEN PERFORM nextval('test_write_attempts');PERFORM pg_sleep(current_setting('props_publication.test_delay')::double precision);END IF;RETURN NEW;END $$;CREATE TRIGGER test_publication_delay AFTER INSERT OR UPDATE ON lab_response_snapshots FOR EACH ROW EXECUTE FUNCTION test_publication_delay()");
    await db.query("SET props_publication.test_delay='0.9'");const crossingAt=await serverNow();
    assert.equal((await unchanged(()=>rawRpc(toRecord(candidate('crossing-write',crossingAt),current),current.payload.checksum,{before:iso(crossingAt+500),cutoff:iso(crossingAt-1000)}))).status,'publication_window_closed');
    const attemptedWrite=(await db.query('SELECT last_value,is_called FROM test_write_attempts')).rows[0];
    assert.equal(attemptedWrite.is_called,true,'Nontransactional sequence proves the rolled-back write reached its AFTER trigger');assert.equal(Number(attemptedWrite.last_value),1);
    await db.query("SET props_publication.test_delay=''");
    // Expiry during the actual write is also checked after the write and rolls back.
    const expiryAt=await serverNow();await setLease(expiryAt+500);await db.query("SET props_publication.test_delay='0.9'");
    assert.equal((await unchanged(()=>rawRpc(toRecord(candidate('lease-expiry',expiryAt),current),current.payload.checksum))).status,'lease_unavailable');
    await db.query("SET props_publication.test_delay=''");await setLease(await serverNow()+60000);
    // A queued writer cannot reuse a client prelock clock after server admission.
    await other.query('BEGIN');await other.query('SELECT pg_advisory_xact_lock(hashtextextended($1,71))',[key]);
    try{const queuedAt=await serverNow(),saved=await readAll(),pending=rawRpc(toRecord(candidate('late-queue',queuedAt),current),current.payload.checksum,{before:iso(queuedAt+250),cutoff:iso(queuedAt-1000)});await other.query('SELECT pg_sleep(0.5)');await other.query('COMMIT');assert.equal((await pending).status,'publication_window_closed');assert.equal(await readAll(),saved);}finally{await other.query('ROLLBACK');}
    // Receipt timestamps describe server admission/write completion only. A
    // surrounding transaction can deliberately delay visibility/ACK past lock.
    const delayedAt=await serverNow(),delayed=toRecord(candidate('delayed-ack',delayedAt),current),delayedCutoff=delayedAt+500;
    await db.query('BEGIN');let delayedReceipt:RpcReceipt;
    try{delayedReceipt=await rawRpc(delayed,current.payload.checksum,{before:iso(delayedCutoff),cutoff:iso(delayedAt-1000)});assert(delayedReceipt.written);assert(Date.parse(delayedReceipt.server_write_completed_at!)<delayedCutoff);assert.deepEqual((await readRecord(other)).payload,current.payload,'Uncommitted write stays invisible');await db.query('SELECT pg_sleep(0.7)');await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}
    assert(await serverNow()>=delayedCutoff);assert.deepEqual((await readRecord()).payload,delayed.payload);assert(!Object.hasOwn(delayedReceipt!,'server_committed_at'),'No false commit-time receipt');
    // Installation remains data-inert after normal/failed/racing publications.
    const finalRows=await readAll();await db.query(sql);assert.equal(await readAll(),finalRows);
    const final=await readNbaPlayerPropsPrivateSnapshot({client:actualClient,slateDate});assert.deepEqual(final!.decisions.filter(r=>r.lockedAt),initial.decisions.filter(r=>r.lockedAt));assert.deepEqual(final!.decisions.find(r=>r.gameId===unrelated.gameId),unrelated,'Every unrelated game field stays exact');
    assert.deepEqual((await db.query("SELECT payload FROM lab_response_snapshots WHERE snapshot_key='unrelated-nfl-fixture'")).rows[0].payload,{locked:true,original:'exact'});
    // The preexisting direct-store writer entry point remains functional.
    await writeNbaPlayerPropsPrivateSnapshot({client:actualClient,snapshot:final!,source:'nba_player_props_private_writer_legacy_test'});assert.deepEqual(await readNbaPlayerPropsPrivateSnapshot({client:actualClient,slateDate}),final);
    console.log('V71 exact PostgreSQL publication passed: production DDL/idempotence, real store envelopes/readers, immutable old native/AI locks, unrelated rows, private ACL/service-only RPC, exact lease owner/expiry, concurrent CAS and stale/corrupt refusal, before/after-write server cutoff rollback, late queue refusal, and explicit write-versus-commit/ACK timestamp semantics. Isolated disposable database only; zero HTTP/provider/model/count calls.');
  }finally{
    if(otherConnected)await other.end();if(dbConnected)await db.end();
    if(created)await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);await admin.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
