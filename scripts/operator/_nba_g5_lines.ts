import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:g}=await sb.from("games").select("id,home_team_id,away_team_id").eq("external_id",401859967).single();
  console.log("G5 game:",JSON.stringify(g));
  const {data:t}=await sb.from("teams").select("id,abbreviation").in("id",[g!.home_team_id,g!.away_team_id]);
  console.log("teams:",JSON.stringify(t));
  const {data:ln}=await sb.from("lines").select("market_type,side,line_value,odds_american,sportsbook").eq("game_id",g!.id).order("market_type");
  console.log(`\nlines rows: ${(ln??[]).length}`);
  for(const r of ln??[]) console.log(`${r.market_type.padEnd(10)} side=${String(r.side).padEnd(6)} line=${r.line_value} odds=${r.odds_american} book=${r.sportsbook}`);
})().catch(e=>console.error("ERR",e?.message||e));
