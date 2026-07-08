/**
 * MLB truthful-edge audit.
 *
 * Read-only. Compares our published side probability against market-implied
 * probability to find where the model is genuinely more predictive than the
 * market, where it is overconfident, and which model/market blend calibrates
 * best by cohort.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "@/lib/db/supabase";
import { effectiveTrackingPlayGrade } from "@/lib/services/trackingAggregateService";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";

type GradeJoin = { result: string | null };
type Row = PredictionRecordRow & {
  prediction_grades: GradeJoin | GradeJoin[] | null;
};

type Args = {
  from: string;
  to: string;
  outDir: string;
  json: boolean;
};

type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";

type Cohort = {
  key: string;
  rows: number;
  decided: number;
  wins: number;
  losses: number;
  units: number;
  roi: number | null;
  winPct: number | null;
  avgModelProb: number | null;
  avgMarketProb: number | null;
  avgClaimedEdge: number | null;
  observedLiftVsMarket: number | null;
  edgeRealization: number | null;
  modelCalibrationGap: number | null;
  marketCalibrationGap: number | null;
  modelBrier: number | null;
  marketBrier: number | null;
  brierEdge: number | null;
  modelLogLoss: number | null;
  marketLogLoss: number | null;
  bestBlendWeight: number | null;
  bestBlendBrier: number | null;
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

function result(row: Row): Result {
  const raw = String(one(row.prediction_grades)?.result ?? "unknown").toLowerCase();
  if (raw === "win" || raw === "loss" || raw === "push" || raw === "void" || raw === "pending") return raw;
  return "unknown";
}

function outcome(row: Row): number | null {
  const r = result(row);
  if (r === "win") return 1;
  if (r === "loss") return 0;
  return null;
}

function units(row: Row): number {
  const r = result(row);
  if (r === "loss") return -1;
  if (r !== "win") return 0;
  const p = row.odds_american;
  if (typeof p !== "number" || !Number.isFinite(p) || p === 0) return 0;
  return p > 0 ? p / 100 : 100 / Math.abs(p);
}

function implied(odds: number | null | undefined): number | null {
  if (typeof odds !== "number" || !Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function prob01(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  if (value >= 0 && value <= 1) return value;
  return null;
}

function avg(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function snap(row: Row): Record<string, unknown> {
  return row.snapshot_json && typeof row.snapshot_json === "object" ? row.snapshot_json as Record<string, unknown> : {};
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function grade(row: Row): string {
  return effectiveTrackingPlayGrade(row).replace(/_/g, " ") || "(none)";
}

function marketProb(row: Row): number | null {
  return prob01(row.market_probability) ?? implied(row.odds_american);
}

function modelProb(row: Row): number | null {
  return prob01(row.model_probability);
}

function claimedEdge(row: Row): number | null {
  const stored = prob01(row.edge);
  if (stored !== null) return Math.abs(stored);
  const model = modelProb(row);
  const market = marketProb(row);
  return model !== null && market !== null ? model - market : null;
}

function lineDirection(row: Row): string {
  return String(obj(snap(row).line_movement).direction ?? "unknown");
}

function featureCodes(row: Row): string {
  const codes = obj(snap(row).v2_2_audit).feature_reason_codes;
  return Array.isArray(codes) ? codes.join(" ") : "";
}

function featureRisk(row: Row): string {
  const codes = featureCodes(row);
  if (/missing/i.test(codes)) return "missing_inputs";
  if (/fallback|proxy/i.test(codes)) return "fallback_or_proxy";
  return "cleaner_inputs";
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

function edgeBucket(row: Row): string {
  const e = claimedEdge(row);
  if (e === null) return "missing";
  const pp = Math.abs(e) * 100;
  if (pp < 1) return "<1pp";
  if (pp < 3) return "1-3pp";
  if (pp < 5) return "3-5pp";
  if (pp < 8) return "5-8pp";
  return "8pp+";
}

function modelMarketGapBucket(row: Row): string {
  const model = modelProb(row);
  const market = marketProb(row);
  if (model === null || market === null) return "missing";
  const pp = (model - market) * 100;
  if (pp < 0) return "model_below_market";
  if (pp < 2) return "0-2pp";
  if (pp < 5) return "2-5pp";
  if (pp < 8) return "5-8pp";
  return "8pp+";
}

function clv(row: Row): number | null {
  const s = snap(row);
  const paths = [
    ["clv_pct"],
    ["clv", "clv_pct"],
    ["clv", "clvPct"],
    ["closing_line_value", "clv_pct"],
    ["closing_line_value", "clvPct"],
    ["closingLineValue", "clvPct"],
  ];
  for (const path of paths) {
    let current: unknown = s;
    for (const part of path) current = obj(current)[part];
    if (typeof current === "number" && Number.isFinite(current)) return current;
  }
  return null;
}

function clvBucket(row: Row): string {
  const v = clv(row);
  if (v === null) return "clv_missing";
  if (v > 5) return "beat_close_5pp+";
  if (v > 0) return "beat_close_0-5pp";
  if (v < -5) return "lost_close_5pp+";
  if (v < 0) return "lost_close_0-5pp";
  return "no_clv_move";
}

function logLoss(p: number, y: number): number {
  const bounded = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return -(y * Math.log(bounded) + (1 - y) * Math.log(1 - bounded));
}

function blendProb(model: number, market: number, weight: number): number {
  return market + weight * (model - market);
}

function summarize(key: string, rows: Row[]): Cohort {
  const decided = rows.filter((row) => outcome(row) !== null && modelProb(row) !== null && marketProb(row) !== null);
  const wins = decided.filter((row) => result(row) === "win").length;
  const losses = decided.filter((row) => result(row) === "loss").length;
  const actual = decided.length ? wins / decided.length : null;
  const avgModel = avg(decided.map(modelProb));
  const avgMarket = avg(decided.map(marketProb));
  const avgEdge = avg(decided.map(claimedEdge));
  let modelBrier = 0;
  let marketBrier = 0;
  let modelLl = 0;
  let marketLl = 0;
  const blendBriers = new Map<number, number>();
  for (let i = 0; i <= 10; i++) blendBriers.set(i / 10, 0);

  for (const row of decided) {
    const y = outcome(row);
    const model = modelProb(row);
    const market = marketProb(row);
    if (y === null || model === null || market === null) continue;
    modelBrier += (model - y) ** 2;
    marketBrier += (market - y) ** 2;
    modelLl += logLoss(model, y);
    marketLl += logLoss(market, y);
    for (const weight of blendBriers.keys()) {
      const p = blendProb(model, market, weight);
      blendBriers.set(weight, (blendBriers.get(weight) ?? 0) + (p - y) ** 2);
    }
  }

  let bestBlendWeight: number | null = null;
  let bestBlendBrier: number | null = null;
  for (const [weight, score] of blendBriers) {
    const brier = decided.length ? score / decided.length : null;
    if (brier === null) continue;
    if (bestBlendBrier === null || brier < bestBlendBrier) {
      bestBlendBrier = brier;
      bestBlendWeight = weight;
    }
  }

  const net = decided.reduce((sum, row) => sum + units(row), 0);
  const observedLift = actual !== null && avgMarket !== null ? actual - avgMarket : null;
  const claimedLift = avgModel !== null && avgMarket !== null ? avgModel - avgMarket : null;
  const edgeRealization = observedLift !== null && claimedLift !== null && Math.abs(claimedLift) > 0.0001
    ? observedLift / claimedLift
    : null;

  return {
    key,
    rows: rows.length,
    decided: decided.length,
    wins,
    losses,
    units: round(net, 2),
    roi: decided.length ? round(net / decided.length, 3) : null,
    winPct: actual !== null ? round(actual * 100, 1) : null,
    avgModelProb: avgModel !== null ? round(avgModel * 100, 2) : null,
    avgMarketProb: avgMarket !== null ? round(avgMarket * 100, 2) : null,
    avgClaimedEdge: avgEdge !== null ? round(avgEdge * 100, 2) : null,
    observedLiftVsMarket: observedLift !== null ? round(observedLift * 100, 2) : null,
    edgeRealization: edgeRealization !== null ? round(edgeRealization, 2) : null,
    modelCalibrationGap: actual !== null && avgModel !== null ? round((actual - avgModel) * 100, 2) : null,
    marketCalibrationGap: actual !== null && avgMarket !== null ? round((actual - avgMarket) * 100, 2) : null,
    modelBrier: decided.length ? round(modelBrier / decided.length, 4) : null,
    marketBrier: decided.length ? round(marketBrier / decided.length, 4) : null,
    brierEdge: decided.length ? round((marketBrier - modelBrier) / decided.length, 4) : null,
    modelLogLoss: decided.length ? round(modelLl / decided.length, 4) : null,
    marketLogLoss: decided.length ? round(marketLl / decided.length, 4) : null,
    bestBlendWeight,
    bestBlendBrier: bestBlendBrier !== null ? round(bestBlendBrier, 4) : null,
  };
}

function group(rows: Row[], keyFn: (row: Row) => string): Cohort[] {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFn(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()]
    .map(([key, rs]) => summarize(key, rs))
    .sort((a, b) => b.decided - a.decided);
}

function markdownTable(rows: Cohort[]): string {
  const header = "| Cohort | Decided | W-L | Units | ROI | Win% | Model% | Market% | Edge | Lift | Realized | Brier Edge | Best Blend |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  return [header, ...rows.map((r) =>
    `| ${r.key} | ${r.decided} | ${r.wins}-${r.losses} | ${r.units} | ${r.roi ?? "-"} | ${r.winPct ?? "-"} | ${r.avgModelProb ?? "-"} | ${r.avgMarketProb ?? "-"} | ${r.avgClaimedEdge ?? "-"} | ${r.observedLiftVsMarket ?? "-"} | ${r.edgeRealization ?? "-"} | ${r.brierEdge ?? "-"} | ${r.bestBlendWeight ?? "-"} |`
  )].join("\n");
}

function findings(report: Record<string, Cohort[]>): string[] {
  const out: string[] = [];
  const realEdges = report.byMarketGap
    .filter((c) => c.decided >= 20 && (c.brierEdge ?? 0) > 0 && (c.observedLiftVsMarket ?? 0) > 0)
    .sort((a, b) => (b.brierEdge ?? 0) - (a.brierEdge ?? 0));
  for (const c of realEdges.slice(0, 4)) {
    out.push(`Real edge candidate ${c.key}: model beat market by Brier ${c.brierEdge}, observed lift ${c.observedLiftVsMarket}pp, ${c.units}u.`);
  }

  const fakeEdges = report.byMarketGap
    .filter((c) => c.decided >= 20 && (c.avgClaimedEdge ?? 0) >= 2 && ((c.observedLiftVsMarket ?? 0) <= 0 || (c.brierEdge ?? 0) <= 0))
    .sort((a, b) => a.units - b.units);
  for (const c of fakeEdges.slice(0, 5)) {
    out.push(`Correction candidate ${c.key}: claimed edge ${c.avgClaimedEdge}pp, observed lift ${c.observedLiftVsMarket}pp, Brier edge ${c.brierEdge}, ${c.units}u.`);
  }

  const blends = report.byMarket
    .filter((c) => c.decided >= 30 && c.bestBlendWeight !== null)
    .map((c) => `${c.key}: best blend weight ${c.bestBlendWeight} where 0=market and 1=model`);
  out.push(...blends);
  return out;
}

async function loadRows(args: Args): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 750) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("*,prediction_grades(result)")
      .eq("sport", "mlb")
      .gte("slate_date", args.from)
      .lte("slate_date", args.to)
      .order("slate_date", { ascending: true })
      .range(from, from + 749);
    if (error) throw new Error(`prediction_records query failed: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 750) break;
  }
  return out.filter((row) => row.launch_day !== true && row.no_bet !== true);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await loadRows(args);
  const report = {
    overall: [summarize("overall", rows)],
    byMarket: group(rows, (r) => String(r.market ?? "unknown")),
    byMarketGrade: group(rows, (r) => `${r.market ?? "unknown"}::${grade(r)}`),
    byMarketGap: group(rows, (r) => `${r.market ?? "unknown"}::gap=${modelMarketGapBucket(r)}`),
    byEdgeBucket: group(rows, (r) => `${r.market ?? "unknown"}::edge=${edgeBucket(r)}`),
    byPrice: group(rows, (r) => `${r.market ?? "unknown"}::price=${priceBucket(r)}`),
    byMovement: group(rows, (r) => `${r.market ?? "unknown"}::move=${lineDirection(r)}`),
    byFeatureRisk: group(rows, (r) => `${r.market ?? "unknown"}::${featureRisk(r)}`),
    byClv: group(rows, (r) => `${r.market ?? "unknown"}::${clvBucket(r)}`),
  };
  const payload = { args, generatedAt: new Date().toISOString(), rows: rows.length, report, findings: findings(report) };
  await mkdir(args.outDir, { recursive: true });
  const base = `${args.outDir}/mlb-truthful-edge-audit-${args.from}-to-${args.to}`;
  await writeFile(`${base}.json`, JSON.stringify(payload, null, 2));
  const md = [
    `# MLB Truthful Edge Audit — ${args.from} to ${args.to}`,
    "",
    `Generated: ${payload.generatedAt}`,
    `Rows: ${rows.length}`,
    "",
    "Brier Edge is market Brier minus model Brier. Positive means the model probability was more predictive than the market probability for the published side.",
    "Best Blend is the weight on model probability in `market + weight * (model - market)`. 0 means pure market, 1 means pure model.",
    "",
    "## Overall",
    markdownTable(report.overall),
    "",
    "## By Market",
    markdownTable(report.byMarket),
    "",
    "## Model vs Market Gap",
    markdownTable(report.byMarketGap.filter((c) => c.decided >= 10)),
    "",
    "## Market + Grade",
    markdownTable(report.byMarketGrade.filter((c) => c.decided >= 10)),
    "",
    "## Edge Buckets",
    markdownTable(report.byEdgeBucket.filter((c) => c.decided >= 10)),
    "",
    "## Price",
    markdownTable(report.byPrice.filter((c) => c.decided >= 10)),
    "",
    "## Movement",
    markdownTable(report.byMovement.filter((c) => c.decided >= 10)),
    "",
    "## Input Quality",
    markdownTable(report.byFeatureRisk.filter((c) => c.decided >= 10)),
    "",
    "## CLV",
    markdownTable(report.byClv.filter((c) => c.decided >= 10)),
    "",
    "## Findings",
    ...(payload.findings.length ? payload.findings.map((f) => `- ${f}`) : ["- No minimum-volume truthful-edge findings yet."]),
    "",
  ].join("\n");
  await writeFile(`${base}.md`, md);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Wrote ${base}.md`);
    console.log(`Wrote ${base}.json`);
    console.log(markdownTable(report.overall));
    console.log("\nFindings:");
    for (const f of payload.findings.slice(0, 10)) console.log(`- ${f}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
