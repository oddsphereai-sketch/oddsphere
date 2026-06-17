/**
 * Audit ATL @ CWS Under 8.5 grade.
 *
 * Daniel flagged: line is moving against the pick, only 4% of money is on
 * Under, and the model graded it Best Angle/Lean. Could be real edge
 * through a soft market, could be a model bug. Pull everything that fed
 * the decision so we can see.
 *
 * Read-only.
 */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const gameId = 15619;
  const ext = 5058800;

  console.log(`========== prediction_records for game.id=${gameId} (ATL@CWS) ==========`);
  const { data: preds } = await supabase
    .from("prediction_records")
    .select("*")
    .eq("game_id", gameId);
  const list = (preds ?? []) as Array<Record<string, unknown>>;
  for (const r of list) {
    if (r.market !== "total") continue;
    console.log(`\n  pr.id=${r.id}  market=${r.market}  pick=${r.pick}`);
    const keys = [
      "model_version", "line_value", "odds_american", "model_probability",
      "market_probability", "edge", "confidence", "play_grade", "best_angle",
      "held", "no_bet", "hold_reason", "no_bet_reason", "locked_at",
      "data_quality_tier", "launch_day", "provisional", "updated_at",
    ];
    for (const k of keys) {
      console.log(`    ${k} = ${JSON.stringify((r as Record<string, unknown>)[k])}`);
    }
    const sj = r.snapshot_json as Record<string, unknown> | null;
    if (sj !== null && typeof sj === "object") {
      console.log(`    snapshot keys: ${Object.keys(sj).join(", ")}`);
      for (const k of ["public_splits", "publicSplits", "lineMovement", "line_movement",
                       "open_odds_american", "openOddsAmerican", "predicted_total",
                       "predictedTotal", "predicted_home_score", "predicted_away_score",
                       "market_total", "marketTotal", "line_value", "totalLine",
                       "ml_signals", "ou_signals", "ouSignals",
                       "signal_summary", "signals", "raw_market_inputs"]) {
        if (sj[k] !== undefined) {
          const v = sj[k];
          const s = typeof v === "object" ? JSON.stringify(v).slice(0, 320) : String(v);
          console.log(`    snap.${k} = ${s}`);
        }
      }
    }
  }

  console.log("\n========== sharp_signals (latest 6) for game.id ==========");
  const { data: signals } = await supabase
    .from("sharp_signals")
    .select("id, market, side, sportsbook, money_pct, bets_pct, line_value, odds_american, captured_at")
    .eq("game_id", gameId)
    .eq("market", "total")
    .order("captured_at", { ascending: false })
    .limit(6);
  for (const s of ((signals ?? []) as Array<Record<string, unknown>>)) {
    console.log(`  side=${s.side} book=${s.sportsbook} money=${s.money_pct}% bets=${s.bets_pct}% line=${s.line_value} odds=${s.odds_american} captured=${s.captured_at}`);
  }

  console.log("\n========== line_history (latest 8) for game.id ==========");
  const { data: lines } = await supabase
    .from("line_history")
    .select("id, market_type, side, sportsbook, line_value, odds_american, captured_at, is_opener")
    .eq("game_id", gameId)
    .eq("market_type", "total")
    .order("captured_at", { ascending: false })
    .limit(8);
  for (const l of ((lines ?? []) as Array<Record<string, unknown>>)) {
    console.log(`  side=${l.side} book=${l.sportsbook} line=${l.line_value} odds=${l.odds_american} opener=${l.is_opener} captured=${l.captured_at}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
