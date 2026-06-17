import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function pad(v: any, n: number) { return String(v ?? "·").padEnd(n); }

async function main() {
  // discover prediction_records columns by selecting one soccer row with *
  const { data: one } = await sb.from("prediction_records").select("*").eq("sport", "soccer").limit(1);
  if (one && one[0]) {
    console.log("=== prediction_records columns ===");
    console.log(Object.keys(one[0]).sort().join(", "));
  }

  const { data: preds } = await sb.from("prediction_records")
    .select("*").eq("sport", "soccer").order("game_id").order("market");
  console.log(`\n=== ${preds?.length ?? 0} soccer prediction_records ===`);

  const gameIds = [...new Set((preds ?? []).map((p: any) => p.game_id))];
  const { data: games } = await sb.from("games").select("id, external_id, slate_date, game_date, status, slate_status, home_team_id, away_team_id, home_score, away_score").in("id", gameIds);
  const gById = new Map<number, any>((games ?? []).map((g: any) => [g.id, g]));
  const teamIds = new Set<number>();
  for (const g of (games ?? []) as any[]) { if (g.home_team_id) teamIds.add(g.home_team_id); if (g.away_team_id) teamIds.add(g.away_team_id); }
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", [...teamIds]);
  const tById = new Map<number, any>((teams ?? []).map((t: any) => [t.id, t]));

  console.log("\n=== games behind these records ===");
  for (const g of (games ?? []) as any[]) {
    console.log(`g${g.id} ext=${g.external_id} ${g.slate_date} ${g.game_date} status=${g.status} slate=${g.slate_status} ${tById.get(g.away_team_id)?.abbreviation}@${tById.get(g.home_team_id)?.abbreviation} score=${g.away_score}-${g.home_score}`);
  }

  console.log("\n=== per-row ===");
  for (const p of (preds ?? []) as any[]) {
    const g = gById.get(p.game_id);
    const matchup = `${tById.get(g?.away_team_id)?.abbreviation ?? "?"}@${tById.get(g?.home_team_id)?.abbreviation ?? "?"}`;
    const comp = p.snapshot_json?.competition ?? "·";
    console.log(`g${p.game_id} ${pad(matchup,9)} ${pad(p.market,15)} pick=${pad(p.pick,16)} grade=${pad(p.play_grade,11)} conf=${pad(p.confidence,5)} edge=${pad(p.edge,7)} held=${p.held?"H":"-"} no_bet=${p.no_bet?"N":"-"} locked=${p.locked_at?"Y":"n"} comp=${comp} created=${p.created_at?.slice(0,19)}`);
  }

  // grades
  const { data: grades } = await sb.from("prediction_grades").select("*").in("game_id", gameIds).order("game_id").order("market");
  console.log(`\n=== prediction_grades for these games: ${grades?.length ?? 0} ===`);
  if (grades && grades[0]) console.log("grade columns:", Object.keys(grades[0]).sort().join(", "));
  for (const gr of (grades ?? []) as any[]) {
    const g = gById.get(gr.game_id);
    const matchup = `${tById.get(g?.away_team_id)?.abbreviation ?? "?"}@${tById.get(g?.home_team_id)?.abbreviation ?? "?"}`;
    console.log(`g${gr.game_id} ${pad(matchup,9)} ${pad(gr.market,15)} pick=${pad(gr.pick,16)} result=${pad(gr.result,8)} actual=${pad(gr.actual_value,5)} graded_at=${pad(gr.graded_at?.slice?.(0,19),20)} src=${pad(gr.source,18)} notes="${(gr.notes ?? "").slice(0,70)}"`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
