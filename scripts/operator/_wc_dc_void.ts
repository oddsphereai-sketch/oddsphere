import { supabase } from "../../lib/db/supabase";
async function main(){
  const games=["ECU@CIV","CPV@ESP","SUI@QAT"];
  const { data } = await supabase.from("prediction_records")
    .select("matchup, market, side, pick, line_value, play_grade, snapshot_json, prediction_grades(result, void, grade_notes, actual_home_score, actual_away_score, winning_team)")
    .eq("sport","soccer").in("matchup",games).eq("market","double_chance");
  for (const r of (data??[]) as any[]){ const g=Array.isArray(r.prediction_grades)?r.prediction_grades[0]:r.prediction_grades;
    console.log(`${r.matchup}: side=${r.side} pick=${r.pick} → result=${g?.result} void=${g?.void} winner=${g?.winning_team} score=${g?.actual_home_score}-${g?.actual_away_score} notes=${g?.grade_notes}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
