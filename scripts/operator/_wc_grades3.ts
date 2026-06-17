import { supabase } from "../../lib/db/supabase";
async function main(){
  const { data } = await supabase.from("prediction_grades")
    .select("result, push, win, loss, void, pending, market, grade_source, prediction_records!inner(sport, matchup, slate_date, side, play_grade)")
    .eq("prediction_records.sport","soccer").gte("prediction_records.slate_date","2026-06-13");
  const rows = (data ?? []) as any[];
  const rec = (r:any)=> Array.isArray(r.prediction_records)?r.prediction_records[0]:r.prediction_records;
  const byGame = new Map<string, any[]>();
  for (const r of rows){ const pr=rec(r); const k=`${pr.slate_date}|${pr.matchup}`; (byGame.get(k)??byGame.set(k,[]).get(k)!).push({...r, ...pr}); }
  console.log("=== per game: market → result (pending?) ===");
  let completed=0, dcResolved=0, mrResolved=0;
  for (const [k,rs] of byGame){
    const resolved = (m:string)=>{ const x=rs.find(r=>r.market===m); return x ? `${x.result}${x.pending?"(PENDING)":""}` : "MISSING"; };
    const mr = rs.find(r=>r.market==="match_result");
    const mrDone = mr && !mr.pending && mr.result && mr.result!=="pending";
    if (mrDone){ completed++; if(mrDone) mrResolved++;
      const dc = rs.find(r=>r.market==="double_chance");
      const dcDone = dc && !dc.pending && dc.result && dc.result!=="pending";
      if (dcDone) dcResolved++;
      console.log(`  ${k.padEnd(24)} MR=${resolved("match_result")} DC=${resolved("double_chance")} TOT=${resolved("total")} BTTS=${resolved("btts")}${mrDone&&!dcDone?"   <-- MR resolved, DC NOT":""}`);
    }
  }
  console.log(`\ncompleted (MR resolved): ${completed}  | DC resolved on those: ${dcResolved}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
