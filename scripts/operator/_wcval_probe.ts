import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function fmt(v: any, n = 10) { return String(v ?? "·").padEnd(n); }

async function main() {
  // 1. All soccer games
  const { data: games } = await sb.from("games")
    .select("id, external_id, sport, slate_date, game_date, status, slate_status, home_team_id, away_team_id, home_score, away_score")
    .eq("sport", "soccer").order("game_date");
  console.log("=== SOCCER GAMES ===");
  const teamIds = new Set<number>();
  for (const g of (games ?? []) as any[]) { if (g.home_team_id) teamIds.add(g.home_team_id); if (g.away_team_id) teamIds.add(g.away_team_id); }
  const { data: teams } = await sb.from("teams").select("id, abbreviation, name").in("id", [...teamIds]);
  const tById = new Map<number, any>((teams ?? []).map((t: any) => [t.id, t]));
  for (const g of (games ?? []) as any[]) {
    const h = tById.get(g.home_team_id); const a = tById.get(g.away_team_id);
    console.log(`g${g.id} ext=${g.external_id} ${g.slate_date} ${g.game_date} status=${g.status} slate=${g.slate_status} ${a?.abbreviation}@${h?.abbreviation} score=${g.away_score}-${g.home_score}`);
  }
  const gameIds = (games ?? []).map((g: any) => g.id);
  const gById = new Map<number, any>((games ?? []).map((g: any) => [g.id, g]));

  // 2. prediction_records for soccer
  const { data: preds } = await sb.from("prediction_records")
    .select("id, game_id, sport, market, pick, line_value, confidence, play_grade, edge, held, no_bet, locked_at, result, graded_at, created_at, snapshot_json")
    .eq("sport", "soccer").order("game_id").order("market");
  console.log(`\n=== PREDICTION_RECORDS (sport=soccer): ${preds?.length ?? 0} rows ===`);

  // counts by market
  const byMarket = new Map<string, number>();
  const byGrade = new Map<string, number>();
  const byMarketGrade = new Map<string, number>();
  for (const p of (preds ?? []) as any[]) {
    byMarket.set(p.market, (byMarket.get(p.market) ?? 0) + 1);
    byGrade.set(p.play_grade ?? "null", (byGrade.get(p.play_grade ?? "null") ?? 0) + 1);
    const k = `${p.market}/${p.play_grade ?? "null"}`;
    byMarketGrade.set(k, (byMarketGrade.get(k) ?? 0) + 1);
  }
  console.log("\n-- counts by market --");
  for (const [m, c] of byMarket) console.log(`  ${fmt(m, 16)} ${c}`);
  console.log("\n-- counts by play_grade --");
  for (const [g, c] of byGrade) console.log(`  ${fmt(g, 16)} ${c}`);
  console.log("\n-- market/grade --");
  for (const [k, c] of [...byMarketGrade].sort()) console.log(`  ${fmt(k, 30)} ${c}`);

  // 3. per-row detail with competition, model_version, confidence, edge, result
  console.log("\n=== PER-ROW DETAIL ===");
  console.log("game | market         | pick            | grade      | conf | edge_pp | held nobet lockd | result   graded_at | comp/mv");
  for (const p of (preds ?? []) as any[]) {
    const g = gById.get(p.game_id);
    const h = tById.get(g?.home_team_id); const a = tById.get(g?.away_team_id);
    const matchup = `${a?.abbreviation ?? "?"}@${h?.abbreviation ?? "?"}`;
    const comp = p.snapshot_json?.competition ?? "·";
    const mv = p.snapshot_json?.model_version ?? p.snapshot_json?.modelVersion ?? "·";
    const edge = p.edge === null || p.edge === undefined ? "·" : Number(p.edge).toFixed(2);
    console.log(`g${p.game_id} ${fmt(matchup,11)}| ${fmt(p.market,15)}| ${fmt(p.pick,16)}| ${fmt(p.play_grade,11)}| ${fmt(p.confidence?.toFixed?.(0),5)}| ${fmt(edge,8)}| ${p.held?"H":"-"}${p.no_bet?"N":"-"}${p.locked_at?"L":"-"}              | ${fmt(p.result,9)} ${fmt(p.graded_at,20)}| ${comp}/${mv}`);
  }

  // 4. prediction_grades for these games (the grade table the grader writes)
  const { data: grades } = await sb.from("prediction_grades")
    .select("id, prediction_record_id, game_id, market, pick, result, actual_value, graded_at, notes, source")
    .in("game_id", gameIds).order("game_id").order("market");
  console.log(`\n=== PREDICTION_GRADES for these games: ${grades?.length ?? 0} rows ===`);
  for (const gr of (grades ?? []) as any[]) {
    const g = gById.get(gr.game_id);
    const h = tById.get(g?.home_team_id); const a = tById.get(g?.away_team_id);
    console.log(`g${gr.game_id} ${a?.abbreviation}@${h?.abbreviation} ${fmt(gr.market,15)} pick=${fmt(gr.pick,16)} result=${fmt(gr.result,8)} actual=${fmt(gr.actual_value,5)} src=${fmt(gr.source,18)} notes="${(gr.notes ?? "").slice(0,60)}"`);
  }

  // 5. Overconfidence / de-vig sanity per row: pull model_p, devig, edge from snapshot
  console.log("\n=== MODEL vs MARKET (de-vig) snapshot inspection ===");
  for (const p of (preds ?? []) as any[]) {
    const sj = p.snapshot_json ?? {};
    const modelPct = sj.model_p_pct ?? sj.model_probability ?? null;
    const devig = sj.market_devig ?? sj.marketDevig ?? null;
    const implied = sj.market_implied ?? sj.marketImplied ?? null;
    const bookCounts = sj.market_book_counts ?? sj.marketBookCounts ?? null;
    const lamH = sj.lambda_home ?? sj.lambdaHome ?? null;
    const lamA = sj.lambda_away ?? sj.lambdaAway ?? null;
    const reductions = sj.confidence_reductions ?? sj.grade_decision?.confidence_reductions ?? null;
    console.log(`g${p.game_id} ${fmt(p.market,15)} pick=${fmt(p.pick,16)} modelPct=${fmt(modelPct,6)} conf=${fmt(p.confidence?.toFixed?.(1),6)} edge=${fmt(p.edge?.toFixed?.(2),7)} λH=${fmt(lamH?.toFixed?.(3),7)} λA=${fmt(lamA?.toFixed?.(3),7)} books=${JSON.stringify(bookCounts ?? {})}`);
    if (devig) {
      const relevant = Object.entries(devig).filter(([k]) => k.startsWith(p.market));
      if (relevant.length) console.log(`        devig: ${relevant.map(([k, v]) => `${k}=${(v as number).toFixed(3)}`).join("  ")}`);
    }
  }

  // 6. snapshot top-level keys (for completeness audit of one row)
  const sample = (preds ?? [])[0];
  if (sample) {
    console.log("\n=== SAMPLE snapshot_json top-level keys (g" + sample.game_id + " " + sample.market + ") ===");
    console.log(Object.keys(sample.snapshot_json ?? {}).sort().join(", "));
    console.log("\ncalibration fields:", JSON.stringify({
      calibration_version: sample.snapshot_json?.calibration_version,
      calibration_source: sample.snapshot_json?.calibration_source,
      calibration_evidence_level: sample.snapshot_json?.calibration_evidence_level,
      model_version: sample.snapshot_json?.model_version ?? sample.snapshot_json?.modelVersion,
    }, null, 0));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
