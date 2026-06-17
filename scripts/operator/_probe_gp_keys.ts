import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data,count}=await sb.from("game_predictions").select("game_id, slate_date, sport_specific",{count:"exact"}).eq("sport","mlb").order("slate_date",{ascending:false}).limit(3);
  console.log("total mlb game_predictions:",count);
  for(const r of data??[]){
    const sp=(r.sport_specific??{}) as any;
    console.log(`\ng${r.game_id} slate=${r.slate_date} sport_specific keys: ${Object.keys(sp).join(", ")}`);
    if(sp.v2_2_audit) console.log(`  v2_2_audit keys: ${Object.keys(sp.v2_2_audit).slice(0,8).join(", ")}... ml_edge=${sp.v2_2_audit.ml_edge_pct} ml_ba_elig=${sp.v2_2_audit.ml_best_angle_eligible}`);
  }
  // also check prediction_records best_angle distribution recent
  const {data:pr}=await sb.from("prediction_records").select("play_grade, best_angle, edge, market",{count:"exact"}).eq("sport","mlb").eq("best_angle",true).order("created_at",{ascending:false}).limit(15);
  console.log(`\nrecent MLB best_angle=true prediction_records: ${(pr??[]).length}`);
  for(const r of pr??[]) console.log(`  ${r.market} grade=${r.play_grade} edge=${r.edge}`);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
