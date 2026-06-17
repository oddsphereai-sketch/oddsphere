/**
 * TARGETED re-grade — ONLY soccer double_chance rows voided SOLELY for
 * MARKET_ODDS_MISSING with a valid final score (ECU@CIV, CPV@ESP). Uses the
 * real fixed gradePrediction. Guards prevent touching anything else.
 * Dry-run prints the plan; pass --apply to write. No prediction/snapshot change.
 */
import { supabase } from "../../lib/db/supabase";
import { gradePrediction } from "../../lib/services/predictionGrader";
const APPLY = process.argv.includes("--apply");
const TARGET_MATCHUPS = ["ECU@CIV", "CPV@ESP"];

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("id, game_id, matchup, sport, market, pick, side, line_value, no_bet, no_bet_reason, odds_american, prediction_grades(id, result, void, win, loss, grade_notes)")
    .eq("sport", "soccer").eq("market", "double_chance").in("matchup", TARGET_MATCHUPS);
  const recs = (data ?? []) as any[];
  const gids = [...new Set(recs.map(r => r.game_id))];
  const { data: games } = await supabase.from("games").select("id, status, home_score, away_score, first_inning_runs").in("id", gids as number[]);
  const gmap = new Map<number, any>(); for (const g of (games ?? []) as any[]) gmap.set(g.id, g);

  console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (preview only)"}\n`);
  let applied = 0;
  for (const r of recs) {
    const cur = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    const g = gmap.get(r.game_id);
    // ---- GUARDS: only re-grade odds-missing voids with a real final score ----
    const guardOk =
      r.market === "double_chance" &&
      r.no_bet_reason === "MARKET_ODDS_MISSING" &&
      cur?.result === "void" &&
      g && g.status && String(g.status).toLowerCase().includes("final") &&
      g.home_score !== null && g.away_score !== null;
    if (!guardOk) {
      console.log(`SKIP ${r.matchup}: guard failed (reason=${r.no_bet_reason} curResult=${cur?.result} status=${g?.status} score=${g?.home_score}-${g?.away_score})`);
      continue;
    }
    // compute new grade via the REAL fixed grader
    const newGrade = gradePrediction({ record: r, game: g, source: "auto_score_ingest" });
    console.log(`${r.matchup}: pick=${r.pick} score=${g.home_score}-${g.away_score} | BEFORE result=${cur.result} void=${cur.void} | AFTER result=${newGrade.result} win=${newGrade.win} loss=${newGrade.loss} void=${newGrade.void} | odds=${r.odds_american} (ROI ${r.odds_american === null ? "EXCLUDED (no price)" : "eligible"})`);
    if (newGrade.result !== "win" && newGrade.result !== "loss") { console.log(`  -> unexpected non win/loss; skipping`); continue; }
    if (APPLY) {
      const { error } = await supabase.from("prediction_grades").update({
        result: newGrade.result, win: newGrade.win, loss: newGrade.loss, push: newGrade.push, void: newGrade.void, pending: newGrade.pending,
        actual_home_score: newGrade.actual_home_score, actual_away_score: newGrade.actual_away_score, actual_total: newGrade.actual_total,
        grade_notes: newGrade.grade_notes, graded_at: new Date().toISOString(),
      }).eq("id", cur.id).eq("market", "double_chance"); // belt-and-suspenders
      if (error) console.log(`  ERROR updating grade ${cur.id}: ${error.message}`);
      else { applied++; console.log(`  ✓ updated prediction_grades id=${cur.id}`); }
    }
  }
  console.log(`\n${APPLY ? `Applied ${applied} re-grade(s).` : "Dry-run complete. Re-run with --apply to write."}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
