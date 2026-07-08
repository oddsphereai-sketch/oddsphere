/**
 * Launch-window calibration audit.
 *
 * Read-only. Produces JSON + Markdown reports under ops-local/learning-lab.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "@/lib/db/supabase";
import { effectiveTrackingPlayGrade } from "@/lib/services/trackingAggregateService";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";

type Args = {
  sport: string;
  from: string;
  to: string;
  outDir: string;
  json: boolean;
};

type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";

type Row = PredictionRecordRow & {
  prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
};

type Cohort = {
  key: string;
  rows: number;
  decided: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number | null;
  pricedDecided: number;
  units: number;
  roi: number | null;
  avgModelProb: number | null;
  avgEdge: number | null;
  brier: number | null;
  logLoss: number | null;
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
  const out: Args = {
    sport: "mlb",
    from: "2026-06-07",
    to: todayEt(),
    outDir: "ops-local/learning-lab",
    json: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") out.json = true;
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "sport") out.sport = value.toLowerCase();
    if (key === "from") out.from = value;
    if (key === "to") out.to = value === "today" ? todayEt() : value;
    if (key === "out-dir") out.outDir = value;
  }
  return out;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function result(row: Row): Result {
  const raw = String(one(row.prediction_grades)?.result ?? "unknown").toLowerCase();
  if (raw === "win" || raw === "loss" || raw === "push" || raw === "void" || raw === "pending") return raw;
  return "unknown";
}

function units(price: number | null | undefined, res: Result): number {
  if (res === "loss") return -1;
  if (res !== "win") return 0;
  if (typeof price !== "number" || !Number.isFinite(price) || price === 0) return 0;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function pct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length, 3) : null;
}

function round(value: number, places = 2): number {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

function grade(row: Row): string {
  return effectiveTrackingPlayGrade(row).replace(/_/g, " ") || "(none)";
}

function snap(row: Row): Record<string, unknown> {
  return row.snapshot_json && typeof row.snapshot_json === "object" ? row.snapshot_json as Record<string, unknown> : {};
}

function v22(row: Row): Record<string, unknown> {
  const s = snap(row);
  return s.v2_2_audit && typeof s.v2_2_audit === "object" ? s.v2_2_audit as Record<string, unknown> : {};
}

function lineDirection(row: Row): string {
  const lm = snap(row).line_movement;
  if (lm && typeof lm === "object" && typeof (lm as Record<string, unknown>).direction === "string") {
    return (lm as Record<string, unknown>).direction as string;
  }
  return "unknown";
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

function probBucket(row: Row): string {
  const p = pct(row.model_probability);
  if (p === null) return "missing";
  if (p < 50) return "<50";
  if (p < 53) return "50-53";
  if (p < 56) return "53-56";
  if (p < 60) return "56-60";
  if (p < 65) return "60-65";
  if (p < 70) return "65-70";
  return "70+";
}

function edgeBucket(row: Row): string {
  const e = Math.abs(pct(row.edge) ?? Number.NaN);
  if (!Number.isFinite(e)) return "missing";
  if (e < 1) return "<1pp";
  if (e < 3) return "1-3pp";
  if (e < 5) return "3-5pp";
  if (e < 8) return "5-8pp";
  return "8pp+";
}

function dataQuality(row: Row): string {
  return row.data_quality_tier ?? String(v22(row).data_quality_tier ?? "(none)");
}

function featureRisk(row: Row): string {
  const codes = v22(row).feature_reason_codes;
  const text = Array.isArray(codes) ? codes.join(" ") : "";
  if (/missing/.test(text)) return "has_missing_inputs";
  if (/fallback|proxy/.test(text)) return "has_fallback_or_proxy";
  return "cleaner_inputs";
}

async function loadRows(args: Args): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 750) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("*,prediction_grades(result)")
      .eq("sport", args.sport)
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

function summarize(key: string, rows: Row[]): Cohort {
  const decidedRows = rows.filter((r) => result(r) === "win" || result(r) === "loss");
  const pricedDecided = decidedRows.filter((r) => r.odds_american !== null);
  const wins = decidedRows.filter((r) => result(r) === "win").length;
  const losses = decidedRows.filter((r) => result(r) === "loss").length;
  const pushes = rows.filter((r) => result(r) === "push").length;
  let brierSum = 0;
  let logLossSum = 0;
  let calibrationN = 0;
  for (const row of decidedRows) {
    if (row.model_probability === null || row.model_probability <= 0 || row.model_probability >= 1) continue;
    const outcome = result(row) === "win" ? 1 : 0;
    const p = row.model_probability;
    brierSum += (p - outcome) * (p - outcome);
    const pc = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
    logLossSum += -(outcome * Math.log(pc) + (1 - outcome) * Math.log(1 - pc));
    calibrationN++;
  }
  const net = pricedDecided.reduce((sum, row) => sum + units(row.odds_american, result(row)), 0);
  return {
    key,
    rows: rows.length,
    decided: decidedRows.length,
    wins,
    losses,
    pushes,
    winPct: decidedRows.length ? round((wins / decidedRows.length) * 100, 1) : null,
    pricedDecided: pricedDecided.length,
    units: round(net, 2),
    roi: pricedDecided.length ? round(net / pricedDecided.length, 3) : null,
    avgModelProb: avg(rows.map((r) => pct(r.model_probability))),
    avgEdge: avg(rows.map((r) => pct(r.edge))),
    brier: calibrationN ? round(brierSum / calibrationN, 4) : null,
    logLoss: calibrationN ? round(logLossSum / calibrationN, 4) : null,
  };
}

function group(rows: Row[], keyFn: (row: Row) => string): Cohort[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => summarize(key, rs))
    .sort((a, b) => b.decided - a.decided);
}

function worst(cohorts: Cohort[], minDecided: number): Cohort[] {
  return cohorts
    .filter((c) => c.decided >= minDecided)
    .sort((a, b) => a.units - b.units)
    .slice(0, 8);
}

function markdownTable(rows: Cohort[]): string {
  const header = "| Cohort | Decided | W-L | Win% | Units | ROI | Avg Prob | Avg Edge | Brier |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|";
  return [header, ...rows.map((r) =>
    `| ${r.key} | ${r.decided} | ${r.wins}-${r.losses} | ${r.winPct ?? "-"} | ${r.units} | ${r.roi ?? "-"} | ${r.avgModelProb ?? "-"} | ${r.avgEdge ?? "-"} | ${r.brier ?? "-"} |`
  )].join("\n");
}

function candidates(report: Record<string, Cohort[]>): string[] {
  const out: string[] = [];
  const gradeBad = worst(report.byMarketGrade, 20).filter((c) => c.units < 0);
  for (const c of gradeBad.slice(0, 4)) out.push(`Review grade cohort ${c.key}: ${c.wins}-${c.losses}, ${c.units}u.`);
  const lineBad = worst(report.byLineDirection, 20).filter((c) => c.units < 0);
  for (const c of lineBad.slice(0, 3)) out.push(`Consider movement correction for ${c.key}: ${c.wins}-${c.losses}, ${c.units}u.`);
  const priceBad = worst(report.byPriceBucket, 20).filter((c) => c.units < 0);
  for (const c of priceBad.slice(0, 3)) out.push(`Price bucket underperforming: ${c.key}, ${c.units}u.`);
  const inputBad = worst(report.byFeatureRisk, 20).filter((c) => c.units < 0);
  for (const c of inputBad.slice(0, 3)) out.push(`Input-quality cohort underperforming: ${c.key}, ${c.units}u.`);
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await loadRows(args);
  const report = {
    overall: [summarize("overall", rows)],
    byMarket: group(rows, (r) => r.market),
    byGrade: group(rows, grade),
    byMarketGrade: group(rows, (r) => `${r.market}::${grade(r)}`),
    bySide: group(rows, (r) => `${r.market}::${r.side ?? r.pick ?? "none"}`),
    byProbabilityBucket: group(rows, probBucket),
    byEdgeBucket: group(rows, edgeBucket),
    byPriceBucket: group(rows, priceBucket),
    byLineDirection: group(rows, (r) => `${r.market}::${lineDirection(r)}`),
    byDataQuality: group(rows, dataQuality),
    byFeatureRisk: group(rows, featureRisk),
    byDay: group(rows, (r) => r.slate_date),
  };
  const findings = candidates(report);
  const payload = { args, generatedAt: new Date().toISOString(), rows: rows.length, report, findings };
  await mkdir(args.outDir, { recursive: true });
  const base = `${args.outDir}/launch-calibration-audit-${args.sport}-${args.from}-to-${args.to}`;
  await writeFile(`${base}.json`, JSON.stringify(payload, null, 2));
  const md = [
    `# Launch Calibration Audit — ${args.sport.toUpperCase()} ${args.from} to ${args.to}`,
    "",
    `Generated: ${payload.generatedAt}`,
    `Rows: ${rows.length}`,
    "",
    "## Overall",
    markdownTable(report.overall),
    "",
    "## By Market",
    markdownTable(report.byMarket),
    "",
    "## By Market + Grade",
    markdownTable(report.byMarketGrade.filter((c) => c.decided >= 5)),
    "",
    "## Probability Buckets",
    markdownTable(report.byProbabilityBucket),
    "",
    "## Edge Buckets",
    markdownTable(report.byEdgeBucket),
    "",
    "## Line Movement",
    markdownTable(report.byLineDirection.filter((c) => c.decided >= 5)),
    "",
    "## Input Quality",
    markdownTable(report.byFeatureRisk),
    "",
    "## Candidate Follow-Ups",
    ...(findings.length ? findings.map((f) => `- ${f}`) : ["- No minimum-volume negative cohorts found."]),
    "",
  ].join("\n");
  await writeFile(`${base}.md`, md);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Wrote ${base}.md`);
    console.log(`Wrote ${base}.json`);
    console.log(markdownTable(report.overall));
    console.log("\nTop follow-ups:");
    for (const f of findings.slice(0, 8)) console.log(`- ${f}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
