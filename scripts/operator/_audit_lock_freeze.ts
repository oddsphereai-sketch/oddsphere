import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
const P=(s:any,n:number)=>{const t=String(s??"—");return t.length>=n?t.slice(0,n):t+" ".repeat(n-t.length);};
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  // ---- LOCKED soccer prediction_records ----
  console.log("=== LOCKED soccer prediction_records (locked_at NOT NULL) ===");
  const {data:soc}=await sb.from("prediction_records")
    .select("game_id, market, pick, side, line_value, odds_american, confidence, play_grade, no_bet, held, locked_at, snapshot_json")
    .eq("sport","soccer").not("locked_at","is",null).order("game_id").limit(8);
  for(const r of soc??[]){
    const snap=(r.snapshot_json??{}) as any; const dec=snap.decision??{}; const model=snap.model??{};
    console.log(`  g${r.game_id} ${P(r.market,14)} pick=${P(r.pick,13)} side=${P(r.side,13)} line=${P(r.line_value,5)} odds=${P(r.odds_american,6)} conf=${P(r.confidence,5)} grade=${P(r.play_grade,10)} held=${r.held} locked=${r.locked_at?.slice(5,16)}`);
    console.log(`       snapshot decision.displayed_side=${dec.displayed_side} expected_total=${model.expected_total ?? dec.projected_total} side_sel=${dec.side_selection_reason}`);
  }
  // ---- LOCKED MLB game_predictions ----
  console.log("\n=== LOCKED MLB rows (game_predictions.locked_at NOT NULL) ===");
  const {data:mlb}=await sb.from("game_predictions")
    .select("game_id, locked_at, sport_specific, ml_pick, total_pick, first_inning_pick")
    .eq("sport","mlb").not("locked_at","is",null).order("game_id",{ascending:false}).limit(4);
  if((mlb??[]).length===0) console.log("  (no locked MLB game_predictions found — checking prediction_records)");
  for(const r of mlb??[]){
    const ss=(r.sport_specific??{}) as any; const af=ss.auto_factors??{};
    console.log(`  g${r.game_id} locked=${r.locked_at?.slice(5,16)} ml=${r.ml_pick} total=${r.total_pick} fi=${r.first_inning_pick} bullpen(h/a)=${af.home_bullpen_factor}/${af.away_bullpen_factor} bullpen_raw=${af.home_bullpen_factor_raw ?? "—"}/${af.away_bullpen_factor_raw ?? "—"}`);
  }
  // ---- LOCKED MLB prediction_records ----
  const {data:mlbpr}=await sb.from("prediction_records")
    .select("game_id, market, pick, side, line_value, odds_american, play_grade, locked_at")
    .eq("sport","mlb").not("locked_at","is",null).order("game_id",{ascending:false}).limit(6);
  console.log(`\n=== LOCKED MLB prediction_records: ${(mlbpr??[]).length} ===`);
  for(const r of mlbpr??[]) console.log(`  g${r.game_id} ${P(r.market,12)} pick=${P(r.pick,12)} line=${P(r.line_value,5)} odds=${P(r.odds_american,6)} grade=${P(r.play_grade,10)} locked=${r.locked_at?.slice(5,16)}`);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
