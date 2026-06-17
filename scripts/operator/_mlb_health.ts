import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  const res=await GET(new Request("https://x/api/lab/daily-edge?sport=mlb&date=2026-06-13"));
  const b=await res.json() as any; const games=(b.games??b.cards??[]);
  console.log(`route MLB 06-13: HTTP=${res.status} games=${games.length}`);
  let mlN=0,ouN=0,fiPresent=0,fiHeld=0,starterMissing=0,weatherStale=0,linesMissing=0,nanFields=0,splitsPresent=0,lineMovePresent=0;
  const issues:string[]=[];
  const isNum=(v:any)=>v===null||v===undefined||(typeof v==="number"&&Number.isFinite(v));
  for(const g of games){
    const mk=g.markets??{};
    if(mk.moneyline){mlN++; if(!isNum(mk.moneyline.modelProb))nanFields++;}
    if(mk.total){ouN++; if(!isNum(mk.total.modelProb))nanFields++;}
    const fi=mk.first_inning||mk.firstInning;
    if(fi){ if(fi.held||fi.pick==null) fiHeld++; else fiPresent++; }
    if(!g.homeStarter||!g.awayStarter) starterMissing++;
    // weather staleness + lastUpdated
    const upd=g.updatedAt||g.generatedAt;
    // splits / line movement presence (snapshot)
    if(mk.moneyline?.publicSplits||mk.moneyline?.sharpStatus) splitsPresent++;
    if(mk.moneyline?.lineMovement||g.lineMovement) lineMovePresent++;
    // check obvious broken fields
    for(const [k,mm] of Object.entries(mk)){ const m:any=mm; if(m&&typeof m==="object"){ if(m.modelProb!==undefined&&!isNum(m.modelProb)){issues.push(`${g.awayTeam}@${g.homeTeam} ${k}.modelProb=${m.modelProb}`);} } }
    if(!g.homeTeam||!g.awayTeam||/^[a-z]/.test(g.homeTeam||"")) issues.push(`team label issue ${g.awayTeam}@${g.homeTeam}`);
  }
  console.log(`ML slots=${mlN} OU slots=${ouN} | FI present=${fiPresent} held=${fiHeld} | starters missing=${starterMissing}`);
  console.log(`splits/sharp present=${splitsPresent} lineMove present=${lineMovePresent} | NaN/broken fields=${nanFields}`);
  if(issues.length) console.log("ISSUES:", JSON.stringify(issues.slice(0,10)));
  // sample one card's key fields
  const s=games[0]; if(s) console.log("\nsample card keys:", Object.keys(s.markets?.moneyline??{}).join(","), "| updatedAt=",s.updatedAt,"generatedAt=",s.generatedAt);
})().catch(e=>console.error("ERR",e?.message||e));
