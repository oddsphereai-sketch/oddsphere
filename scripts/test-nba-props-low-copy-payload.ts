import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {gzipSync,gunzipSync} from "node:zlib";
import {encodeNbaPlayerPropsPrivatePayload as encode,decodeNbaPlayerPropsPrivatePayload as decode,encodeNbaPlayerPropsMarketHistoryPayload as stream,writeNbaPlayerPropsMarketHistory,NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,type NbaPlayerPropsMarketHistory} from "../lib/services/nba/nbaPlayerPropsPrivateStore";
import type {SupabaseClient} from "@supabase/supabase-js";

const hash=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
function legacyEncode(payload:unknown,payloadKind:"market_history"|"current_state"|"candidate_snapshot"|"tracking_history"){
 const json=JSON.stringify(payload),compressed=gzipSync(Buffer.from(json),{level:9});
 return {kind:"nba_player_props_private_envelope_v1",release:NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,encoding:"gzip-base64",payloadKind,checksum:hash(json),uncompressedBytes:Buffer.byteLength(json),compressedBytes:compressed.byteLength,payload:compressed.toString("base64")};
}
function legacyDecode(value:ReturnType<typeof legacyEncode>){
 try{const bytes=gunzipSync(Buffer.from(value.payload,"base64"),{maxOutputLength:192_000_000});if(bytes.byteLength!==value.uncompressedBytes)return null;const json=bytes.toString("utf8");return hash(json)===value.checksum?JSON.parse(json):null;}catch{return null;}
}
async function main(){
for(const kind of ["market_history","current_state","candidate_snapshot","tracking_history"]as const){
 const input={kind,rows:[{name:"Nikola Jokić 🏀",price:-110,p:.5000001,line:12.5,lockedAt:"2026-10-30T22:25:27.112Z",evidence:{source:"OWLS",at:"2026-10-30T22:25:00Z"}}],missing:null};
 const original=JSON.stringify(input),envelope=legacyEncode(input,kind),candidate=encode(input,kind);
 assert.deepEqual(candidate,envelope,"encoded gzip, checksum, lengths, release and payload stay byte-identical");
 assert.deepEqual(decode(envelope,kind),legacyDecode(envelope));
 assert.equal(JSON.stringify(input),original,"stored locked evidence and caller input are never mutated");
 for(const changed of [{checksum:"0".repeat(64)},{uncompressedBytes:envelope.uncompressedBytes+1},{uncompressedBytes:envelope.uncompressedBytes-1},{uncompressedBytes:-1},{uncompressedBytes:193_000_000},{compressedBytes:envelope.compressedBytes+1},{payload:envelope.payload.slice(5)}]){
  assert.equal(decode({...envelope,...changed},kind),null,JSON.stringify(changed));
 }
 assert.equal(decode(envelope,kind==="market_history"?"current_state":"market_history"),null);
}
// Preserve the exact legacy UTF-8 replacement semantics, even for a manually
// stored malformed byte stream whose checksum was taken from decoded text.
const invalid=Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]);
const compressed=gzipSync(invalid),odd={...legacyEncode({},"market_history"),checksum:hash(invalid.toString("utf8")),uncompressedBytes:invalid.length,compressedBytes:compressed.length,payload:compressed.toString("base64")};
assert.deepEqual(decode(odd,"market_history"),legacyDecode(odd));
const members=Buffer.concat([gzipSync(Buffer.from('{"x":')),gzipSync(Buffer.from('"legacy"}'))]);
const multi={...odd,payload:members.toString("base64"),compressedBytes:members.length,uncompressedBytes:Buffer.byteLength('{"x":"legacy"}'),checksum:hash('{"x":"legacy"}')};
assert.deepEqual(decode(multi,"market_history"),legacyDecode(multi),"concatenated legacy gzip members keep exact reader semantics");
const large={observations:Array.from({length:24_000},(_,i)=>({id:i,side:i%2?"over":"under",observedAt:"2026-10-30T22:25:00Z",provider:"owls",evidence:"exact frozen source receipt ".repeat(10)}))};
const largeEnvelope=legacyEncode(large,"market_history");
assert.ok(largeEnvelope.uncompressedBytes>8_000_000);
assert.deepEqual(encode(large,"market_history"),largeEnvelope);
assert.deepEqual(decode(largeEnvelope,"market_history"),large);
for(const observations of [[],[{name:"Jokić 🏀",line:1.5,price:-110}],large.observations]){
 const history={release:"fixture",publicEnabled:false,slateDate:"2026-10-30",createdAt:"2026-10-30T00:00:00Z",updatedAt:"2026-10-30T22:25:00Z",observations} as unknown as NbaPlayerPropsMarketHistory;
 const before=JSON.stringify(history);
 assert.deepEqual(await stream(history),legacyEncode(history,"market_history"),"backpressured encoding preserves every exact JSON/gzip/checksum byte");
 assert.equal(JSON.stringify(history),before);
}
const circular={observations:[]as unknown[],publicEnabled:false};circular.observations.push(circular);
await assert.rejects(stream(circular as unknown as NbaPlayerPropsMarketHistory),/circular/i,"stream failure cannot return a publishable partial envelope");
let writes=0;
const client={from:()=>({upsert:async()=>{writes++;return {error:null};}})} as unknown as SupabaseClient;
const oversized={publicEnabled:false,observations:[{evidence:randomBytes(8_500_000).toString("hex")}]} as unknown as NbaPlayerPropsMarketHistory;
await assert.rejects(writeNbaPlayerPropsMarketHistory({client,history:oversized}),/gzip limit/);
assert.equal(writes,0,"compressed overflow cannot reach any database mutation");
await assert.rejects(stream({observations:Array(200_000).fill({evidence:"x".repeat(1_000)})} as unknown as NbaPlayerPropsMarketHistory),/JSON limit/);
console.log("PASS low-copy NBA props codec: legacy bytes/checksums/gzip and decoded values identical; bounded streaming, empty/large histories, unicode, malformed UTF-8, corrupt/truncated/oversized envelopes, failed-stream isolation and immutable input evidence preserved.");
}
void main();
