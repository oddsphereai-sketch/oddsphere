import assert from 'node:assert/strict';
import {packReaderSource,unpackReaderSource,verifiedReaderSourceV3,type PackedReaderSourceV3} from '../lib/playerPropsAi/sourceCodec';
import type {Json} from '../lib/playerPropsAi/evidenceContract';
const phrase='Original provider receipt is distinct from native observation time.';
const rows=Array.from({length:80},(_,i)=>({provider:'fixture-provider',observedAt:100.0000001,receivedAt:i<76?100.0000001:100+i,player:i%3,statistic:i%7,phase:i<40,categorical:['category_one','category_two','category_three'][i%3],medicalStatus:i===40?'questionable':'available',meaning:phrase}));
const areas=Object.fromEntries(['recent','history','matchup','availability','prior','market','role','quality'].map(name=>[name,{status:'supplied',facts:[{id:`fact-${name}`,label:name,value:{meaning:phrase,clock:100.0000001}}]}]));
const value:Json={format:'synthetic',sport:'nba',gameId:'synthetic-game',start:'2026-11-11T20:00:00Z',lock:'2026-11-11T19:00:00Z',cutoff:'2026-11-11T18:00:00Z',stage:'early',schema:{quoteTrace:'[actor,market,book,line,side,opening,events]'},historicalGames:[],sharedContext:{rows,literals:[{$literal:'#123'},{$o:[['literal',1]]},{$tuples:{rows:1}},{$ref:'context_0'},'#12','#not-an-index',null,false,0,-0,1.000000001,'\u0000number:-0']},players:[{id:'actor-1',name:'Synthetic Actor',team:'AAA',opponent:'BBB',markets:['points','rebounds'],evidence:[['e0','market',0,1,{rows}]],readerAreas:areas}],quoteTraces:Array.from({length:20},(_,i)=>[0,0,0,i+0.5,'over',false,Array.from({length:10},(_,n)=>[100.0000001,100.0000001,0,-110+n,1])])};
const before=structuredClone(value),packed=verifiedReaderSourceV3(value);
assert.equal(packed.format,'props_source_tables_v3');assert.deepEqual(unpackReaderSource(packed),before);assert.deepEqual(value,before);
const wire=JSON.parse(JSON.stringify(packed)) as PackedReaderSourceV3;
// JSON itself serializes -0 as 0; the in-memory codec retains the original type/value.
assert.deepEqual(unpackReaderSource(wire),JSON.parse(JSON.stringify(before)));
const doc=packed.document as Record<string,Json>,actor=(doc.players as Record<string,Json>[])[0];
assert.equal(doc.gameId,'synthetic-game');assert.equal(actor.id,'actor-1');assert.equal(actor.name,'Synthetic Actor');assert.deepEqual(actor.markets,['points','rebounds']);assert.deepEqual(doc.schema,(value as Record<string,Json>).schema);
assert.ok(JSON.stringify(packed).length<JSON.stringify(value).length*0.75);
for(const encoding of ['constant','dictionary','default','runs','sameAs'])assert.ok(JSON.stringify(packed).includes(`\"${encoding}\":`),`Positive ${encoding} encoding exercised`);
// Stored v1/v2 packets retain their original decoding semantics.
const legacy=packReaderSource(value);assert.deepEqual(unpackReaderSource(legacy),value);const v1={...legacy,format:'props_source_records_v1' as const};assert.deepEqual(unpackReaderSource(v1),unpackReaderSource(legacy));
function rejects(change:(p:PackedReaderSourceV3)=>void,pattern:RegExp){const p=structuredClone(packed);change(p);assert.throws(()=>unpackReaderSource(p),pattern);}
rejects(p=>{p.document='#999999999';},/reference/);
rejects(p=>{p.document='#01';},/label/);
rejects(p=>{p.document={$literal:'#1',extra:1};},/Ambiguous/);
rejects(p=>{p.document={$o:[['x',1],['x',2]]};},/escaped/);
rejects(p=>{p.tables[0].fields[1]=p.tables[0].fields[0];},/schema/);
rejects(p=>{p.tables[0].start++;},/range/);
rejects(p=>{Object.assign(p.tables[0],{extra:1});},/schema/);
rejects(p=>{p.tables[0].columns[0]={sameAs:0};},/alias/);
rejects(p=>{p.tables[0].columns[0]={dictionary:['x'],indices:Array(p.tables[0].rows).fill(1)};},/dictionary/);
rejects(p=>{p.tables[0].columns[0]={default:0,at:[[0,1],[0,2]]};},/sparse/);
rejects(p=>{p.tables[0].columns[0]={runs:[[p.tables[0].rows+1,0]]};},/run/);
rejects(p=>{p.document=`#${p.tables[0].start}`;p.tables[0].columns[0]={constant:`#${p.tables[0].start}`};},/Cyclic/);
rejects(p=>{p.decodedNodes=2;},/allocation|expansion|pool/);
rejects(p=>{p.decodedBytes=1;},/pool|expansion/);
rejects(p=>{p.document={$tuples:{rows:100_001,width:1,columns:[[1]]}};},/count/);
rejects(p=>{p.document={$tuples:{rows:1,width:1,columns:[{runs:[[0,1]]}]}};},/run/);
const cyclic:Record<string,Json>={};cyclic.self=cyclic;assert.throws(()=>verifiedReaderSourceV3(cyclic),/Cyclic/);
console.log('Source tables v3: exact facts/types/precision, named navigation, all eight areas, reserved collisions, legacy v1/v2, sparse/runs/dictionaries and bounded malformed/cyclic decoding passed.');
