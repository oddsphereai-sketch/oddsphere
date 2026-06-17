import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const { data: preds } = await sb.from("prediction_records")
    .select("game_id, market, pick, confidence, play_grade, held, no_bet, snapshot_json")
    .eq("sport", "soccer").order("game_id").order("market");

  console.log("=== DE-VIG INTEGRITY CHECK (does over/under, yes/no sum to ~1.0; DC to ~2.0) ===");
  const seen = new Set<number>();
  for (const p of (preds ?? []) as any[]) {
    if (seen.has(p.game_id)) continue; seen.add(p.game_id);
    const dv = p.snapshot_json?.market?.devigged_probabilities ?? {};
    const mr = (dv["match_result|home"] ?? 0) + (dv["match_result|draw"] ?? 0) + (dv["match_result|away"] ?? 0);
    const tot = (dv["total|over|2.5"] ?? 0) + (dv["total|under|2.5"] ?? 0);
    const btts = (dv["btts|yes"] ?? 0) + (dv["btts|no"] ?? 0);
    const dc = (dv["double_chance|home_or_draw"] ?? 0) + (dv["double_chance|away_or_draw"] ?? 0) + (dv["double_chance|home_or_away"] ?? 0);
    console.log(`g${p.game_id} MR_sum=${mr.toFixed(3)} TOT_sum=${tot.toFixed(3)} BTTS_sum=${btts.toFixed(3)} DC_sum=${dc.toFixed(3)}`);
  }

  console.log("\n=== BTTS: model vs market (overconfidence) + book count ===");
  for (const p of (preds ?? []).filter((x: any) => x.market === "btts") as any[]) {
    const sj = p.snapshot_json ?? {};
    const modelYes = sj.model?.raw_probabilities?.btts?.yes;
    const dvYes = sj.market?.devigged_probabilities?.["btts|yes"];
    const impYes = sj.market?.implied_probabilities?.["btts|yes"];
    const books = sj.market?.book_counts?.btts;
    const edge = sj.market?.edge_pp?.["btts|yes"];
    const lamMin = Math.min(sj.model?.lambda_home ?? 9, sj.model?.lambda_away ?? 9);
    console.log(`g${p.game_id} modelYes=${(modelYes * 100).toFixed(1)}% impliedYes=${(impYes * 100).toFixed(1)}% devigYes=${(dvYes * 100).toFixed(1)}% edge=${edge.toFixed(1)}pp books=${books} λmin=${lamMin.toFixed(2)} grade=${p.play_grade} conf=${p.confidence} no_bet=${p.no_bet}`);
  }

  console.log("\n=== DOUBLE_CHANCE: model vs market + book count (the 2026-06-11 2x bug check) ===");
  for (const p of (preds ?? []).filter((x: any) => x.market === "double_chance") as any[]) {
    const sj = p.snapshot_json ?? {};
    const pickKey = `double_chance|${p.pick}`;
    const modelP = sj.model?.raw_probabilities?.double_chance?.[p.pick];
    const dv = sj.market?.devigged_probabilities?.[pickKey];
    const imp = sj.market?.implied_probabilities?.[pickKey];
    const books = sj.market?.book_counts?.double_chance;
    const edge = sj.market?.edge_pp?.[pickKey];
    console.log(`g${p.game_id} pick=${p.pick} modelP=${(modelP * 100).toFixed(1)}% implied=${(imp * 100).toFixed(1)}% devig=${(dv * 100).toFixed(1)}% edge=${edge.toFixed(1)}pp books=${books} grade=${p.play_grade} conf=${p.confidence}`);
  }

  console.log("\n=== ALL no_bet / hold reasons ===");
  for (const p of (preds ?? []) as any[]) {
    const d = p.snapshot_json?.decision ?? {};
    console.log(`g${p.game_id} ${String(p.market).padEnd(15)} ${p.pick.padEnd(14)} grade=${String(p.play_grade).padEnd(10)} held=${p.held} no_bet=${p.no_bet} reason="${d.no_bet_reason ?? p.snapshot_json?.hold_reason ?? "·"}"`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
