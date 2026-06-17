/** READ-ONLY — is the conviction/value gate firing? play_grade dist on recent slates + gate evidence. */
import { supabase } from "../../lib/db/supabase";
async function main(){
  for (const d of ["2026-06-15","2026-06-16"]){
    const {data}=await supabase.from("prediction_records")
      .select("market, play_grade, best_angle, no_bet, snapshot_json")
      .eq("sport","mlb").eq("slate_date",d).in("market",["moneyline","total"]);
    const rows=(data??[]) as any[];
    const dist:Record<string,number>={};
    let gateDemoted=0;
    for(const r of rows){const g=r.best_angle?"best_angle":(r.play_grade??"null");dist[g]=(dist[g]??0)+1;
      // gate evidence: snapshot v2_2_audit may carry a gate note
      const aud=r.snapshot_json?.v2_2_audit;
      const note=JSON.stringify(aud??{}).toLowerCase();
      if(note.includes("gate")||note.includes("conviction")) gateDemoted++;
    }
    console.log(`${d}: n=${rows.length}  dist=${JSON.stringify(dist)}  gate-mentions=${gateDemoted}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
