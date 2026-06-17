import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, matchup, market, side, play_grade, prediction_grades(result, graded_at, outcome)")
    .eq("sport", "soccer").gte("slate_date", "2026-06-13").order("slate_date").order("matchup");
  const rows = (data ?? []) as any[];
  const g = (r: any) => { const x = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; return x; };
  const byGame = new Map<string, any[]>();
  for (const r of rows) { const k = `${r.slate_date}|${r.matchup}`; (byGame.get(k) ?? byGame.set(k, []).get(k)!).push(r); }

  console.log("=== per game: which markets are GRADED (have prediction_grades.result) ===");
  let gamesWithMR = 0, gamesWithDC = 0;
  for (const [k, rs] of byGame) {
    const graded = rs.filter(r => g(r)?.result);
    if (!graded.length) { continue; } // game not completed/graded
    const gradedMarkets = graded.map(r => `${r.market}:${g(r).result}`);
    const hasMR = graded.some(r => r.market === "match_result");
    const hasDC = graded.some(r => r.market === "double_chance");
    if (hasMR) gamesWithMR++;
    if (hasDC) gamesWithDC++;
    console.log(`  ${k.padEnd(26)} graded=[${gradedMarkets.join(", ")}]${hasMR && !hasDC ? "   <-- MR graded, NO DC grade" : ""}`);
  }
  console.log(`\nGraded games with match_result: ${gamesWithMR}   with double_chance: ${gamesWithDC}`);

  // For games where MR graded but DC not: show the DC record's state (play_grade, no_bet, side) + why ungraded
  console.log(`\n=== DC records on MR-graded-but-DC-ungraded games ===`);
  for (const [k, rs] of byGame) {
    const graded = rs.filter(r => g(r)?.result);
    if (!graded.length) continue;
    const hasMR = graded.some(r => r.market === "match_result");
    const hasDC = graded.some(r => r.market === "double_chance");
    if (hasMR && !hasDC) {
      const dc = rs.find(r => r.market === "double_chance");
      console.log(`  ${k}: DC rec → side=${dc?.side} play_grade=${dc?.play_grade} grade_obj=${JSON.stringify(g(dc))}`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
