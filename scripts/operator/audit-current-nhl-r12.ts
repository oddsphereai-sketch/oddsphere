import { writeNhlPredictionRecords } from "../../lib/services/nhl/buildNhlPredictionRecords";
import { supabase } from "../../lib/db/supabase";
import { writeFile } from "node:fs/promises";

async function main(): Promise<void> {
  const slateDate = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7) ?? "2026-09-30";
  const result = await writeNhlPredictionRecords({
    slateDate,
    apply: false,
    deferLock: true,
    logger: (message) => console.log(message),
  });
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id, market, model_version, play_grade, snapshot_json")
    .eq("sport", "nhl")
    .eq("slate_date", slateDate)
    .is("locked_at", null);
  if (error) throw error;
  const compact = (data ?? []).filter((row) => row.market === "moneyline").map((row) => {
    const snapshot = row.snapshot_json as {
      feature_inputs?: unknown;
      model_output?: unknown;
      goalie_assumption?: unknown;
    } | null;
    return {
      game_id: row.game_id,
      model_version: row.model_version,
      play_grade: row.play_grade,
      feature_inputs: snapshot?.feature_inputs,
      model_output: snapshot?.model_output,
      goalie_assumption: snapshot?.goalie_assumption,
    };
  });
  const payload = JSON.stringify({ result, stored: compact }, null, 2);
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) await writeFile(output, `${payload}\n`);
  console.log(payload);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
