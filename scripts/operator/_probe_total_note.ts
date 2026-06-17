import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const { buildSoccerDailyEdgeAdapted } = await import("../../lib/services/soccer/buildSoccerDailyEdgeAdapted");
  const res = await buildSoccerDailyEdgeAdapted("2026-06-12");
  for(const g of res.games as any[]){
    const t = g.markets?.total?.soccerTotalContext;
    if(t) console.log(`\n${g.matchup} TOTAL: proj=${t.projected_total.toFixed(2)} line=${t.line} disp=${t.displayed_side} mean=${t.mean_direction_side} disagree=${t.mean_vs_probability_disagree}\n  note: ${t.note}`);
  }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
