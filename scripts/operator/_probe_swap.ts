import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const { buildSoccerDailyEdgeAdapted } = await import("../../lib/services/soccer/buildSoccerDailyEdgeAdapted");
  const res = await buildSoccerDailyEdgeAdapted("2026-06-12");
  for(const g of res.games as any[]){
    console.log(`\n=== ${g.id} ===`);
    for(const [slot,m] of Object.entries(g.markets ?? {}) as any[]){
      if(!m) continue;
      const ctxs=["soccerMatchResultContext","soccerDoubleChanceContext","soccerBttsContext","soccerTotalContext"].filter(k=>m[k]!=null);
      console.log(`  ${slot.padEnd(13)} pick=${String(m.pick).padEnd(13)} price=${m.priceAmerican} contexts=[${ctxs.join(", ")}]`);
    }
  }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
