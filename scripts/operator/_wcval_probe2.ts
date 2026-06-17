import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const soccerGameIds = [15687, 15721, 15754, 15755];

  // A. all prediction_records for these game_ids regardless of sport
  const { data: preds, error } = await sb.from("prediction_records")
    .select("id, game_id, sport, market, pick, line_value, confidence, play_grade, edge, held, no_bet, locked_at, result, graded_at, model_version, created_at, snapshot_json")
    .in("game_id", soccerGameIds).order("game_id").order("market");
  if (error) { console.log("ERR", error.message); }
  console.log(`prediction_records for soccer game_ids (any sport): ${preds?.length ?? 0}`);
  const sportVals = new Map<string, number>();
  const mvVals = new Map<string, number>();
  for (const p of (preds ?? []) as any[]) {
    sportVals.set(p.sport ?? "null", (sportVals.get(p.sport ?? "null") ?? 0) + 1);
    mvVals.set(p.model_version ?? "null", (mvVals.get(p.model_version ?? "null") ?? 0) + 1);
  }
  console.log("sport values:", JSON.stringify([...sportVals]));
  console.log("model_version values:", JSON.stringify([...mvVals]));

  // B. distinct sport values in prediction_records overall
  const { data: distinctSports } = await sb.from("prediction_records").select("sport").limit(5000);
  const sset = new Map<string, number>();
  for (const r of (distinctSports ?? []) as any[]) sset.set(r.sport ?? "null", (sset.get(r.sport ?? "null") ?? 0) + 1);
  console.log("\nall distinct sport values in prediction_records (first 5000):", JSON.stringify([...sset]));

  // C. dump the rows
  console.log("\n=== ROWS ===");
  for (const p of (preds ?? []) as any[]) {
    console.log(`g${p.game_id} sport=${p.sport} mv=${p.model_version} ${String(p.market).padEnd(15)} pick=${String(p.pick).padEnd(16)} grade=${String(p.play_grade).padEnd(11)} conf=${p.confidence} edge=${p.edge} held=${p.held} no_bet=${p.no_bet} locked=${p.locked_at ? "Y" : "n"} result=${p.result} graded_at=${p.graded_at} created=${p.created_at}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
