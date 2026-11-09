/** Forward diagnostics only. Never repairs, normalizes or changes a stored law. */
import type {GamePacket} from "./evidenceContract";
import {PROPS_AI_SCENARIOS} from "./releases";
export type PhysicalFinding={playerId:string;playerIndex:number;scenario:number;rule:string;values:Record<string,number>};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function physicalLawFindings(packet:GamePacket,draft:unknown):PhysicalFinding[]{
 const players=object(object(draft)?.players),findings:PhysicalFinding[]=[];if(!players)return findings;
 packet.players.forEach((player,playerIndex)=>{
  const law=object(object(players[player.id])?.law),outcomes=object(law?.outcomes);if(!outcomes)return;
  for(let scenario=0;scenario<PROPS_AI_SCENARIOS;scenario++){
   const stat=(key:string)=>{const a=outcomes[key];return Array.isArray(a)&&a.length===PROPS_AI_SCENARIOS&&Number.isSafeInteger(a[scenario])?a[scenario] as number:undefined;};
   const add=(rule:string,values:Record<string,number|undefined>,bad:boolean)=>{if(bad&&Object.values(values).every(v=>v!==undefined))findings.push({playerId:player.id,playerIndex,scenario,rule,values:values as Record<string,number>});};
   if(packet.sport==="nba"){const pts=stat("points"),threes=stat("threes");add("3PM*3<=PTS",{PTS:pts,"3PM":threes},pts!==undefined&&threes!==undefined&&3*threes>pts);}
   if(packet.sport==="nfl"){
    const att=stat("passing_attempts"),cmp=stat("passing_completions"),td=stat("passing_tds"),int=stat("interceptions"),yds=stat("passing_yards");
    add("CMP<=ATT",{CMP:cmp,ATT:att},cmp!==undefined&&att!==undefined&&cmp>att);
    add("TD<=CMP",{TD:td,CMP:cmp},td!==undefined&&cmp!==undefined&&td>cmp);
    add("INT<=ATT-CMP",{INT:int,ATT:att,CMP:cmp},int!==undefined&&att!==undefined&&cmp!==undefined&&int>att-cmp);
    add("CMP0=>YDS0",{CMP:cmp,YDS:yds},cmp===0&&yds!==undefined&&yds!==0);
   }
   if(packet.sport==="mlb"){const hr=stat("batter_home_runs"),runs=stat("batter_runs_scored"),rbi=stat("batter_rbis");add("HR<=R",{HR:hr,R:runs},hr!==undefined&&runs!==undefined&&hr>runs);add("HR<=RBI",{HR:hr,RBI:rbi},hr!==undefined&&rbi!==undefined&&hr>rbi);}
  }
 });return findings;
}
/** Every player gets a compact example before more scenarios, within existing feedback. */
export function physicalCorrectionSummary(findings:PhysicalFinding[]){
 const groups=new Map<number,PhysicalFinding[]>();for(const f of findings)groups.set(f.playerIndex,[...(groups.get(f.playerIndex)??[]),f]);
 const prefix="Physical identities failed. P/S=zero-based input player/scenario. Recheck evidence; fix all bad scenarios, never clamp. ";
 const essentials=[...groups].map(([p,rows])=>`P${p} ${[...new Set(rows.map(f=>f.rule))].join("/")} (${rows.length} bad)`);
 let result=prefix+essentials.join("; ");
 for(const [p,rows]of groups){const f=rows[0],example=`; P${p} S${f.scenario} ${Object.entries(f.values).map(([k,v])=>`${k}=${v}`).join(",")}`;if(result.length+example.length<=1024)result+=example;}
 return result;
}
