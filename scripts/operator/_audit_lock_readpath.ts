import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const { buildSoccerDailyEdgeAdapted } = await import("../../lib/services/soccer/buildSoccerDailyEdgeAdapted");
  const res = await buildSoccerDailyEdgeAdapted("2026-06-12");
  for(const g of res.games as any[]){
    const isBih = (g.id??"").includes("3") || g.matchup?.includes("BIH") || g.lockState==="locked";
    console.log(`\n=== ${g.id} lockState=${g.lockState} ===`);
    for(const [slot,m] of Object.entries(g.markets ?? {}) as any[]){
      if(!m) continue;
      const v=m.verdict?.label ?? m.verdict;
      console.log(`  ${slot.padEnd(13)} pick=${String(m.pick).padEnd(14)} verdict=${String(v).padEnd(10)} held=${m.held} price=${m.priceAmerican} open=${m.lineOpenAmerican}`);
      if(slot==="total" && m.soccerTotalContext){const t=m.soccerTotalContext;console.log(`     TOTAL note: ${t.note}`);}
    }
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
