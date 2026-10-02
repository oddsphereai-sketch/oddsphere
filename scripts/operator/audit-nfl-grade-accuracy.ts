/** SELECT-only NFL locked-result accuracy by immutable release, market and play grade. */

import { supabase } from "@/lib/db/supabase";
import { preferAppendOnlyWinnerTrackingCorrections } from "@/lib/services/tracking/winnerAccuracyScorecardQuery";

type Row = {
  id: number;
  market: "moneyline" | "spread" | "total";
  play_grade: string | null;
  no_bet: boolean;
  model_version: string | null;
  calibration_version: string | null;
  tracking_correction_release: string | null;
  supersedes_prediction_record_id: number | null;
  prediction_grades: Array<{ result: string; win: boolean; loss: boolean }> | { result: string; win: boolean; loss: boolean } | null;
};

function grade(row: Row) {
  return Array.isArray(row.prediction_grades) ? row.prediction_grades[0] ?? null : row.prediction_grades;
}

function summary(rows: Row[]) {
  const resolved = rows.filter((row) => {
    const value = grade(row);
    return value?.win === true || value?.loss === true;
  });
  const wins = resolved.filter((row) => grade(row)?.win === true).length;
  return {
    rows: rows.length,
    resolved: resolved.length,
    wins,
    losses: resolved.length - wins,
    accuracy: resolved.length ? wins / resolved.length : null,
  };
}

async function main() {
  const { data, error } = await supabase.from("prediction_records")
    .select([
      "id", "market", "play_grade", "no_bet", "model_version", "calibration_version",
      "tracking_correction_release:snapshot_json->>tracking_correction_release",
      "supersedes_prediction_record_id:snapshot_json->supersedes_prediction_record_id",
      "prediction_grades(result,win,loss)",
    ].join(","))
    .eq("sport", "nfl")
    .in("market", ["moneyline", "spread", "total"])
    .not("locked_at", "is", null)
    .order("id", { ascending: true });
  if (error) throw new Error(`NFL grade audit failed: ${error.message}`);
  const rows = preferAppendOnlyWinnerTrackingCorrections((data ?? []) as unknown as Row[]);
  const actionable = (row: Row) => !row.no_bet && ["lean", "best_angle"].includes(String(row.play_grade ?? "").toLowerCase());
  const releases = [...new Set(rows.map((row) => `${row.model_version ?? "unknown"}|${row.calibration_version ?? "unknown"}`))];
  const by = (selected: Row[]) => ({
    overall: summary(selected),
    actionable: summary(selected.filter(actionable)),
    byMarket: Object.fromEntries(["moneyline", "spread", "total"].map((market) => [market, {
      all: summary(selected.filter((row) => row.market === market)),
      actionable: summary(selected.filter((row) => row.market === market && actionable(row))),
    }])),
    byGrade: Object.fromEntries(["best_angle", "lean", "watchlist", "no_play"].map((playGrade) => [
      playGrade,
      summary(selected.filter((row) => String(row.play_grade ?? "").toLowerCase() === playGrade)),
    ])),
  });
  console.log(JSON.stringify({
    readOnly: true,
    records: rows.length,
    allReleases: by(rows),
    byRelease: Object.fromEntries(releases.map((release) => [release, by(rows.filter((row) =>
      `${row.model_version ?? "unknown"}|${row.calibration_version ?? "unknown"}` === release))])),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
