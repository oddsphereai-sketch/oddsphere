/**
 * Push 4 operator — grade prediction records against final scores.
 *
 * USAGE:
 *   Dry-run:
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/grade-predictions.ts --sport mlb --date 2026-06-06
 *
 *   Apply:
 *     PREDICTION_GRADES_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/grade-predictions.ts --sport mlb --date 2026-06-06 --apply
 *
 * For each prediction_records row on the slate:
 *   1. Looks up the underlying games row for final status + scores
 *   2. Calls gradePrediction() (pure)
 *   3. UPSERTs into prediction_grades on (prediction_record_id)
 *
 * Pending grades are STILL written (with result='pending') so the
 * tracking page can show "X games pending grading". Re-running after
 * scores land flips pending → win/loss/push/void.
 *
 * First-inning rows: actual_first_inning_runs is null unless manually
 * entered via the manual_grade operator script. The grader correctly
 * keeps them pending until then.
 */

import { supabase } from "../../lib/db/supabase";
import { gradePrediction } from "../../lib/services/predictionGrader";
import type {
  PredictionGradeRow,
  PredictionRecordRow,
  TrackedSport,
} from "../../lib/types/domain/Tracking";

type Args = {
  sport: TrackedSport;
  date: string;
  apply: boolean;
  source: "auto_score_ingest" | "manual_operator";
};

function parseArgs(argv: readonly string[]): Args {
  let sport: TrackedSport = "mlb";
  let date: string | null = null;
  let apply = false;
  let source: "auto_score_ingest" | "manual_operator" = "auto_score_ingest";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as TrackedSport; continue; }
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--manual") { source = "manual_operator"; continue; }
  }
  if (date === null) {
    console.error("Usage: grade-predictions.ts --sport mlb --date YYYY-MM-DD [--apply] [--manual]");
    process.exit(1);
  }
  return { sport, date, apply, source };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envEnabled = process.env.PREDICTION_GRADES_DB_WRITES_ENABLED === "true";
  const willApply = opts.apply && envEnabled;

  console.log(`\n━━━ grade-predictions · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`  --apply flag:                          ${opts.apply ? "YES" : "no"}`);
  console.log(`  PREDICTION_GRADES_DB_WRITES_ENABLED:   ${envEnabled ? "true" : "missing"}`);
  console.log(`  source:                                ${opts.source}`);
  console.log(`  mode:                                  ${willApply ? "APPLY (will UPSERT)" : "DRY-RUN"}`);
  console.log("");

  // Probe table existence
  const probe = await supabase
    .from("prediction_records")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (probe.error && /relation .* does not exist|could not find the table/i.test(probe.error.message)) {
    console.error("✗ prediction_records table not found. Apply schema-migration-v17.sql first.");
    process.exit(1);
  }

  // Load records for this slate
  const { data: recRows } = await supabase
    .from("prediction_records")
    .select("*")
    .eq("sport", opts.sport)
    .eq("slate_date", opts.date);
  const records = (recRows ?? []) as PredictionRecordRow[];
  console.log(`prediction_records on slate: ${records.length}`);
  if (records.length === 0) {
    console.log("Nothing to grade. Exiting.");
    return;
  }

  // Load games for those records (one query)
  const gameIds = Array.from(new Set(records.map((r) => r.game_id)));
  const { data: gameRows } = await supabase
    .from("games")
    .select("id, status, home_score, away_score, home_team_id, away_team_id")
    .in("id", gameIds);
  const gameById = new Map<number, {
    id: number;
    status: string | null;
    home_score: number | null;
    away_score: number | null;
  }>(
    ((gameRows ?? []) as Array<{
      id: number;
      status: string | null;
      home_score: number | null;
      away_score: number | null;
    }>).map((g) => [g.id, g]),
  );

  // Load existing grades (we'll only insert if missing OR if pending was recorded)
  const { data: existingGradeRows } = await supabase
    .from("prediction_grades")
    .select("prediction_record_id, result")
    .in(
      "prediction_record_id",
      records.map((r) => r.id).filter((x): x is number => x !== undefined),
    );
  const existingGradeByRecId = new Map<number, string>(
    ((existingGradeRows ?? []) as Array<{ prediction_record_id: number; result: string }>).map((g) => [g.prediction_record_id, g.result]),
  );

  let wins = 0, losses = 0, pushes = 0, voids = 0, pending = 0, upserted = 0, skipped = 0;
  const grades: PredictionGradeRow[] = [];
  for (const rec of records) {
    const game = gameById.get(rec.game_id);
    if (game === undefined) {
      console.log(`  skipping rec_id=${rec.id} — no game row`);
      skipped++;
      continue;
    }
    const grade = gradePrediction({
      record: rec,
      game: {
        status: game.status ?? "unknown",
        home_score: game.home_score,
        away_score: game.away_score,
        first_inning_runs: null, // not populated by auto ingest in V1
      },
      source: opts.source,
    });
    if (grade.win) wins++;
    else if (grade.loss) losses++;
    else if (grade.push) pushes++;
    else if (grade.void) voids++;
    else pending++;

    // Skip "pending" upserts when there's already a final grade — don't regress
    const existing = existingGradeByRecId.get(rec.id!);
    if (existing !== undefined && existing !== "pending" && grade.result === "pending") {
      skipped++;
      continue;
    }
    grades.push(grade);
  }

  console.log(`Computed: wins=${wins} losses=${losses} pushes=${pushes} voids=${voids} pending=${pending}`);

  if (!willApply) {
    console.log("\nDRY-RUN — no DB writes performed.");
    return;
  }

  for (const g of grades) {
    const { error: upErr } = await supabase
      .from("prediction_grades")
      .upsert(g, { onConflict: "prediction_record_id" });
    if (upErr) {
      console.error(`  upsert failed for rec ${g.prediction_record_id}: ${upErr.message}`);
      skipped++;
    } else {
      upserted++;
    }
  }
  console.log(`\n✓ APPLIED — upserted: ${upserted}, skipped: ${skipped}`);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
