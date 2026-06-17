import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:g}=await sb.from("games").select("id,slate_status,status").eq("sport","mlb").gte("game_date","2026-06-13T12:00:00Z").lte("game_date","2026-06-14T07:00:00Z");
  const ids=(g??[]).map(r=>r.id);
  const byStatus:Record<string,number>={}; for(const r of g??[]) byStatus[r.slate_status]=(byStatus[r.slate_status]??0)+1;
  console.log(`MLB slate games=${ids.length} slate_status=${JSON.stringify(byStatus)}`);
  const {data:p}=await sb.from("game_predictions").select("game_id,predicted_ml_winner,predicted_ou_side,predicted_nrfi,sport_specific,computed_at").in("game_id",ids);
  const preds=p??[];
  const withMl=preds.filter(r=>r.predicted_ml_winner).length;
  const withOu=preds.filter(r=>r.predicted_ou_side).length;
  const withFi=preds.filter(r=>r.predicted_nrfi!==null).length;
  const v22=preds.filter(r=>(r.sport_specific as any)?.v2_2_audit?.ml_regularized_model_prob!==undefined).length;
  const recent=preds.filter(r=>new Date(r.computed_at).getTime()>Date.parse("2026-06-13T11:40:00Z")).length;
  console.log(`predictions=${preds.length} | ML set=${withMl} | OU set=${withOu} | FI(nrfi non-null)=${withFi} | v2.2 regularized-audit present=${v22} | computed in this run=${recent}`);
})();
