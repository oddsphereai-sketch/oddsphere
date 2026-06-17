import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:g}=await sb.from("games").select("id,home_team_id,away_team_id").eq("external_id",7).single();
  const {data:t}=await sb.from("teams").select("id,name").in("id",[g!.home_team_id,g!.away_team_id]);
  console.log("ext7 teams:",JSON.stringify(t));
  // lines for ext7
  const {data:ln}=await sb.from("lines").select("market_type,sportsbook").eq("game_id",g!.id);
  console.log(`ext7 lines: ${(ln??[]).length}`);
  // lines for ext5 (comparison)
  const {data:g5}=await sb.from("games").select("id").eq("external_id",5).single();
  const {data:ln5}=await sb.from("lines").select("market_type").eq("game_id",g5!.id);
  console.log(`ext5 lines (comparison): ${(ln5??[]).length}`);
})().catch(e=>console.error("ERR",e?.message||e));
