/**
 * MLB grading / ROI / units integrity audit.
 *
 * Read-only: no DB writes, no production changes, no paid AI.
 */
import { mkdir, writeFile } from "node:fs/promises";
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

type Game = {
  id: number;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  total_runs: number | null;
  first_inning_runs: number | null;
};

type LineHistoryRow = {
  game_id: number | null;
  market_type: string | null;
  side: string | null;
  odds_american: number | null;
  line_value: number | null;
  recorded_at: string | null;
  created_at: string | null;
};

type AuditRow = {
  id: number;
  date: string;
  market: Market;
  matchup: string;
  pick: string | null;
  side: string | null;
  grade: string;
  line: number | null;
  lockedPrice: number | null;
  priceSource: string;
  priceUsedForUnits: number | null;
  impliedProbability: number | null;
  modelProbability: number | null;
  edge: number | null;
  lockedSnapshot: boolean;
  lineHistoryCoverage: boolean;
  storedResult: Result;
  recomputedResult: Result;
  resultMatches: boolean | null;
  recomputedUnits: number | null;
  unitReliability: "priced" | "missing_price_win" | "missing_price_loss_assumed_stake" | "not_settled";
  missingReasons: string[];
};

const MARKETS: Market[] = ["moneyline", "total", "first_inning"];

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

function gradeLabel(raw: RawPrediction): string {
  if (raw.best_angle) return "Best Angle";
  const text = String(raw.play_grade ?? "").toLowerCase().replace(/[_-]/g, " ");
  if (/lean/.test(text)) return "Lean";
  if (/watch/.test(text)) return "Watchlist";
  if (/caution/.test(text)) return "Caution";
  if (/best/.test(text)) return "Best Angle";
  return raw.no_bet ? "No Play" : raw.play_grade ?? "No Play";
}

function parseMatchup(matchup: string | null): { away: string | null; home: string | null } {
  const text = String(matchup ?? "");
  const m = text.match(/^\s*([A-Z0-9]{2,4})\s*@\s*([A-Z0-9]{2,4})\s*$/i);
  return { away: m?.[1]?.toUpperCase() ?? null, home: m?.[2]?.toUpperCase() ?? null };
}

function recomputeResult(row: RawPrediction, market: Market, game: Game | null): Result {
  if (!game) return "unknown";
  const status = String(game.status ?? "").toLowerCase();
  if (!/(final|completed|closed|graded)/.test(status) && game.home_score === null && game.away_score === null) return "pending";
  const sidePick = `${row.side ?? ""} ${row.pick ?? ""}`.toLowerCase();
  if (market === "moneyline") {
    if (game.away_score === null || game.home_score === null) return "unknown";
    if (game.away_score === game.home_score) return "push";
    const winner = game.away_score > game.home_score ? "away" : "home";
    const teams = parseMatchup(row.matchup);
    const pick = String(row.pick ?? row.side ?? "").toUpperCase();
    const pickedWinner =
      sidePick.includes(winner) ||
      (winner === "away" && teams.away !== null && pick.includes(teams.away)) ||
      (winner === "home" && teams.home !== null && pick.includes(teams.home));
    return pickedWinner ? "win" : "loss";
  }
  if (market === "total") {
    if (row.line_value === null) return "unknown";
    const total = game.total_runs ?? (game.away_score !== null && game.home_score !== null ? game.away_score + game.home_score : null);
    if (total === null) return "unknown";
    if (total === row.line_value) return "push";
    const over = /over/.test(sidePick);
    const under = /under/.test(sidePick);
    if (!over && !under) return "unknown";
    return (over && total > row.line_value) || (under && total < row.line_value) ? "win" : "loss";
  }
  if (market === "first_inning") {
    if (game.first_inning_runs === null) return "unknown";
    const tossUp = /toss/.test(sidePick);
    if (tossUp) return "void";
    const yrfi = /yrfi|over/.test(sidePick);
    const nrfi = /nrfi|under/.test(sidePick);
    if (!yrfi && !nrfi) return "unknown";
    return (yrfi && game.first_inning_runs > 0) || (nrfi && game.first_inning_runs === 0) ? "win" : "loss";
  }
  return "unknown";
}

function marketType(market: Market): string {
  return market === "first_inning" ? "first_inning_total" : market;
}

function lineHistoryKey(gameId: number | null, market: Market): string {
  return `${gameId ?? "none"}::${marketType(market)}`;
}

function priceSource(row: RawPrediction): string {
  if (row.odds_american === null) return "missing";
  const json = JSON.stringify(row.snapshot_json ?? {}).toLowerCase();
  if (json.includes("prediction_records_recovered")) return "prediction_records_recovered";
  if (json.includes("locked")) return "locked_prediction_record";
  return row.locked_at ? "prediction_records_locked_odds" : "prediction_records_current_odds";
}

async function loadRaw(args: ReturnType<typeof parseArgs>) {
  const rawRows: RawPrediction[] = [];
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
    rawRows.push(...((data ?? []) as RawPrediction[]));
    if ((data ?? []).length < 750) break;
  }
  const filtered = rawRows.filter((r) => r.launch_day !== true && normalizeMarket(r.market) !== null);
  const gameIds = [...new Set(filtered.map((r) => r.game_id).filter((id): id is number => typeof id === "number"))];
  const games = new Map<number, Game>();
  for (let i = 0; i < gameIds.length; i += 500) {
    const { data, error } = await supabase.from("games").select("id,status,home_score,away_score,total_runs,first_inning_runs").in("id", gameIds.slice(i, i + 500));
    if (error) throw new Error(`games load failed: ${error.message}`);
    for (const game of (data ?? []) as Game[]) games.set(game.id, game);
  }
  const historyKeys = new Set<string>();
  for (let i = 0; i < gameIds.length; i += 500) {
    const { data, error } = await supabase
      .from("line_history")
      .select("game_id,market_type,side,odds_american,line_value,recorded_at,created_at")
      .in("game_id", gameIds.slice(i, i + 500));
    if (error) throw new Error(`line_history load failed: ${error.message}`);
    for (const h of (data ?? []) as LineHistoryRow[]) {
      if (h.game_id !== null && h.market_type) historyKeys.add(`${h.game_id}::${h.market_type}`);
    }
  }
  return { rawRows: filtered, games, historyKeys };
}

function buildRows(rawRows: RawPrediction[], games: Map<number, Game>, historyKeys: Set<string>): AuditRow[] {
  return rawRows.flatMap((raw): AuditRow[] => {
    const market = normalizeMarket(raw.market);
    if (!market) return [];
    const game = raw.game_id !== null ? games.get(raw.game_id) ?? null : null;
    const storedResult = normalizeResult(one(raw.prediction_grades)?.result);
    const recomputed = recomputeResult(raw, market, game);
    const recomputedUnits = units(raw.odds_american, storedResult);
    const missingReasons: string[] = [];
    if (raw.odds_american === null) missingReasons.push("locked_price_missing");
    if (pct(raw.market_probability) === null && impliedPct(raw.odds_american) === null) missingReasons.push("implied_probability_missing");
    if (pct(raw.edge) === null) missingReasons.push("edge_missing");
    if (!raw.locked_at) missingReasons.push("locked_at_missing");
    if (!raw.snapshot_json) missingReasons.push("snapshot_json_missing");
    if (!historyKeys.has(lineHistoryKey(raw.game_id, market))) missingReasons.push("line_history_missing");
    if (storedResult === "unknown") missingReasons.push("stored_result_missing");
    const resultMatches = storedResult === "unknown" || recomputed === "unknown" || recomputed === "pending" ? null : storedResult === recomputed;
    return [{
      id: raw.id,
      date: raw.slate_date,
      market,
      matchup: raw.matchup ?? "",
      pick: raw.pick,
      side: raw.side,
      grade: gradeLabel(raw),
      line: raw.line_value,
      lockedPrice: raw.odds_american,
      priceSource: priceSource(raw),
      priceUsedForUnits: raw.odds_american,
      impliedProbability: pct(raw.market_probability) ?? impliedPct(raw.odds_american),
      modelProbability: pct(raw.model_probability),
      edge: pct(raw.edge),
      lockedSnapshot: Boolean(raw.locked_at && raw.snapshot_json),
      lineHistoryCoverage: historyKeys.has(lineHistoryKey(raw.game_id, market)),
      storedResult,
      recomputedResult: recomputed,
      resultMatches,
      recomputedUnits,
      unitReliability: storedResult === "win" || storedResult === "loss"
        ? raw.odds_american !== null ? "priced" : storedResult === "win" ? "missing_price_win" : "missing_price_loss_assumed_stake"
        : "not_settled",
      missingReasons,
    }];
  });
}

function groupRows<T>(rows: T[], keyFn: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) (out[keyFn(row)] ??= []).push(row);
  return out;
}

function summarize(rows: AuditRow[]) {
  const settled = rows.filter((r) => r.storedResult === "win" || r.storedResult === "loss");
  const pricedSettled = settled.filter((r) => r.lockedPrice !== null);
  const unitsTotal = +pricedSettled.reduce((s, r) => s + (r.recomputedUnits ?? 0), 0).toFixed(4);
  const comparable = rows.filter((r) => r.resultMatches !== null);
  const mismatches = comparable.filter((r) => r.resultMatches === false);
  const priceCoverage = rows.length ? rows.filter((r) => r.lockedPrice !== null).length / rows.length : 0;
  const pricedSettledCoverage = settled.length ? pricedSettled.length / settled.length : 0;
  const resultMismatchRate = comparable.length ? mismatches.length / comparable.length : 0;
  const lineHistoryCoverage = rows.length ? rows.filter((r) => r.lineHistoryCoverage).length / rows.length : 0;
  const lockedSnapshotCoverage = rows.length ? rows.filter((r) => r.lockedSnapshot).length / rows.length : 0;
  const reliability =
    pricedSettledCoverage >= 0.95 && resultMismatchRate <= 0.01 ? "reliable" :
    pricedSettledCoverage >= 0.85 && resultMismatchRate <= 0.03 ? "usable_with_caution" :
    "unreliable";
  return {
    rows: rows.length,
    settledRows: settled.length,
    pricedSettledRows: pricedSettled.length,
    priceCoverage: +priceCoverage.toFixed(4),
    pricedSettledCoverage: +pricedSettledCoverage.toFixed(4),
    impliedProbabilityCoverage: rows.length ? +(rows.filter((r) => r.impliedProbability !== null).length / rows.length).toFixed(4) : 0,
    edgeCoverage: rows.length ? +(rows.filter((r) => r.edge !== null).length / rows.length).toFixed(4) : 0,
    lineHistoryCoverage: +lineHistoryCoverage.toFixed(4),
    lockedSnapshotCoverage: +lockedSnapshotCoverage.toFixed(4),
    resultComparableRows: comparable.length,
    resultMismatchCount: mismatches.length,
    resultMismatchRate: +resultMismatchRate.toFixed(4),
    storedUnitsAvailable: false,
    storedVsRecomputedUnitMismatchCount: null,
    storedUnitsTotal: null,
    recomputedUnitsTotal: unitsTotal,
    recomputedRoi: pricedSettled.length ? +(unitsTotal / pricedSettled.length).toFixed(4) : null,
    roiReliability: reliability,
    blockers: [
      ...(pricedSettledCoverage < 0.95 ? ["priced_settled_coverage_below_95pct"] : []),
      ...(resultMismatchRate > 0.01 ? ["result_mismatch_rate_above_1pct"] : []),
      "stored_units_not_persisted_directly_recomputed_from_locked_price",
    ],
    priceSourceDistribution: Object.fromEntries(Object.entries(groupRows(rows, (r) => r.priceSource)).map(([k, v]) => [k, v.length])),
    missingReasonDistribution: Object.fromEntries(Object.entries(groupRows(rows.flatMap((r) => r.missingReasons.map((reason) => ({ reason }))), (r) => r.reason)).map(([k, v]) => [k, v.length])),
    mismatchExamples: mismatches.slice(0, 12).map((r) => ({
      id: r.id,
      date: r.date,
      matchup: r.matchup,
      market: r.market,
      pick: r.pick,
      line: r.line,
      storedResult: r.storedResult,
      recomputedResult: r.recomputedResult,
    })),
  };
}

function byDateMarket(rows: AuditRow[]) {
  const groups = groupRows(rows, (r) => `${r.date}::${r.market}`);
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, summarize(value)]));
}

function buildReport(rows: AuditRow[], args: ReturnType<typeof parseArgs>) {
  const byMarket = Object.fromEntries(MARKETS.map((m) => [m, summarize(rows.filter((r) => r.market === m))]));
  return {
    generatedAt: new Date().toISOString(),
    noCost: true,
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    args,
    overall: summarize(rows),
    byMarket,
    byDateMarket: byDateMarket(rows),
    fiSpecific: {
      recordByDirection: Object.fromEntries(Object.entries(groupRows(rows.filter((r) => r.market === "first_inning"), (r) => {
        const text = `${r.pick ?? ""} ${r.side ?? ""}`.toLowerCase();
        if (/toss/.test(text)) return "Toss-Up";
        if (/yrfi|over/.test(text)) return "YRFI";
        if (/nrfi|under/.test(text)) return "NRFI";
        return "unknown";
      })).map(([k, v]) => [k, summarize(v)])),
      findings: [
        "FI consensus/sharp split bars are not required for integrity.",
        "FI ROI should be trusted only to the extent locked FI price coverage and result matching pass.",
        "FI result accuracy can still be evaluated when first_inning_runs and stored result agree.",
      ],
    },
    metricTrust: {
      moneyline: {
        trusted: ["win/loss", "locked price when present", "recomputed units/ROI", "probability bands", "market implied probability", "line movement when line_history exists"],
        reliability: byMarket.moneyline.roiReliability,
      },
      total: {
        trusted: ["win/loss/push", "locked line", "locked price when present", "projection error", "projection gap", "recomputed units/ROI"],
        reliability: byMarket.total.roiReliability,
      },
      first_inning: {
        trusted: ["YRFI/NRFI/Toss-Up result accuracy when first_inning_runs is present", "model probability calibration"],
        caution: ["units/ROI", "price-based edge", "price movement"],
        reliability: byMarket.first_inning.roiReliability,
      },
    },
    exactRepairRecommendations: [
      "Persist direct units/stake result if you want stored-vs-recomputed unit audits; current reports reconstruct units from locked odds.",
      "For FI, keep improving locked price, implied probability, edge, and line_history persistence before price-sensitive tuning.",
      "Treat missing FI price as a grade-strengthening blocker even if model/stat context exists.",
      "Keep FI Toss-Up as No Play; this does not depend on ROI reliability.",
    ],
    examples: rows.slice(0, 8),
  };
}

function markdown(report: ReturnType<typeof buildReport>): string {
  const m = report.byMarket as Record<Market, ReturnType<typeof summarize>>;
  return `# MLB Grading Integrity Audit

Generated: ${report.generatedAt}

Read-only: no DB writes, no production changes, no paid AI.

## Reliability by Market

- ML: ${m.moneyline.roiReliability}; priced settled coverage ${(m.moneyline.pricedSettledCoverage * 100).toFixed(1)}%; result mismatches ${m.moneyline.resultMismatchCount}/${m.moneyline.resultComparableRows}; recomputed units ${m.moneyline.recomputedUnitsTotal}
- Totals: ${m.total.roiReliability}; priced settled coverage ${(m.total.pricedSettledCoverage * 100).toFixed(1)}%; result mismatches ${m.total.resultMismatchCount}/${m.total.resultComparableRows}; recomputed units ${m.total.recomputedUnitsTotal}
- FI: ${m.first_inning.roiReliability}; priced settled coverage ${(m.first_inning.pricedSettledCoverage * 100).toFixed(1)}%; result mismatches ${m.first_inning.resultMismatchCount}/${m.first_inning.resultComparableRows}; recomputed units ${m.first_inning.recomputedUnitsTotal}

## Important Caveat

Stored unit columns are not directly persisted in the joined prediction rows used here. Units/ROI are recomputed from stored result + locked odds. That is acceptable for research when locked price coverage is high, but it is not the same as auditing a stored unit column.

## Repair Recommendations

${report.exactRepairRecommendations.map((x) => `- ${x}`).join("\n")}
`;
}

async function main() {
  const args = parseArgs();
  const { rawRows, games, historyKeys } = await loadRaw(args);
  const rows = buildRows(rawRows, games, historyKeys);
  const report = buildReport(rows, args);
  await mkdir(args.outDir, { recursive: true });
  const jsonPath = `${args.outDir}/mlb-grading-integrity-audit.json`;
  const mdPath = `${args.outDir}/mlb-grading-integrity-audit.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown(report), "utf8");
  if (args.json) {
    console.log(JSON.stringify({
      output: { jsonPath, mdPath },
      overall: report.overall,
      byMarket: report.byMarket,
      fiSpecific: report.fiSpecific,
      metricTrust: report.metricTrust,
      exactRepairRecommendations: report.exactRepairRecommendations,
    }, null, 2));
    return;
  }
  console.log(`Grading integrity audit written:\n- ${jsonPath}\n- ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
