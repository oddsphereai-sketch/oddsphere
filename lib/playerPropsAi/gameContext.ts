/** Pure joins of existing collector context. This module never fetches another feed. */
import type { GamePacket, Json, Evidence } from "./evidenceContract";
import { instant, invariant } from "./evidence";

export type ReaderGameContext = {
  id: string; gameId: string; start: string; awayTeam: string; homeTeam: string;
  availableAt: string; source: string;
  injuries?: Json; weather?: Json; depth?: Json;
};
const object=(v:Json|undefined):Record<string,Json>=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const team=(s:string)=>({JAC:"JAX",WSH:"WAS",LA:"LAR"}[s]??s);
function availableAt(value:Json, initial:string){
  let latest=instant(initial);
  const walk=(v:Json)=>{
    if(!v||typeof v!=="object")return;
    for(const [key,entry] of Object.entries(v)){
      if(["capturedAt","reportedAt","reportUpdatedAt","asOfTimestamp","generatedAt","availableAt"].includes(key)&&typeof entry==="string"&&Number.isFinite(Date.parse(entry)))latest=Math.max(latest,instant(entry));
      if(entry&&typeof entry==="object")walk(entry);
    }
  };walk(value);return new Date(latest).toISOString();
}
export function attachGameReaderContext(packet:GamePacket,contexts:ReaderGameContext[]):GamePacket{
  const matching=contexts.filter(c=>c.gameId===packet.gameId&&instant(c.start)===instant(packet.start)&&instant(c.availableAt)<=instant(packet.cutoff));
  return {...packet,players:packet.players.map(player=>{
    const eligible=matching.filter(c=>[player.team,player.opponent].every(t=>[c.awayTeam,c.homeTeam].some(s=>team(s)===team(t))));
    const evidence=[...player.evidence];
    for(const key of ["injuries","weather","depth"] as const){
      const candidates=eligible.flatMap(c=>{const value=c[key];if(!value)return [];const at=availableAt(value,c.availableAt);return instant(at)<=instant(packet.cutoff)?[{c,value,at}]:[];}).sort((a,b)=>instant(b.at)-instant(a.at));
      const selected=candidates[0];if(!selected)continue;
      const {c,value,at}=selected;
      let facts=value;
      if(key==="injuries"){
        const report=object(value),teams=Array.isArray(report.teams)?report.teams.map(object):[];
        const side=(abbreviation:string)=>{
          const found=teams.find(t=>team(String(t.abbreviation))===team(abbreviation));
          return {team:abbreviation,known:Boolean(found&&report.reportUpdatedAt),players:found?.players??[]};
        };
        facts={context:{away:side(c.awayTeam),home:side(c.homeTeam)},originalReport:value,
          interpretation:"Exact source report, including explicit clearances when supplied. An omitted name is not health/starter confirmation."};
      }
      const entry:Evidence={id:`${player.id}:game-context:${key}:${c.id}`,kind:key==="injuries"?"availability":"matchup",availableAt:at,source:`${c.source}; exact-game ${key}`,value:facts};
      invariant(!evidence.some(e=>e.id===entry.id),"Duplicate game-context attachment");evidence.push(entry);
    }
    return {...player,evidence};
  })};
}
