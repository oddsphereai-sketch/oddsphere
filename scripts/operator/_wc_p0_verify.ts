import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  console.log("NOW UTC:",new Date().toISOString());
  // 1. soccer games today + recent
  const {data:soc}=await sb.from("games").select("id,external_id,slate_status,status,game_date,home_team_id,away_team_id").eq("sport","soccer").gte("game_date","2026-06-13T00:00:00Z").lte("game_date","2026-06-15T07:00:00Z").order("game_date");
  console.log(`\nsoccer games 06-13..06-15: ${(soc??[]).length}`);
  const ids=new Set<number>(); for(const r of soc??[]){if(r.home_team_id)ids.add(r.home_team_id);if(r.away_team_id)ids.add(r.away_team_id);}
  const {data:tm}=await sb.from("teams").select("id,name").in("id",[...ids]);
  const nm=new Map((tm??[]).map(t=>[t.id,t.name]));
  for(const r of soc??[]) console.log(`  ${new Date(r.game_date).toISOString()} ${r.slate_status} ${r.status} ${nm.get(r.away_team_id)} @ ${nm.get(r.home_team_id)} ext=${r.external_id}`);
  // 2. soccer daily refresh today?
  const {data:logs}=await sb.from("data_refresh_log").select("data_source,refresh_status,records_updated,refresh_started_at").eq("sport","soccer").gte("refresh_started_at","2026-06-13T00:00:00Z").order("refresh_started_at",{ascending:false}).limit(8);
  console.log(`\nsoccer refresh runs today:`); for(const r of logs??[]) console.log(`  ${new Date(r.refresh_started_at).toISOString().slice(11,16)} ${r.data_source} ${r.refresh_status} rec=${r.records_updated}`);
  // 3. route output for soccer today + yesterday
  const {GET}=await import("../../app/api/lab/daily-edge/route");
  for(const d of ["2026-06-13","2026-06-12"]){const res=await GET(new Request(`https://x/api/lab/daily-edge?sport=soccer&date=${d}`));const b=await res.json() as any;const g=(b.games??b.cards??[]);console.log(`route soccer ${d}: HTTP=${res.status} games=${g.length}${g.length?" -> "+g.map((x:any)=>x.awayTeam+"@"+x.homeTeam).join(", "):""}`);}
})().catch(e=>console.error("ERR",e?.message||e));
