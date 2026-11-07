/** Local source coverage audit; does not claim the AI understood or forecast correctly. */
import {readFileSync,writeFileSync} from "node:fs";
import type {GamePacket} from "../../lib/playerPropsAi/evidenceContract";
import {readerEvidence,READER_AREAS} from "../../lib/playerPropsAi/readerCoverage";
import {digest,invariant,validatePacket} from "../../lib/playerPropsAi/evidence";
const [manifest,out]=process.argv.slice(2);
invariant(manifest&&out?.startsWith("/private/tmp/"),"Local manifest and new private output required");
const rows=JSON.parse(readFileSync(manifest,"utf8")) as {packets:{stage:string;research:string}[]};
const packets=rows.packets.filter(r=>r.stage==="final").map(row=>{
  const p=JSON.parse(readFileSync(row.research,"utf8")) as GamePacket;validatePacket(p);
  const before=digest(p),facts=readerEvidence(p);
  const players=p.players.map(player=>({id:player.id,name:player.name,markets:player.markets,
    areas:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[player.id][area].status,facts:facts[player.id][area].facts.map(f=>({id:f.id,label:f.label,hash:f.hash,availableAt:f.availableAt,sourceIds:f.sourceIds})),limitations:facts[player.id][area].limitations}]))}));
  invariant(digest(p)===before,"Source audit changed its input");
  return {sport:p.sport,gameId:p.gameId,cutoff:p.cutoff,inputHash:before,players};
});
const totals=Object.fromEntries(["nba","nfl","mlb"].map(sport=>{
  const games=packets.filter(p=>p.sport===sport),players=games.flatMap(g=>g.players);
  return [sport,{games:games.length,players:players.length,markets:players.reduce((n,p)=>n+p.markets.length,0),areas:Object.fromEntries(READER_AREAS.map(area=>[area,players.reduce((counts,p)=>{const status=p.areas[area].status;counts[status]=(counts[status]??0)+1;return counts;},{} as Record<string,number>)]))}];
}));
writeFileSync(out,JSON.stringify({scope:"All frozen full-product game/player sources; availability is not proof of freshness, understanding or predictive accuracy",aiCalls:0,productionWrites:0,totals,packets}),{mode:0o600,flag:"wx"});
console.log(JSON.stringify({out,aiCalls:0,productionWrites:0,totals}));
