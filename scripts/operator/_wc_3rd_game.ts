import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  // the 3 games + which have predictions
  const {data:g}=await sb.from("games").select("id,external_id,game_date,status").eq("sport","soccer").in("external_id",[5,6,7]);
  for(const r of g??[]){
    const {data:pr}=await sb.from("prediction_records").select("market").eq("game_id",r.id);
    console.log(`ext=${r.external_id} game_date=${new Date(r.game_date).toISOString()} status=${r.status} predictions=${(pr??[]).length}`);
  }
  // What ET window does the route use for 2026-06-13?
  const { etSlateDateToUtcWindow } = await import("../../lib/services/nba/etSlateDate");
  try{ const w=etSlateDateToUtcWindow("2026-06-13"); console.log("\nETwindow(2026-06-13):", JSON.stringify(w)); }catch(e:any){ console.log("etSlateDateToUtcWindow err:",e?.message); }
})().catch(e=>console.error("ERR",e?.message||e));
