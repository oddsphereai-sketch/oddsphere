import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  // all teams appearing in soccer games
  const {data:g}=await sb.from("games").select("home_team_id,away_team_id").eq("sport","soccer");
  const ids=new Set<number>(); for(const r of g??[]){if(r.home_team_id)ids.add(r.home_team_id);if(r.away_team_id)ids.add(r.away_team_id);}
  const {data:t}=await sb.from("teams").select("id,name").in("id",[...ids]);
  const elo=readFileSync("data/wc2026_elo_snapshot_2026-06-11.csv","utf8").toLowerCase();
  const missing:string[]=[], present:string[]=[];
  for(const tm of t??[]){ const n=(tm.name||"").toLowerCase(); if(elo.includes(n)) present.push(tm.name); else missing.push(tm.name); }
  console.log(`soccer teams in fixtures: ${(t??[]).length}`);
  console.log(`IN Elo snapshot (${present.length}): ${present.join(", ")}`);
  console.log(`MISSING from Elo (${missing.length}): ${missing.join(", ")}`);
})().catch(e=>console.error("ERR",e?.message||e));
