import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  console.log("NOW UTC:", new Date().toISOString());
  // Q1: WC games TODAY (06-13 ET ~ 06-13 12:00Z .. 06-14 07:00Z) + any future soccer
  const {data:soc}=await sb.from("games").select("id,external_id,slate_status,status,game_date").eq("sport","soccer").gte("game_date","2026-06-13T00:00:00Z").order("game_date").limit(20);
  console.log(`\nsoccer games >= 06-13 00:00Z: ${(soc??[]).length}`);
  for(const r of soc??[]) console.log(`  ${new Date(r.game_date).toISOString()} ${r.slate_status} ${r.status} ext=${r.external_id}`);
  // Q2: NBA game tonight ingested? + ratings + lines readiness
  const {data:nba}=await sb.from("games").select("id,external_id,slate_status,status,game_date,home_team_id,away_team_id").eq("sport","nba").gte("game_date","2026-06-13T00:00:00Z").order("game_date");
  console.log(`\nnba games >= 06-13 00:00Z: ${(nba??[]).length}`);
  for(const r of nba??[]) console.log(`  ${new Date(r.game_date).toISOString()} ${r.slate_status} ${r.status} ext=${r.external_id} home=${r.home_team_id} away=${r.away_team_id}`);
  // ratings + lines coverage
  const {data:rt}=await sb.from("nba_team_ratings").select("team_id,scope,updated_at").order("updated_at",{ascending:false}).limit(6);
  console.log(`\nnba_team_ratings recent: ${(rt??[]).length}`); for(const r of rt??[]) console.log(`  team=${r.team_id} scope=${r.scope} upd=${new Date(r.updated_at).toISOString().slice(0,16)}`);
  const {data:ln}=await sb.from("lines").select("game_id,market_type,sportsbook").eq("sport","nba").limit(5);
  console.log(`nba lines rows (sample): ${(ln??[]).length}`);
})().catch(e=>console.error("ERR",e?.message||e));
