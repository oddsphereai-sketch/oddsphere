import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  // games scheduled per sport for 06-13 (UTC window incl late)
  for(const sport of ["nba","nhl","soccer"]){
    const {data}=await sb.from("games").select("slate_status").eq("sport",sport).gte("game_date","2026-06-13T00:00:00Z").lte("game_date","2026-06-14T07:00:00Z");
    const by:Record<string,number>={}; for(const r of data??[]) by[r.slate_status]=(by[r.slate_status]??0)+1;
    console.log(`${sport}: 06-13 games=${(data??[]).length} ${JSON.stringify(by)}`);
  }
  // confirm a recent published slate still renders via route (regression check on read path)
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  for(const [sport,date] of [["soccer","2026-06-12"],["nhl","2026-06-12"],["mlb","2026-06-12"]]){
    const res=await GET(new Request(`https://x/api/lab/daily-edge?sport=${sport}&date=${date}`));
    const b=await res.json() as any; const n=(b.games??b.cards??[]).length;
    console.log(`route ${sport} ${date}: HTTP=${res.status} games=${n}`);
  }
})();
