/**
 * Complete MLB model calibration audit.
 *
 * Read-only. Focuses on how predictions are made:
 * - locked score projection accuracy
 * - raw vs market-anchored total projection accuracy
 * - side/grade/price performance
 * - probability calibration
 * - feature/input quality and market-movement cohorts
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

type Metric = {
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
  within1: number | null;
  within2: number | null;
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

function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length, 3) : null;
}

function res(row: Row): "win" | "loss" | "push" | "void" | "pending" | "unknown" {
  const raw = String(one(row.prediction_grades)?.result ?? "unknown").toLowerCase();
  if (raw === "win" || raw === "loss" || raw === "push" || raw === "void" || raw === "pending") return raw;
  return "unknown";
}

function grade(row: Row): string {
  return effectiveTrackingPlayGrade(row).replace(/_/g, " ") || "(none)";
}

function snap(row: Row): Record<string, unknown> {
  return row.snapshot_json && typeof row.snapshot_json === "object" ? row.snapshot_json as Record<string, unknown> : {};
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function predictedScores(row: Row): { home: number | null; away: number | null } {
  const s = obj(snap(row).predicted_scores_at_lock);
  const v22 = obj(snap(row).v2_2_audit);
  return {
    home: num(s.home) ?? num(v22.posterior_home_runs),
    away: num(s.away) ?? num(v22.posterior_away_runs),
  };
}

function actualScores(row: Row): { home: number | null; away: number | null } {
  const g = one(row.prediction_grades);
  return { home: g?.actual_home_score ?? null, away: g?.actual_away_score ?? null };
}

function actualTotal(row: Row): number | null {
  const a = actualScores(row);
  return a.home !== null && a.away !== null ? a.home + a.away : null;
}

function actualMarginHome(row: Row): number | null {
  const a = actualScores(row);
  return a.home !== null && a.away !== null ? a.home - a.away : null;
}

function predTotal(row: Row): number | null {
  const p = predictedScores(row);
  return p.home !== null && p.away !== null ? p.home + p.away : null;
}

function predMarginHome(row: Row): number | null {
  const p = predictedScores(row);
  return p.home !== null && p.away !== null ? p.home - p.away : null;
}

function marketAwareTotal(row: Row): number | null {
  return num(obj(snap(row).mlb_core_model_calibration).market_aware_projected_total_if_enabled);
}

function marketTotal(row: Row): number | null {
  return row.line_value ?? num(obj(snap(row).v2_2_audit).market_total) ?? num(obj(snap(row).mlb_core_model_calibration).market_total);
}

function totalProjectionSide(row: Row, total: number | null): "over" | "under" | "on_line" | "unknown" {
  const line = marketTotal(row);
  if (total === null || line === null) return "unknown";
  if (total > line) return "over";
  if (total < line) return "under";
  return "on_line";
}

function lineDirection(row: Row): string {
  return String(obj(snap(row).line_movement).direction ?? "unknown");
}

function featureRisk(row: Row): string {
  const codes = obj(snap(row).v2_2_audit).feature_reason_codes;
  const text = Array.isArray(codes) ? codes.join(" ") : "";
  if (/missing/.test(text)) return "missing_inputs";
  if (/fallback|proxy/.test(text)) return "fallback_or_proxy";
  return "cleaner_inputs";
}

function noVigProbBucket(row: Row): string {
  const p = row.model_probability;
  if (p === null) return "missing";
  if (p < 0.5) return "<50";
  if (p < 0.53) return "50-53";
  if (p < 0.56) return "53-56";
  if (p < 0.6) return "56-60";
  if (p < 0.65) return "60-65";
  if (p < 0.7) return "65-70";
  return "70+";
}

function edgeBucket(row: Row): string {
  const e = Math.abs(row.edge ?? Number.NaN);
  if (!Number.isFinite(e)) return "missing";
  if (e < 1) return "<1pp";
  if (e < 3) return "1-3pp";
  if (e < 5) return "3-5pp";
  if (e < 8) return "5-8pp";
  return "8pp+";
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

function units(row: Row): number {
  const r = res(row);
  if (r === "loss") return -1;
  if (r !== "win") return 0;
  const p = row.odds_american;
  if (typeof p !== "number" || p === 0) return 0;
  return p > 0 ? p / 100 : 100 / Math.abs(p);
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

function uniqueGameRows(rows: Row[]): Row[] {
  const byGame = new Map<number, Row>();
  for (const row of rows) {
    if (row.game_id === undefined || row.game_id === null) continue;
    if (actualTotal(row) === null || predTotal(row) === null) continue;
    const existing = byGame.get(row.game_id);
    if (!existing || row.market === "moneyline") byGame.set(row.game_id, row);
  }
  return [...byGame.values()];
}

function sideRows(rows: Row[]): Row[] {
  return rows.filter((r) => res(r) === "win" || res(r) === "loss");
}

function summarize(rows: Row[], key: string): Metric {
  const decided = sideRows(rows);
  const wins = decided.filter((r) => res(r) === "win").length;
  const losses = decided.length - wins;
  const priced = decided.filter((r) => r.odds_american !== null);
  let brierSum = 0;
  let brierN = 0;
  for (const row of decided) {
    if (row.model_probability === null || row.model_probability <= 0 || row.model_probability >= 1) continue;
    const outcome = res(row) === "win" ? 1 : 0;
    brierSum += (row.model_probability - outcome) ** 2;
    brierN++;
  }
  const net = priced.reduce((sum, row) => sum + units(row), 0);
  return {
    key,
    n: rows.length,
    decided: decided.length,
    wins,
    losses,
    winPct: decided.length ? round((wins / decided.length) * 100, 1) : null,
    units: round(net, 2),
    roi: priced.length ? round(net / priced.length, 3) : null,
    avgProb: avg(rows.map((r) => r.model_probability === null ? null : r.model_probability * 100)),
    avgEdge: avg(rows.map((r) => r.edge)),
    brier: brierN ? round(brierSum / brierN, 4) : null,
  };
}

function summarizeGroups(rows: Row[], keyFn: (row: Row) => string, minDecided = 0): Metric[] {
  const map = new Map<string, Row[]>();
  for (const row of rows) map.set(keyFn(row), [...(map.get(keyFn(row)) ?? []), row]);
  return [...map.entries()]
    .map(([key, rs]) => summarize(rs, key))
    .filter((m) => m.decided >= minDecided)
    .sort((a, b) => b.decided - a.decided);
}

function errorMetric(key: string, pairs: Array<{ pred: number | null; actual: number | null }>): ErrorMetric {
  const errors = pairs
    .filter((p): p is { pred: number; actual: number } => p.pred !== null && p.actual !== null)
    .map((p) => p.pred - p.actual);
  const abs = errors.map(Math.abs);
  return {
    key,
    n: errors.length,
    mae: errors.length ? round(abs.reduce((a, b) => a + b, 0) / errors.length, 3) : null,
    bias: errors.length ? round(errors.reduce((a, b) => a + b, 0) / errors.length, 3) : null,
    rmse: errors.length ? round(Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length), 3) : null,
    within1: errors.length ? round(abs.filter((e) => e <= 1).length / errors.length * 100, 1) : null,
    within2: errors.length ? round(abs.filter((e) => e <= 2).length / errors.length * 100, 1) : null,
  };
}

function projectionErrors(gameRows: Row[]): ErrorMetric[] {
  return [
    errorMetric("home_runs", gameRows.map((r) => ({ pred: predictedScores(r).home, actual: actualScores(r).home }))),
    errorMetric("away_runs", gameRows.map((r) => ({ pred: predictedScores(r).away, actual: actualScores(r).away }))),
    errorMetric("raw_total", gameRows.map((r) => ({ pred: predTotal(r), actual: actualTotal(r) }))),
    errorMetric("market_aware_total_if_enabled", gameRows.map((r) => ({ pred: marketAwareTotal(r), actual: actualTotal(r) }))),
    errorMetric("market_line_total", gameRows.map((r) => ({ pred: marketTotal(r), actual: actualTotal(r) }))),
    errorMetric("home_margin", gameRows.map((r) => ({ pred: predMarginHome(r), actual: actualMarginHome(r) }))),
  ];
}

function tableMetric(rows: Metric[]): string {
  const head = "| Cohort | N | Decided | W-L | Win% | Units | ROI | Avg Prob | Avg Edge | Brier |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  return [head, ...rows.map((r) => `| ${r.key} | ${r.n} | ${r.decided} | ${r.wins}-${r.losses} | ${r.winPct ?? "-"} | ${r.units} | ${r.roi ?? "-"} | ${r.avgProb ?? "-"} | ${r.avgEdge ?? "-"} | ${r.brier ?? "-"} |`)].join("\n");
}

function tableError(rows: ErrorMetric[]): string {
  const head = "| Projection | N | MAE | Bias (Pred-Actual) | RMSE | Within 1 | Within 2 |\n|---|---:|---:|---:|---:|---:|---:|";
  return [head, ...rows.map((r) => `| ${r.key} | ${r.n} | ${r.mae ?? "-"} | ${r.bias ?? "-"} | ${r.rmse ?? "-"} | ${r.within1 ?? "-"}% | ${r.within2 ?? "-"}% |`)].join("\n");
}

function insightBullets(report: {
  projection: ErrorMetric[];
  marketGrade: Metric[];
  probability: Metric[];
  price: Metric[];
  movement: Metric[];
  feature: Metric[];
  totalAlignment: Metric[];
}): string[] {
  const out: string[] = [];
  const raw = report.projection.find((r) => r.key === "raw_total");
  const anchored = report.projection.find((r) => r.key === "market_aware_total_if_enabled");
  const line = report.projection.find((r) => r.key === "market_line_total");
  if (raw && anchored && raw.mae !== null && anchored.mae !== null) {
    out.push(`Market-anchored total projection would have MAE ${anchored.mae} vs raw ${raw.mae}${line?.mae !== null ? ` and market line ${line?.mae}` : ""}.`);
  }
  for (const c of report.marketGrade.filter((m) => m.decided >= 30 && m.units < -3).slice(0, 6)) {
    out.push(`${c.key} is leaking: ${c.wins}-${c.losses}, ${c.units}u.`);
  }
  for (const c of report.probability.filter((m) => m.decided >= 30 && m.units < -5).slice(0, 4)) {
    out.push(`Probability bucket ${c.key} is overconfident/negative: ${c.wins}-${c.losses}, ${c.units}u.`);
  }
  for (const c of report.price.filter((m) => m.decided >= 30 && m.units < -5).slice(0, 3)) {
    out.push(`Price bucket ${c.key} is negative: ${c.units}u.`);
  }
  for (const c of report.movement.filter((m) => m.decided >= 25 && m.units < -5).slice(0, 3)) {
    out.push(`Movement cohort ${c.key} is negative: ${c.units}u.`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await loadRows(args);
  const games = uniqueGameRows(rows);
  const totalRows = rows.filter((r) => r.market === "total");
  const report = {
    projection: projectionErrors(games),
    market: summarizeGroups(rows, (r) => r.market, 1),
    marketGrade: summarizeGroups(rows, (r) => `${r.market}::${grade(r)}`, 5),
    probability: summarizeGroups(rows, noVigProbBucket, 1),
    edge: summarizeGroups(rows, edgeBucket, 1),
    price: summarizeGroups(rows, priceBucket, 1),
    movement: summarizeGroups(rows, (r) => `${r.market}::${lineDirection(r)}`, 5),
    feature: summarizeGroups(rows, featureRisk, 1),
    totalAlignment: summarizeGroups(totalRows, (r) => {
      const rawSide = totalProjectionSide(r, predTotal(r));
      const anchoredSide = totalProjectionSide(r, marketAwareTotal(r));
      return `pick=${r.side ?? r.pick}::raw=${rawSide}::anchored=${anchoredSide}`;
    }, 5),
    byDay: summarizeGroups(rows, (r) => r.slate_date, 1),
  };
  const insights = insightBullets(report);
  const payload = { args, generatedAt: new Date().toISOString(), rows: rows.length, games: games.length, report, insights };
  await mkdir(args.outDir, { recursive: true });
  const base = `${args.outDir}/mlb-complete-calibration-audit-${args.from}-to-${args.to}`;
  await writeFile(`${base}.json`, JSON.stringify(payload, null, 2));
  const md = [
    `# MLB Complete Calibration Audit — ${args.from} to ${args.to}`,
    "",
    `Generated: ${payload.generatedAt}`,
    `Rows: ${rows.length}`,
    `Games with score projections: ${games.length}`,
    "",
    "## Projection Accuracy",
    tableError(report.projection),
    "",
    "## By Market",
    tableMetric(report.market),
    "",
    "## By Market + Tracked Grade",
    tableMetric(report.marketGrade),
    "",
    "## Probability Buckets",
    tableMetric(report.probability),
    "",
    "## Edge Buckets",
    tableMetric(report.edge),
    "",
    "## Price Buckets",
    tableMetric(report.price),
    "",
    "## Movement Cohorts",
    tableMetric(report.movement),
    "",
    "## Feature/Input Risk",
    tableMetric(report.feature),
    "",
    "## Total Pick vs Projection Alignment",
    tableMetric(report.totalAlignment),
    "",
    "## Initial Improvement Hypotheses",
    ...(insights.length ? insights.map((i) => `- ${i}`) : ["- No obvious minimum-volume leak found."]),
    "",
  ].join("\n");
  await writeFile(`${base}.md`, md);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Wrote ${base}.md`);
    console.log(`Wrote ${base}.json`);
    console.log(tableError(report.projection));
    console.log("\nInitial improvement hypotheses:");
    for (const i of insights) console.log(`- ${i}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
