import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // Query soccer rows directly via sport column
  const { data: soccerPreds, error: e1 } = await sb.from("prediction_records").select("*").eq("sport","soccer").order("created_at", { ascending: false });
  if (e1) { console.log("ERR e1:", e1); return; }
  console.log(`soccer prediction_records (sport=soccer) total: ${soccerPreds?.length}`);
  // group by game_id
  const byGame = new Map<number, any[]>();
  for (const p of (soccerPreds ?? []) as any[]) {
    const arr = byGame.get(p.game_id) ?? [];
    arr.push(p);
    byGame.set(p.game_id, arr);
  }
  console.log("\nby game_id:");
  for (const [gid, rows] of byGame.entries()) {
    console.log(`\n  g${gid} matchup=${rows[0].matchup} slate=${rows[0].slate_date} game=${rows[0].game_date}`);
    for (const p of rows.sort((a,b)=>a.market.localeCompare(b.market))) {
      const hasReconcile = p.snapshot_json?.decision?.total_projection_reconciliation !== undefined;
      const displayed = p.snapshot_json?.decision?.displayed_side;
      const noBet = p.no_bet;
      const noBetReason = p.no_bet_reason;
      const grade = p.play_grade;
      const held = p.held;
      const holdReason = p.hold_reason;
      const mv = p.model_version;
      console.log(`    ${p.market.padEnd(15)} pick=${(p.pick??"null").padEnd(15)} grade=${(grade??"?").padEnd(15)} no_bet=${noBet} held=${held} locked=${p.locked_at!==null?"Y":"n"} created=${p.created_at} mv=${mv}`);
      console.log(`      hold_reason=${holdReason} | no_bet_reason=${noBetReason} | displayed_side=${displayed} | reconcileBlob=${hasReconcile}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
