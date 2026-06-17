import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const { buildSoccerDailyEdgeAdapted } = await import("../../lib/services/soccer/buildSoccerDailyEdgeAdapted");
  const res = await buildSoccerDailyEdgeAdapted("2026-06-12");
  for(const g of res.games as any[]){
    console.log(`\n=== ${g.id} ===`);
    for(const [slot,m] of Object.entries(g.markets ?? {}) as any[]){
      const gc=m?.soccerGradeContext;
      if(gc) console.log(`  ${slot}: model=${gc.model_pct}% market=${gc.market_pct}% edge=${gc.edge_pp}pp miscal=${gc.miscalibration_flag}\n     reason: ${gc.grade_reason}`);
    }
  }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
