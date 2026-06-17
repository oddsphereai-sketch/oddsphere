import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const day="2026-06-13";
  const {data}=await sb.from("games").select("id,sport,slate_status,status,game_date,external_id").gte("game_date",`${day}T00:00:00Z`).lte("game_date",`${day}T23:59:59Z`).order("game_date");
  console.log("=== 2026-06-13 games detail ===");
  for(const r of data??[]) console.log(`${r.sport.padEnd(6)} ${r.slate_status.padEnd(10)} ${r.status.padEnd(18)} ${new Date(r.game_date).toISOString()} ext=${r.external_id}`);
  console.log(`\nNow (UTC): ${new Date().toISOString()}`);
  // route output per sport
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  for(const sport of ["mlb","nba","nhl","soccer"]){
    const res=await GET(new Request(`https://x/api/lab/daily-edge?sport=${sport}&date=${day}`));
    let n=0; try{const b=await res.json() as any; n=(b.games??b.cards??[]).length;}catch{}
    console.log(`route ${sport}: status=${res.status} games=${n}`);
  }
})();
