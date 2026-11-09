import {inspectGenerativeDraft} from "./generativeAdmission";
import {GENERATIVE_WIRE_RELEASE} from "./generativeCoordinates";
/** Private bounded failure evidence. No headers, keys or public DTO imports. */
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import type {GamePacket} from "./evidenceContract";
import type {PhysicalFinding} from "./physicalDiagnostics";
export const PROPS_AI_FAILURE_EVIDENCE_RELEASE="player_props_ai_failure_evidence_2026_11_09_r2_generative_diagnostics" as const;
export function archiveFailureBytes(text:string){
 const raw=Buffer.from(text,"utf8");if(raw.length>16_000_000)throw Error("failure_evidence_input_bound");
 const compressed=gzipSync(raw);if(compressed.length>2_000_000)throw Error("failure_evidence_compressed_bound");
 return {encoding:"gzip-base64" as const,bytes:raw.length,sha256:createHash("sha256").update(raw).digest("hex"),data:compressed.toString("base64")};
}
export function failureEvidence(args:{packet:GamePacket;requestBody:string;draftText:string|null;reason:string;physical:PhysicalFinding[]}){
 let diagnostics:unknown=null;try{const raw=args.draftText===null?null:JSON.parse(args.draftText);if(raw?.wireRelease===GENERATIVE_WIRE_RELEASE){const inspection=inspectGenerativeDraft(args.packet,raw);diagnostics={coordinates:inspection.coordinates,source:inspection.source,format:inspection.format};}}catch{}
 const base={generativeDiagnostics:diagnostics,release:PROPS_AI_FAILURE_EVIDENCE_RELEASE,reason:(typeof args.reason==="string"?args.reason:"unclassified_failure").replace(/sk-[A-Za-z0-9_-]+/g,"redacted").slice(0,2000),physical:args.physical};
 try{const result={...base,input:archiveFailureBytes(JSON.stringify(args.packet)),request:archiveFailureBytes(args.requestBody),draft:args.draftText===null?null:archiveFailureBytes(args.draftText)};if(JSON.stringify(result).length>768000)throw Error("failure_evidence_total_bound");return result;}
 catch{return {...base,archiveUnavailable:"bounded_archive_construction_failed"};}
}
