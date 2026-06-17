import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // unordered top-5
  const { data: any5, error } = await sb.from("prediction_records").select("id, game_id, market, pick, locked_at, updated_at, created_at, snapshot_json").limit(5);
  if (error) { console.log("ERR:", error); return; }
  console.log(`got ${any5?.length ?? 0} rows`);
  for (const r of (any5 ?? []) as any[]) {
    const comp = r.snapshot_json?.competition;
    console.log(`  pr${r.id} g${r.game_id} ${r.market} pick=${r.pick} comp=${comp} created=${r.created_at} updated=${r.updated_at}`);
  }
  // count by sport via snapshot_json.competition
  console.log("\nsoccer/fifa_world_cup count via snapshot:");
  const { data: wcRows } = await sb.from("prediction_records").select("id, game_id, market, snapshot_json", { count: "exact" }).contains("snapshot_json", { competition: "fifa_world_cup" }).limit(20);
  console.log(`  wc rows in snapshot: ${wcRows?.length ?? 0}`);
  for (const r of (wcRows ?? []) as any[]) {
    console.log(`    pr${r.id} g${r.game_id} ${r.market}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
