import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const P = (s:any,n:number)=>{const t=String(s??"—");return t.length>=n?t.slice(0,n):t+" ".repeat(n-t.length);};
(async () => {
  const { data: games } = await sb.from("games").select("id, home_team_id, away_team_id, game_date, status").eq("sport","soccer").in("slate_date",["2026-06-12"]).order("game_date");
  for (const g of games!) {
    console.log(`\n=== game ${g.id}  (${g.game_date})  status=${g.status} ===`);
    const { data: recs } = await sb.from("prediction_records").select("market, pick, side, line_value, odds_american, play_grade, held, no_bet, no_bet_reason, hold_reason, locked_at, snapshot_json").eq("game_id", g.id).order("market");
    console.log(`  ${P("market",14)}${P("pick",16)}${P("side",16)}${P("odds",7)}${P("grade",11)}${P("held",6)}${P("nobet",6)}${P("lock",5)}reason`);
    for (const r of recs ?? []) {
      const reason = r.no_bet_reason ?? r.hold_reason ?? "";
      console.log(`  ${P(r.market,14)}${P(r.pick,16)}${P(r.side,16)}${P(r.odds_american,7)}${P(r.play_grade,11)}${P(r.held,6)}${P(r.no_bet,6)}${P(r.locked_at?"Y":"N",5)}${reason}`);
    }
    // opener alignment for each pick side
    console.log(`  --- opener / current match for the DISPLAYED pick side ---`);
    const { data: lh } = await sb.from("line_history").select("market_type, side, odds_american, is_opener, recorded_at").eq("game_id", g.id);
    const { data: ln } = await sb.from("lines").select("market_type, side, odds_american").eq("game_id", g.id);
    for (const r of recs ?? []) {
      const openers = (lh ?? []).filter(h => h.market_type === r.market && h.side === r.side);
      const cur = (ln ?? []).filter(l => l.market_type === r.market && l.side === r.side);
      console.log(`  ${P(r.market,14)} side='${r.side}'  line_history match: ${openers.length}  lines match: ${cur.length}  ${openers.length===0?"<<< NO OPENER for this side":""}${cur.length===0?" <<< NO CURRENT":""}`);
    }
    // show distinct sides present in line_history per market
    const byMkt: Record<string,Set<string>> = {};
    for (const h of lh ?? []) { (byMkt[h.market_type] ??= new Set()).add(String(h.side)); }
    console.log(`  --- distinct line_history sides per market ---`);
    for (const [mk, set] of Object.entries(byMkt)) console.log(`  ${P(mk,14)} ${Array.from(set).join(", ")}`);
  }
})().then(()=>process.exit(0));
