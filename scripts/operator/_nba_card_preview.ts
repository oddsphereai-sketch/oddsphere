import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  const res=await GET(new Request("https://x/api/lab/daily-edge?sport=nba&date=2026-06-13"));
  const b=await res.json() as any; const games=(b.games??b.cards??[]);
  console.log(`route nba 2026-06-13: HTTP=${res.status} games=${games.length}`);
  const isBad=(v:any)=>v!==null&&v!==undefined&&typeof v==="number"&&!Number.isFinite(v);
  for(const g of games){
    console.log(`\ncard: ${g.awayTeam} @ ${g.homeTeam}  (logos: away=${!!g.awayTeamLogo} home=${!!g.homeTeamLogo})`);
    console.log(`  lockState=${g.lockState} status=${g.status} gameTime=${g.gameTime}`);
    const m=g.markets??{};
    for(const k of ["moneyline","total"]){const mk=m[k]; if(!mk){console.log(`  ${k}: MISSING`);continue;}
      console.log(`  ${k}: pick=${mk.pick} verdict=${mk.verdict??mk.grade} modelProb=${mk.modelProb} conf=${mk.confidence} gap=${mk.modelMarketGapPct} line=${mk.line??mk.modelTotal??""}`);
      for(const [kk,vv] of Object.entries(mk)) if(isBad(vv)) console.log(`    !! NaN field ${kk}`);
    }
    // team name casing
    if(/^[a-z]/.test(g.homeTeam||"")||/^[a-z]/.test(g.awayTeam||"")) console.log("  !! lowercase team name");
  }
})().catch(e=>console.error("ERR",e?.message||e));
