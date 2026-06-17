import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  console.log("NOW (UTC):", new Date().toISOString());
  // All NBA games in the last 5 days + next 2 (UTC)
  const {data}=await sb.from("games").select("id,external_id,slate_status,status,game_date,created_at,home_team_id,away_team_id").eq("sport","nba").gte("game_date","2026-06-08T00:00:00Z").lte("game_date","2026-06-15T23:59:59Z").order("game_date");
  console.log(`\n=== NBA games 06-08..06-15 (UTC): ${(data??[]).length} ===`);
  // resolve team abbrevs
  const ids=new Set<number>(); for(const r of data??[]){ if(r.home_team_id)ids.add(r.home_team_id); if(r.away_team_id)ids.add(r.away_team_id);}
  const {data:teams}=await sb.from("teams").select("id,abbreviation,name").in("id",[...ids]);
  const tm=new Map((teams??[]).map(t=>[t.id,t.abbreviation||t.name]));
  for(const r of data??[]) console.log(`${new Date(r.game_date).toISOString()} ${r.slate_status.padEnd(9)} ${r.status.padEnd(16)} ${tm.get(r.away_team_id)??"?"}@${tm.get(r.home_team_id)??"?"} ext=${r.external_id} created=${new Date(r.created_at).toISOString()}`);
  // predictions for those
  const gids=(data??[]).map(r=>r.id);
  if(gids.length){const {data:p}=await sb.from("game_predictions").select("game_id,computed_at").in("game_id",gids); console.log(`\nNBA predictions for those games: ${(p??[]).length}`);}
})().catch(e=>console.error("ERR",e?.message||e));
