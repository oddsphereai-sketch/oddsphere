/** Production request/process rehearsal, under the EXISTING fixed $2 local ledger. No DB/provider writes. */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {TestBudget,type Attempt} from "./api-eval";
import type {GamePacket} from "../../lib/playerPropsAi/evidenceContract";
import {prepareReviewParts} from "../../lib/playerPropsAi/partitions";
import {jointReviewRequest,parseJointReview,readerReviewRequest,parseReaderReview} from "../../lib/playerPropsAi/request";
import {countAiInput,generateAiReview,structuredAiText} from "../../lib/playerPropsAi/openai";
import {usageMicroUsd} from "../../lib/playerPropsAi/budget";
import {digest,invariant} from "../../lib/playerPropsAi/evidence";
import {PROPS_AI_MAX_OUTPUT_PER_REQUEST,PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL,type PropsAiModel} from "../../lib/playerPropsAi/releases";
const arg=(name:string)=>process.argv.find(s=>s.startsWith(`--${name}=`))?.slice(name.length+3);
async function main(){
 const file=arg("packet"),label=arg("label"),model=(arg("model")??PROPS_AI_PRIMARY_MODEL) as PropsAiModel;
 invariant(file&&label&&/^[a-z0-9_-]+$/i.test(label)&&[PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL].includes(model)&&process.env.OPENAI_API_KEY,"Packet, unique label, supported model and private key environment required");
 const packet=JSON.parse(readFileSync(file,"utf8")) as GamePacket;
 const readerOnly=arg("mode")==="reader",request=readerOnly?readerReviewRequest:jointReviewRequest;
 const parts=await prepareReviewParts(packet,{key:process.env.OPENAI_API_KEY!,model,count:(p,m)=>countAiInput(request(p,m,PROPS_AI_MAX_OUTPUT_PER_REQUEST),{key:process.env.OPENAI_API_KEY!})});
 const root="/private/tmp/oddsphere-props-ai-eval-20261106",budget=new TestBudget(`${root}/ledger.json`);mkdirSync(root,{recursive:true,mode:0o700});
 const planned=parts.map((part,i)=>{
  const body=request(part.packet,model,PROPS_AI_MAX_OUTPUT_PER_REQUEST),id=digest({body,label,part:i});
  const reserve=Math.ceil(usageMicroUsd(model,{input_tokens:part.inputTokens+2048,output_tokens:PROPS_AI_MAX_OUTPUT_PER_REQUEST})*1.2)/1e6;
  const attempt:Attempt={id,job:`joint-law-rehearsal|${packet.gameId}|${packet.stage}`,model,reservedUsd:reserve,actualUsd:null,status:"reserved",inputTokens:part.inputTokens,outputTokens:null};
  return {...part,body,attempt,file:`${root}/${label}_p${i+1}.joint-response.json`};
 });
 budget.reserveMany(planned.map(p=>p.attempt));const receipts=[],players=[];
 try { for(const part of planned){
  budget.claim(part.attempt);writeFileSync(part.file.replace(/\.json$/,".request.json"),JSON.stringify({label,body:part.body,packetDigest:digest(part.packet)}),{mode:0o600,flag:"wx"});
  let response;const progress:{type:string;elapsedMs:number;textCharacters:number}[]=[];
  try{response=await generateAiReview(part.body,{key:process.env.OPENAI_API_KEY!,timeoutMs:180000,onProgress:event=>{if(progress.length<1000)progress.push(event);else progress[999]=event;},onCreated:async id=>{budget.update(part.attempt.id,{responseId:id,status:"streaming"});}});}
  catch(error){budget.update(part.attempt.id,{status:"failed_reservation_retained"});throw error;}
  finally{writeFileSync(part.file.replace(/\.json$/,".stream-health.json"),JSON.stringify({events:progress,scope:"Bounded timing/count metadata (first events and latest event); no partial model text or hidden reasoning stored"}),{mode:0o600,flag:"wx"});}
  writeFileSync(part.file,JSON.stringify({label,response}),{mode:0o600,flag:"wx"});
  invariant(response.usage,"No usage; reserved charge retained");const actual=usageMicroUsd(model,response.usage)/1e6;
  budget.update(part.attempt.id,{actualUsd:actual,inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens,status:response.status,responseId:response.id});
  let qualityError:string|null=null;
  try{const parsed=readerOnly?parseReaderReview(part.packet,structuredAiText(response)):parseJointReview(part.packet,structuredAiText(response));players.push(...parsed.players);writeFileSync(part.file.replace(/\.json$/,".accepted.json"),JSON.stringify(parsed),{mode:0o600,flag:"wx"});}
  catch(error){qualityError=(error as Error).message;budget.update(part.attempt.id,{qualityError});}
  receipts.push({file:part.file,input:response.usage.input_tokens,output:response.usage.output_tokens,cost:actual,qualityError});
 } } finally {budget.cancelUnsent(planned.map(p=>p.attempt.id));}
 const report={label,model,game:packet.gameId,players:packet.players.length,markets:packet.players.reduce((n,p)=>n+p.markets.length,0),requests:planned.length,
  knownUsd:receipts.reduce((n,r)=>n+r.cost,0),allProcessChecksPassed:receipts.every(r=>!r.qualityError),mode:readerOnly?"reader_process_only":"joint_forecast",reviewedPlayers:players.length,receipts,productionWrites:0,
  scope:"full-scope API-format/process/cost rehearsal; no retrospective accuracy qualification or live publication"};
 writeFileSync(`${root}/${label}.joint-result.json`,JSON.stringify(report),{mode:0o600,flag:"wx"});console.log(JSON.stringify(report));
}
void main().catch(error=>{console.error((error as Error).message.replace(/sk-[\w-]+/g,"redacted"));process.exitCode=1;});
