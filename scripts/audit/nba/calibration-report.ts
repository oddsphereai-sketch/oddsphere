/** SELECT-only frozen NBA performance; no fitting, providers or regrading.
 * node --env-file=/absolute/.env.local --import tsx scripts/audit/nba/calibration-report.ts \
 *   --from=2026-11-06 --through=2026-11-19 --output=/private/tmp/nba-report.json
 */
import { writeFileSync } from "node:fs";
import { buildNbaFrozenPerformance, type FrozenNbaRow } from "./frozen-performance";
const flag = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main() {
  const from = flag("from"), through = flag("through"), output = flag("output");
  const validDate = (date: string | undefined): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!validDate(from) || !validDate(through) || through < from || Date.parse(through) - Date.parse(from) > 30 * 86400000 || !output?.startsWith("/")) {
    throw new Error("Pass --from and --through (inclusive, at most 31 days), and an absolute --output path.");
  }
  if (process.argv.some(arg => /^(--write|--apply|--refit)(=|$)/.test(arg))) throw new Error("This audit cannot write production data or refit a model.");
  const { supabase } = await import("../../../lib/db/supabase");
  const rows: FrozenNbaRow[] = [];
  // Scalar JSON projections avoid transferring three full duplicate member cards per game.
  const fields = "id,game_id,external_id,slate_date,game_date,matchup,market,side,line_value,odds_american,model_version,calibration_version,model_probability,play_grade,locked_at,held," +
    "grade_policy_release:snapshot_json->>grade_policy_release," +
    "independent_picks:snapshot_json->nba_grounding_audit->market_reader_decision->independentPicks," +
    "grades:prediction_grades(result,actual_home_score,actual_away_score,grade_source,graded_at)";
  let complete = false;
  for (let offset = 0; offset < 4000; offset += 250) {
    const result = await supabase.from("prediction_records").select(fields).eq("sport", "nba")
      .gte("slate_date", from).lte("slate_date", through).not("locked_at", "is", null)
      .order("id").range(offset, offset + 249);
    if (result.error) throw new Error(`Frozen NBA read failed: ${result.error.message}`);
    rows.push(...result.data as unknown as FrozenNbaRow[]);
    if (result.data.length < 250) { complete = true; break; }
  }
  if (!complete) throw new Error("Frozen NBA row budget reached; refusing truncated performance.");
  const report = { at: new Date().toISOString(), from, through, ...buildNbaFrozenPerformance(rows) };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, records: rows.length, eras: report.eras.length, issues: report.issues.length, productionWrites: 0, providerCalls: 0 }));
  if (report.issues.length) process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
