/** READ ONLY. Reports current-slate eligibility for the market-led MLB Moneyline Lean candidate. */
import { currentSlateDate } from "../../lib/dates/slateDate";
import { supabase } from "../../lib/db/supabase";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";

const date = process.argv[2] ?? currentSlateDate("mlb");
const normalizedPct = (value: unknown): number | null => typeof value === "number"
  ? Math.round((value <= 1 ? value * 100 : value) * 10) / 10
  : null;

async function main(): Promise<void> {
  const dry = await createPredictionRecords({ sport: "mlb", slateDate: date, launchDay: false, apply: false, supabase });
  if (dry.errors.length) throw new Error(JSON.stringify(dry.errors));
  const rows = dry.proposed.filter((row) => row.market === "moneyline").map((row) => {
    const snapshot = (row.snapshot_json ?? {}) as Record<string, unknown>;
    const movement = (snapshot.line_movement ?? {}) as Record<string, unknown>;
    const integrity = (snapshot.data_integrity ?? {}) as Record<string, unknown>;
    const decision = (snapshot.decision_pipeline ?? {}) as Record<string, unknown>;
    const sourceSplits = Array.isArray(snapshot.source_aware_split_rows_at_lock)
      ? snapshot.source_aware_split_rows_at_lock as Array<Record<string, unknown>>
      : [];
    const sharp = sourceSplits.find((split) =>
      split.market_type === "moneyline" && split.provider === "sharpapi" &&
      String(split.selection_key ?? "").split(":").at(-1) === row.side
    );
    const bets = normalizedPct(sharp?.bets_pct);
    const money = normalizedPct(sharp?.money_pct);
    const gap = bets === null || money === null ? null : Math.round((money - bets) * 10) / 10;
    const alreadyActionable = row.best_angle || row.play_grade === "lean" || row.play_grade === "best_angle";
    const checks = {
      nonactionable: !alreadyActionable,
      noBetClear: !row.no_bet && !row.held,
      unchangedFinalSide: decision.final_side_changed !== true,
      withinObservedProbabilityRange: row.model_probability !== null && row.model_probability >= .50,
      playablePrice: row.odds_american !== null && row.odds_american >= -120 && row.odds_american <= 200,
      highQuality: row.data_quality_tier === "high",
      freshBaseline: integrity.stale === "no" && integrity.market_baseline_valid === "yes",
      towardAtLeast1pp: movement.direction === "toward_pick" && Number(movement.magnitude_pp) >= 1,
      sharpapiGapBelow20: gap !== null && gap < 20,
    };
    return {
      matchup: row.matchup,
      pick: row.pick,
      odds: row.odds_american,
      probability: row.model_probability,
      currentGrade: row.best_angle ? "best_angle" : row.play_grade,
      movement: movement.direction ?? null,
      movementPp: movement.magnitude_pp ?? null,
      sharpapi: { bets, money, gap },
      quality: row.data_quality_tier,
      qualifies: Object.values(checks).every(Boolean),
      failedChecks: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name),
    };
  });
  console.log(JSON.stringify({ date, databaseWrites: false, qualifiers: rows.filter((row) => row.qualifies), rows }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
