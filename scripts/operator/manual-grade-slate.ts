/**
 * Push 4 operator — manual outcome entry for a slate.
 *
 * USAGE:
 *   1. Generate the template:
 *      npx tsx --env-file=.env.local \
 *        scripts/operator/manual-grade-slate.ts \
 *        --sport mlb --date 2026-06-06 --template > today.csv
 *
 *   2. Fill in scores in today.csv. Columns:
 *      external_id, matchup, home_score, away_score, first_inning_runs, status, notes
 *      (status optional — defaults to "final"; first_inning_runs optional)
 *
 *   3. Apply:
 *      PREDICTION_GRADES_DB_WRITES_ENABLED=true \
 *        npx tsx --env-file=.env.local \
 *        scripts/operator/manual-grade-slate.ts \
 *        --sport mlb --date 2026-06-06 --file today.csv --apply
 *
 * The manual path is the only way to grade FI markets in V1 (BDL
 * doesn't expose first-inning splits). It also flips today's
 * launch-day records out of pending state if you choose to count
 * them.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { supabase } from "../../lib/db/supabase";
import { gradePrediction } from "../../lib/services/predictionGrader";
import type {
  PredictionRecordRow,
  TrackedSport,
} from "../../lib/types/domain/Tracking";

type Args = {
  sport: TrackedSport;
  date: string;
  template: boolean;
  file: string | null;
  apply: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  let sport: TrackedSport = "mlb";
  let date: string | null = null;
  let template = false;
  let file: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as TrackedSport; continue; }
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--template") { template = true; continue; }
    if (a === "--file" && argv[i + 1]) { file = argv[++i]!; continue; }
    if (a === "--apply") { apply = true; continue; }
  }
  if (date === null) {
    console.error("Usage: manual-grade-slate.ts --sport mlb --date YYYY-MM-DD [--template | --file <csv>] [--apply]");
    process.exit(1);
  }
  return { sport, date, template, file, apply };
}

async function emitTemplate(sport: TrackedSport, slateDate: string): Promise<void> {
  // Load slate games for the template
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, status, home_score, away_score, home_team_id, away_team_id")
    .eq("sport", sport)
    .eq("slate_date", slateDate);
  const teamIds = new Set<number>();
  for (const g of (games ?? []) as Array<{ home_team_id: number; away_team_id: number }>) {
    teamIds.add(g.home_team_id);
    teamIds.add(g.away_team_id);
  }
  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", Array.from(teamIds));
  const abbrev = new Map<number, string>(
    ((teams ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [t.id, t.abbreviation]),
  );

  console.log("external_id,matchup,home_score,away_score,first_inning_runs,status,notes");
  for (const g of (games ?? []) as Array<{
    external_id: number;
    status: string | null;
    home_score: number | null;
    away_score: number | null;
    home_team_id: number;
    away_team_id: number;
  }>) {
    const matchup = `${abbrev.get(g.away_team_id) ?? "?"}@${abbrev.get(g.home_team_id) ?? "?"}`;
    console.log(
      `${g.external_id},${matchup},${g.home_score ?? ""},${g.away_score ?? ""},,${g.status ?? "final"},`,
    );
  }
}

type ManualRow = {
  external_id: number;
  home_score: number | null;
  away_score: number | null;
  first_inning_runs: number | null;
  status: string;
  notes: string;
};

function parseManualCsv(text: string): ManualRow[] {
  const lines = text.split(/\r?\n/);
  const out: ManualRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    if (/^external_id/i.test(raw)) continue;
    if (raw.trim().length === 0) continue;
    const cells = raw.split(",").map((c) => c.trim());
    const ext = Number.parseInt(cells[0] ?? "", 10);
    if (!Number.isFinite(ext)) continue;
    out.push({
      external_id: ext,
      home_score: cells[2] ? Number.parseInt(cells[2], 10) : null,
      away_score: cells[3] ? Number.parseInt(cells[3], 10) : null,
      first_inning_runs: cells[4] ? Number.parseInt(cells[4], 10) : null,
      status: (cells[5] ?? "final"),
      notes: cells[6] ?? "",
    });
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.template) {
    await emitTemplate(opts.sport, opts.date);
    return;
  }
  if (opts.file === null) {
    console.error("Provide --file <csv> or --template");
    process.exit(1);
  }
  const envEnabled = process.env.PREDICTION_GRADES_DB_WRITES_ENABLED === "true";
  const willApply = opts.apply && envEnabled;

  const absPath = path.isAbsolute(opts.file) ? opts.file : path.resolve(opts.file);
  if (!fs.existsSync(absPath)) {
    console.error(`✗ file not found: ${absPath}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(absPath, "utf-8");
  const manualRows = parseManualCsv(csvText);

  console.log(`\n━━━ manual-grade-slate · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`  file:                                  ${absPath}`);
  console.log(`  rows parsed:                           ${manualRows.length}`);
  console.log(`  --apply flag:                          ${opts.apply ? "YES" : "no"}`);
  console.log(`  PREDICTION_GRADES_DB_WRITES_ENABLED:   ${envEnabled ? "true" : "missing"}`);
  console.log(`  mode:                                  ${willApply ? "APPLY" : "DRY-RUN"}`);
  console.log("");

  // Load prediction_records for slate
  const { data: recRows } = await supabase
    .from("prediction_records")
    .select("*")
    .eq("sport", opts.sport)
    .eq("slate_date", opts.date);
  const records = (recRows ?? []) as PredictionRecordRow[];
  const recordsByExt = new Map<number, PredictionRecordRow[]>();
  for (const r of records) {
    const arr = recordsByExt.get(r.external_id) ?? [];
    arr.push(r);
    recordsByExt.set(r.external_id, arr);
  }

  let upserted = 0;
  let pending = 0;
  for (const m of manualRows) {
    const recs = recordsByExt.get(m.external_id) ?? [];
    if (recs.length === 0) continue;
    for (const rec of recs) {
      const grade = gradePrediction({
        record: rec,
        game: {
          status: m.status || "final",
          home_score: m.home_score,
          away_score: m.away_score,
          first_inning_runs: m.first_inning_runs,
        },
        source: "manual_operator",
        notes: m.notes || null,
      });
      if (grade.result === "pending") pending++;
      if (willApply) {
        const { error: upErr } = await supabase
          .from("prediction_grades")
          .upsert(grade, { onConflict: "prediction_record_id" });
        if (upErr) {
          console.error(`  upsert failed rec_id=${rec.id}: ${upErr.message}`);
          continue;
        }
        upserted++;
      } else {
        console.log(
          `  ext=${rec.external_id} ${rec.market.padEnd(13)} pick=${(rec.pick ?? "—").padEnd(5)} → ${grade.result}`,
        );
      }
    }
  }

  console.log(
    willApply
      ? `\n✓ APPLIED — upserted: ${upserted}; remaining pending: ${pending}`
      : `\nDRY-RUN — no DB writes; ${pending} would remain pending`,
  );
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
