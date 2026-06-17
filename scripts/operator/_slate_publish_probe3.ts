import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const day="2026-06-13";
  const {data}=await sb.from("games").select("id,sport,slate_status,status,created_at,updated_at").gte("game_date",`${day}T00:00:00Z`).lte("game_date",`${day}T23:59:59Z`).order("created_at");
  console.log("=== 06-13 games: created_at / updated_at ===");
  for(const r of data??[]) console.log(`${r.sport.padEnd(6)} ${r.slate_status.padEnd(9)} created=${new Date(r.created_at).toISOString()} updated=${new Date(r.updated_at).toISOString()}`);
  // most recent prediction computed_at across all sports
  const {data:p}=await sb.from("game_predictions").select("computed_at, game_id").order("computed_at",{ascending:false}).limit(5);
  console.log("\n=== most recent game_predictions.computed_at ===");
  for(const r of p??[]) console.log(`${new Date(r.computed_at).toISOString()} game_id=${r.game_id}`);
})();
