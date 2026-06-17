import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:wc}=await sb.from("games").select("id").eq("sport","soccer").gte("game_date","2026-06-12T00:00:00Z").lte("game_date","2026-06-14T07:00:00Z");
  const gids=(wc??[]).map(r=>r.id);
  const {data:pr}=await sb.from("prediction_records").select("id,game_prediction_id,game_id,market,pick,play_grade,confidence,locked_at,best_angle").in("game_id",gids).order("game_id");
  console.log(`=== WC prediction_records (${(pr??[]).length}) ===`);
  for(const r of pr??[]) console.log(`g${r.game_id} ${r.market.padEnd(13)} pick=${String(r.pick).padEnd(10)} grade=${String(r.play_grade).padEnd(11)} conf=${r.confidence} locked=${r.locked_at?"Y":"N"} BA=${r.best_angle}`);
  // grading via prediction_results
  const gpids=(pr??[]).map(r=>r.game_prediction_id).filter(Boolean);
  const {data:res,error}=await sb.from("prediction_results").select("game_prediction_id,market,result,win,graded_at,grade_source").in("game_prediction_id",gpids);
  if(error)console.log("prediction_results err:",error.message);
  console.log(`\n=== WC prediction_results (${(res??[]).length} graded) ===`);
  for(const r of res??[]) console.log(`gp${r.game_prediction_id} ${r.market.padEnd(13)} result=${String(r.result).padEnd(7)} win=${r.win} src=${r.grade_source} at=${r.graded_at?new Date(r.graded_at).toISOString().slice(0,16):"-"}`);
})().catch(e=>console.error("ERR",e?.message||e));
