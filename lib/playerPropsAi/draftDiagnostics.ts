/** Prospective diagnostics only; never edits returned or accepted text/numbers. */
import type {GamePacket} from "./evidenceContract";
import {READER_AREAS} from "./readerCoverage";
import {physicalLawFindings} from "./physicalDiagnostics";
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function draftFormattingFindings(packet:GamePacket,draft:unknown,verifiedClaimRendering=false){
 const players=object(object(draft)?.players),findings:{playerIndex:number;field:string}[]=[];
 if(!players)return findings;
 packet.players.forEach((p,playerIndex)=>{
  const row=object(players[p.id]);if(!row)return;
  const assessment=row.assessment;
  if(typeof assessment!=="string"||!assessment.trim()||assessment.length>(verifiedClaimRendering?600:180)||!/[.!?]$/.test(assessment.trim()))findings.push({playerIndex,field:"assessment"});
  const coverage=object(row.coverage);if(!coverage)return;
  READER_AREAS.forEach((area,i)=>{const observation=object(coverage[area])?.observation;
   if(typeof observation!=="string"||!observation.trim()||observation.length>(verifiedClaimRendering?1400:300)||!/[.!?]$/.test(observation.trim())||!verifiedClaimRendering&&/\d/.test(observation))findings.push({playerIndex,field:`reader${i}`});
  });
 });return findings;
}
/** Every affected actor/category is listed before optional numeric examples. */
export function draftAdmissionSummary(packet:GamePacket,draft:unknown):string|null{
 const physical=physicalLawFindings(packet,draft),format=draftFormattingFindings(packet,draft);
 if(!physical.length&&!format.length)return null;
 let summary="Draft checks failed. P/S=zero-based player/scenario; A=assessment; R=reader-area index in supplied order. Rewrite clipped prose as a shorter complete sentence; never just add punctuation. ";
 summary+=packet.players.flatMap((_,i)=>{const rules=[...new Set(physical.filter(f=>f.playerIndex===i).map(f=>f.rule))],fields=format.filter(f=>f.playerIndex===i).map(f=>f.field==="assessment"?"A":`R${f.field.slice(6)}`);return rules.length||fields.length?[`P${i} ${[...fields,...rules].join(",")}`]:[];}).join("; ");
 for(const i of [...new Set(physical.map(f=>f.playerIndex))]){const f=physical.find(f=>f.playerIndex===i)!,example=`; P${i} S${f.scenario} ${Object.entries(f.values).map(([k,v])=>`${k}=${v}`).join(",")}`;if(summary.length+example.length<=1024)summary+=example;}
 return summary;
}
