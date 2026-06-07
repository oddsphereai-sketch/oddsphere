/**
 * Push 6B.2 — Tracking readiness audit (read-only).
 *
 * Phase 8 deliverable. Given a slate date, reports whether tomorrow's
 * automated slate-cycle output is tracking-compatible:
 *
 *   • predictions generated for each game
 *   • full-game V2.2 audit present (ml_play_grade, ou_play_grade,
 *     ml_edge_pct, ou_edge_pct, data_quality_tier)
 *   • FI V2 audit present when FIRST_INNING_MODEL_VERSION=fi_v2 was
 *     active for the run (sport_specific.fi_model_used="fi_v2" +
 *     fi_v2_audit.fi_pick + fi_v2_audit.fi_play_grade + fi_edge_pct)
 *   • Toss-Up / Held distinguishable in stored fields
 *   • no duplicate prediction rows per game
 *   • lines / FI lines present for grading
 *   • starter linescore readiness for FI grading (game_linescores rows
 *     once games finish)
 *
 * NEVER writes. Refuses --apply.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/audit-tracking-readiness.ts \
 *     --sport mlb --date YYYY-MM-DD [--verbose]
 */

import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

type Opts = { sport: Sport; date: string; verbose: boolean };

function parseArgs(argv: string[]): Opts {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--verbose") { verbose = true; continue; }
    if (a === "--apply") { console.error("✗ --apply not supported (read-only)."); process.exit(2); }
  }
  if (!date) {
    console.error("Usage: audit-tracking-readiness.ts --sport mlb --date YYYY-MM-DD [--verbose]");
    process.exit(1);
  }
  return { sport, date, verbose };
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ TRACKING READINESS · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`     READ-ONLY · NO DB WRITES\n`);

  // Load slate + predictions + teams.
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, status, home_team_id, away_team_id")
    .eq("slate_date", opts.date)
    .eq("sport", opts.sport)
    .order("game_date");
  if (!games || games.length === 0) {
    console.log("No games on slate. Done.");
    return;
  }
  const gameIds = games.map((g) => g.id as number);
  const { data: teams } = await supabase.from("teams").select("id, abbreviation");
  const abbr = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  const { data: preds } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, ml_confidence, ou_confidence, nrfi_confidence, predicted_total, sport_specific")
    .in("game_id", gameIds);
  const predByGameId = new Map<number, Record<string, unknown>>();
  const duplicates: number[] = [];
  for (const p of preds ?? []) {
    if (predByGameId.has(p.game_id as number)) duplicates.push(p.game_id as number);
    else predByGameId.set(p.game_id as number, p);
  }

  // Lines coverage
  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, market_type")
    .in("game_id", gameIds);
  const mlCovered = new Set<number>();
  const totalCovered = new Set<number>();
  const fiCovered = new Set<number>();
  for (const l of lineRows ?? []) {
    const k = l.game_id as number;
    if (l.market_type === "moneyline") mlCovered.add(k);
    if (l.market_type === "total") totalCovered.add(k);
    if (l.market_type === "first_inning_total") fiCovered.add(k);
  }

  // Linescore readiness — for FI grading once games finish
  const { data: linescores } = await supabase
    .from("game_linescores")
    .select("game_id, inning, away_runs, home_runs")
    .in("game_id", gameIds);
  const firstInningHas = new Set<number>();
  for (const l of linescores ?? []) {
    if ((l.inning as number) === 1) firstInningHas.add(l.game_id as number);
  }

  // Per-game audit
  type Row = {
    matchup: string;
    extId: number;
    status: string;
    hasPred: boolean;
    mlOk: boolean;
    ouOk: boolean;
    fiV2Ok: boolean;
    nrfiKind: string;
    fiPick: string | null;
    fiPlayGrade: string | null;
    fiEdgePct: number | null;
    tier: string | null;
    mlPlayGrade: string | null;
    ouPlayGrade: string | null;
    mlLineOk: boolean;
    totalLineOk: boolean;
    fiLineOk: boolean;
    firstInningInLinescore: boolean;
    issues: string[];
  };
  const rows: Row[] = [];
  for (const g of games) {
    const m = `${abbr.get(g.away_team_id as number) ?? "?"}@${abbr.get(g.home_team_id as number) ?? "?"}`;
    const p = predByGameId.get(g.id as number);
    const sp = (p?.sport_specific as Record<string, unknown> | null) ?? {};
    const v22 = (sp.v2_2_audit as Record<string, unknown> | undefined) ?? null;
    const fi = (sp.fi_v2_audit as Record<string, unknown> | undefined) ?? null;
    const fiModelUsed = (sp.fi_model_used as string | undefined) ?? "legacy";
    const nrfiKind = (sp.nrfi_decision_kind as string | undefined) ?? "—";
    const issues: string[] = [];
    if (!p) issues.push("no_prediction");
    if (p && v22 === null) issues.push("missing_v22_audit");
    if (p && fiModelUsed === "fi_v2" && fi === null) issues.push("fi_model_used_fi_v2_but_audit_missing");
    if (p && !mlCovered.has(g.id as number)) issues.push("no_ml_line");
    if (p && !totalCovered.has(g.id as number)) issues.push("no_total_line");
    if (p && !fiCovered.has(g.id as number) && fiModelUsed === "fi_v2") issues.push("no_fi_line");
    rows.push({
      matchup: m,
      extId: g.external_id as number,
      status: (g.status as string | null) ?? "",
      hasPred: !!p,
      mlOk: !!v22 && v22.ml_edge_pct !== undefined,
      ouOk: !!v22 && v22.ou_edge_pct !== undefined,
      fiV2Ok: !!fi && fi.fi_pick !== undefined,
      nrfiKind,
      fiPick: (fi?.fi_pick as string | undefined) ?? null,
      fiPlayGrade: (fi?.fi_play_grade as string | undefined) ?? null,
      fiEdgePct: typeof fi?.fi_edge_pct === "number" ? fi.fi_edge_pct as number : null,
      tier: (v22?.data_quality_tier as string | undefined) ?? (fi?.data_quality_tier as string | undefined) ?? null,
      mlPlayGrade: (v22?.ml_play_grade as string | undefined) ?? null,
      ouPlayGrade: (v22?.ou_play_grade as string | undefined) ?? null,
      mlLineOk: mlCovered.has(g.id as number),
      totalLineOk: totalCovered.has(g.id as number),
      fiLineOk: fiCovered.has(g.id as number),
      firstInningInLinescore: firstInningHas.has(g.id as number),
      issues,
    });
  }

  // Per-game table
  console.log("matchup   | status                 | pred | V22 ml/ou | FI V2 pick/grade/edge      | tier  | lines ml/tot/fi | LS-FI | issues");
  console.log("─".repeat(180));
  for (const r of rows) {
    const v22m = r.mlOk ? "✓" : "✗";
    const v22o = r.ouOk ? "✓" : "✗";
    const fiCol = r.fiV2Ok
      ? `${(r.fiPick ?? "—").padEnd(8)} / ${(r.fiPlayGrade ?? "—").padEnd(10)} / ${(r.fiEdgePct !== null ? (r.fiEdgePct >= 0 ? "+" : "") + r.fiEdgePct.toFixed(1) + "pp" : "—").padEnd(6)}`
      : (r.nrfiKind !== "—" ? `legacy(${r.nrfiKind})`.padEnd(34) : "—".padEnd(34));
    const lines = `${r.mlLineOk ? "✓" : "✗"} / ${r.totalLineOk ? "✓" : "✗"} / ${r.fiLineOk ? "✓" : "✗"}`;
    const ls = r.firstInningInLinescore ? "✓" : "·";
    console.log(
      `${r.matchup.padEnd(9)} | ${r.status.padEnd(22)} | ${(r.hasPred ? "✓" : "✗").padEnd(4)} | ${(v22m + "/" + v22o).padEnd(9)} | ${fiCol} | ${(r.tier ?? "—").padEnd(5)} | ${lines.padEnd(15)} | ${ls}     | ${r.issues.join(",")}`,
    );
  }

  // Aggregate
  const total = rows.length;
  const hasPredCount = rows.filter((r) => r.hasPred).length;
  const v22Count = rows.filter((r) => r.mlOk && r.ouOk).length;
  const fiV2Count = rows.filter((r) => r.fiV2Ok).length;
  const tossUpCount = rows.filter((r) => (r.nrfiKind === "toss_up" || r.fiPick === "Toss-Up")).length;
  const heldNrfiCount = rows.filter((r) => r.nrfiKind === "held" || r.fiPick === "Held").length;
  const nrfiCount = rows.filter((r) => r.fiPick === "NRFI").length;
  const yrfiCount = rows.filter((r) => r.fiPick === "YRFI").length;

  console.log(`\n━━━ Aggregate ━━━`);
  console.log(`  Games on slate:               ${total}`);
  console.log(`  Predictions generated:        ${hasPredCount}/${total}`);
  console.log(`  Duplicate prediction rows:    ${duplicates.length} (game_ids: ${duplicates.join(",") || "none"})`);
  console.log(`  Full-game V2.2 audit:         ${v22Count}/${total}`);
  console.log(`  FI V2 audit:                  ${fiV2Count}/${total}`);
  console.log(`    FI V2 NRFI:                 ${nrfiCount}`);
  console.log(`    FI V2 YRFI:                 ${yrfiCount}`);
  console.log(`    FI V2 Toss-Up (incl legacy):${tossUpCount}`);
  console.log(`    FI Held (incl legacy):      ${heldNrfiCount}`);
  console.log(`  Lines coverage:`);
  console.log(`    ML:                         ${rows.filter((r) => r.mlLineOk).length}/${total}`);
  console.log(`    Total:                      ${rows.filter((r) => r.totalLineOk).length}/${total}`);
  console.log(`    FI (first_inning_total):    ${rows.filter((r) => r.fiLineOk).length}/${total}`);
  console.log(`  Linescore first-inning rows:  ${rows.filter((r) => r.firstInningInLinescore).length}/${total}`);

  // Issues summary
  const issueCounts: Record<string, number> = {};
  for (const r of rows) for (const i of r.issues) issueCounts[i] = (issueCounts[i] ?? 0) + 1;
  if (Object.keys(issueCounts).length > 0) {
    console.log(`\n  Issue codes:`);
    for (const [k, v] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(40)} ${v}`);
  }

  if (opts.verbose) {
    const fiV2Rows = rows.filter((r) => r.fiV2Ok);
    if (fiV2Rows.length > 0) {
      console.log(`\n  FI V2 details:`);
      for (const r of fiV2Rows) {
        console.log(`    ${r.matchup}  pick=${r.fiPick}  pg=${r.fiPlayGrade}  edge=${r.fiEdgePct?.toFixed(2)}pp  tier=${r.tier}`);
      }
    }
  }

  console.log(`\nREAD-ONLY — no DB writes performed.\n`);
}

if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
}
