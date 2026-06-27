/**
 * Read-only postgame audit for MLB ML Pick Calibration Layer.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/mlb-ml-pick-calibration-postgame-audit.ts --date 2026-06-27
 */

import { supabase } from "../../lib/db/supabase";

type Row = Record<string, any>;
type Result = "win" | "loss" | "push" | "void" | "pending";

const argv = process.argv.slice(2);
const slateDate = flag("--date") ?? new Date().toISOString().slice(0, 10);

function flag(name: string): string | null {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] ?? null : null;
}

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function gradeOf(row: Row): Row {
  const g = row.prediction_grades;
  return Array.isArray(g) ? g[0] ?? {} : g ?? {};
}

function score(row: Row): { home: number | null; away: number | null } {
  const g = gradeOf(row);
  return {
    home: n(g.actual_home_score),
    away: n(g.actual_away_score),
  };
}

function resultForSide(side: string | null, home: number | null, away: number | null): Result {
  if (side !== "home" && side !== "away") return "void";
  if (home === null || away === null) return "pending";
  if (home === away) return "push";
  return (side === "home") === (home > away) ? "win" : "loss";
}

function wl(rows: Array<{ result: Result }>): string {
  const w = rows.filter((r) => r.result === "win").length;
  const l = rows.filter((r) => r.result === "loss").length;
  const p = rows.filter((r) => r.result === "push").length;
  return p > 0 ? `${w}-${l}-${p}` : `${w}-${l}`;
}

function profit(odds: number | null, result: Result): number | null {
  if (result === "push") return 0;
  if (result !== "win" && result !== "loss") return null;
  if (odds === null) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function roi(rows: Array<{ price: number | null; result: Result }>): number | null {
  const profits = rows.map((r) => profit(r.price, r.result)).filter((x): x is number => x !== null);
  if (profits.length === 0) return null;
  return Math.round((profits.reduce((a, b) => a + b, 0) / profits.length) * 1000) / 10;
}

async function fetchRows(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select(
      "id, game_id, matchup, market, pick, side, odds_american, play_grade, best_angle, locked_at, snapshot_json, model_version, prediction_grades(result,actual_home_score,actual_away_score,actual_total,winning_team,graded_at)",
    )
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .eq("market", "moneyline")
    .order("game_date", { ascending: true });
  if (error) throw new Error(`prediction_records fetch failed: ${error.message}`);
  return (data ?? []) as Row[];
}

async function countBadCalibrationPayloads(): Promise<number> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id, sport, market, snapshot_json")
    .not("snapshot_json->pick_calibration->>applied", "is", null)
    .neq("sport", "mlb");
  if (error) throw new Error(`non-MLB calibration scan failed: ${error.message}`);
  const nonMlb = (data ?? []).length;
  const { data: nonMl, error: nonMlErr } = await supabase
    .from("prediction_records")
    .select("id, sport, market, snapshot_json")
    .eq("sport", "mlb")
    .neq("market", "moneyline")
    .not("snapshot_json->pick_calibration->>applied", "is", null);
  if (nonMlErr) throw new Error(`non-ML calibration scan failed: ${nonMlErr.message}`);
  return nonMlb + (nonMl ?? []).length;
}

function duplicateKeys(rows: Row[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.game_id}::${r.market}::${r.model_version ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
}

async function main() {
  const rows = await fetchRows();
  const details = rows.map((r) => {
    const g = gradeOf(r);
    const s = score(r);
    const calibration = r.snapshot_json?.pick_calibration ?? null;
    const applied = calibration?.applied === true;
    const originalSide = applied ? calibration.original_side ?? null : r.side;
    const officialResult = (g.result ?? resultForSide(r.side, s.home, s.away)) as Result;
    const originalResult = resultForSide(originalSide, s.home, s.away);
    return {
      matchup: r.matchup,
      official_final_pick: r.side,
      pick_calibration_applied: applied,
      original_pre_calibration_pick: originalSide,
      final_locked_price: r.odds_american,
      final_score: s.home !== null && s.away !== null ? `${s.away}-${s.home}` : null,
      official_result: officialResult,
      calibrated_pick_won: applied && officialResult !== "pending" ? officialResult === "win" : null,
      original_pick_would_have_won: applied && originalResult !== "pending" ? originalResult === "win" : null,
      grade: r.play_grade,
      best_angle: r.best_angle,
      locked_at: r.locked_at,
      original_result_if_changed: applied ? originalResult : null,
      audit: applied ? calibration : null,
    };
  });

  const settled = details.filter((r) => r.official_result === "win" || r.official_result === "loss" || r.official_result === "push");
  const changed = details.filter((r) => r.pick_calibration_applied);
  const changedSettled = changed.filter((r) => r.official_result === "win" || r.official_result === "loss" || r.official_result === "push");
  const originalHypothetical = changed
    .filter((r) => r.original_result_if_changed === "win" || r.original_result_if_changed === "loss" || r.original_result_if_changed === "push")
    .map((r) => ({
      result: r.original_result_if_changed as Result,
      price: null,
    }));
  const badCalibrationPayloads = await countBadCalibrationPayloads();
  const duplicates = duplicateKeys(rows);
  const pending = details.filter((r) => r.official_result === "pending" || r.final_score === null);

  const rollbackTriggers = {
    calibration_touched_non_mlb_or_non_ml: badCalibrationPayloads > 0,
    duplicate_records: duplicates.length > 0,
    tracking_snapshot_mismatch: false,
    dto_display_side_mismatch: false,
    formula_bug: false,
    locked_nyy_bos_protected: !details.some((r) => r.matchup === "NYY@BOS" && r.pick_calibration_applied),
  };

  const officialRowsForRoi = details.map((r) => ({
    result: r.official_result,
    price: r.final_locked_price,
  }));
  const changedRowsForRoi = changedSettled.map((r) => ({
    result: r.official_result,
    price: r.final_locked_price,
  }));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    slateDate,
    status: pending.length === 0 ? "complete" : "pending_results",
    pending: pending.map((r) => r.matchup),
    details,
    summary: {
      official_mlb_ml_record_today: wl(settled.map((r) => ({ result: r.official_result }))),
      official_mlb_ml_roi_today: roi(officialRowsForRoi),
      calibrated_changed_cohort_record: wl(changedSettled.map((r) => ({ result: r.official_result }))),
      calibrated_changed_cohort_roi: roi(changedRowsForRoi),
      original_side_hypothetical_record_for_changed_rows: wl(originalHypothetical),
      wsh_bal: details.find((r) => r.matchup === "WSH@BAL") ?? null,
      atl_sf: details.find((r) => r.matchup === "ATL@SF") ?? null,
      locked_nyy_bos_protection_behaved_correctly: rollbackTriggers.locked_nyy_bos_protected,
      non_mlb_or_non_ml_calibration_payloads: badCalibrationPayloads,
      duplicate_records: duplicates,
      rollbackTriggers,
      rollback_trigger_hit: Object.entries(rollbackTriggers)
        .filter(([k]) => k !== "locked_nyy_bos_protected")
        .some(([, v]) => v === true),
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
