import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // What SOCCER_MODEL_VERSION does the adapter filter on?
  // From sample: records have mv=soccer_dixon_coles_v1
  for (const d of ["2026-06-11", "2026-06-12", "2026-06-13"]) {
    const { data: gs } = await sb.from("games")
      .select("id, slate_date, slate_status, game_date, status, home_team_id, away_team_id")
      .eq("sport", "soccer").eq("slate_date", d);
    const games = (gs ?? []) as any[];
    console.log(`\n=== soccer slate ${d}: ${games.length} games ===`);
    const ids = games.map(g => g.id);
    let pr: any[] = [];
    if (ids.length) {
      const { data } = await sb.from("prediction_records")
        .select("game_id, market, model_version, pick, play_grade, held").in("game_id", ids).eq("sport", "soccer");
      pr = (data ?? []) as any[];
    }
    for (const g of games) {
      const recs = pr.filter(p => p.game_id === g.id);
      const mvs = Array.from(new Set(recs.map(r => r.model_version)));
      console.log(`   g${g.id} ${g.game_date} games.slate_status=${g.slate_status} status=${g.status} | ${recs.length} recs mv=[${mvs.join(",")}] markets=[${recs.map(r=>r.market).join(",")}]`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
