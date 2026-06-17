import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { formatKeyStats } = await import("../../lib/services/keyStatsFormatter");

  // today's MLB games
  const isoToday = new Date().toISOString().slice(0,10);
  const { data: games } = await sb.from("games")
    .select("id, home_team_id, away_team_id, game_date, slate_date")
    .eq("sport","mlb").in("slate_date",[isoToday, new Date(Date.now()-864e5).toISOString().slice(0,10)]);
  const teamIds = [...new Set((games??[]).flatMap(g=>[g.home_team_id,g.away_team_id]))];
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", teamIds);
  const tm = new Map((teams??[]).map(t=>[t.id,t.abbreviation]));
  const lbl=(g:any)=>`${tm.get(g.away_team_id)}@${tm.get(g.home_team_id)}`;

  const targets = (games??[]).filter(g=>{ const s=lbl(g); return s==="ATL@NYM"||s==="SEA@WSH"; });
  for (const g of targets) {
    const { data: gp } = await sb.from("game_predictions").select("sport_specific").eq("game_id", g.id).limit(1);
    const af = (gp?.[0]?.sport_specific as any)?.auto_factors ?? null;
    console.log(`\n===== ${lbl(g)} (game_id=${g.id}) auto_factors present=${af!=null} =====`);
    if (af) {
      const keys = ["away_starter_era","home_starter_era","away_lineup_weighted_ops","home_lineup_weighted_ops","away_bullpen_factor","home_bullpen_factor"];
      for (const k of keys) console.log(`  ${k.padEnd(30)} = ${JSON.stringify(af[k])}`);
    }
    const rows = formatKeyStats(af, "moneyline");
    console.log(`  --- formatKeyStats(moneyline) → ${rows.length} rows ---`);
    for (const r of rows) console.log(`    ${r.label.padEnd(22)} away=${JSON.stringify(r.awayValue).padEnd(12)} home=${JSON.stringify(r.homeValue)}`);
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
