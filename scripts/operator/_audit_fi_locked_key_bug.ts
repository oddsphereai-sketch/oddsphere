import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // Find recent slates with locked FI prediction_records
  for (const SLATE of ["2026-06-11","2026-06-10","2026-06-09"]) {
    const { data: locked } = await sb.from("prediction_records")
      .select("game_id, market, side, odds_american, locked_at, snapshot_json")
      .eq("sport","mlb").eq("slate_date",SLATE)
      .in("market",["moneyline","total","first_inning"])
      .not("locked_at","is",null);
    const fi = (locked??[]).filter((r:any)=>r.market==="first_inning");
    const ml = (locked??[]).filter((r:any)=>r.market==="moneyline");
    console.log(`\nslate ${SLATE}: locked rows ml=${ml.length} fi=${fi.length}`);
    if (fi.length>0) {
      const r:any = fi[0];
      console.log(`  FI locked sample game=${r.game_id} side=${r.side} odds_american=${r.odds_american}`);
      console.log(`  → route injects current-line under key "${r.game_id}::${r.market}" (= first_inning)`);
      console.log(`  → buildGameDto reads FI current-line from key "${r.game_id}::first_inning_total"  ==> KEY MISMATCH (price would be lost)`);
      const lm = (r.snapshot_json as any)?.line_movement;
      console.log(`  FI snapshot line_movement=${JSON.stringify(lm??null)}`);
      // Does the snapshot have lines_at_lock with first_inning_total?
      const lal = (r.snapshot_json as any)?.lines_at_lock;
      if (Array.isArray(lal)) {
        const fimk = [...new Set(lal.map((x:any)=>x.market_type))];
        console.log(`  lines_at_lock market_types present: ${fimk.join(",")}`);
      } else { console.log(`  lines_at_lock: ${lal===undefined?"absent":"present-nonarray"}`); }
      break;
    }
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
