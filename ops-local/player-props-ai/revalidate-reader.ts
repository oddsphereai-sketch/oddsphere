/** Recheck immutable saved responses; a new validation is not a new inference. */
import {readFileSync,writeFileSync} from "node:fs";
import type {GamePacket} from "../../lib/playerPropsAi/evidenceContract";
import {readerEvidence,validatePlayerCoverage,type ReaderCoverage} from "../../lib/playerPropsAi/readerCoverage";
import {playerSubset} from "../../lib/playerPropsAi/partitions";
import {structuredAiText,type AiResponse} from "../../lib/playerPropsAi/openai";
import {PROPS_AI_RELEASE} from "../../lib/playerPropsAi/releases";
import {digest,invariant} from "../../lib/playerPropsAi/evidence";
const [packetFile,resultFile,out]=process.argv.slice(2);
invariant(packetFile&&resultFile&&out?.startsWith("/private/tmp/"),"Private packet/result/new output expected");
const packet=JSON.parse(readFileSync(packetFile,"utf8")) as GamePacket;
const result=JSON.parse(readFileSync(resultFile,"utf8")) as {label:string;receipts:{file:string}[]};
const accepted=[],failed=[];
for(const receipt of result.receipts){
  const response=JSON.parse(readFileSync(receipt.file,"utf8")).response as AiResponse;
  const request=JSON.parse(readFileSync(receipt.file.replace(/\.json$/,".request.json"),"utf8")).body;
  const part=playerSubset(packet,JSON.parse(request.input).players.map((p:{id:string})=>p.id)),facts=readerEvidence(part);
  const value=structuredAiText(response) as {players:Record<string,{coverage:ReaderCoverage}>};
  for(const p of part.players){
    try{accepted.push({playerId:p.id,coverage:validatePlayerCoverage(p,facts[p.id],value.players[p.id].coverage),originalResponseId:response.id,originalReceiptFile:receipt.file,originalRequestHash:digest(request)});}
    catch(e){failed.push({playerId:p.id,error:(e as Error).message,originalResponseId:response.id});}
  }
}
invariant(new Set([...accepted,...failed].map(p=>p.playerId)).size===packet.players.length,"Revalidation lost player coverage");
writeFileSync(out,JSON.stringify({release:PROPS_AI_RELEASE,sourceGeneration:result.label,validatedAt:new Date().toISOString(),scope:"New validation of original immutable receipts, not regenerated or backdated forecasts",generationCalls:0,accepted,failed}),{mode:0o600,flag:"wx"});
if(failed.length)writeFileSync(out.replace(/\.json$/,".needs-repair.research.json"),JSON.stringify(playerSubset(packet,failed.map(f=>f.playerId))),{mode:0o600,flag:"wx"});
console.log(JSON.stringify({sport:packet.sport,out,passed:accepted.length,failed,generationCalls:0}));
