import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Full snapshot for PAR@USA btts and match_result, plus CZE@KOR btts
  const { data: preds } = await sb.from("prediction_records")
    .select("game_id, market, pick, snapshot_json")
    .eq("sport", "soccer").in("game_id", [15755, 15721]).order("game_id");

  for (const p of (preds ?? []) as any[]) {
    if (!(p.market === "btts" || (p.game_id === 15755 && p.market === "total"))) continue;
    console.log(`\n########## g${p.game_id} ${p.market} (pick=${p.pick}) snapshot_json ##########`);
    console.log(JSON.stringify(p.snapshot_json, null, 2));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
