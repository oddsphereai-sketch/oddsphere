import type {GamePacket,Json} from "./evidenceContract";
import {digest,stable} from "./evidence";
const metadata=new Set(["availableAt","asOfTimestamp","generatedAt","generated_at","capturedAt","fetchedAt","receivedAt","providerResponseAt","updatedAt","updated_at","reportedAt","reportUpdatedAt","sourceSnapshotId","evaluatedAt","snapshotAvailableAt","featureAsOf","asOf","fetched_at","available_at"]);
function content(value:Json):Json{
  if(Array.isArray(value))return value.map(content);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!metadata.has(key)).map(([key,v])=>[key,content(v)]));
  return value;
}
/** Quote changes can be repriced. Actual availability, role or matchup changes invalidate the old read. */
export function criticalContextHashes(packet:GamePacket){
  return Object.fromEntries(packet.players.map(player=>[player.id,digest({sport:packet.sport,start:packet.start,player:player.id,team:player.team,opponent:player.opponent,
    evidence:[...new Set(player.evidence.filter(e=>e.kind!=="market"&&e.kind!=="independent_model").map(e=>stable({kind:e.kind,value:content(e.value)})))].sort(),
    role:[...new Set(player.evidence.filter(e=>e.kind==="independent_model").map(e=>{const v=e.value as Record<string,Json>;return stable(content({role:v.role??null,matchup:v.matchup??null,context:v.context??null}));}))].sort(),
  })]));
}
