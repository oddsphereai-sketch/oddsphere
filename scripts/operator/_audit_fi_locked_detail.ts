import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const SLATE="2026-06-11";
  for (const mk of ["moneyline","total","first_inning"]) {
    const { data } = await sb.from("prediction_records")
      .select("game_id, side, odds_american, snapshot_json")
      .eq("sport","mlb").eq("slate_date",SLATE).eq("market",mk).not("locked_at","is",null);
    let withOdds=0, withLM=0, withLAL=0;
    for (const r of (data??[]) as any[]) {
      if (r.odds_american!==null) withOdds++;
      const lm=(r.snapshot_json as any)?.line_movement;
      if (lm?.open_odds_american!=null) withLM++;
      const lal=(r.snapshot_json as any)?.lines_at_lock;
      if (Array.isArray(lal) && lal.some((x:any)=>x.market_type===(mk==="first_inning"?"first_inning_total":mk))) withLAL++;
    }
    console.log(`${mk}: locked=${(data??[]).length} | odds_american set=${withOdds} | snapshot.line_movement.open set=${withLM} | lines_at_lock has this market=${withLAL}`);
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
