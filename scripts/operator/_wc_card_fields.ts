import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  const res=await GET(new Request("https://x/api/lab/daily-edge?sport=soccer&date=2026-06-13"));
  const b=await res.json() as any;
  console.log("sport label:", b.sport?.label ?? b.sportLabel ?? "(see games)", "| games:", (b.games??[]).length);
  const isBad=(v:any)=>typeof v==="number"&&!Number.isFinite(v);
  let nan=0, ba=0;
  for(const g of (b.games??[])){
    const mk=g.markets??{};
    const slots=Object.keys(mk).filter(k=>mk[k]);
    const held=slots.filter(k=>mk[k].held).length;
    console.log(`${g.awayTeam}@${g.homeTeam} logos=${!!g.awayTeamLogo&&!!g.homeTeamLogo} markets=${slots.length} held=${held}`);
    for(const k of slots){const m=mk[k]; if(m.grade==="best_angle"||m.verdict?.key==="best_angle")ba++;
      for(const [kk,vv] of Object.entries(m)) if(isBad(vv)){nan++;console.log(`  !! NaN ${k}.${kk}`);}
      if(/^[a-z]/.test(g.homeTeam||"")) console.log("  !! lowercase team");
    }
  }
  console.log(`\nNaN fields=${nan} · Best Angle on cards=${ba}`);
})().catch(e=>console.error("ERR",e?.message||e));
