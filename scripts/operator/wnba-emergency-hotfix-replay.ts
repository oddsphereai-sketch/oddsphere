import { supabase } from "../../lib/db/supabase";
import { currentSlateDate } from "../../lib/dates/slateDate";

type Row = Record<string, any>;
type Side = "home" | "away" | "over" | "under";
type Result = "win" | "loss" | "push" | "pending" | "void";

const argv = process.argv.slice(2);
const jsonOnly = argv.includes("--json");
const startDate = readFlag("--start") ?? "2026-06-24";
const today = readFlag("--today") ?? currentSlateDate("wnba");

function readFlag(name: string): string | null {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] ?? null : null;
}

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value: number | null | undefined, places = 3): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const m = 10 ** places;
  return Math.round(value * m) / m;
}

function pct(part: number, total: number): number | null {
  return total === 0 ? null : round((part / total) * 100, 1);
}

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function phi(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pl = 0.02425, ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1); }
  if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

function americanProfit(odds: number | null, result: Result): number | null {
  if (result === "push") return 0;
  if (result !== "win" && result !== "loss") return null;
  if (odds === null) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarizeBets(rows: Array<{ result: Result; odds: number | null }>) {
  const graded = rows.filter((r) => r.result === "win" || r.result === "loss" || r.result === "push");
  const roiRows = graded
    .map((r) => americanProfit(r.odds, r.result))
    .filter((x): x is number => x !== null);
  const wins = graded.filter((r) => r.result === "win").length;
  const losses = graded.filter((r) => r.result === "loss").length;
  const pushes = graded.filter((r) => r.result === "push").length;
  const profit = roiRows.reduce((a, b) => a + b, 0);
  return {
    n: graded.length,
    wins,
    losses,
    pushes,
    hitRate: pct(wins, wins + losses),
    roi: roiRows.length ? round((profit / roiRows.length) * 100, 1) : null,
    profit: round(profit, 3),
    roiEligible: roiRows.length,
  };
}

async function page(table: string, build: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await build(supabase.from(table).select("*")).range(from, from + 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    out.push(...((res.data ?? []) as Row[]));
    if ((res.data ?? []).length < 1000) return out;
  }
}

async function loadByIds(table: string, ids: Array<number | string>, column = "id"): Promise<Row[]> {
  const out: Row[] = [];
  const uniq = Array.from(new Set(ids)).filter((x) => x !== null && x !== undefined);
  for (let i = 0; i < uniq.length; i += 500) {
    const batch = uniq.slice(i, i + 500);
    const { data, error } = await supabase.from(table).select("*").in(column, batch);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
  }
  return out;
}

function rawTotal(rec: Row): number | null {
  const modelTotal = n(rec.snapshot_json?.model?.total);
  if (modelTotal !== null) return modelTotal;
  const away = n(rec.snapshot_json?.projected_score?.away);
  const home = n(rec.snapshot_json?.projected_score?.home);
  return away !== null && home !== null ? away + home : null;
}

function rawHomeMargin(rec: Row): number | null {
  const modelMargin = n(rec.snapshot_json?.model?.margin);
  if (modelMargin !== null) return modelMargin;
  const away = n(rec.snapshot_json?.projected_score?.away);
  const home = n(rec.snapshot_json?.projected_score?.home);
  return away !== null && home !== null ? home - away : null;
}

function scoreDerivedHomeMargin(rec: Row): number | null {
  return n(rec.snapshot_json?.model?.components?.raw_model_margin);
}

function finalPredictionHomeMargin(rec: Row): number | null {
  return n(rec.snapshot_json?.model?.components?.market_coherent_margin);
}

function marketTotal(rec: Row): number | null {
  return n(rec.snapshot_json?.market_consensus?.total) ?? n(rec.snapshot_json?.trusted_consensus?.total) ?? n(rec.line_value);
}

function homeLineForSpreadRec(rec: Row): number | null {
  const line = n(rec.line_value);
  if (line === null) return null;
  if (rec.side === "home") return line;
  if (rec.side === "away") return -line;
  return null;
}

function marketHomeMargin(rec: Row): number | null {
  const homeLine = homeLineForSpreadRec(rec);
  return homeLine === null ? null : -homeLine;
}

function totalSide(proj: number | null, line: number | null): Side | null {
  if (proj === null || line === null) return null;
  if (proj > line) return "over";
  if (proj < line) return "under";
  return null;
}

function spreadSide(homeMargin: number | null, homeLine: number | null): Side | null {
  if (homeMargin === null || homeLine === null) return null;
  const edgeHome = homeMargin + homeLine;
  if (edgeHome > 0) return "home";
  if (edgeHome < 0) return "away";
  return null;
}

function totalResult(side: Side | null, line: number | null, actualTotal: number | null): Result {
  if (side !== "over" && side !== "under") return "void";
  if (line === null || actualTotal === null) return "pending";
  if (actualTotal === line) return "push";
  return actualTotal > line ? (side === "over" ? "win" : "loss") : side === "under" ? "win" : "loss";
}

function spreadResult(side: Side | null, homeLine: number | null, homeScore: number | null, awayScore: number | null): Result {
  if (side !== "home" && side !== "away") return "void";
  if (homeLine === null || homeScore === null || awayScore === null) return "pending";
  const line = side === "home" ? homeLine : -homeLine;
  const margin = side === "home" ? homeScore - awayScore : awayScore - homeScore;
  const cover = margin + line;
  if (cover === 0) return "push";
  return cover > 0 ? "win" : "loss";
}

function gradeFromEdge(edge: number | null): "best_angle" | "lean" | "watchlist" | "caution" | null {
  if (edge === null) return null;
  const a = Math.abs(edge);
  if (a >= 4) return "best_angle";
  if (a >= 2.5) return "lean";
  return "watchlist";
}

function bucketTotalLine(line: number | null): string {
  if (line === null) return "missing";
  if (line < 160) return "<160";
  if (line < 170) return "160-169.5";
  if (line < 180) return "170-179.5";
  return "180+";
}

function bucketOuSide(side: unknown): string {
  return side === "over" || side === "under" ? side : "missing";
}

function bucketSpreadAbs(line: number | null): string {
  if (line === null) return "missing";
  const a = Math.abs(line);
  if (a <= 2.5) return "0-2.5";
  if (a <= 5.5) return "3-5.5";
  if (a <= 8.5) return "6-8.5";
  return "9+";
}

function lineMarketSide(market: string, side: Side, homeLine: number | null): { side: string; line: number | null } {
  if (market === "total") return { side, line: null };
  if (market === "spread") return { side, line: side === "home" ? homeLine : homeLine === null ? null : -homeLine };
  return { side, line: null };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function priceLookup(rows: Row[], gameId: number, market: string, side: Side, line: number | null, cutoffIso: string | null): number | null {
  const cutoff = cutoffIso ? Date.parse(cutoffIso) : NaN;
  const candidates = rows
    .filter((r) => r.game_id === gameId && r.market_type === market && r.side === side && n(r.odds_american) !== null)
    .filter((r) => line === null || n(r.line_value) === line)
    .filter((r) => {
      const t = Date.parse(String(r.recorded_at ?? r.fetched_at ?? ""));
      return !Number.isFinite(cutoff) || !Number.isFinite(t) || t <= cutoff;
    })
    .sort((a, b) => Date.parse(String(b.recorded_at ?? b.fetched_at ?? "")) - Date.parse(String(a.recorded_at ?? a.fetched_at ?? "")));
  if (!candidates.length) return null;
  const latest = Date.parse(String(candidates[0]!.recorded_at ?? candidates[0]!.fetched_at ?? ""));
  const latestRows = Number.isFinite(latest)
    ? candidates.filter((r) => Date.parse(String(r.recorded_at ?? r.fetched_at ?? "")) === latest)
    : candidates;
  return median(latestRows.map((r) => n(r.odds_american)).filter((x): x is number => x !== null));
}

function sidePrice(rec: Row, lineRows: Row[], side: Side | null, market: "total" | "spread"): number | null {
  if (side === null) return null;
  if (side === rec.side) return n(rec.odds_american);
  const homeLine = market === "spread" ? homeLineForSpreadRec(rec) : null;
  const lookup = lineMarketSide(market, side, homeLine);
  return priceLookup(lineRows, rec.game_id, market, lookup.side as Side, lookup.line, rec.game_date);
}

function projectionMetrics(
  rows: Row[],
  project: (r: Row) => number | null,
  sideOf: (r: Row, projection: number | null) => Side | null,
  market: "total" | "spread",
  lineRows: Row[],
) {
  const projected = rows.filter((r) => project(r) !== null);
  const errors = projected.map((r) => {
    const actual = market === "total" ? n(r.actual_total) : n(r.actual_home_score)! - n(r.actual_away_score)!;
    return project(r)! - actual!;
  });
  const bets = projected.map((r) => {
    const side = sideOf(r, project(r));
    const result = market === "total"
      ? totalResult(side, n(r.line_value), n(r.actual_total))
      : spreadResult(side, homeLineForSpreadRec(r), n(r.actual_home_score), n(r.actual_away_score));
    return { result, odds: sidePrice(r, lineRows, side, market) };
  });
  const changed = projected.filter((r) => {
    const side = sideOf(r, project(r));
    return side !== null && side !== r.side;
  });
  const changedBets = changed.map((r) => {
    const side = sideOf(r, project(r));
    const result = market === "total"
      ? totalResult(side, n(r.line_value), n(r.actual_total))
      : spreadResult(side, homeLineForSpreadRec(r), n(r.actual_home_score), n(r.actual_away_score));
    return { result, odds: sidePrice(r, lineRows, side, market) };
  });
  const bestAngle = projected.filter((r) => gradeFromEdge(edgeFor(r, project(r), market)) === "best_angle");
  const lean = projected.filter((r) => gradeFromEdge(edgeFor(r, project(r), market)) === "lean");
  return {
    sample: projected.length,
    mae: errors.length ? round(errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length, 3) : null,
    rmse: errors.length ? round(Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length), 3) : null,
    bias: errors.length ? round(errors.reduce((a, b) => a + b, 0) / errors.length, 3) : null,
    side: summarizeBets(bets),
    sideChangesVsProduction: changed.length,
    changedSide: summarizeBets(changedBets),
    bestAngle: summarizeBets(bestAngle.map((r) => {
      const side = sideOf(r, project(r));
      return {
        result: market === "total" ? totalResult(side, n(r.line_value), n(r.actual_total)) : spreadResult(side, homeLineForSpreadRec(r), n(r.actual_home_score), n(r.actual_away_score)),
        odds: sidePrice(r, lineRows, side, market),
      };
    })),
    lean: summarizeBets(lean.map((r) => {
      const side = sideOf(r, project(r));
      return {
        result: market === "total" ? totalResult(side, n(r.line_value), n(r.actual_total)) : spreadResult(side, homeLineForSpreadRec(r), n(r.actual_home_score), n(r.actual_away_score)),
        odds: sidePrice(r, lineRows, side, market),
      };
    })),
  };
}

function edgeFor(rec: Row, projection: number | null, market: "total" | "spread"): number | null {
  if (projection === null) return null;
  if (market === "total") {
    const line = n(rec.line_value);
    return line === null ? null : projection - line;
  }
  const homeLine = homeLineForSpreadRec(rec);
  return homeLine === null ? null : projection + homeLine;
}

function correctionByBucket(rows: Row[], keyOf: (r: Row) => string, rawOf: (r: Row) => number | null, actualOf: (r: Row) => number | null) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out = new Map<string, number>();
  const details: Row[] = [];
  for (const [key, rs] of groups) {
    const diffs = rs.map((r) => {
      const raw = rawOf(r), actual = actualOf(r);
      return raw !== null && actual !== null ? actual - raw : null;
    }).filter((x): x is number => x !== null);
    const rawCorrection = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    const shrink = diffs.length / (diffs.length + 20);
    const correction = rawCorrection * shrink;
    out.set(key, correction);
    details.push({ key, sample: diffs.length, rawCorrection: round(rawCorrection, 3), shrink: round(shrink, 3), correction: round(correction, 3) });
  }
  return { corrections: out, details };
}

function totalCandidateRows(records: Row[], lineRows: Row[], homeBias: number) {
  const totals = records.filter((r) => r.market === "total");
  const lineBucket = correctionByBucket(totals, (r) => bucketTotalLine(n(r.line_value)), rawTotal, (r) => n(r.actual_total));
  const ouBucket = correctionByBucket(totals, (r) => bucketOuSide(r.side), rawTotal, (r) => n(r.actual_total));

  let bestAlpha = 0;
  let bestScore = Infinity;
  for (let alpha = 0; alpha <= 1.0001; alpha += 0.05) {
    const m = projectionMetrics(
      totals,
      (r) => {
        const raw = rawTotal(r), market = marketTotal(r);
        return raw === null || market === null ? null : market + alpha * (raw - market);
      },
      (r, p) => totalSide(p, n(r.line_value)),
      "total",
      lineRows,
    );
    const score = (m.mae ?? Infinity) + Math.abs(alpha - 0.25) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestAlpha = round(alpha, 2)!;
    }
  }

  const candidates: Record<string, ReturnType<typeof projectionMetrics> & { overfittingRisk: string; formula: string }> = {};
  const add = (name: string, formula: string, risk: string, project: (r: Row) => number | null) => {
    candidates[name] = {
      ...projectionMetrics(totals, project, (r, p) => totalSide(p, n(r.line_value)), "total", lineRows),
      formula,
      overfittingRisk: risk,
    };
  };

  add("A_raw_projected_total", "raw_projected_total", "current baseline", rawTotal);
  add("B_market_total_only", "market_total", "no side by construction; projection benchmark only", marketTotal);
  add("C_market_plus_25pct_model_edge", "market_total + 0.25 * (raw_projected_total - market_total)", "low; fixed shrinkage", (r) => {
    const raw = rawTotal(r), market = marketTotal(r);
    return raw === null || market === null ? null : market + 0.25 * (raw - market);
  });
  add("D_market_plus_50pct_model_edge", "market_total + 0.50 * (raw_projected_total - market_total)", "medium; larger raw-model trust", (r) => {
    const raw = rawTotal(r), market = marketTotal(r);
    return raw === null || market === null ? null : market + 0.5 * (raw - market);
  });
  add("E_learned_alpha_regularized", `market_total + ${bestAlpha} * (raw_projected_total - market_total)`, "high; fitted on thin sample", (r) => {
    const raw = rawTotal(r), market = marketTotal(r);
    return raw === null || market === null ? null : market + bestAlpha * (raw - market);
  });
  add("F_line_bucket_correction", "raw_projected_total + shrunk correction by total-line bucket", "high; bucket sample is tiny", (r) => {
    const raw = rawTotal(r);
    return raw === null ? null : raw + (lineBucket.corrections.get(bucketTotalLine(n(r.line_value))) ?? 0);
  });
  add("G_over_under_correction", "raw_projected_total + shrunk correction by production O/U side", "high; side sample is tiny", (r) => {
    const raw = rawTotal(r);
    return raw === null ? null : raw + (ouBucket.corrections.get(bucketOuSide(r.side)) ?? 0);
  });

  return { candidates, learnedAlpha: bestAlpha, lineBucketCorrections: lineBucket.details, overUnderCorrections: ouBucket.details, homeBias };
}

function spreadCandidateRows(records: Row[], lineRows: Row[]) {
  const spreads = records.filter((r) => r.market === "spread");
  const diffs = spreads.map((r) => {
    const raw = rawHomeMargin(r);
    const actual = n(r.actual_home_score) !== null && n(r.actual_away_score) !== null ? n(r.actual_home_score)! - n(r.actual_away_score)! : null;
    return raw !== null && actual !== null ? actual - raw : null;
  }).filter((x): x is number => x !== null);
  const observedHomeBias = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  const regularizedHomeBias = observedHomeBias * (diffs.length / (diffs.length + 20));

  let bestAlpha = 0;
  let bestGamma = 0;
  let bestScore = Infinity;
  for (let alpha = 0; alpha <= 0.5001; alpha += 0.05) {
    for (let gamma = 0; gamma <= 0.5001; gamma += 0.05) {
      const m = projectionMetrics(
        spreads,
        (r) => {
          const raw = rawHomeMargin(r), market = marketHomeMargin(r);
          return raw === null || market === null ? null : market + alpha * (raw - market) + gamma * observedHomeBias;
        },
        (r, p) => spreadSide(p, homeLineForSpreadRec(r)),
        "spread",
        lineRows,
      );
      const score = (m.mae ?? Infinity) + Math.abs(alpha - 0.25) * 0.35 + gamma * 0.75;
      if (score < bestScore) {
        bestScore = score;
        bestAlpha = round(alpha, 2)!;
        bestGamma = round(gamma, 2)!;
      }
    }
  }

  const candidates: Record<string, ReturnType<typeof projectionMetrics> & { overfittingRisk: string; formula: string }> = {};
  const add = (name: string, formula: string, risk: string, project: (r: Row) => number | null) => {
    candidates[name] = {
      ...projectionMetrics(spreads, project, (r, p) => spreadSide(p, homeLineForSpreadRec(r)), "spread", lineRows),
      formula,
      overfittingRisk: risk,
    };
  };

  add("A_raw_home_margin", "raw_projected_home_margin", "current baseline", rawHomeMargin);
  add("A2_score_derived_home_margin", "score_derived_home_margin", "independent model component", scoreDerivedHomeMargin);
  add("A3_final_prediction_implied_margin", "sigM * probit(final_moneyline_probability)", "single-distribution coherence candidate", finalPredictionHomeMargin);
  add("A4_current_blended_margin_same_cohort", "0.7 * score_margin + 0.3 * final_probability_margin", "same-cohort current margin", (r) =>
    finalPredictionHomeMargin(r) === null ? null : rawHomeMargin(r));
  add("A5_market25_current_blended_same_cohort", "market_margin + 0.25 * (current_blended_margin - market_margin)", "same-cohort production calibration", (r) => {
    const raw = rawHomeMargin(r), market = marketHomeMargin(r);
    return finalPredictionHomeMargin(r) === null || raw === null || market === null
      ? null
      : market + 0.25 * (raw - market);
  });
  add("A6_market25_with_ml_winner_guard_same_cohort", "market25_blended_margin; final_probability_margin on winner conflict", "single published score/spread margin with ML-side invariant", (r) => {
    const raw = rawHomeMargin(r), market = marketHomeMargin(r), mlMargin = finalPredictionHomeMargin(r);
    if (raw === null || market === null || mlMargin === null) return null;
    const calibrated = market + 0.25 * (raw - market);
    return Math.sign(calibrated) !== 0 && Math.sign(mlMargin) !== 0 && Math.sign(calibrated) !== Math.sign(mlMargin)
      ? mlMargin
      : calibrated;
  });
  add("B_market_implied_home_margin_only", "market_implied_home_margin", "no side by construction; projection benchmark only", marketHomeMargin);
  add("C_market_plus_25pct_model_edge", "market_implied_home_margin + 0.25 * (raw_home_margin - market_home_margin)", "low; fixed shrinkage", (r) => {
    const raw = rawHomeMargin(r), market = marketHomeMargin(r);
    return raw === null || market === null ? null : market + 0.25 * (raw - market);
  });
  add("D_market_plus_50pct_model_edge", "market_implied_home_margin + 0.50 * (raw_home_margin - market_home_margin)", "medium; larger raw-model trust", (r) => {
    const raw = rawHomeMargin(r), market = marketHomeMargin(r);
    return raw === null || market === null ? null : market + 0.5 * (raw - market);
  });
  add("E_raw_plus_25pct_observed_home_bias", "raw_home_margin + 0.25 * observed_home_bias", "medium-high; uses launch sample home bias", (r) => {
    const raw = rawHomeMargin(r);
    return raw === null ? null : raw + 0.25 * observedHomeBias;
  });
  add("F_raw_plus_50pct_observed_home_bias", "raw_home_margin + 0.50 * observed_home_bias", "high; aggressive home correction", (r) => {
    const raw = rawHomeMargin(r);
    return raw === null ? null : raw + 0.5 * observedHomeBias;
  });
  add("G_market25_plus_25pct_observed_home_bias", "market_home_margin + 0.25 * (raw_home_margin - market_home_margin) + 0.25 * observed_home_bias", "medium-high; fixed but launch-bias dependent", (r) => {
    const raw = rawHomeMargin(r), market = marketHomeMargin(r);
    return raw === null || market === null ? null : market + 0.25 * (raw - market) + 0.25 * observedHomeBias;
  });
  add("H_market_plus_25pct_regularized_home_bias", "market_home_margin + 0.25 * regularized_home_bias", "medium; conservative bias shrinkage but mostly no side", (r) => {
    const market = marketHomeMargin(r);
    return market === null ? null : market + 0.25 * regularizedHomeBias;
  });
  add("I_learned_regularized_margin", `market_home_margin + ${bestAlpha} * (raw_home_margin - market_home_margin) + ${bestGamma} * observed_home_bias`, "high; fitted on thin sample", (r) => {
    const raw = rawHomeMargin(r), market = marketHomeMargin(r);
    return raw === null || market === null ? null : market + bestAlpha * (raw - market) + bestGamma * observedHomeBias;
  });

  return {
    candidates,
    observedHomeBias: round(observedHomeBias, 3),
    regularizedHomeBias: round(regularizedHomeBias, 3),
    learnedAlpha: bestAlpha,
    learnedGamma: bestGamma,
  };
}

function moneylineCandidateRows(records: Row[]) {
  const rows = records.filter((r) => r.market === "moneyline" && finalPredictionHomeMargin(r) !== null);
  const spreadByGame = new Map(
    records.filter((r) => r.market === "spread").map((r) => [r.game_id, r]),
  );
  const evaluate = (probability: (r: Row) => number | null) => {
    const values = rows.map((r) => {
      const p = probability(r);
      const actual = n(r.actual_home_score)! > n(r.actual_away_score)! ? 1 : 0;
      return p === null ? null : { p, actual };
    }).filter((x): x is { p: number; actual: number } => x !== null);
    const correct = values.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.actual).length;
    return {
      sample: values.length,
      correct,
      accuracy: pct(correct, values.length),
      brier: values.length ? round(values.reduce((sum, x) => sum + (x.p - x.actual) ** 2, 0) / values.length, 4) : null,
    };
  };
  const finalProbability = (r: Row) => {
    const confidence = n(r.confidence);
    if (confidence === null) return null;
    return r.side === "home" ? confidence / 100 : 1 - confidence / 100;
  };
  const sigma = (r: Row) => {
    const p = finalProbability(r), margin = finalPredictionHomeMargin(r);
    if (p === null || margin === null) return null;
    const z = probit(Math.min(0.99, Math.max(0.01, p)));
    return Math.abs(z) < 1e-9 ? null : margin / z;
  };
  const fromMargin = (marginOf: (r: Row) => number | null) => (r: Row) => {
    const margin = marginOf(r), s = sigma(r);
    return margin === null || s === null || s <= 0 ? null : phi(margin / s);
  };
  return {
    final_moneyline_probability: evaluate(finalProbability),
    score_derived_margin_probability: evaluate(fromMargin(scoreDerivedHomeMargin)),
    current_blended_margin_probability: evaluate(fromMargin(rawHomeMargin)),
    market25_blended_margin_probability: evaluate(fromMargin((r) => {
      const raw = rawHomeMargin(r), spread = spreadByGame.get(r.game_id);
      const market = spread ? marketHomeMargin(spread) : null;
      return raw === null || market === null ? null : market + 0.25 * (raw - market);
    })),
  };
}

function candidateToday(
  records: Row[],
  gamesById: Map<number, Row>,
  totalProject: (r: Row) => number | null,
  spreadProject: (r: Row) => number | null,
) {
  const now = Date.now();
  return records
    .filter((r) => r.slate_date >= today && (r.market === "total" || r.market === "spread"))
    .map((r) => {
      const game = gamesById.get(r.game_id) ?? {};
      const startMs = Date.parse(String(r.game_date ?? game.game_date ?? ""));
      const locked = r.locked_at != null || game.status !== "scheduled" || !Number.isFinite(startMs) || startMs - now <= 60 * 60 * 1000;
      const projection = r.market === "total" ? totalProject(r) : spreadProject(r);
      const suggestedSide = r.market === "total"
        ? totalSide(projection, n(r.line_value))
        : spreadSide(projection, homeLineForSpreadRec(r));
      const currentEdge = r.market === "total"
        ? rawTotal(r) !== null && n(r.line_value) !== null ? rawTotal(r)! - n(r.line_value)! : null
        : rawHomeMargin(r) !== null && homeLineForSpreadRec(r) !== null ? rawHomeMargin(r)! + homeLineForSpreadRec(r)! : null;
      const emergencyEdge = edgeFor(r, projection, r.market);
      const emergencyGrade = r.market === "total" ? r.play_grade : gradeFromEdge(emergencyEdge);
      return {
        id: r.id,
        game_id: r.game_id,
        matchup: r.matchup,
        market: r.market,
        game_date: r.game_date,
        status: game.status ?? null,
        locked_at: r.locked_at,
        eligibility: locked ? "frozen_locked_started_or_inside_t60" : "eligible_future_unlocked",
        marketLine: n(r.line_value),
        currentRawProjectedTotal: r.market === "total" ? round(rawTotal(r), 2) : null,
        emergencyCalibratedTotal: r.market === "total" ? round(projection, 2) : null,
        currentRawProjectedHomeMargin: r.market === "spread" ? round(rawHomeMargin(r), 2) : null,
        marketImpliedHomeMargin: r.market === "spread" ? round(marketHomeMargin(r), 2) : null,
        emergencyCalibratedHomeMargin: r.market === "spread" ? round(projection, 2) : null,
        currentPick: r.pick,
        currentSide: r.side,
        emergencySide: suggestedSide,
        pickChangedIfEligible: !locked && suggestedSide !== null && suggestedSide !== r.side,
        currentGrade: r.play_grade,
        emergencyGrade,
        gradeChangedIfEnabled: !locked && emergencyGrade !== null && emergencyGrade !== r.play_grade,
        currentEdge: round(currentEdge, 3),
        emergencyEdge: round(emergencyEdge, 3),
        reasonCode: locked
          ? "frozen_by_lock_start_safety"
          : suggestedSide === null
            ? "calibration_lands_on_market_line_no_side"
            : suggestedSide !== r.side
              ? "calibrated_side_differs"
              : "same_side_after_calibration",
      };
    });
}

async function main() {
  const records = await page("prediction_records", (q) => q
    .eq("sport", "wnba")
    .gte("slate_date", startDate)
    .in("market", ["moneyline", "total", "spread"])
    .order("slate_date", { ascending: true }));
  const games = await loadByIds("games", Array.from(new Set(records.map((r) => r.game_id))));
  const grades = await loadByIds("prediction_grades", records.map((r) => r.id), "prediction_record_id");
  const teams = await loadByIds("teams", Array.from(new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]).filter(Boolean))));
  const gameIds = Array.from(new Set(records.map((r) => r.game_id)));
  const lineRows = gameIds.length
    ? await page("line_history", (q) => q
        .in("game_id", gameIds)
        .in("market_type", ["total", "spread"])
        .not("odds_american", "is", null)
        .order("recorded_at", { ascending: false }))
    : [];

  const gameById = new Map(games.map((g) => [g.id, g]));
  const gradeByRecordId = new Map(grades.map((g) => [g.prediction_record_id, g]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const enriched: Row[] = records.map((rec): Row => {
    const game = gameById.get(rec.game_id) ?? {};
    const grade = gradeByRecordId.get(rec.id) ?? {};
    const homeScore = n(game.home_score);
    const awayScore = n(game.away_score);
    const actualTotal = homeScore !== null && awayScore !== null ? homeScore + awayScore : n(grade.actual_total);
    return {
      ...rec,
      game,
      actual_home_score: homeScore,
      actual_away_score: awayScore,
      actual_total: actualTotal,
      matchup: rec.matchup ?? `${teamById.get(game.away_team_id)?.abbreviation ?? "?"}@${teamById.get(game.home_team_id)?.abbreviation ?? "?"}`,
    };
  });

  const settled = enriched.filter((r) => {
    const game = gameById.get(r.game_id) ?? {};
    return (game.status === "final" || game.status === "closed") && n(r.actual_home_score) !== null && n(r.actual_away_score) !== null;
  });
  const totals = settled.filter((r) => r.market === "total");
  const spreads = settled.filter((r) => r.market === "spread");
  const totalReplay = totalCandidateRows(settled, lineRows, 0);
  const spreadReplay = spreadCandidateRows(settled, lineRows);
  const moneylineReplay = moneylineCandidateRows(settled);

  const selectedTotalFormula = "no_total_recommendation_hotfix";
  const selectedTotalProject = rawTotal;
  const selectedSpreadFormula = "market_home_margin + 0.25 * (raw_home_margin - market_home_margin) + 0.25 * observed_home_bias";
  const selectedSpreadProject = (r: Row) => {
    const raw = rawHomeMargin(r);
    const market = marketHomeMargin(r);
    return raw === null || market === null ? null : market + 0.25 * (raw - market) + 0.25 * (spreadReplay.observedHomeBias ?? 0);
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    startDate,
    today,
    sample: {
      records: records.length,
      settledRecords: settled.length,
      settledTotals: totals.length,
      settledSpreads: spreads.length,
      lineHistoryRows: lineRows.length,
    },
    baseline: {
      totals: summarizeBets(totals.map((r) => ({ result: totalResult(r.side, n(r.line_value), n(r.actual_total)), odds: n(r.odds_american) }))),
      spreads: summarizeBets(spreads.map((r) => ({ result: spreadResult(r.side, homeLineForSpreadRec(r), n(r.actual_home_score), n(r.actual_away_score)), odds: n(r.odds_american) }))),
    },
    totalReplay,
    spreadReplay,
    moneylineReplay,
    selectedEmergencyCandidates: {
      total: {
        recommendation: selectedTotalFormula,
        rationale: "Projection shrinkage reduces error a bit but every recommendation-use candidate keeps the same losing sides or creates no side. Do not enable total recommendation-use today.",
      },
      spread: {
        recommendation: selectedSpreadFormula,
        metrics: spreadReplay.candidates.G_market25_plus_25pct_observed_home_bias,
        rationale: "The launch sample shows a structural home-margin miss. This uses only 25% of the observed correction and keeps a market anchor; still high-risk because sample is 9 projected settled spreads.",
      },
    },
    todayBeforeAfter: candidateToday(enriched, gameById, selectedTotalProject, selectedSpreadProject),
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
