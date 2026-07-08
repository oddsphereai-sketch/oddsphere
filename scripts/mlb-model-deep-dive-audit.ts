/**
 * MLB model deep-dive audit.
 *
 * Read-only. Searches for calibration corrections below the final grade layer:
 * raw vs shadow projection blends, total-side alignment, team run bias,
 * ML probability calibration, first-inning calibration, and pitching/bullpen
 * input cohorts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "@/lib/db/supabase";
import { effectiveTrackingPlayGrade } from "@/lib/services/trackingAggregateService";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";

type GradeJoin = {
  result: string | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_first_inning_runs: number | null;
};

type Row = PredictionRecordRow & {
  prediction_grades: GradeJoin | GradeJoin[] | null;
};

type Args = {
  from: string;
  to: string;
  outDir: string;
  json: boolean;
};

type RecordMetric = {
  key: string;
  n: number;
  decided: number;
  wins: number;
  losses: number;
  winPct: number | null;
  units: number;
  roi: number | null;
  avgProb: number | null;
  avgEdge: number | null;
  brier: number | null;
};

type ErrorMetric = {
  key: string;
  n: number;
  mae: number | null;
  bias: number | null;
  rmse: number | null;
  directional: number | null;
};

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseArgs(): Args {
  const out: Args = { from: "2026-06-07", to: todayEt(), outDir: "ops-local/learning-lab", json: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") out.json = true;
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "from") out.from = value;
    if (key === "to") out.to = value === "today" ? todayEt() : value;
    if (key === "out-dir") out.outDir = value;
  }
  return out;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function round(value: number, places = 3): number {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function snap(row: Row): Record<string, unknown> {
  return row.snapshot_json && typeof row.snapshot_json === "object" ? row.snapshot_json as Record<string, unknown> : {};
}

function v22(row: Row): Record<string, unknown> {
  return obj(snap(row).v2_2_audit);
}

function core(row: Row): Record<string, unknown> {
  return obj(snap(row).mlb_core_model_calibration);
}

function auto(row: Row): Record<string, unknown> {
  return obj(snap(row).auto_factors);
}

function result(row: Row): "win" | "loss" | "push" | "void" | "pending" | "unknown" {
  const raw = String(one(row.prediction_grades)?.result ?? "unknown").toLowerCase();
  if (raw === "win" || raw === "loss" || raw === "push" || raw === "void" || raw === "pending") return raw;
  return "unknown";
}

function actualScores(row: Row): { home: number | null; away: number | null } {
  const g = one(row.prediction_grades);
  return { home: g?.actual_home_score ?? null, away: g?.actual_away_score ?? null };
}

function actualTotal(row: Row): number | null {
  const s = actualScores(row);
  return s.home !== null && s.away !== null ? s.home + s.away : null;
}

function predictedScores(row: Row): { home: number | null; away: number | null } {
  const scores = obj(snap(row).predicted_scores_at_lock);
  return {
    home: num(scores.home) ?? num(v22(row).posterior_home_runs),
    away: num(scores.away) ?? num(v22(row).posterior_away_runs),
  };
}

function rawTotal(row: Row): number | null {
  const s = predictedScores(row);
  return s.home !== null && s.away !== null ? s.home + s.away : num(v22(row).posterior_total);
}

function shadowTotal(row: Row): number | null {
  return num(core(row).market_aware_projected_total_if_enabled);
}

function marketLine(row: Row): number | null {
  return row.line_value ?? num(v22(row).market_total) ?? num(core(row).market_total);
}

function sideFromDelta(delta: number | null): "over" | "under" | "on_line" | "unknown" {
  if (delta === null) return "unknown";
  if (delta > 0) return "over";
  if (delta < 0) return "under";
  return "on_line";
}

function totalSide(total: number | null, line: number | null): "over" | "under" | "on_line" | "unknown" {
  if (total === null || line === null) return "unknown";
  return sideFromDelta(total - line);
}

function americanUnits(row: Row): number {
  const r = result(row);
  if (r === "loss") return -1;
  if (r !== "win") return 0;
  const p = row.odds_american;
  if (typeof p !== "number" || p === 0) return 0;
  return p > 0 ? p / 100 : 100 / Math.abs(p);
}

function grade(row: Row): string {
  return effectiveTrackingPlayGrade(row).replace(/_/g, " ") || "(none)";
}

function bucket(value: number | null, cuts: Array<[number, string]>, fallback = "missing"): string {
  if (value === null || !Number.isFinite(value)) return fallback;
  for (const [max, label] of cuts) if (value < max) return label;
  return cuts.at(-1)?.[1].replace(/^</, "") + "+" || "other";
}

function confidenceBucket(row: Row): string {
  const p = row.model_probability === null ? null : row.model_probability * 100;
  return bucket(p, [[50, "<50"], [53, "50-53"], [56, "53-56"], [60, "56-60"], [65, "60-65"], [70, "65-70"], [101, "70+"]]);
}

function edgeBucket(row: Row): string {
  const e = Math.abs(row.edge ?? Number.NaN);
  return bucket(e, [[1, "<1pp"], [3, "1-3pp"], [5, "3-5pp"], [8, "5-8pp"], [999, "8pp+"]]);
}

function priceBucket(row: Row): string {
  const p = row.odds_american;
  if (p === null || p === undefined) return "missing";
  if (p > 0) return "plus_money";
  if (p >= -110) return "-100_to_-110";
  if (p >= -130) return "-111_to_-130";
  if (p >= -160) return "-131_to_-160";
  return "heavy_juice";
}

function lineDirection(row: Row): string {
  return String(obj(snap(row).line_movement).direction ?? "unknown");
}

function featureCodes(row: Row): string {
  const codes = v22(row).feature_reason_codes;
  return Array.isArray(codes) ? codes.join(" ") : "";
}

function featureRisk(row: Row): string {
  const codes = featureCodes(row);
  if (/missing/.test(codes)) return "missing_inputs";
  if (/fallback|proxy/.test(codes)) return "fallback_or_proxy";
  return "cleaner_inputs";
}

function starterBucket(row: Row): string {
  const home = num(auto(row).home_starter_era_factor);
  const away = num(auto(row).away_starter_era_factor);
  if (home === null || away === null) return "starter_unknown";
  const avg = (home + away) / 2;
  if (avg < 0.9) return "both_or_avg_good_starters";
  if (avg > 1.1) return "both_or_avg_bad_starters";
  return "starter_neutral";
}

function bullpenBucket(row: Row): string {
  const home = num(auto(row).home_bullpen_factor);
  const away = num(auto(row).away_bullpen_factor);
  if (home === null || away === null) return "bullpen_unknown";
  const avg = (home + away) / 2;
  if (avg < 0.92) return "strong_bullpens";
  if (avg > 1.08) return "weak_bullpens";
  return "bullpen_neutral";
}

function workloadBucket(row: Row): string {
  const h = String(obj(v22(row).home_starter_workload).role ?? "");
  const a = String(obj(v22(row).away_starter_workload).role ?? "");
  if (!h && !a) return "workload_unknown";
  if (h.includes("short") || a.includes("short") || h.includes("reliever") || a.includes("reliever")) return "short_or_reliever_starter";
  return "normal_starters";
}

async function loadRows(args: Args): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 750) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("*,prediction_grades(result,actual_home_score,actual_away_score,actual_first_inning_runs)")
      .eq("sport", "mlb")
      .gte("slate_date", args.from)
      .lte("slate_date", args.to)
      .order("slate_date", { ascending: true })
      .range(from, from + 749);
    if (error) throw new Error(`prediction_records query failed: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 750) break;
  }
  return out.filter((r) => r.launch_day !== true);
}

function uniqueGames(rows: Row[]): Row[] {
  const byGame = new Map<number, Row>();
  for (const row of rows) {
    if (row.game_id === undefined || row.game_id === null) continue;
    if (actualTotal(row) === null || rawTotal(row) === null) continue;
    const existing = byGame.get(row.game_id);
    if (!existing || row.market === "moneyline") byGame.set(row.game_id, row);
  }
  return [...byGame.values()];
}

function recordMetric(key: string, rows: Row[]): RecordMetric {
  const decided = rows.filter((r) => result(r) === "win" || result(r) === "loss");
  const wins = decided.filter((r) => result(r) === "win").length;
  const losses = decided.length - wins;
  const priced = decided.filter((r) => r.odds_american !== null);
  const units = priced.reduce((sum, r) => sum + americanUnits(r), 0);
  let brierSum = 0;
  let brierN = 0;
  for (const row of decided) {
    if (row.model_probability === null || row.model_probability <= 0 || row.model_probability >= 1) continue;
    const outcome = result(row) === "win" ? 1 : 0;
    brierSum += (row.model_probability - outcome) ** 2;
    brierN++;
  }
  return {
    key,
    n: rows.length,
    decided: decided.length,
    wins,
    losses,
    winPct: decided.length ? round((wins / decided.length) * 100, 1) : null,
    units: round(units, 2),
    roi: priced.length ? round(units / priced.length, 3) : null,
    avgProb: avg(rows.map((r) => r.model_probability === null ? null : r.model_probability * 100)),
    avgEdge: avg(rows.map((r) => r.edge)),
    brier: brierN ? round(brierSum / brierN, 4) : null,
  };
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length, 3) : null;
}

function groupRows<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(keyFn(row), [...(out.get(keyFn(row)) ?? []), row]);
  return out;
}

function recordGroups(rows: Row[], keyFn: (row: Row) => string, minDecided = 0): RecordMetric[] {
  return [...groupRows(rows, keyFn).entries()]
    .map(([key, rs]) => recordMetric(key, rs))
    .filter((m) => m.decided >= minDecided)
    .sort((a, b) => b.decided - a.decided);
}

function errorMetric(key: string, pairs: Array<{ pred: number | null; actual: number | null; line?: number | null }>): ErrorMetric {
  const usable = pairs.filter((p): p is { pred: number; actual: number; line?: number | null } => p.pred !== null && p.actual !== null);
  const errors = usable.map((p) => p.pred - p.actual);
  const abs = errors.map(Math.abs);
  const directional = usable.filter((p) => {
    if (p.line === undefined || p.line === null) return false;
    return sideFromDelta(p.pred - p.line) === sideFromDelta(p.actual - p.line);
  }).length;
  return {
    key,
    n: usable.length,
    mae: usable.length ? round(abs.reduce((a, b) => a + b, 0) / usable.length, 3) : null,
    bias: usable.length ? round(errors.reduce((a, b) => a + b, 0) / usable.length, 3) : null,
    rmse: usable.length ? round(Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / usable.length), 3) : null,
    directional: usable.length && usable.some((p) => p.line !== undefined && p.line !== null) ? round((directional / usable.length) * 100, 1) : null,
  };
}

function blendSearch(gameRows: Row[]): ErrorMetric[] {
  const out: ErrorMetric[] = [];
  for (let rawWeight = 0; rawWeight <= 1.0001; rawWeight += 0.1) {
    const w = Math.round(rawWeight * 10) / 10;
    out.push(errorMetric(
      `raw_${w}_shadow_${round(1 - w, 1)}`,
      gameRows.map((r) => {
        const raw = rawTotal(r);
        const shadow = shadowTotal(r);
        return {
          pred: raw !== null && shadow !== null ? raw * w + shadow * (1 - w) : null,
          actual: actualTotal(r),
          line: marketLine(r),
        };
      }),
    ));
  }
  return out.sort((a, b) => (a.mae ?? 999) - (b.mae ?? 999));
}

function projectionByGroup(gameRows: Row[], keyFn: (row: Row) => string): ErrorMetric[] {
  return [...groupRows(gameRows, keyFn).entries()]
    .map(([key, rs]) => errorMetric(key, rs.map((r) => ({ pred: rawTotal(r), actual: actualTotal(r), line: marketLine(r) }))))
    .filter((m) => m.n >= 8)
    .sort((a, b) => Math.abs(b.bias ?? 0) - Math.abs(a.bias ?? 0));
}

function teamBias(gameRows: Row[]): ErrorMetric[] {
  const pairs = new Map<string, Array<{ pred: number | null; actual: number | null }>>();
  for (const row of gameRows) {
    const [away, home] = String(row.matchup ?? "").split("@");
    const pred = predictedScores(row);
    const actual = actualScores(row);
    if (home) pairs.set(home, [...(pairs.get(home) ?? []), { pred: pred.home, actual: actual.home }]);
    if (away) pairs.set(away, [...(pairs.get(away) ?? []), { pred: pred.away, actual: actual.away }]);
  }
  return [...pairs.entries()]
    .map(([team, ps]) => errorMetric(team, ps))
    .filter((m) => m.n >= 12)
    .sort((a, b) => Math.abs(b.bias ?? 0) - Math.abs(a.bias ?? 0));
}

function firstInningCalibration(fiRows: Row[]): RecordMetric[] {
  return recordGroups(fiRows.filter((r) => result(r) === "win" || result(r) === "loss"), (r) => {
    const g = one(r.prediction_grades);
    const runs = g?.actual_first_inning_runs ?? null;
    const actualSide = runs === null ? "actual_unknown" : runs > 0 ? "actual_yrfi" : "actual_nrfi";
    return `${grade(r)}::pick=${r.pick ?? "none"}::${confidenceBucket(r)}::${actualSide}`;
  }, 5);
}

function metricTable(rows: RecordMetric[]): string {
  const head = "| Cohort | N | Decided | W-L | Win% | Units | ROI | Avg Prob | Avg Edge | Brier |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  return [head, ...rows.map((r) => `| ${r.key} | ${r.n} | ${r.decided} | ${r.wins}-${r.losses} | ${r.winPct ?? "-"} | ${r.units} | ${r.roi ?? "-"} | ${r.avgProb ?? "-"} | ${r.avgEdge ?? "-"} | ${r.brier ?? "-"} |`)].join("\n");
}

function errorTable(rows: ErrorMetric[]): string {
  const head = "| Cohort | N | MAE | Bias Pred-Actual | RMSE | Directional vs Line |\n|---|---:|---:|---:|---:|---:|";
  return [head, ...rows.map((r) => `| ${r.key} | ${r.n} | ${r.mae ?? "-"} | ${r.bias ?? "-"} | ${r.rmse ?? "-"} | ${r.directional ?? "-"}% |`)].join("\n");
}

function buildInsights(report: {
  blendSearch: ErrorMetric[];
  totalProjectionByStarter: ErrorMetric[];
  totalProjectionByBullpen: ErrorMetric[];
  teamBias: ErrorMetric[];
  totalsByAlignment: RecordMetric[];
  mlCalibration: RecordMetric[];
  fiByGrade: RecordMetric[];
}): string[] {
  const out: string[] = [];
  const bestBlend = report.blendSearch[0];
  const halfBlend = report.blendSearch.find((r) => r.key === "raw_0.5_shadow_0.5");
  if (bestBlend) out.push(`Best raw/shadow blend in stored shadow sample: ${bestBlend.key}, MAE ${bestBlend.mae}, bias ${bestBlend.bias}.`);
  if (halfBlend) out.push(`Simple split-the-difference blend: MAE ${halfBlend.mae}, bias ${halfBlend.bias}.`);
  for (const c of report.mlCalibration.filter((m) => m.decided >= 20 && m.units < -3).slice(0, 5)) {
    out.push(`ML correction candidate: ${c.key} is ${c.wins}-${c.losses}, ${c.units}u.`);
  }
  for (const c of report.totalsByAlignment.filter((m) => m.decided >= 15 && m.units < -3).slice(0, 5)) {
    out.push(`Totals correction candidate: ${c.key} is ${c.wins}-${c.losses}, ${c.units}u.`);
  }
  for (const c of report.totalProjectionByStarter.filter((m) => m.n >= 20 && Math.abs(m.bias ?? 0) >= 0.5).slice(0, 3)) {
    out.push(`Projection bias by starter bucket: ${c.key} bias ${c.bias} runs.`);
  }
  for (const c of report.totalProjectionByBullpen.filter((m) => m.n >= 20 && Math.abs(m.bias ?? 0) >= 0.5).slice(0, 3)) {
    out.push(`Projection bias by bullpen bucket: ${c.key} bias ${c.bias} runs.`);
  }
  for (const c of report.teamBias.slice(0, 5)) {
    out.push(`Team run projection bias: ${c.key} bias ${c.bias} runs over ${c.n} team-games.`);
  }
  for (const c of report.fiByGrade.filter((m) => m.decided >= 10 && m.units < -2).slice(0, 4)) {
    out.push(`First-inning correction candidate: ${c.key} is ${c.wins}-${c.losses}, ${c.units}u.`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await loadRows(args);
  const games = uniqueGames(rows);
  const totals = rows.filter((r) => r.market === "total");
  const moneylines = rows.filter((r) => r.market === "moneyline");
  const firstInnings = rows.filter((r) => r.market === "first_inning");
  const gamesWithShadow = games.filter((r) => rawTotal(r) !== null && shadowTotal(r) !== null && actualTotal(r) !== null);

  const report = {
    blendSearch: blendSearch(gamesWithShadow),
    rawProjectionByStarter: projectionByGroup(games, starterBucket),
    rawProjectionByBullpen: projectionByGroup(games, bullpenBucket),
    rawProjectionByWorkload: projectionByGroup(games, workloadBucket),
    rawProjectionByFeatureRisk: projectionByGroup(games, featureRisk),
    teamBias: teamBias(games),
    totalsByAlignment: recordGroups(totals, (r) => {
      const line = marketLine(r);
      const rawSide = totalSide(rawTotal(r), line);
      const shadowSide = totalSide(shadowTotal(r), line);
      return `pick=${r.side ?? r.pick}::raw=${rawSide}::shadow=${shadowSide}::grade=${grade(r)}`;
    }, 8),
    totalsByPitching: recordGroups(totals, (r) => `${starterBucket(r)}::${bullpenBucket(r)}::${workloadBucket(r)}`, 8),
    mlCalibration: recordGroups(moneylines, (r) => `${grade(r)}::${confidenceBucket(r)}::edge=${edgeBucket(r)}::move=${lineDirection(r)}`, 8),
    mlByMarketGap: recordGroups(moneylines, (r) => {
      const gap = rowMarketGap(r);
      return `gap=${bucket(gap, [[0, "negative"], [2, "0-2pp"], [5, "2-5pp"], [8, "5-8pp"], [999, "8pp+"]])}::price=${priceBucket(r)}::grade=${grade(r)}`;
    }, 8),
    fiByGrade: firstInningCalibration(firstInnings),
    fiByInput: recordGroups(firstInnings, (r) => `${grade(r)}::${featureRisk(r)}::${confidenceBucket(r)}`, 8),
  };
  const insights = buildInsights({
    blendSearch: report.blendSearch,
    totalProjectionByStarter: report.rawProjectionByStarter,
    totalProjectionByBullpen: report.rawProjectionByBullpen,
    teamBias: report.teamBias,
    totalsByAlignment: report.totalsByAlignment,
    mlCalibration: report.mlCalibration,
    fiByGrade: report.fiByGrade,
  });
  const payload = { args, generatedAt: new Date().toISOString(), rows: rows.length, games: games.length, gamesWithShadow: gamesWithShadow.length, report, insights };
  await mkdir(args.outDir, { recursive: true });
  const base = `${args.outDir}/mlb-model-deep-dive-audit-${args.from}-to-${args.to}`;
  await writeFile(`${base}.json`, JSON.stringify(payload, null, 2));
  const md = [
    `# MLB Model Deep-Dive Audit — ${args.from} to ${args.to}`,
    "",
    `Generated: ${payload.generatedAt}`,
    `Rows: ${rows.length}`,
    `Games: ${games.length}`,
    `Games with shadow projection: ${gamesWithShadow.length}`,
    "",
    "## Raw/Shadow Blend Search",
    errorTable(report.blendSearch),
    "",
    "## Raw Total Projection Bias By Starter Bucket",
    errorTable(report.rawProjectionByStarter),
    "",
    "## Raw Total Projection Bias By Bullpen Bucket",
    errorTable(report.rawProjectionByBullpen),
    "",
    "## Raw Total Projection Bias By Workload",
    errorTable(report.rawProjectionByWorkload),
    "",
    "## Raw Total Projection Bias By Input Risk",
    errorTable(report.rawProjectionByFeatureRisk),
    "",
    "## Team Run Projection Bias",
    errorTable(report.teamBias.slice(0, 20)),
    "",
    "## Totals By Pick/Raw/Shadow Alignment",
    metricTable(report.totalsByAlignment),
    "",
    "## Totals By Pitching Cohort",
    metricTable(report.totalsByPitching),
    "",
    "## ML Calibration Cohorts",
    metricTable(report.mlCalibration),
    "",
    "## ML Market Gap / Price Cohorts",
    metricTable(report.mlByMarketGap),
    "",
    "## First Inning Calibration",
    metricTable(report.fiByGrade),
    "",
    "## First Inning Input Cohorts",
    metricTable(report.fiByInput),
    "",
    "## Correction Hypotheses",
    ...(insights.length ? insights.map((i) => `- ${i}`) : ["- No clear correction candidates found."]),
    "",
  ].join("\n");
  await writeFile(`${base}.md`, md);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Wrote ${base}.md`);
    console.log(`Wrote ${base}.json`);
    console.log(errorTable(report.blendSearch.slice(0, 5)));
    console.log("\nCorrection hypotheses:");
    for (const insight of insights.slice(0, 14)) console.log(`- ${insight}`);
  }
}

function rowMarketGap(row: Row): number | null {
  if (row.model_probability === null || row.market_probability === null) return null;
  return (row.model_probability - row.market_probability) * 100;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
