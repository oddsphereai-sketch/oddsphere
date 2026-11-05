/** Private per-game receipt codec only. No database, activation, model inference,
 * migration or locked-record replacement; no training rows are packaged here. */
import {createHash} from "node:crypto";
import {gzipSync,gunzipSync} from "node:zlib";
export const CBB_CONTEXTUAL_EVIDENCE_CODEC_RELEASE="cbb_contextual_evidence_gzip_2026_11_05_r1" as const;
export const CBB_CONTEXTUAL_EVIDENCE_MAX_RAW_BYTES=4*1024*1024;
export const CBB_CONTEXTUAL_EVIDENCE_MAX_GZIP_BYTES=512*1024;
export type CbbContextualEvidenceIdentity={gameId:number;asOf:string;modelRelease:string;gradeRelease:string;independentRelease:string;artifactObjectSha256:string};
export type CbbContextualEvidence={identity:CbbContextualEvidenceIdentity;input:unknown;interpretation:unknown;finalScore:unknown;marketDecisions:unknown;trace:unknown};
export type CbbContextualEvidenceEnvelope={release:typeof CBB_CONTEXTUAL_EVIDENCE_CODEC_RELEASE;encoding:"gzip-base64";identity:CbbContextualEvidenceIdentity;uncompressedBytes:number;compressedBytes:number;uncompressedSha256:string;compressedSha256:string;payload:string};
const sha=(v:string|Uint8Array)=>createHash("sha256").update(v).digest("hex");
const isSha=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
function need(v:unknown,message:string):asserts v{if(!v)throw Error("CBB evidence: "+message);}
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);}
const identityKeys=["gameId","asOf","modelRelease","gradeRelease","independentRelease","artifactObjectSha256"] as const;
function identity(v:unknown):asserts v is CbbContextualEvidenceIdentity{
 need(record(v)&&Object.keys(v).length===identityKeys.length&&identityKeys.every(k=>Object.hasOwn(v,k)),"identity fields invalid");
 need(Number.isSafeInteger(v.gameId)&&(v.gameId as number)>0&&typeof v.asOf==="string"&&Number.isFinite(Date.parse(v.asOf)),"game or as-of invalid");
 need([v.modelRelease,v.gradeRelease,v.independentRelease].every(s=>typeof s==="string"&&s.trim().length>0)&&isSha(v.artifactObjectSha256),"release or artifact hash invalid");
}
function sameIdentity(a:unknown,b:unknown){identity(a);identity(b);need(identityKeys.every(k=>a[k]===b[k]),"identity mismatch");}
function jsonValue(v:unknown,seen=new Set<object>(),depth=0):void{
 need(depth<=256,"JSON nesting exceeds budget");if(v===null||typeof v==="string"||typeof v==="boolean")return;
 if(typeof v==="number"){need(Number.isFinite(v),"nonfinite number");return;}
 need(typeof v==="object"&&(Array.isArray(v)||record(v)),"non-JSON value");need(!seen.has(v),"cyclic JSON");seen.add(v);
 const keys=Reflect.ownKeys(v);need(keys.every(k=>typeof k==="string"),"non-JSON symbol key");
 if(Array.isArray(v))need(keys.length===v.length+1&&Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)).every(Boolean)&&keys.every(k=>k==="length"||typeof k==="string"&&String(Number(k))===k&&Number.isSafeInteger(Number(k))&&Number(k)>=0&&Number(k)<v.length),"sparse array or extra array fields");
 for(const key of keys){if(Array.isArray(v)&&key==="length")continue;const d=Object.getOwnPropertyDescriptor(v,key)!;need(d.enumerable&&Object.hasOwn(d,"value"),"non-JSON property");jsonValue(d.value,seen,depth+1);}seen.delete(v);
}
function evidence(v:unknown):asserts v is CbbContextualEvidence{
 jsonValue(v);need(record(v)&&Object.keys(v).length===6&&["identity","input","interpretation","finalScore","marketDecisions","trace"].every(k=>Object.hasOwn(v,k)),"receipt fields invalid");identity(v.identity);
}
function jsonString(v:unknown):string{if(typeof v==="number"&&Object.is(v,-0))return "-0";if(Array.isArray(v))return "["+v.map(jsonString).join(",")+"]";if(record(v))return "{"+Object.keys(v).map(k=>JSON.stringify(k)+":"+jsonString(v[k])).join(",")+"}";return JSON.stringify(v);}
function frozen<T>(v:T):T{if(v&&typeof v==="object"){Object.values(v).forEach(frozen);Object.freeze(v);}return v;}
export function encodeCbbContextualEvidence(value:CbbContextualEvidence|string):Readonly<CbbContextualEvidenceEnvelope>{
 let originalJSON:string;if(typeof value==="string")originalJSON=value;else{evidence(value);originalJSON=jsonString(value);}
 const uncompressedBytes=Buffer.byteLength(originalJSON);need(uncompressedBytes>0&&uncompressedBytes<=CBB_CONTEXTUAL_EVIDENCE_MAX_RAW_BYTES,"uncompressed byte budget exceeded");
 const parsed:unknown=JSON.parse(originalJSON);evidence(parsed);const raw=Buffer.from(originalJSON),gzip=gzipSync(raw,{level:9});need(gzip.length<=CBB_CONTEXTUAL_EVIDENCE_MAX_GZIP_BYTES,"compressed byte budget exceeded");
 return frozen({release:CBB_CONTEXTUAL_EVIDENCE_CODEC_RELEASE,encoding:"gzip-base64",identity:{...parsed.identity},uncompressedBytes,compressedBytes:gzip.length,uncompressedSha256:sha(raw),compressedSha256:sha(gzip),payload:gzip.toString("base64")});
}
export function decodeCbbContextualEvidence(value:unknown,expectedIdentity:CbbContextualEvidenceIdentity):Readonly<{evidence:CbbContextualEvidence;originalJSON:string}>{
 need(record(value)&&value.release===CBB_CONTEXTUAL_EVIDENCE_CODEC_RELEASE&&value.encoding==="gzip-base64","unsupported envelope");sameIdentity(value.identity,expectedIdentity);
 need(Number.isSafeInteger(value.compressedBytes)&&(value.compressedBytes as number)>0&&(value.compressedBytes as number)<=CBB_CONTEXTUAL_EVIDENCE_MAX_GZIP_BYTES&&Number.isSafeInteger(value.uncompressedBytes)&&(value.uncompressedBytes as number)>0&&(value.uncompressedBytes as number)<=CBB_CONTEXTUAL_EVIDENCE_MAX_RAW_BYTES,"invalid byte budgets");
 need(isSha(value.compressedSha256)&&isSha(value.uncompressedSha256)&&typeof value.payload==="string"&&value.payload.length<=4*Math.ceil(CBB_CONTEXTUAL_EVIDENCE_MAX_GZIP_BYTES/3)&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.payload),"invalid hashes or canonical base64");
 const gzip=Buffer.from(value.payload,"base64");need(gzip.toString("base64")===value.payload&&gzip.length===value.compressedBytes&&sha(gzip)===value.compressedSha256,"compressed hash/bytes mismatch");
 const raw=gunzipSync(gzip,{maxOutputLength:CBB_CONTEXTUAL_EVIDENCE_MAX_RAW_BYTES});need(raw.length===value.uncompressedBytes&&sha(raw)===value.uncompressedSha256,"uncompressed hash/bytes mismatch");
 const originalJSON=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw),parsed:unknown=JSON.parse(originalJSON);evidence(parsed);sameIdentity(parsed.identity,expectedIdentity);sameIdentity(parsed.identity,value.identity);
 return frozen({evidence:parsed,originalJSON});
}
