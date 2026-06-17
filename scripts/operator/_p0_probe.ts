import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const today = new Date().toISOString().slice(0,10);
  const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10);
  const { data: gs } = await sb.from("games").select("id, external_id, sport, slate_date, game_date, status").eq("sport","soccer").in("slate_date", [today, tomorrow]).order("game_date");
  console.log("WC slate today/tomorrow:");
  for (const g of (gs ?? []) as any[]) console.log(`  g${g.id} ext=${g.external_id} ${g.slate_date} ${g.game_date} status=${g.status}`);
  const ids = (gs ?? []).map((g:any)=>g.id);
  if (ids.length === 0) { console.log("(no games)"); return; }
  const { data: ps } = await sb.from("prediction_records").select("id, game_id, market, pick, grade, locked_at, updated_at, created_at, snapshot_json").in("game_id", ids).order("game_id");
  console.log(`\nprediction_records for these game_ids: ${ps?.length ?? 0}`);
  for (const p of (ps ?? []) as any[]) {
    const comp = p.snapshot_json?.competition;
    const mv = p.snapshot_json?.model_version;
    const hasReconcile = p.snapshot_json?.decision?.total_projection_reconciliation !== undefined;
    console.log(`  g${p.game_id} ${p.market.padEnd(15)} pick=${(p.pick??"null").padEnd(15)} comp=${comp ?? "(none)"} mv=${mv ?? "(none)"} locked=${p.locked_at!==null?"Y":"n"} updated=${p.updated_at} reconcileBlob=${hasReconcile?"Y":"n"}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
