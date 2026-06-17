import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  console.log("== ALL soccer games last 7 days ==");
  const { data: gs } = await sb.from("games").select("id, external_id, sport, slate_date, game_date, status, home_team_id, away_team_id").eq("sport","soccer").gte("slate_date", "2026-06-08").order("game_date");
  for (const g of (gs ?? []) as any[]) console.log(`  g${g.id} ext=${g.external_id} ${g.slate_date} ${g.game_date} status=${g.status} home=${g.home_team_id} away=${g.away_team_id}`);

  const ids = (gs ?? []).map((g:any)=>g.id);
  if (ids.length === 0) return;
  const { data: ts } = await sb.from("teams").select("id, abbreviation").in("id", Array.from(new Set((gs as any[]).flatMap((g:any)=>[g.home_team_id, g.away_team_id]).filter(Boolean))));
  const tm = new Map(((ts as any[]) ?? []).map((t:any) => [t.id, t.abbreviation]));

  console.log("\n== predictions for those games ==");
  const { data: ps } = await sb.from("prediction_records").select("id, game_id, market, pick, grade, locked_at, updated_at, created_at, snapshot_json").in("game_id", ids).order("game_id, market");
  console.log(`  rows: ${ps?.length ?? 0}`);
  for (const p of (ps ?? []) as any[]) {
    const g = (gs as any[]).find((gg:any)=>gg.id===p.game_id);
    const matchup = g ? `${tm.get(g.away_team_id)} vs ${tm.get(g.home_team_id)}` : "?";
    const comp = p.snapshot_json?.competition;
    const mv = p.snapshot_json?.model_version;
    const hasReconcile = p.snapshot_json?.decision?.total_projection_reconciliation !== undefined;
    console.log(`  g${p.game_id} ${matchup} ${p.market.padEnd(15)} pick=${(p.pick??"null").padEnd(15)} comp=${comp ?? "(none)"} mv=${mv ?? "(none)"} locked=${p.locked_at!==null?"Y":"n"} updated=${p.updated_at} reconcile=${hasReconcile?"Y":"n"}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
