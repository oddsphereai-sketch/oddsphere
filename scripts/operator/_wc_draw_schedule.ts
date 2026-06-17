/** READ-ONLY — WC draw-prediction gap + missing-game (schedule/slate boundary). */
import { supabase } from "../../lib/db/supabase";
async function main() {
  // 1. DRAW prediction gap: do match_result picks ever = draw? predicted vs actual draw rate
  const { data: mr } = await supabase.from("prediction_records")
    .select("slate_date, matchup, side, pick, model_probability, snapshot_json, game_id, prediction_grades(result)")
    .eq("sport", "soccer").eq("market", "match_result").gte("slate_date", "2026-06-13").order("slate_date");
  const rows = (mr ?? []) as any[];
  const sides: Record<string, number> = {};
  for (const r of rows) sides[String(r.pick ?? r.side)] = (sides[String(r.pick ?? r.side)] ?? 0) + 1;
  console.log(`=== WC match_result picks by side (n=${rows.length}) ===`);
  console.log(JSON.stringify(sides));
  // actual draw rate among completed
  const gids = [...new Set(rows.map(r => r.game_id))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, status, home_score, away_score, game_date").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  let completed = 0, actualDraws = 0, predictedDraws = 0;
  for (const r of rows) { const g = gmap.get(r.game_id); if (g && g.home_score != null && g.away_score != null) { completed++; if (g.home_score === g.away_score) actualDraws++; if ((r.pick ?? r.side) === "draw") predictedDraws++; } }
  console.log(`completed=${completed}  actual draws=${actualDraws} (${completed ? (100 * actualDraws / completed).toFixed(0) : 0}%)  predicted draws (on completed)=${predictedDraws}`);
  // model draw probability available? check snapshot for draw prob
  const ex = rows.find(r => r.snapshot_json);
  const sj = ex?.snapshot_json ?? {};
  const aud = sj.soccer_audit ?? sj.v1_audit ?? {};
  console.log(`\nsnapshot soccer keys: ${Object.keys(sj).slice(0, 12).join(", ")}`);
  console.log(`soccer_audit draw-ish keys: ${Object.keys(aud).filter(k => /draw|p_draw|prob/i.test(k)).join(", ") || "(none visible)"}`);
  console.log(`sample model_probability values (match_result): ${rows.slice(0, 8).map(r => `${r.pick}:${r.model_probability}`).join("  ")}`);

  // 2. MISSING GAME: games table WC vs prediction_records coverage, around date boundary
  console.log(`\n=== schedule coverage (games table 'soccer' vs prediction_records) ===`);
  const { data: allGames } = await supabase.from("games").select("id, external_id, game_date, status, home_team_id, away_team_id").eq("sport", "soccer").gte("game_date", "2026-06-15").lte("game_date", "2026-06-18").order("game_date");
  const predGameIds = new Set(rows.map(r => r.game_id));
  // also pull all soccer prediction_records game_ids in window
  const { data: allPred } = await supabase.from("prediction_records").select("game_id, matchup, slate_date").eq("sport", "soccer").gte("slate_date", "2026-06-15");
  const predicted = new Set((allPred ?? []).map((r: any) => r.game_id));
  console.log(`games in window: ${(allGames ?? []).length}; with predictions: ${(allGames ?? []).filter((g: any) => predicted.has(g.id)).length}`);
  for (const g of (allGames ?? []) as any[]) {
    console.log(`  game ${g.id} ${g.game_date} status=${g.status} predicted=${predicted.has(g.id) ? "YES" : "NO  <-- MISSING"}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
