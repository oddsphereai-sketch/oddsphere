import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  for(const sport of ["mlb","nba","nhl","soccer"]){
    try{
      const res=await GET(new Request(`https://x/api/lab/daily-edge?sport=${sport}&date=2026-06-13`));
      const b=await res.json() as any;
      const games=(b.games??b.cards??[]);
      let ml=0,ou=0,nan=0;
      if(sport==="mlb") for(const g of games){const m=g.markets??{};
        if(m.moneyline){ml++; if(m.moneyline.modelProb!==null&&!Number.isFinite(m.moneyline.modelProb))nan++;}
        if(m.total){ou++; if(m.total.modelProb!==null&&!Number.isFinite(m.total.modelProb))nan++;}}
      console.log(`${sport.padEnd(7)} HTTP=${res.status} games=${games.length}`+(sport==="mlb"?` mlSlots=${ml} ouSlots=${ou} NaN=${nan}`:""));
    }catch(err:any){console.log(`${sport.padEnd(7)} ROUTE ERROR: ${err?.message||err}`);}
  }
})();
