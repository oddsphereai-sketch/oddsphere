/** READ-ONLY: verify tonight's writes for tomorrow's slate. */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, status, slate_date, home_team_id, away_team_id")
    .eq("sport", "soccer")
    .eq("slate_date", "2026-06-12");
  const gameIds = (games ?? []).map((g: any) => g.id);
  console.log(`games on 2026-06-12: ${(games ?? []).length}`);
  for (const g of (games ?? []) as any[]) {
    console.log(`  game_id=${g.id} ext=${g.external_id} status=${g.status}`);
  }

  const teamIds = new Set<number>();
  for (const g of (games ?? []) as any[]) {
    if (g.home_team_id) teamIds.add(g.home_team_id);
    if (g.away_team_id) teamIds.add(g.away_team_id);
  }
  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation, display_name, location")
    .in("id", [...teamIds]);
  console.log(`\nteams: ${(teams ?? []).length}`);
  for (const t of (teams ?? []) as any[]) {
    console.log(`  id=${t.id} abbr=${t.abbreviation} display=${t.display_name} loc=${t.location}`);
  }

  const { data: prs } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, pick, held, no_bet, play_grade, locked_at, snapshot_json")
    .in("game_id", gameIds);
  console.log(`\nprediction_records: ${(prs ?? []).length}`);
  for (const p of (prs ?? []) as any[]) {
    const snap = p.snapshot_json ?? {};
    const decision = (snap as any).decision ?? {};
    console.log(`  pr_id=${p.id} game=${p.game_id} ${p.market}/${p.pick} held=${p.held} no_bet=${p.no_bet} grade=${p.play_grade} ba=${decision.best_angle ?? "?"}`);
  }

  const { count: linesCount } = await supabase.from("lines").select("id", { count: "exact", head: true }).in("game_id", gameIds);
  const { count: lineHistCount } = await supabase.from("line_history").select("id", { count: "exact", head: true }).in("game_id", gameIds);
  console.log(`\nlines rows: ${linesCount ?? 0}`);
  console.log(`line_history rows: ${lineHistCount ?? 0}`);

  // Sample a few line rows
  const { data: lines } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american")
    .in("game_id", gameIds)
    .limit(8);
  console.log(`\nsample lines (8):`);
  for (const l of (lines ?? []) as any[]) {
    console.log(`  game=${l.game_id} ${l.market_type}/${l.side} book=${l.sportsbook} line=${l.line_value} odds=${l.odds_american}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
