import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {NBA_PROPS_MARKET_ROW_TABLE as tag,parseNbaPropsMarketRowTable as parse,planNbaPropsMarketRowTable as plan} from "../lib/services/nba/nbaPlayerPropsMarketRowTable";
import {encodeNbaPlayerPropsMarketHistoryPayload as encode,decodeNbaPlayerPropsPrivatePayload as decode,NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,type NbaPlayerPropsMarketHistory} from "../lib/services/nba/nbaPlayerPropsPrivateStore";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const template={format:tag,properties:[["release","fixture"],["observations"],["publicEnabled",false]],layouts:[["name","line","price","original"]],rows:[[0,"Jokić 🏀",4.5,-110,{source:"exact",nullId:null}],[0,"Jokić 🏀",4.5,-110,{source:"exact",nullId:null}]]};
const expected={release:"fixture",observations:[{name:"Jokić 🏀",line:4.5,price:-110,original:{source:"exact",nullId:null}},{name:"Jokić 🏀",line:4.5,price:-110,original:{source:"exact",nullId:null}}],publicEnabled:false};
assert.equal(JSON.stringify(parse(structuredClone(template),250_000)),JSON.stringify(expected),"ordered keys, duplicate rows and nested original values remain exact");
let negatives=0;
for(const mutate of [
 (x:typeof template)=>{x.format="forged" as typeof tag;},
 (x:typeof template)=>{(x as unknown as Record<string,unknown>).extra=true;},
 (x:typeof template)=>{x.layouts[0]!.push("name");},
 (x:typeof template)=>{x.layouts[0]![0]="x".repeat(129);},
 (x:typeof template)=>{x.layouts=Array(65).fill([]);},
 (x:typeof template)=>{x.layouts=[Array.from({length:65},(_,i)=>String(i))];},
 (x:typeof template)=>{x.rows[0]![0]=-1;},
 (x:typeof template)=>{x.rows[0]![0]=.5;},
 (x:typeof template)=>{x.rows[0]![0]=3;},
 (x:typeof template)=>{x.rows[0]!.pop();},
 (x:typeof template)=>{x.properties.push(["release","forged"]);},
 (x:typeof template)=>{x.properties=x.properties.filter(p=>p[0]!=="observations");},
 (x:typeof template)=>{x.properties.find(p=>p[0]==="observations")!.push("forged");},
]){const bad=structuredClone(template);mutate(bad);assert.throws(()=>parse(bad,250_000));negatives++;}
assert.throws(()=>parse(structuredClone(template),1));negatives++;
const safe=parse({format:tag,properties:[["observations"]],layouts:[["__proto__","constructor"]],rows:[[0,"stored value","original"]]},1) as {observations:Record<string,unknown>[]};
assert.equal(Object.getPrototypeOf(safe.observations[0]),Object.prototype);assert(Object.hasOwn(safe.observations[0]!,"__proto__"));assert.equal(safe.observations[0]!.__proto__,"stored value");
const row={name:"Jokić 🏀",line:4.5,americanPrice:-110,observedAt:"2026-11-23T22:25:00.000Z",receivedAt:"2026-11-23T22:25:01.000Z",identity:{originalName:null,provider:"frozen"},omitted:undefined};
const history={release:"fixture",observations:Array(100_000).fill(row),publicEnabled:false,slateDate:"2026-11-23",createdAt:"2026-11-23T00:00:00Z",updatedAt:"2026-11-23T22:25:00Z"} as unknown as NbaPlayerPropsMarketHistory;
assert.equal(plan({...history,observations:[row]},250_000),null);
const unsupported={...row};Object.defineProperty(unsupported,"getter",{enumerable:true,get:()=>"original"});
assert.equal(plan({...history,observations:[unsupported,...history.observations.slice(1)]},250_000),null,"unsupported shapes retain the old path rather than omit a field");
async function main(){
 const before=JSON.stringify(history),encoded=await encode(history);assert.equal(encoded.payloadSchema,tag);assert.equal(JSON.stringify(decode(encoded,"market_history")),before);assert.equal(JSON.stringify(history),before,"caller/source objects never mutate");
 for(const changed of [{payloadSchema:"forged"},{checksum:"0".repeat(64)},{uncompressedBytes:encoded.uncompressedBytes+1},{compressedBytes:encoded.compressedBytes+1}]){assert.equal(decode({...encoded,...changed},"market_history"),null);negatives++;}
 assert.equal(decode(encoded,"candidate_snapshot"),null);negatives++;
 assert.equal(decode({...encoded,payloadSchema:undefined},"market_history"),null,"a stripped new tag cannot masquerade as legacy history");negatives++;
 assert.equal(decode({...encoded,release:"nba_player_props_private_store_2026_11_08_r8_interned_ai_coverage"},"market_history"),null,"new tagged rows cannot be reinterpreted as old authority");negatives++;
 const empty=gzipSync(Buffer.alloc(0)),padding=Buffer.alloc(empty.length*Math.ceil(8_000_001/empty.length),empty),padded=Buffer.concat([Buffer.from(encoded.payload,"base64"),padding]);
 assert.equal(decode({...encoded,compressedBytes:padded.length,payload:padded.toString("base64")},"market_history"),null,"valid zero-output gzip members cannot bypass the unchanged compressed ceiling");negatives++;
 const json=JSON.stringify({...template,rows:[[9]]}),gzip=gzipSync(json),bad={...encoded,checksum:hash(json),uncompressedBytes:Buffer.byteLength(json),compressedBytes:gzip.length,payload:gzip.toString("base64")};assert.equal(decode(bad,"market_history"),null);negatives++;
 const legacyJson=JSON.stringify(expected),legacyGzip=gzipSync(legacyJson),legacy={...encoded,release:"nba_player_props_private_store_2026_11_08_r8_interned_ai_coverage",checksum:hash(legacyJson),uncompressedBytes:Buffer.byteLength(legacyJson),compressedBytes:legacyGzip.length,payload:legacyGzip.toString("base64")};delete legacy.payloadSchema;assert.equal(JSON.stringify(decode(legacy,"market_history")),legacyJson,"original R8 envelope remains original authority");
 await assert.rejects(encode({...history,observations:Array(250_001).fill(row)}),/row limit/);negatives++;
 assert.equal(encoded.release,NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE);
 console.log(JSON.stringify({status:"PASS",rows:100_000,allOriginalFieldValuesAndOrderAndDuplicateRowsExact:true,negativeControls:negatives,oldR8ReaderAuthorityPreserved:true,originalInputsUnchanged:true,networkCalls:0,paidCalls:0}));
}
void main();
