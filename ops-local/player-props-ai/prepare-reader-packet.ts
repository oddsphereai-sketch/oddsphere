/** Prepare the full source input locally; no API calls or production writes. */
import {readFileSync,writeFileSync} from "node:fs";
import {fromCachedExport} from "../../lib/playerPropsAi/cachedAdapters";
import {enrichCachedPacket,mlbPackets,type EnrichedSource} from "../../lib/playerPropsAi/cachedEnrichment";
import {compileMarketReport} from "../../lib/playerPropsAi/marketReport";
import type {GamePacket} from "../../lib/playerPropsAi/evidenceContract";
import {digest,invariant,instant,validatePacket} from "../../lib/playerPropsAi/evidence";
const [sourceFile,packetFile,out]=process.argv.slice(2);
invariant(sourceFile&&packetFile&&out?.startsWith("/private/tmp/"),"Local source, frozen packet and new private output required");
const source=JSON.parse(readFileSync(sourceFile,"utf8")) as EnrichedSource,original=JSON.parse(readFileSync(packetFile,"utf8")) as GamePacket;
const before=digest(source);
let packet:GamePacket;
if(original.sport==="nba"){
  const found=fromCachedExport(source).packets.find(p=>p.gameId===original.gameId&&p.stage===original.stage);invariant(found,"Full original NBA source not found");
  packet=enrichCachedPacket({...found,cutoff:original.cutoff,
    players:found.players.map(p=>({...p,evidence:p.evidence.filter(e=>instant(e.availableAt)<=instant(original.cutoff))})),
    quotes:found.quotes.filter(q=>instant(q.receivedAt)<=instant(original.cutoff)&&instant(q.observedAt)<=instant(original.cutoff)),
    sourceLimitations:[...found.sourceLimitations.filter(s=>!s.startsWith("planned future slot:")),"Offline process rehearsal at the original saved review cutoff; not a new production prediction"]},source);
}else{
  invariant(original.sport==="mlb","NBA/MLB saved full source expected");
  const found=mlbPackets(source).find(p=>p.gameId===original.gameId&&p.stage===original.stage);invariant(found,"Full original MLB source not found");packet=found;
}
validatePacket(packet);packet=compileMarketReport(packet);invariant(digest(source)===before,"Source export changed");
invariant(packet.players.every(p=>original.players.some(x=>x.id===p.id))&&original.players.every(p=>packet.players.some(x=>x.id===p.id)),"Source rebuild changed player identity coverage");
writeFileSync(out,JSON.stringify(packet),{mode:0o600,flag:"wx"});
console.log(JSON.stringify({out,sport:packet.sport,players:packet.players.length,markets:packet.players.reduce((n,p)=>n+p.markets.length,0),productionWrites:0,apiCalls:0}));
