/**
 * Immediate Calibration Validation + Fix Plan.
 *
 * Read-only: no DB writes, no production changes, no paid AI.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { supabase } from "../lib/db/supabase";

type Market = "moneyline" | "total" | "first_inning";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";

type RawPrediction = {
  id: number;
  sport: string;
  slate_date: string;
  game_id: number | null;
  matchup: string | null;
  market: string | null;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  launch_day: boolean | null;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
};

type CandidateClass = "production_candidate_now" | "controlled_rollout_candidate" | "needs_integrity_fix_first" | "needs_more_data" | "reject";

const ACTIONABLE = new Set(["Best Angle", "Lean"]);

function parseArgs() {
  const out = { sport: "mlb", from: "2026-06-07", to: todayEt(), outDir: "ops-local/learning-lab", json: false };
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

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeMarket(raw: string | null): Market | null {
  const v = String(raw ?? "").toLowerCase();
  if (v === "moneyline" || v === "ml") return "moneyline";
  if (v === "total" || v === "ou" || v === "over_under") return "total";
  if (v === "first_inning" || v === "fi" || v === "yrfi" || v === "nrfi") return "first_inning";
  return null;
}

function normalizeResult(raw: string | null | undefined): Result {
  const v = String(raw ?? "unknown").toLowerCase();
  if (v === "win" || v === "loss" || v === "push" || v === "void" || v === "pending") return v;
  return "unknown";
}

function grade(raw: RawPrediction): string {
  if (raw.best_angle) return "Best Angle";
  const text = String(raw.play_grade ?? "").toLowerCase().replace(/[_-]/g, " ");
  if (/best/.test(text)) return "Best Angle";
  if (/lean/.test(text)) return "Lean";
  if (/watch/.test(text)) return "Watchlist";
  if (/caution/.test(text)) return "Caution";
  return "No Play";
}

function pct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return +(Math.abs(value) <= 1 ? value * 100 : value).toFixed(4);
}

function impliedPct(price: number | null): number | null {
  if (price === null || price === 0) return null;
  return +(100 * (price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100))).toFixed(4);
}

function units(price: number | null, result: Result): number | null {
  if (result === "void" || result === "push" || result === "pending" || result === "unknown") return 0;
  if (result === "loss") return -1;
  if (result === "win" && price !== null && price !== 0) return +(price > 0 ? price / 100 : 100 / Math.abs(price)).toFixed(4);
  return null;
}

function sideText(row: RawPrediction): string {
  return `${row.pick ?? ""} ${row.side ?? ""}`.toLowerCase();
}

async function loadRows(args: ReturnType<typeof parseArgs>): Promise<RawPrediction[]> {
  const out: RawPrediction[] = [];
  for (let from = 0; from < 6000; from += 750) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,game_id,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,best_angle,no_bet,launch_day,locked_at,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .order("slate_date", { ascending: true })
      .range(from, from + 749);
    if (args.from) query = query.gte("slate_date", args.from);
    if (args.to) query = query.lte("slate_date", args.to);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records load failed: ${error.message}`);
    out.push(...((data ?? []) as RawPrediction[]));
    if ((data ?? []).length < 750) break;
  }
  return out.filter((r) => r.launch_day !== true && normalizeMarket(r.market) !== null);
}

function summarize(rows: RawPrediction[]) {
  const settled = rows.filter((r) => {
    const result = normalizeResult(one(r.prediction_grades)?.result);
    return result === "win" || result === "loss";
  });
  const wins = settled.filter((r) => normalizeResult(one(r.prediction_grades)?.result) === "win").length;
  const losses = settled.length - wins;
  const priced = settled.filter((r) => r.odds_american !== null);
  const net = +priced.reduce((sum, row) => sum + (units(row.odds_american, normalizeResult(one(row.prediction_grades)?.result)) ?? 0), 0).toFixed(4);
  return {
    rows: rows.length,
    settled: settled.length,
    wins,
    losses,
    pricedSettled: priced.length,
    units: net,
    roi: priced.length ? +(net / priced.length).toFixed(4) : null,
    priceCoverage: rows.length ? +(rows.filter((r) => r.odds_american !== null).length / rows.length).toFixed(4) : 0,
    edgeCoverage: rows.length ? +(rows.filter((r) => pct(r.edge) !== null).length / rows.length).toFixed(4) : 0,
    avgModelProbability: avg(rows.map((r) => pct(r.model_probability))),
    avgEdge: avg(rows.map((r) => pct(r.edge))),
  };
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4) : null;
}

function groupRows<T>(rows: T[], keyFn: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) (out[keyFn(row)] ??= []).push(row);
  return out;
}

function marketRows(rows: RawPrediction[], market: Market): RawPrediction[] {
  return rows.filter((r) => normalizeMarket(r.market) === market);
}

async function readJson(path: string): Promise<unknown | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function path(obj: unknown, dotted: string): unknown {
  let cur = obj;
  for (const part of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function candidate(
  id: string,
  title: string,
  classification: CandidateClass,
  exactRule: string,
  evidenceFor: string[],
  evidenceAgainst: string[],
  touches: string[],
  flag: string,
  riskLevel: "low" | "medium" | "high",
  expectedVolumeEffect: string,
  examples: unknown[],
) {
  return {
    id,
    title,
    classification,
    exactRule,
    evidenceFor,
    evidenceAgainst,
    riskLevel,
    rollbackFlag: flag,
    expectedVolumeEffect,
    touches,
    examplesHelpedOrHurt: examples,
  };
}

function buildCandidates(rows: RawPrediction[], integrity: unknown, modelDiag: unknown) {
  const fi = marketRows(rows, "first_inning");
  const total = marketRows(rows, "total");
  const ml = marketRows(rows, "moneyline");
  const fiSummary = summarize(fi);
  const totalReliability = String(path(integrity, "byMarket.total.roiReliability") ?? "unknown");
  const mlReliability = String(path(integrity, "byMarket.moneyline.roiReliability") ?? "unknown");
  const fiReliability = String(path(integrity, "byMarket.first_inning.roiReliability") ?? "unknown");
  const fiTossUps = fi.filter((r) => /toss/.test(sideText(r)));
  const fiMissingPriceActionable = fi.filter((r) => r.odds_american === null && ACTIONABLE.has(grade(r)));
  const fiThinOrNegative = fi.filter((r) => pct(r.edge) !== null && (pct(r.edge) ?? 0) <= 1 && ACTIONABLE.has(grade(r)));
  const totalsThinLean = total.filter((r) => grade(r) === "Lean" && Math.abs((pct(r.edge) ?? 999)) < 3 && r.line_value !== null);
  const mlBand = ml.filter((r) => {
    const p = pct(r.model_probability);
    return p !== null && p >= 60 && p < 70;
  });
  const mlBestAngleRisk = ml.filter((r) => {
    const p = pct(r.model_probability);
    const edge = pct(r.edge);
    return grade(r) === "Best Angle" && p !== null && p >= 60 && p < 70 && r.odds_american !== null && r.odds_american < -110 && (edge ?? 999) < 8;
  });
  const mlShrink = ((path(modelDiag, "candidates.controlled_rollout_candidate") as unknown[]) ?? []).find((x) => path(x, "rule") === "ml_shrink_60_70");
  const out = [
    candidate(
      "fi_tossup_hard_no_play",
      "FI Toss-Up hard No Play",
      "production_candidate_now",
      "If market=first_inning and pick/side is Toss-Up, public Play Grade must be No Play and copy must say no actionable YRFI/NRFI side.",
      [
        `Toss-Up rows found: ${fiTossUps.length}.`,
        "This rule depends on side/actionability semantics, not ROI.",
        "Toss-Up means the model did not choose YRFI or NRFI; it should never strengthen into an actionable grade.",
      ],
      [
        "Does not improve non-Toss-Up FI rows.",
        "Requires a small guard in future grade generation, not historical row mutation.",
      ],
      ["actual Play Grade for future unlocked FI Toss-Up only", "copy"],
      "MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED",
      "low",
      "Tiny; only FI Toss-Up rows lose accidental actionability.",
      fiTossUps.slice(0, 8).map(example),
    ),
    candidate(
      "fi_missing_price_blocks_grade_strengthening",
      "FI missing price blocks grade strengthening",
      "production_candidate_now",
      "If market=first_inning and price is missing/unavailable, do not allow grade strengthening above Watchlist; copy may explain model/stat lean.",
      [
        `FI price coverage: ${(fiSummary.priceCoverage * 100).toFixed(1)}%.`,
        `Actionable FI rows with missing price: ${fiMissingPriceActionable.length}.`,
        "This is a value/actionability rule; it does not require reliable FI ROI.",
      ],
      [
        "Could suppress a valid model lean when price arrives late but mapping misses it.",
        "Should be paired with persistence repair so the cap self-resolves when price appears.",
      ],
      ["grade alignment for future unlocked FI only", "copy"],
      "MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED",
      "low",
      "Low; only FI rows missing required price context are capped.",
      fiMissingPriceActionable.slice(0, 8).map(example),
    ),
    candidate(
      "fi_negative_thin_price_edge_cap",
      "FI negative/thin price edge cap",
      fiReliability === "reliable" ? "controlled_rollout_candidate" : "needs_integrity_fix_first",
      "If FI edge is negative or near zero at the current locked price, cap at No Play/Watchlist; if price worse than -150, require stronger edge for Lean.",
      [
        `FI thin/negative actionable rows: ${fiThinOrNegative.length}.`,
        `FI ROI reliability: ${fiReliability}.`,
      ],
      [
        "FI price/edge/line-history persistence has been weaker than ML/Totals.",
        "Do not use FI ROI alone until integrity remains clean over a larger sample.",
      ],
      ["grade alignment for future unlocked FI only", "copy"],
      "MLB_FI_NEGATIVE_THIN_EDGE_CAP_ENABLED",
      "medium",
      "Moderate; would cap FI rows where price/value is not actually actionable.",
      fiThinOrNegative.slice(0, 8).map(example),
    ),
    candidate(
      "totals_thin_gap_lean_cap",
      "Totals Lean thin projection-gap cap",
      totalReliability === "reliable" || totalReliability === "usable_with_caution" ? "controlled_rollout_candidate" : "needs_integrity_fix_first",
      "Totals Lean with projection gap/edge below threshold cannot stay Lean unless market/price evidence strongly overrides; otherwise cap to Watchlist or Caution.",
      [
        `Totals ROI reliability: ${totalReliability}.`,
        `Thin Totals Lean rows in this audit: ${totalsThinLean.length}.`,
        "Prior Learning Lab showed full/train/validation improvement but holdout was slightly negative, so this is not a same-day hard production rule.",
      ],
      [
        "Holdout was not clearly positive.",
        "Needs combined conditions: thin edge plus neutral/against movement plus no support, not a blanket demotion.",
      ],
      ["grade alignment warning or future cap", "copy"],
      "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED",
      "medium",
      "Moderate; primarily moves weak Totals Leans to Watchlist/Caution.",
      totalsThinLean.slice(0, 8).map(example),
    ),
    candidate(
      "ml_probability_band_grade_cap",
      "ML 60-70 probability band grade/value cap",
      mlShrink && (mlReliability === "reliable" || mlReliability === "usable_with_caution") ? "controlled_rollout_candidate" : "needs_more_data",
      "For ML model probability 60-70%, apply grade/value caution when price is heavy or line movement is not supportive; do not mutate model probability in production yet.",
      [
        `Rows in 60-70% ML band: ${mlBand.length}.`,
        `Model diagnostic candidate: ${mlShrink ? "ml_shrink_60_70 improved Brier/ECE" : "not available"}.`,
        `ML ROI reliability: ${mlReliability}.`,
      ],
      [
        "This should not be a production probability mutation yet.",
        "Best use today is grade-alignment/capping logic with kill switch.",
      ],
      ["grade alignment for future unlocked ML only", "copy"],
      "MLB_ML_PROBABILITY_BAND_GRADE_CAP_ENABLED",
      "medium",
      "Moderate; only ML plays in overconfidence band with price/market friction get capped/reviewed.",
      mlBestAngleRisk.slice(0, 8).map(example),
    ),
  ];
  return {
    production_candidate_now: out.filter((x) => x.classification === "production_candidate_now"),
    controlled_rollout_candidate: out.filter((x) => x.classification === "controlled_rollout_candidate"),
    needs_integrity_fix_first: out.filter((x) => x.classification === "needs_integrity_fix_first"),
    needs_more_data: out.filter((x) => x.classification === "needs_more_data"),
    reject: out.filter((x) => x.classification === "reject"),
    all: out,
  };
}

function example(row: RawPrediction) {
  return {
    id: row.id,
    date: row.slate_date,
    matchup: row.matchup,
    market: normalizeMarket(row.market),
    pick: row.pick,
    side: row.side,
    grade: grade(row),
    price: row.odds_american,
    line: row.line_value,
    modelProbability: pct(row.model_probability),
    marketProbability: pct(row.market_probability) ?? impliedPct(row.odds_american),
    edge: pct(row.edge),
    result: normalizeResult(one(row.prediction_grades)?.result),
  };
}

function buildReport(rows: RawPrediction[], integrity: unknown, modelDiag: unknown, args: ReturnType<typeof parseArgs>) {
  const byMarket = {
    moneyline: summarize(marketRows(rows, "moneyline")),
    total: summarize(marketRows(rows, "total")),
    first_inning: summarize(marketRows(rows, "first_inning")),
  };
  const candidates = buildCandidates(rows, integrity, modelDiag);
  return {
    generatedAt: new Date().toISOString(),
    noCost: true,
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    args,
    integritySource: integrity ? "ops-local/learning-lab/mlb-grading-integrity-audit.json" : "not_found_run_grading_integrity_audit_first",
    modelDiagnosticSource: modelDiag ? "ops-local/learning-lab/mlb-projection-model-diagnostic-v1.json" : "not_found_run_model_diagnostic_first",
    metricTrust: path(integrity, "metricTrust") ?? {
      note: "Integrity report not found; run learning-lab:grading-integrity-audit first.",
    },
    marketSummaries: byMarket,
    candidates,
    recommendedNextChanges: [
      "Candidate A is safe for production approval today behind MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED.",
      "Candidate B is safe for production approval today behind MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED.",
      "Candidate C should wait for FI price/edge integrity to stay clean.",
      "Candidate D should be controlled rollout/admin-review first, not blanket production demotion.",
      "Candidate E should be grade/value cap review only; do not mutate ML probabilities in production yet.",
    ],
    killSwitchFlags: [
      "MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED",
      "MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED",
      "MLB_FI_NEGATIVE_THIN_EDGE_CAP_ENABLED",
      "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED",
      "MLB_ML_PROBABILITY_BAND_GRADE_CAP_ENABLED",
    ],
    productionSafeNow: candidates.production_candidate_now.map((x) => x.id),
  };
}

function markdown(report: ReturnType<typeof buildReport>): string {
  return `# MLB Immediate Calibration Validation + Fix Plan

Generated: ${report.generatedAt}

Read-only: no DB writes, no production changes, no paid AI.

## Metric Trust

\`\`\`json
${JSON.stringify(report.metricTrust, null, 2)}
\`\`\`

## Candidate Classification

- production_candidate_now: ${report.candidates.production_candidate_now.map((x) => x.id).join(", ") || "none"}
- controlled_rollout_candidate: ${report.candidates.controlled_rollout_candidate.map((x) => x.id).join(", ") || "none"}
- needs_integrity_fix_first: ${report.candidates.needs_integrity_fix_first.map((x) => x.id).join(", ") || "none"}
- needs_more_data: ${report.candidates.needs_more_data.map((x) => x.id).join(", ") || "none"}
- reject: ${report.candidates.reject.map((x) => x.id).join(", ") || "none"}

## Recommended Next Changes

${report.recommendedNextChanges.map((x) => `- ${x}`).join("\n")}

## Kill Switch Flags

${report.killSwitchFlags.map((x) => `- ${x}=false`).join("\n")}

## Full Candidates

${report.candidates.all.map((x) => `### ${x.title}

- Class: ${x.classification}
- Rule: ${x.exactRule}
- Flag: ${x.rollbackFlag}
- Risk: ${x.riskLevel}
- Volume: ${x.expectedVolumeEffect}
- Touches: ${x.touches.join(", ")}
- Evidence for: ${x.evidenceFor.join(" ")}
- Evidence against: ${x.evidenceAgainst.join(" ")}
`).join("\n")}
`;
}

async function main() {
  const args = parseArgs();
  const rows = await loadRows(args);
  const integrity = await readJson(`${args.outDir}/mlb-grading-integrity-audit.json`);
  const modelDiag = await readJson(`${args.outDir}/mlb-projection-model-diagnostic-v1.json`);
  const report = buildReport(rows, integrity, modelDiag, args);
  await mkdir(args.outDir, { recursive: true });
  const jsonPath = `${args.outDir}/mlb-immediate-calibration-fix-plan.json`;
  const mdPath = `${args.outDir}/mlb-immediate-calibration-fix-plan.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown(report), "utf8");
  if (args.json) {
    console.log(JSON.stringify({
      output: { jsonPath, mdPath },
      metricTrust: report.metricTrust,
      marketSummaries: report.marketSummaries,
      candidateCounts: {
        production_candidate_now: report.candidates.production_candidate_now.length,
        controlled_rollout_candidate: report.candidates.controlled_rollout_candidate.length,
        needs_integrity_fix_first: report.candidates.needs_integrity_fix_first.length,
        needs_more_data: report.candidates.needs_more_data.length,
        reject: report.candidates.reject.length,
      },
      candidates: report.candidates,
      productionSafeNow: report.productionSafeNow,
      killSwitchFlags: report.killSwitchFlags,
      recommendedNextChanges: report.recommendedNextChanges,
    }, null, 2));
    return;
  }
  console.log(`Immediate fix plan written:\n- ${jsonPath}\n- ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
