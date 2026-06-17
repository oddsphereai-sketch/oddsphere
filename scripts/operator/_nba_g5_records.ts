import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:g}=await sb.from("games").select("id").eq("external_id",401859967).single();
  const {data:pr}=await sb.from("prediction_records").select("market,pick,confidence,play_grade,best_angle,model_used,model_probability,market_probability,edge,locked_at,odds_american,line_value,snapshot_json").eq("game_id",g!.id);
  console.log(`G5 prediction_records: ${(pr??[]).length}`);
  for(const r of pr??[]){
    const aud=(r.snapshot_json as any)?.nba_grounding_audit;
    console.log(`\n${r.market}: pick=${r.pick} conf=${r.confidence} grade=${r.play_grade} BA=${r.best_angle} model_used=${r.model_used}`);
    console.log(`  modelProb=${r.model_probability} marketProb=${r.market_probability} edge=${r.edge} odds=${r.odds_american} line=${r.line_value} locked=${r.locked_at?"Y":"N"}`);
    console.log(`  grounding_audit present=${!!aud}${aud?` strength=${aud.consensus_strength} rawV2_total=${aud.raw_v2_total} grounded_total=${aud.grounded_projection?.total} rejected=${JSON.stringify(aud.rejected_books)}`:""}`);
  }
})().catch(e=>console.error("ERR",e?.message||e));
