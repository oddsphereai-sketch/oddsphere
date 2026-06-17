import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const day="2026-06-13";
  const {data}=await sb.from("games").select("id,external_id,slate_status,status,home_pitcher_id,away_pitcher_id,game_date").eq("sport","mlb").gte("game_date",`${day}T12:00:00Z`).lte("game_date",`${day}T23:59:59Z`).order("game_date");
  console.log("=== 06-13 MLB scheduled games — starter confirmation (G2) ===");
  let bothConfirmed=0, anyMissing=0;
  for(const r of data??[]){
    const hp=r.home_pitcher_id!=null, ap=r.away_pitcher_id!=null;
    if(hp&&ap) bothConfirmed++; else anyMissing++;
    console.log(`ext=${r.external_id} ${r.slate_status} home_pitcher=${r.home_pitcher_id??"NULL"} away_pitcher=${r.away_pitcher_id??"NULL"}`);
  }
  console.log(`\nbothConfirmed=${bothConfirmed} / ${(data??[]).length}  (anyMissing=${anyMissing})`);
})();
