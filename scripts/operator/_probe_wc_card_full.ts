/**
 * Full-fidelity probe of what the WC + CWS DTOs will render with.
 *
 *   1. CZE@KOR — every field on each prediction_records row + full snapshot_json
 *   2. ATL@CWS — confirm new starter + prediction_records
 *   3. Soccer team rows — confirm logo/flag asset state
 *   4. `lines` + `line_history` for the soccer game — any odds rows recorded?
 *
 * Read-only.
 */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  console.log("========== CZE@KOR — FULL prediction_records ==========");
  const { data: wcPreds } = await supabase
    .from("prediction_records")
    .select("*")
    .eq("game_id", 15721);
  const wcList = (wcPreds ?? []) as Array<Record<string, unknown>>;
  console.log(`  ${wcList.length} rows`);
  for (const r of wcList) {
    console.log(`\n  ─── pr.id=${r.id} market=${r.market} pick=${r.pick} side=${r.side} ───`);
    const keys = [
      "line_value", "odds_american", "model_probability", "market_probability",
      "edge", "confidence", "play_grade", "held", "no_bet", "hold_reason",
      "no_bet_reason", "locked_at", "best_angle",
    ];
    for (const k of keys) {
      console.log(`    ${k} = ${JSON.stringify((r as Record<string, unknown>)[k])}`);
    }
    const sj = r.snapshot_json as Record<string, unknown> | null;
    console.log(`    snapshot_json keys: ${sj ? Object.keys(sj).join(", ") : "null"}`);
    if (sj) {
      const interesting = [
        "competition", "lambdaHome", "lambdaAway", "lambda_home", "lambda_away",
        "expected_total", "match", "model", "model_outputs", "market_outputs",
        "fixture_hold_reason", "hold_reasons", "raw_market_inputs",
        "line_movement", "open_odds_american",
        "match_result", "total", "btts", "double_chance",
      ];
      for (const k of interesting) {
        if (sj[k] !== undefined) {
          const v = sj[k];
          const s = typeof v === "object" ? JSON.stringify(v).slice(0, 220) : String(v);
          console.log(`    snapshot.${k} = ${s}`);
        }
      }
    }
  }

  console.log("\n\n========== CZE@KOR + RSA@MEX — `lines` rows ==========");
  const { data: lines } = await supabase
    .from("lines")
    .select("id, game_id, market_type, side, sportsbook, line_value, odds_american, captured_at")
    .in("game_id", [15721, 15687])
    .order("captured_at", { ascending: false })
    .limit(20);
  const lineList = (lines ?? []) as Array<Record<string, unknown>>;
  console.log(`  ${lineList.length} line rows`);
  for (const l of lineList) {
    console.log(`    game=${l.game_id} mkt=${l.market_type} side=${l.side} book=${l.sportsbook} line=${l.line_value} odds=${l.odds_american} captured=${l.captured_at}`);
  }

  console.log("\n\n========== Soccer teams — logo_url state ==========");
  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation, display_name, location, logo_url, primary_color, provider_ids")
    .eq("sport", "soccer");
  for (const t of (teams ?? []) as Array<Record<string, unknown>>) {
    console.log(`  ${t.abbreviation}: logo_url=${t.logo_url ?? "null"}  primary_color=${t.primary_color ?? "null"}  provider_ids=${JSON.stringify(t.provider_ids).slice(0, 120)}`);
  }

  console.log("\n\n========== ATL@CWS — game + prediction_records ==========");
  const { data: cwsGame } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, status, updated_at")
    .eq("id", 15619)
    .single();
  console.log(`  ${JSON.stringify(cwsGame)}`);
  const { data: cwsPlayers } = await supabase
    .from("players")
    .select("id, full_name, mlb_person_id")
    .in("id", [13962, 13959]);
  console.log(`  starters: ${JSON.stringify(cwsPlayers)}`);
  const { data: cwsPreds } = await supabase
    .from("prediction_records")
    .select("id, market, pick, model_probability, market_probability, odds_american, line_value, edge, confidence, play_grade, held, no_bet, locked_at, updated_at")
    .eq("game_id", 15619);
  const cwsList = (cwsPreds ?? []) as Array<Record<string, unknown>>;
  console.log(`  ${cwsList.length} prediction_records for game 15619`);
  for (const r of cwsList) {
    console.log(`    pr.id=${r.id} mkt=${r.market} pick=${r.pick} model=${r.model_probability} mkt=${r.market_probability} odds=${r.odds_american} line=${r.line_value} grade=${r.play_grade} held=${r.held} no_bet=${r.no_bet} locked_at=${r.locked_at} updated=${r.updated_at}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
