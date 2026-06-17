import { supabase } from "../../lib/db/supabase";
async function main(){
  const { data } = await supabase.from("prediction_records")
    .select("id, matchup, market, side, pick, odds_american, no_bet, no_bet_reason, held, hold_reason, game_id, prediction_grades(id, result, void, grade_notes)")
    .eq("sport","soccer").in("matchup",["ECU@CIV","CPV@ESP","SUI@QAT"]).eq("market","double_chance");
  for (const r of (data??[]) as any[]){ const g=Array.isArray(r.prediction_grades)?r.prediction_grades[0]:r.prediction_grades;
    console.log(`${r.matchup}: no_bet=${r.no_bet} reason=${r.no_bet_reason} held=${r.held} hold_reason=${r.hold_reason} odds=${r.odds_american} | grade: result=${g?.result} void=${g?.void} notes=${g?.grade_notes} (gradeId=${g?.id})`);
  }
  // confirm final scores exist on these games
  const gids = [...new Set((data??[]).map((r:any)=>r.game_id))];
  const { data: games } = await supabase.from("games").select("id, status, home_score, away_score").in("id", gids as number[]);
  console.log("\ngames:"); for (const g of (games??[]) as any[]) console.log(`  game ${g.id}: status=${g.status} score=${g.home_score}-${g.away_score}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
