import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:logs}=await sb.from("data_refresh_log").select("data_source,sport,refresh_status,records_updated,refresh_started_at").gte("refresh_started_at","2026-06-13T00:00:00Z").order("refresh_started_at",{ascending:false}).limit(40);
  console.log(`=== data_refresh_log since 06-13 00:00 UTC (${logs?.length}) ===`);
  for(const r of logs??[]) console.log(`${new Date(r.refresh_started_at).toISOString()} ${(r.sport||"-").padEnd(7)} ${(r.data_source||"").padEnd(28)} ${(r.refresh_status||"").padEnd(8)} rec=${r.records_updated}`);
  // WC tracking: do prediction_records for the 3 WC games have results/grades?
  const {data:wc}=await sb.from("games").select("id").eq("sport","soccer").gte("game_date","2026-06-12T00:00:00Z").lte("game_date","2026-06-14T07:00:00Z");
  const gids=(wc??[]).map(r=>r.id);
  const {data:pr}=await sb.from("prediction_records").select("market,pick,result,graded_at,best_angle,play_grade,locked_at").in("game_id",gids);
  const res:Record<string,number>={}, graded={n:0}; for(const r of pr??[]){res[String(r.result)]=(res[String(r.result)]??0)+1; if(r.graded_at)graded.n++;}
  console.log(`\n=== WC prediction_records (${(pr??[]).length}) result dist=${JSON.stringify(res)} graded=${graded.n} ===`);
  console.log("sample:", JSON.stringify((pr??[]).slice(0,4).map(r=>({m:r.market,pick:r.pick,result:r.result,locked:!!r.locked_at,grade:r.play_grade}))));
})().catch(e=>console.error("ERR",e?.message||e));
