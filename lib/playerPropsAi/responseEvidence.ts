import {playerSubset} from "./partitions";
/** Private self-contained exact part source/wire, including successful parts of failed jobs. */
import {createHash} from "node:crypto";
import type {GamePacket} from "./evidenceContract";
import type {AcceptedPlayerLaw} from "./law";
import {digest} from "./evidence";
import {archiveFailureBytes} from "./failureEvidence";
import {GENERATIVE_WIRE_RELEASE} from "./generativeCoordinates";
export const PROPS_AI_RESPONSE_EVIDENCE_RELEASE="player_props_ai_response_evidence_2026_11_09_r2_named_correction_request" as const;
const sha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
export function acceptedResponseEvidence(args:{packet:GamePacket;sourcePacket:GamePacket;sourcePacketJson?:string;requestBody:string;draftText:string;correctionText?:string;players:{playerId:string;law:AcceptedPlayerLaw|null;sourceDeclinedMarkets:string[]}[]}){
 const input=JSON.stringify(args.packet),whole=args.sourcePacketJson??JSON.stringify(args.sourcePacket),subset=JSON.stringify(playerSubset(args.sourcePacket,args.packet.players.map(p=>p.id))),partInputKind=input===whole?"whole_game":input===subset?"player_subset_v1":"custom_exact",base={partInputKind,correctionText:args.correctionText??null,release:PROPS_AI_RESPONSE_EVIDENCE_RELEASE,wireRelease:GENERATIVE_WIRE_RELEASE,partInputDigest:digest(args.packet),partInputSha256:sha(input),partInputBytes:Buffer.byteLength(input),requestSha256:sha(args.requestBody),requestBytes:Buffer.byteLength(args.requestBody),canonicalLawHashes:Object.fromEntries(args.players.map(p=>[p.playerId,p.law?.hash??null])),sourceDeclinedMarkets:Object.fromEntries(args.players.map(p=>[p.playerId,p.sourceDeclinedMarkets]))};
 try{const result={...base,partInput:archiveFailureBytes(input),draft:archiveFailureBytes(args.draftText)};if(JSON.stringify(result).length>768000)throw Error("response_evidence_total_bound");return result;}catch{return {...base,archiveUnavailable:"bounded_wire_archive_construction_failed"};}
}
