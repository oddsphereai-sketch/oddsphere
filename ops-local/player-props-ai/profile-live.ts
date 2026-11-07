/** Exact counts for the production joint-law request. No predictions, writes or source mutation. */
import {readFileSync,writeFileSync} from "node:fs";
import type {GamePacket} from "../../lib/playerPropsAi/evidenceContract";
import {prepareReviewParts} from "../../lib/playerPropsAi/partitions";
import {invariant,digest} from "../../lib/playerPropsAi/evidence";
const [manifestFile,out]=process.argv.slice(2);
invariant(out?.startsWith("/private/tmp/")&&process.env.OPENAI_API_KEY,"Private NEW output and configured evaluation environment required");
const manifest=JSON.parse(readFileSync(manifestFile,"utf8")) as {packets:{stage:string;sport:string;gameId:string;research:string}[]};
async function main(){
 const profiles=[],errors=[];
 for(const row of manifest.packets.filter(p=>p.stage==="final")){
  const packet=JSON.parse(readFileSync(row.research,"utf8")) as GamePacket;
  try{
   const parts=await prepareReviewParts(packet,{key:process.env.OPENAI_API_KEY!});
   profiles.push({sport:row.sport,gameId:row.gameId,inputHash:digest(packet),players:packet.players.length,scopes:packet.players.reduce((n,p)=>n+p.markets.length,0),parts:parts.map(p=>({inputTokens:p.inputTokens,players:p.packet.players.length}))});
   console.log(JSON.stringify({completed:profiles.length,game:row.gameId,parts:parts.length,input:parts.reduce((n,p)=>n+p.inputTokens,0)}));
  }catch(error){errors.push({sport:row.sport,gameId:row.gameId,error:(error as Error).message});console.log(JSON.stringify(errors.at(-1)));}
 }
 writeFileSync(out,JSON.stringify({generatedAt:new Date().toISOString(),generationCalls:0,profiles,errors,complete:errors.length===0}),{mode:0o600,flag:"wx"});
 console.log(JSON.stringify({out,profiles:profiles.length,errors:errors.length,generationCalls:0}));
}
void main().catch(error=>{console.error((error as Error).message.replace(/sk-[\w-]+/g,"redacted"));process.exitCode=1;});
