import {sourceEventContext} from "./sourceEvents";
import type {Evidence,GamePacket,Json} from "./evidenceContract";
import {digest,stable} from "./evidence";
import {NBA_READER_UNIT_CONTRACT} from './readerUnitContract';
const metadata=new Set(["availableAt","asOfTimestamp","generatedAt","generated_at","capturedAt","fetchedAt","receivedAt","providerResponseAt","updatedAt","updated_at","reportedAt","reportUpdatedAt","sourceSnapshotId","evaluatedAt","snapshotAvailableAt","featureAsOf","asOf","fetched_at","available_at"]);
function content(value:Json):Json{
  if(Array.isArray(value))return value.map(content);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!metadata.has(key)).map(([key,v])=>[key,content(v)]));
  return value;
}
/** This exact derived annotation describes already supplied benchmark units.
 * It is not a new source fact. Unknown annotations, other units, reference
 * values and all real actor/context changes retain their ordinary hash. */
function evidenceContent(packet:GamePacket,e:Evidence):Json{
 const value=e.value;
 if(packet.sport==='nba'&&e.kind==='matchup'&&value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&value.readerBenchmarks===true&&value.readerUnitContract!==undefined
  &&stable(value.readerUnitContract)===stable(NBA_READER_UNIT_CONTRACT)){
  const {readerUnitContract:ignored,...originalFacts}=value;void ignored;
  return content(originalFacts);
 }
 return content(value);
}
/** Quote changes can be repriced. Actual availability, role or matchup changes invalidate the old read. */
export function criticalContextHashes(packet:GamePacket){
  return Object.fromEntries(packet.players.map(player=>[player.id,digest({sport:packet.sport,start:packet.start,player:player.id,team:player.team,opponent:player.opponent,
    ...(player.sourceEventContracts?{sourceEventContracts:sourceEventContext(player.sourceEventContracts)}:{}),
    evidence:[...new Set(player.evidence.filter(e=>e.kind!=="market"&&e.kind!=="independent_model").map(e=>stable({kind:e.kind,value:evidenceContent(packet,e)})))].sort(),
    role:[...new Set(player.evidence.filter(e=>e.kind==="independent_model").map(e=>{const v=e.value as Record<string,Json>;return stable(content({role:v.role??null,matchup:v.matchup??null,context:v.context??null}));}))].sort(),
  })]));
}
