import type { GamePacket, Json } from "./evidenceContract";
import { digest, invariant, validatePacket } from "./evidence";
import { jointReviewRequest } from "./request";
import { countAiInput } from "./openai";
import { PROPS_AI_MAX_INPUT_PER_REQUEST, PROPS_AI_MAX_OUTPUT_PER_REQUEST, PROPS_AI_PRIMARY_MODEL, type PropsAiModel } from "./releases";
export function playerSubset(packet: GamePacket, ids: string[]): GamePacket {
  const included = new Set(ids);
  const markets: string[] = [], times: string[] = [], sources: string[] = [];
  const index = (values: string[], value: string) => { let i = values.indexOf(value); if (i < 0) { i=values.length;values.push(value); } return i; };
  const rows: Json = packet.players.map(p => [p.id,p.name,p.team,p.opponent,
    p.evidence.filter(e => e.kind === "independent_model").map(e => {
      const value = e.value as Record<string,Json>;
      return [typeof value.market === "string" ? index(markets,value.market) : null,value.independentProjection ?? null,index(times,e.availableAt),index(sources,e.source)];
    })]);
  const context: Json = {format:"peer_baseline_table_v1",schema:{row:"[playerId,name,team,opponent,heads]",head:"[marketIndex,independentMeanOrNull,availabilityTimeIndex,sourceIndex]"},markets,times,sources,rows};
  return { ...packet, players: packet.players.filter(p => included.has(p.id)), quotes: packet.quotes.filter(q => included.has(q.playerId)), sharedGameContext: context };
}
export async function prepareReviewParts(packet: GamePacket, args: { key: string; model?: PropsAiModel; fetchImpl?: typeof fetch; count?: (packet: GamePacket, model: PropsAiModel) => Promise<number> }) {
  validatePacket(packet); const model = args.model ?? PROPS_AI_PRIMARY_MODEL;
  const count = args.count ?? ((p, m) => countAiInput(jointReviewRequest(p, m, PROPS_AI_MAX_OUTPUT_PER_REQUEST), args));
  // Coverage notes plus joint scenarios need a bounded output envelope too.
  const structurallySafe = (p: GamePacket) => p.players.length <= 8 && p.players.reduce((n,player)=>n+player.evidence.length,0)<=800;
  let parts: {packet:GamePacket;inputTokens:number}[] = [];
  if (structurallySafe(packet)) {
    const tokens=await count(packet,model);
    if(tokens<=PROPS_AI_MAX_INPUT_PER_REQUEST)parts=[{packet,inputTokens:tokens}];
  }
  if(!parts.length){
    invariant(packet.players.length>1,"single_player_evidence_exceeds_request_bound");
    // Size estimates choose whole-player bins; the actual model-specific count is
    // still authoritative. No source, player or market is truncated to fit.
    const weighted=packet.players.map(p=>({id:p.id,weight:JSON.stringify(jointReviewRequest(playerSubset(packet,[p.id]),model,PROPS_AI_MAX_OUTPUT_PER_REQUEST)).length})).sort((a,b)=>b.weight-a.weight);
    for (const numberOfBins of [2,3,4]) {
      const bins:string[][]=Array.from({length:numberOfBins},()=>[]),loads=Array(numberOfBins).fill(0) as number[];
      for(const p of weighted){const i=loads.indexOf(Math.min(...loads));bins[i].push(p.id);loads[i]+=p.weight;}
      if(bins.some(b=>!b.length))continue;
      const seen=new Set<string>();
      for(let iteration=0;iteration<6;iteration++){
        const signature=JSON.stringify(bins);if(seen.has(signature))break;seen.add(signature);
        const packets=bins.map(ids=>playerSubset(packet,ids));
        if(!packets.every(structurallySafe))break;
        const tokens=await Promise.all(packets.map(p=>count(p,model)));
        if(tokens.every(n=>n<=PROPS_AI_MAX_INPUT_PER_REQUEST)){parts=packets.map((p,i)=>({packet:p,inputTokens:tokens[i]}));break;}
        const from=tokens.indexOf(Math.max(...tokens)),to=tokens.indexOf(Math.min(...tokens));
        const moved=weighted.filter(p=>bins[from].includes(p.id)).sort((a,b)=>Math.abs((loads[from]-a.weight)-(loads[to]+a.weight))-Math.abs((loads[from]-b.weight)-(loads[to]+b.weight)))[0];
        if(!moved||bins[from].length<=1)break;
        bins[from]=bins[from].filter(id=>id!==moved.id);bins[to].push(moved.id);loads[from]-=moved.weight;loads[to]+=moved.weight;
      }
      if(parts.length)break;
    }
    invariant(parts.length>0,"complete_player_evidence_exceeds_bounded_four_partition_capacity");
  }
  invariant(digest(parts.flatMap(p => p.packet.players.map(p => p.id)).sort()) === digest(packet.players.map(p => p.id).sort()), "partition_player_coverage_mismatch");
  return parts;
}
