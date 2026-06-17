import { supabase } from "../../lib/db/supabase";
async function main(){
  const { data } = await supabase.from("prediction_records")
    .select("matchup, sport, market, no_bet, launch_day, slate_date, prediction_grades(result, win, loss, void)")
    .eq("sport","soccer").eq("market","double_chance").gte("slate_date","2026-06-14"); // official tracking start
  const rows=(data??[]).filter((r:any)=>!r.launch_day) as any[];
  const g=(r:any)=>Array.isArray(r.prediction_grades)?r.prediction_grades[0]:r.prediction_grades;
  const oldFilter=rows.filter(r=>r.no_bet!==true);
  const newFilter=rows.filter(r=>r.no_bet!==true || (r.sport==="soccer"&&r.market==="double_chance"));
  const tally=(rs:any[])=>{let w=0,l=0,v=0,p=0;for(const r of rs){const x=g(r);if(!x||x.result==="pending"){p++;continue;}if(x.win)w++;else if(x.loss)l++;else if(x.void)v++;}return `${w}-${l} (win%=${w+l?Math.round(100*w/(w+l)):"--"}) [void ${v}, pending ${p}, n ${rs.length}]`;}
  console.log("DC tally BEFORE fix (no_bet excluded):", tally(oldFilter));
  console.log("DC tally AFTER fix (DC included):    ", tally(newFilter));
  console.log("\nincluded-by-fix rows:");
  for (const r of newFilter.filter(r=>r.no_bet===true)){const x=g(r);console.log(`  ${r.matchup}: ${x?.result}`);}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
