/**
 * MLB Projection Model Diagnostic Lab v1.
 *
 * Read-only: no DB writes, no production changes, no paid AI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "../lib/db/supabase";

type Market = "moneyline" | "total" | "first_inning";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";
type Split = "train" | "validation" | "holdout";

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
  confidence: number | null;
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

type Row = {
  id: number;
  date: string;
  split: Split;
  gameId: number | null;
  matchup: string;
  market: Market;
  pick: string | null;
  side: string | null;
  grade: Grade;
  price: number | null;
  line: number | null;
  lockedAt: string | null;
  projectedAway: number | null;
  projectedHome: number | null;
  projectedTotal: number | null;
  projectedMarginHome: number | null;
  mlProbability: number | null;
  totalProbability: number | null;
  fiProbability: number | null;
  modelProbability: number | null;
  marketProbability: number | null;
  edge: number | null;
  confidence: number | null;
  actualAway: number | null;
  actualHome: number | null;
  actualTotal: number | null;
  actualMarginHome: number | null;
  firstInningRuns: number | null;
  result: Result;
  units: number;
  outcome: 0 | 1 | null;
  awayError: number | null;
  homeError: number | null;
  totalError: number | null;
  marginError: number | null;
  priceBucket: string;
  probabilityBucket: string;
  edgeBucket: string;
  projectedTotalBucket: string;
  marketTotalBucket: string;
  totalGapBucket: string;
  totalDirection: string;
  favoriteDog: string;
  lineMovement: string;
  marketRead: string;
  consensus: boolean;
  sharp: boolean;
  sourceRelationship: string;
  dataQuality: string;
  starterBucket: string;
  bullpenBucket: string;
  offenseBucket: string;
  weatherBucket: string;
  parkBucket: string;
  fallbackBucket: string;
};

type Summary = {
  count: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  roi: number | null;
  winRate: number | null;
  avgPrice: number | null;
  avgModelProbability: number | null;
  avgMarketProbability: number | null;
  avgEdge: number | null;
};

type ErrorSummary = {
  count: number;
  awayMae: number | null;
  awayRmse: number | null;
  awayBias: number | null;
  homeMae: number | null;
  homeRmse: number | null;
  homeBias: number | null;
  totalMae: number | null;
  totalRmse: number | null;
  totalBias: number | null;
  marginMae: number | null;
  marginRmse: number | null;
  marginBias: number | null;
};

type CalibrationSummary = Summary & {
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  avgObserved: number | null;
  calibrationGap: number | null;
};

const MARKETS: Market[] = ["moneyline", "total", "first_inning"];
const ACTIONABLE = new Set<Grade>(["Best Angle", "Lean"]);

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

function pathValue(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function num(obj: unknown, paths: string[]): number | null {
  for (const p of paths) {
    const v = pathValue(obj, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function str(obj: unknown, paths: string[]): string | null {
  for (const p of paths) {
    const v = pathValue(obj, p);
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function bool(obj: unknown, paths: string[]): boolean {
  for (const p of paths) {
    const v = pathValue(obj, p);
    if (v === true || v === "true" || v === 1 || v === "1") return true;
  }
  return false;
}

function pct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return +(Math.abs(value) <= 1 ? value * 100 : value).toFixed(4);
}

function normalizeMarket(value: string | null): Market | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "moneyline" || raw === "ml") return "moneyline";
  if (raw === "total" || raw === "ou" || raw === "over_under") return "total";
  if (raw === "first_inning" || raw === "fi" || raw === "nrfi" || raw === "yrfi") return "first_inning";
  return null;
}

function normalizeGrade(raw: string | null, bestAngle: boolean | null, noBet: boolean | null): Grade {
  if (bestAngle === true) return "Best Angle";
  const text = String(raw ?? "").toLowerCase().replace(/[_-]/g, " ");
  if (/best/.test(text)) return "Best Angle";
  if (/lean/.test(text)) return "Lean";
  if (/watch|market aligned/.test(text)) return "Watchlist";
  if (/caution/.test(text)) return "Caution";
  if (noBet === true || /no bet|no play|pass|provisional/.test(text)) return "No Play";
  return "No Play";
}

function normalizeResult(raw: string | null | undefined): Result {
  const text = String(raw ?? "unknown").toLowerCase();
  if (["win", "loss", "push", "void", "pending"].includes(text)) return text as Result;
  return "unknown";
}

function units(price: number | null, result: Result): number {
  if (result === "loss") return -1;
  if (result !== "win" || price === null || price === 0) return 0;
  return +(price > 0 ? price / 100 : 100 / Math.abs(price)).toFixed(4);
}

function impliedPct(price: number | null): number | null {
  if (price === null || price === 0) return null;
  return +(100 * (price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100))).toFixed(4);
}

function priceBucket(price: number | null): string {
  if (price === null) return "missing";
  if (price >= 170) return "dog_170_plus";
  if (price >= 130) return "dog_130_170";
  if (price >= 100) return "dog_100_130";
  if (price >= -110) return "near_even";
  if (price >= -150) return "fav_110_150";
  if (price >= -200) return "fav_150_200";
  return "fav_200_plus";
}

function probBucket(p: number | null): string {
  if (p === null) return "missing";
  if (p < 50) return "lt_50";
  if (p < 55) return "50_55";
  if (p < 60) return "55_60";
  if (p < 65) return "60_65";
  if (p < 70) return "65_70";
  return "70_plus";
}

function edgeBucket(e: number | null): string {
  if (e === null) return "missing";
  if (e <= 0) return "negative_or_zero";
  if (e < 2) return "0_2";
  if (e < 5) return "2_5";
  if (e < 8) return "5_8";
  return "8_plus";
}

function totalBucket(t: number | null, prefix = ""): string {
  if (t === null) return `${prefix}missing`;
  if (t <= 7.5) return `${prefix}lte_7.5`;
  if (t < 9) return `${prefix}8_8.5`;
  if (t < 10) return `${prefix}9_9.5`;
  return `${prefix}10_plus`;
}

function gapBucket(g: number | null): string {
  if (g === null) return "missing";
  const a = Math.abs(g);
  if (a < 0.5) return "0_0.5";
  if (a < 1) return "0.5_1";
  if (a < 2) return "1_2";
  return "2_plus";
}

function movement(snapshot: Record<string, unknown> | null): string {
  const raw = str(snapshot, ["line_movement.direction", "marketReadV2.movement.directionRelativeToPick", "recommendationDecision.resolvedMarketRead.movement.directionRelativeToPick"]);
  if (!raw) return snapshot?.line_movement ? "present_unclassified" : "unknown";
  if (/toward|support/i.test(raw)) return "toward_pick";
  if (/against|resist|oppose/i.test(raw)) return "against_pick";
  if (/flat|none|neutral|no/i.test(raw)) return "neutral";
  return raw;
}

function marketRead(snapshot: Record<string, unknown> | null, market: Market): string {
  return str(snapshot, ["recommendationDecision.resolvedMarketRead.status", "resolvedMarketRead.status", "marketRead.status", "market_read.status"]) ??
    (market === "first_inning" ? "historical_fi_market_context_not_persisted" : "historical_market_read_not_persisted");
}

function signalRows(snapshot: Record<string, unknown> | null, market: Market): Array<Record<string, unknown>> {
  const rows = snapshot?.signal_rows_at_lock;
  if (!Array.isArray(rows)) return [];
  const marketType = market === "first_inning" ? "first_inning_total" : market;
  return rows.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && row.market_type === marketType);
}

function source(snapshot: Record<string, unknown> | null, market: Market) {
  const rows = signalRows(snapshot, market);
  const consensus = rows.some((r) => r.public_money_pct !== null || r.public_betting_pct !== null) || Boolean(snapshot?.public_splits);
  const sharp = rows.some((r) => r.has_steam_move === true || r.has_reverse_line_movement === true || typeof r.signal_strength === "string") || Boolean(pathValue(snapshot, "recommendationDecision.sharpBookSplits"));
  const conflict = bool(snapshot, ["recommendationDecision.sourceConflict", "sourceConflict", "public_splits.conflict"]);
  return { consensus, sharp, relationship: conflict ? "source_conflict" : consensus && sharp ? "both_available" : consensus ? "consensus_only" : sharp ? "sharp_only" : "not_persisted" };
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4) : null;
}

function mae(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +(nums.reduce((s, v) => s + Math.abs(v), 0) / nums.length).toFixed(4) : null;
}

function rmse(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +Math.sqrt(nums.reduce((s, v) => s + v * v, 0) / nums.length).toFixed(4) : null;
}

function summarize(rows: Row[]): Summary {
  const wins = rows.filter((r) => r.result === "win").length;
  const losses = rows.filter((r) => r.result === "loss").length;
  const settled = wins + losses;
  const net = +rows.reduce((s, r) => s + r.units, 0).toFixed(4);
  return {
    count: rows.length,
    settled,
    wins,
    losses,
    pushes: rows.filter((r) => r.result === "push").length,
    units: net,
    roi: settled ? +(net / settled).toFixed(4) : null,
    winRate: settled ? +(wins / settled).toFixed(4) : null,
    avgPrice: avg(rows.map((r) => r.price)),
    avgModelProbability: avg(rows.map((r) => r.modelProbability)),
    avgMarketProbability: avg(rows.map((r) => r.marketProbability)),
    avgEdge: avg(rows.map((r) => r.edge)),
  };
}

function errorSummary(rows: Row[]): ErrorSummary {
  return {
    count: rows.length,
    awayMae: mae(rows.map((r) => r.awayError)),
    awayRmse: rmse(rows.map((r) => r.awayError)),
    awayBias: avg(rows.map((r) => r.awayError)),
    homeMae: mae(rows.map((r) => r.homeError)),
    homeRmse: rmse(rows.map((r) => r.homeError)),
    homeBias: avg(rows.map((r) => r.homeError)),
    totalMae: mae(rows.map((r) => r.totalError)),
    totalRmse: rmse(rows.map((r) => r.totalError)),
    totalBias: avg(rows.map((r) => r.totalError)),
    marginMae: mae(rows.map((r) => r.marginError)),
    marginRmse: rmse(rows.map((r) => r.marginError)),
    marginBias: avg(rows.map((r) => r.marginError)),
  };
}

function calibration(rows: Row[]): CalibrationSummary {
  const base = summarize(rows);
  const cal = rows.filter((r) => r.outcome !== null && r.modelProbability !== null);
  let brier: number | null = null;
  let logLoss: number | null = null;
  let ece: number | null = null;
  if (cal.length) {
    brier = +(cal.reduce((s, r) => s + ((r.modelProbability! / 100) - r.outcome!) ** 2, 0) / cal.length).toFixed(6);
    logLoss = +(cal.reduce((s, r) => {
      const p = Math.max(0.001, Math.min(0.999, r.modelProbability! / 100));
      return s - (r.outcome! * Math.log(p) + (1 - r.outcome!) * Math.log(1 - p));
    }, 0) / cal.length).toFixed(6);
    const bins = groupRows(cal, (r) => probBucket(r.modelProbability));
    ece = +Object.values(bins).reduce((sum, bucket) => {
      const meanPred = avg(bucket.map((r) => r.modelProbability));
      const observed = bucket.filter((r) => r.outcome === 1).length / bucket.length;
      return sum + (bucket.length / cal.length) * Math.abs(((meanPred ?? 0) / 100) - observed);
    }, 0).toFixed(6);
  }
  const observed = base.winRate;
  return {
    ...base,
    brier,
    logLoss,
    ece,
    avgObserved: observed,
    calibrationGap: observed !== null && base.avgModelProbability !== null ? +(observed * 100 - base.avgModelProbability).toFixed(4) : null,
  };
}

function groupRows<T>(rows: T[], keyFn: (row: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const row of rows) (map[keyFn(row)] ??= []).push(row);
  return map;
}

function group<T>(rows: T[], keyFn: (row: T) => string, summaryFn: (rows: T[]) => unknown): Record<string, unknown> {
  const groups = groupRows(rows, keyFn);
  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, summaryFn(v)]));
}

function featureBucket(snapshot: Record<string, unknown> | null, feature: string): string {
  const text = JSON.stringify(snapshot ?? {}).toLowerCase();
  if (feature === "starter") {
    if (/starter.*preferred|first_inning_ok/.test(text)) return "starter_preferred_or_fi";
    if (/starter_proxy|starter.*fallback|missing_starter|starter_unconfirmed/.test(text)) return "starter_proxy_or_unconfirmed";
  }
  if (feature === "bullpen") {
    if (/bullpen_missing|bullpen_fallback|bullpen_proxy/.test(text)) return "bullpen_proxy_or_missing";
    if (/bullpen/.test(text)) return "bullpen_present";
  }
  if (feature === "offense") {
    if (/offense_missing|team_proxy_ops|top_order_proxy|top_order_no_ops/.test(text)) return "offense_proxy_or_missing";
    if (/ops|offense/.test(text)) return "offense_present";
  }
  if (feature === "weather") {
    if (/weather_proxy|weather_fallback/.test(text)) return "weather_proxy";
    const temp = num(snapshot, ["v2_2_audit.feature_capture.weather.temperature_f", "fi_v2_audit.feature_capture.weather.temperature_f"]);
    if (temp !== null) return temp >= 80 ? "hot_80_plus" : temp < 65 ? "cool_lt_65" : "mild_65_79";
  }
  if (feature === "park") {
    const park = num(snapshot, ["auto_factors.park_factor_runs", "v2_2_audit.feature_capture.park.park_factor_runs", "fi_v2_audit.feature_capture.park.park_factor_runs"]);
    if (park === null) return "park_missing";
    if (park >= 103) return "hitter_park";
    if (park <= 97) return "pitcher_park";
    return "neutral_park";
  }
  return `${feature}_unknown_or_not_persisted`;
}

function projectionFields(snapshot: Record<string, unknown> | null, market: Market) {
  const away = num(snapshot, [
    "total_projection_reconciliation.reconciled_away_score",
    "v2_2_audit.posterior_away_runs",
    "predicted_scores_at_lock.away",
    "review_v1.reviewed.away_score",
    "review_v1.raw.away_score",
  ]);
  const home = num(snapshot, [
    "total_projection_reconciliation.reconciled_home_score",
    "v2_2_audit.posterior_home_runs",
    "predicted_scores_at_lock.home",
    "review_v1.reviewed.home_score",
    "review_v1.raw.home_score",
  ]);
  const total = num(snapshot, [
    "total_projection_reconciliation.reconciled_total",
    "v2_2_audit.posterior_total",
    "review_v1.reviewed.total",
    "review_v1.raw.total",
  ]) ?? (away !== null && home !== null ? +(away + home).toFixed(4) : null);
  const mlProbability = pct(num(snapshot, ["v2_2_audit.ml_model_prob", "v2_2_audit.ml_regularized_model_prob", "review_v1.reviewed.ml_confidence"]));
  const totalProbability = pct(num(snapshot, ["v2_2_audit.ou_model_prob", "v2_2_audit.ou_regularized_model_prob", "total_projection_reconciliation.reconciled_confidence_pct"]));
  const fiPick = String(str(snapshot, ["fi_v2_audit.fi_pick"]) ?? "").toLowerCase();
  const fiProb = market === "first_inning"
    ? pct(/yrfi|over/.test(fiPick)
      ? num(snapshot, ["fi_v2_audit.posterior_p_yrfi", "fi_v2_audit.independent_p_yrfi"])
      : num(snapshot, ["fi_v2_audit.posterior_p_nrfi", "fi_v2_audit.independent_p_nrfi"]))
    : null;
  return { away, home, total, mlProbability, totalProbability, fiProb };
}

function splitRows(rows: Row[]): Row[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.6);
  const validationEnd = Math.floor(sorted.length * 0.8);
  return sorted.map((r, i) => ({ ...r, split: i < trainEnd ? "train" : i < validationEnd ? "validation" : "holdout" }));
}

async function loadRows(args: ReturnType<typeof parseArgs>): Promise<Row[]> {
  const rawRows: RawPrediction[] = [];
  for (let from = 0; from < 5000; from += 750) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,game_id,matchup,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,edge,play_grade,best_angle,no_bet,launch_day,locked_at,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .order("slate_date", { ascending: true })
      .range(from, from + 749);
    if (args.from) query = query.gte("slate_date", args.from);
    if (args.to) query = query.lte("slate_date", args.to);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rawRows.push(...((data ?? []) as RawPrediction[]));
    if ((data ?? []).length < 750) break;
  }
  const gameIds = [...new Set(rawRows.map((r) => r.game_id).filter((id): id is number => typeof id === "number"))];
  const games = new Map<number, Game>();
  for (let i = 0; i < gameIds.length; i += 500) {
    const { data, error } = await supabase.from("games").select("id,status,home_score,away_score,total_runs,first_inning_runs").in("id", gameIds.slice(i, i + 500));
    if (error) throw new Error(error.message);
    for (const game of (data ?? []) as Game[]) games.set(game.id, game);
  }
  const rows = rawRows.flatMap((raw): Row[] => {
    if (raw.launch_day === true) return [];
    const market = normalizeMarket(raw.market);
    if (!market) return [];
    const game = raw.game_id !== null ? games.get(raw.game_id) ?? null : null;
    const proj = projectionFields(raw.snapshot_json, market);
    const src = source(raw.snapshot_json, market);
    const actualAway = game?.away_score ?? null;
    const actualHome = game?.home_score ?? null;
    const actualTotal = game?.total_runs ?? (actualAway !== null && actualHome !== null ? actualAway + actualHome : null);
    const actualMarginHome = actualAway !== null && actualHome !== null ? actualHome - actualAway : null;
    const projectedMarginHome = proj.home !== null && proj.away !== null ? proj.home - proj.away : null;
    const modelProbability = pct(raw.model_probability) ?? (market === "moneyline" ? proj.mlProbability : market === "total" ? proj.totalProbability : proj.fiProb);
    const marketProbability = pct(raw.market_probability) ?? impliedPct(raw.odds_american);
    const result = normalizeResult(one(raw.prediction_grades)?.result);
    const side = String(raw.side ?? raw.pick ?? "").toLowerCase();
    const signedTotalGap = market === "total" && proj.total !== null && raw.line_value !== null ? (/under/.test(side) ? raw.line_value - proj.total : proj.total - raw.line_value) : null;
    return [{
      id: raw.id,
      date: raw.slate_date,
      split: "train",
      gameId: raw.game_id,
      matchup: raw.matchup ?? "",
      market,
      pick: raw.pick,
      side: raw.side,
      grade: normalizeGrade(raw.play_grade, raw.best_angle, raw.no_bet),
      price: raw.odds_american,
      line: raw.line_value,
      lockedAt: raw.locked_at,
      projectedAway: proj.away,
      projectedHome: proj.home,
      projectedTotal: proj.total,
      projectedMarginHome,
      mlProbability: proj.mlProbability,
      totalProbability: proj.totalProbability,
      fiProbability: proj.fiProb,
      modelProbability,
      marketProbability,
      edge: pct(raw.edge),
      confidence: pct(raw.confidence),
      actualAway,
      actualHome,
      actualTotal,
      actualMarginHome,
      firstInningRuns: game?.first_inning_runs ?? null,
      result,
      units: units(raw.odds_american, result),
      outcome: result === "win" ? 1 : result === "loss" ? 0 : null,
      awayError: proj.away !== null && actualAway !== null ? +(proj.away - actualAway).toFixed(4) : null,
      homeError: proj.home !== null && actualHome !== null ? +(proj.home - actualHome).toFixed(4) : null,
      totalError: proj.total !== null && actualTotal !== null ? +(proj.total - actualTotal).toFixed(4) : null,
      marginError: projectedMarginHome !== null && actualMarginHome !== null ? +(projectedMarginHome - actualMarginHome).toFixed(4) : null,
      priceBucket: priceBucket(raw.odds_american),
      probabilityBucket: probBucket(modelProbability),
      edgeBucket: edgeBucket(pct(raw.edge)),
      projectedTotalBucket: totalBucket(proj.total, "projected_"),
      marketTotalBucket: totalBucket(raw.line_value, "market_"),
      totalGapBucket: gapBucket(signedTotalGap),
      totalDirection: /under/.test(side) ? "under" : /over/.test(side) ? "over" : "unknown",
      favoriteDog: raw.odds_american !== null && raw.odds_american < 0 ? "favorite" : "dog",
      lineMovement: movement(raw.snapshot_json),
      marketRead: marketRead(raw.snapshot_json, market),
      consensus: src.consensus,
      sharp: src.sharp,
      sourceRelationship: src.relationship,
      dataQuality: market === "first_inning" ? str(raw.snapshot_json, ["fi_v2_audit.data_quality_tier", "v2_data_quality_tier"]) ?? "unknown" : str(raw.snapshot_json, ["v2_2_audit.data_quality_tier", "v2_data_quality_tier"]) ?? "unknown",
      starterBucket: featureBucket(raw.snapshot_json, "starter"),
      bullpenBucket: featureBucket(raw.snapshot_json, "bullpen"),
      offenseBucket: featureBucket(raw.snapshot_json, "offense"),
      weatherBucket: featureBucket(raw.snapshot_json, "weather"),
      parkBucket: featureBucket(raw.snapshot_json, "park"),
      fallbackBucket: JSON.stringify(raw.snapshot_json ?? {}).toLowerCase().includes("fallback") ? "fallback_mentioned" : "no_fallback_mentioned",
    }];
  });
  return splitRows(rows);
}

function probabilityCalibration(rows: Row[]) {
  return {
    overall: calibration(rows),
    byBucket: group(rows, (r) => r.probabilityBucket, calibration),
    byGrade: group(rows, (r) => r.grade, calibration),
  };
}

function projectionAnalysis(rows: Row[]) {
  const projectionRows = rows.filter((r) => r.projectedTotal !== null && r.actualTotal !== null);
  return {
    overall: errorSummary(projectionRows),
    byProjectedTotalBucket: group(projectionRows, (r) => r.projectedTotalBucket, errorSummary),
    byMarketTotalBucket: group(projectionRows, (r) => r.marketTotalBucket, errorSummary),
    byGrade: group(projectionRows, (r) => r.grade, errorSummary),
    byDataQuality: group(projectionRows, (r) => r.dataQuality, errorSummary),
    byLineMovement: group(projectionRows, (r) => r.lineMovement, errorSummary),
    byStarterBucket: group(projectionRows, (r) => r.starterBucket, errorSummary),
    byBullpenBucket: group(projectionRows, (r) => r.bullpenBucket, errorSummary),
    byWeatherBucket: group(projectionRows, (r) => r.weatherBucket, errorSummary),
    byParkBucket: group(projectionRows, (r) => r.parkBucket, errorSummary),
  };
}

function marketComparison(rows: Row[]) {
  return {
    byEdgeBucket: group(rows, (r) => r.edgeBucket, summarize),
    byMovement: group(rows, (r) => r.lineMovement, summarize),
    byMovementAndEdge: group(rows, (r) => `${r.lineMovement}__${r.edgeBucket}`, summarize),
    byMarketRead: group(rows, (r) => r.marketRead, summarize),
    bySourceRelationship: group(rows, (r) => r.sourceRelationship, summarize),
    modelMovedAgainstLost: rows.filter((r) => r.lineMovement === "against_pick" && r.result === "loss").slice(0, 10).map(example),
    modelMovedAgainstWon: rows.filter((r) => r.lineMovement === "against_pick" && r.result === "win").slice(0, 10).map(example),
  };
}

function featureDiagnostics(rows: Row[]) {
  return {
    starter: group(rows, (r) => r.starterBucket, summarize),
    bullpen: group(rows, (r) => r.bullpenBucket, summarize),
    offense: group(rows, (r) => r.offenseBucket, summarize),
    weather: group(rows, (r) => r.weatherBucket, summarize),
    park: group(rows, (r) => r.parkBucket, summarize),
    fallback: group(rows, (r) => r.fallbackBucket, summarize),
    persistenceGaps: [
      "Bullpen/weather fallback booleans are not consistently real historical booleans; evaluated as text-derived buckets only.",
      "Historical sharp context is not reliably persisted at lock for older rows.",
      "FI line movement/split context is incomplete; FI model calibration remains exploratory.",
    ],
  };
}

function example(row: Row) {
  return {
    date: row.date,
    matchup: row.matchup,
    market: row.market,
    pick: row.pick,
    grade: row.grade,
    result: row.result,
    units: row.units,
    price: row.price,
    line: row.line,
    modelProbability: row.modelProbability,
    marketProbability: row.marketProbability,
    edge: row.edge,
    projectedTotal: row.projectedTotal,
    actualTotal: row.actualTotal,
    totalError: row.totalError,
    lineMovement: row.lineMovement,
    marketRead: row.marketRead,
  };
}

function residualLeaks(rows: Row[]) {
  const totalRows = rows.filter((r) => r.market === "total");
  const ml = rows.filter((r) => r.market === "moneyline");
  const fi = rows.filter((r) => r.market === "first_inning");
  const leaks = [
    { id: "projected_total_high_underperformed", likelyIssue: "projection_model_bias", rows: totalRows.filter((r) => (r.projectedTotal ?? 0) >= 10 && (r.totalError ?? 0) >= 2) },
    { id: "projected_total_clears_line_misses_by_2", likelyIssue: "projection_model_or_probability_calibration", rows: totalRows.filter((r) => r.result === "loss" && Math.abs(r.totalError ?? 0) >= 2 && r.totalGapBucket !== "missing") },
    { id: "ml_favorite_bad_price_loss", likelyIssue: "price_value_or_grade_bucket", rows: ml.filter((r) => r.price !== null && r.price <= -150 && ACTIONABLE.has(r.grade) && r.result === "loss") },
    { id: "market_moved_against_model_loss", likelyIssue: "market_signal_blind_spot", rows: rows.filter((r) => r.lineMovement === "against_pick" && ACTIONABLE.has(r.grade) && r.result === "loss") },
    { id: "totals_lean_weak_gap_loss", likelyIssue: "grade_bucket_projection_gap", rows: totalRows.filter((r) => r.grade === "Lean" && (r.totalGapBucket === "0_0.5" || r.totalGapBucket === "missing") && r.result === "loss") },
    { id: "fi_expensive_loss", likelyIssue: "fi_price_value", rows: fi.filter((r) => r.price !== null && r.price <= -150 && r.result === "loss") },
  ];
  return leaks.map((l) => ({
    id: l.id,
    likelyIssue: l.likelyIssue,
    summary: summarize(l.rows),
    projectionError: errorSummary(l.rows),
    examples: l.rows.slice(0, 8).map(example),
  }));
}

function adjustProbability(row: Row, rule: string): number | null {
  if (row.modelProbability === null) return null;
  let p = row.modelProbability;
  if (rule === "ml_shrink_60_70") {
    if (row.market === "moneyline" && p >= 60 && p < 70) p -= 5;
  } else if (rule === "totals_shrink_55_70") {
    if (row.market === "total" && p >= 55 && p < 70) p -= 4;
  } else if (rule === "movement_against_penalty") {
    if (row.lineMovement === "against_pick") p -= 4;
  } else if (rule === "movement_toward_boost_playable") {
    if (row.lineMovement === "toward_pick" && row.price !== null && row.price > -175) p += 2;
  } else if (rule === "totals_gap_calibrated") {
    if (row.market === "total" && (row.totalGapBucket === "0_0.5" || row.totalGapBucket === "missing")) p -= 4;
    if (row.market === "total" && (row.totalGapBucket === "1_2" || row.totalGapBucket === "2_plus")) p += 2;
  } else if (rule === "fi_price_aware") {
    if (row.market === "first_inning" && row.price !== null && row.price <= -150) p -= 3;
  }
  return Math.max(1, Math.min(99, +p.toFixed(4)));
}

function calibrationWith(rows: Row[], rule: string): CalibrationSummary {
  return calibration(rows.map((r) => ({ ...r, modelProbability: adjustProbability(r, rule) })));
}

function counterfactualCalibration(rows: Row[]) {
  const rules = ["ml_shrink_60_70", "totals_shrink_55_70", "movement_against_penalty", "movement_toward_boost_playable", "totals_gap_calibrated", "fi_price_aware"];
  return rules.map((rule) => {
    const scoped = rows.filter((r) =>
      rule.startsWith("ml") ? r.market === "moneyline" :
      rule.startsWith("totals") ? r.market === "total" :
      rule.startsWith("fi") ? r.market === "first_inning" :
      true
    );
    const original = calibration(scoped);
    const adjusted = calibrationWith(scoped, rule);
    const train = calibrationWith(scoped.filter((r) => r.split === "train"), rule);
    const validation = calibrationWith(scoped.filter((r) => r.split === "validation"), rule);
    const holdout = calibrationWith(scoped.filter((r) => r.split === "holdout"), rule);
    const brierDelta = original.brier !== null && adjusted.brier !== null ? +(original.brier - adjusted.brier).toFixed(6) : null;
    const eceDelta = original.ece !== null && adjusted.ece !== null ? +(original.ece - adjusted.ece).toFixed(6) : null;
    const classification = rule.startsWith("fi")
      ? "needs_more_data"
      : classifyCandidate(scoped.length, brierDelta, eceDelta, train, validation, holdout);
    return { rule, sample: scoped.length, original, adjusted, brierDelta, eceDelta, train, validation, holdout, classification };
  });
}

function classifyCandidate(n: number, brierDelta: number | null, eceDelta: number | null, train: CalibrationSummary, validation: CalibrationSummary, holdout: CalibrationSummary) {
  const improves = (brierDelta ?? 0) > 0.001 || (eceDelta ?? 0) > 0.005;
  const valOk = validation.brier !== null && train.brier !== null ? validation.brier <= train.brier + 0.04 : false;
  const holdoutOk = holdout.brier !== null && train.brier !== null ? holdout.brier <= train.brier + 0.04 : false;
  if (n >= 200 && improves && valOk && holdoutOk) return "controlled_rollout_candidate";
  if (n >= 120 && improves) return "shadow_only";
  if (n < 120) return "needs_more_data";
  return "reject";
}

function buildReport(rows: Row[], args: ReturnType<typeof parseArgs>) {
  const byMarket = Object.fromEntries(MARKETS.map((m) => [m, rows.filter((r) => r.market === m)]));
  const report = {
    generatedAt: new Date().toISOString(),
    noCost: true,
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    args,
    dataset: {
      rows: rows.length,
      settledRows: rows.filter((r) => r.result === "win" || r.result === "loss").length,
      trueProjectionRows: rows.filter((r) => r.projectedAway !== null && r.projectedHome !== null).length,
      finalScoreJoinedRows: rows.filter((r) => r.actualAway !== null && r.actualHome !== null).length,
      dateRange: { from: rows[0]?.date ?? null, to: rows[rows.length - 1]?.date ?? null },
      splitCounts: {
        train: rows.filter((r) => r.split === "train").length,
        validation: rows.filter((r) => r.split === "validation").length,
        holdout: rows.filter((r) => r.split === "holdout").length,
      },
      coverage: {
        projectedScores: rows.filter((r) => r.projectedAway !== null && r.projectedHome !== null).length,
        projectedTotal: rows.filter((r) => r.projectedTotal !== null).length,
        mlProbability: rows.filter((r) => r.market === "moneyline" && r.modelProbability !== null).length,
        totalProbability: rows.filter((r) => r.market === "total" && r.modelProbability !== null).length,
        fiProbability: rows.filter((r) => r.market === "first_inning" && r.modelProbability !== null).length,
        lineMovement: rows.filter((r) => r.lineMovement !== "unknown").length,
        consensus: rows.filter((r) => r.consensus).length,
        sharp: rows.filter((r) => r.sharp).length,
      },
    },
    projectionError: projectionAnalysis(rows),
    probabilityCalibration: Object.fromEntries(MARKETS.map((m) => [m, probabilityCalibration(byMarket[m])])),
    modelVsMarket: Object.fromEntries(MARKETS.map((m) => [m, marketComparison(byMarket[m])])),
    featureDiagnostics: featureDiagnostics(rows),
    residualLeaks: residualLeaks(rows),
    counterfactualCalibration: counterfactualCalibration(rows),
  };
  return {
    ...report,
    candidates: {
      production_candidate_now: report.counterfactualCalibration.filter((r) => r.classification === "production_candidate_now"),
      controlled_rollout_candidate: report.counterfactualCalibration.filter((r) => r.classification === "controlled_rollout_candidate"),
      shadow_only: report.counterfactualCalibration.filter((r) => r.classification === "shadow_only"),
      needs_more_data: report.counterfactualCalibration.filter((r) => r.classification === "needs_more_data"),
      reject: report.counterfactualCalibration.filter((r) => r.classification === "reject"),
    },
    nextActions: [
      "Do not change production model logic until candidate is reviewed.",
      "Prioritize projection-gap Totals and line-movement-against diagnostics for shadow/controlled review.",
      "Persist real bullpen/weather fallback booleans for future feature diagnostics.",
      "Improve FI price/line-history persistence before FI model tuning.",
    ],
  };
}

function mdSummary(s: Summary): string {
  const roi = s.roi === null ? "n/a" : `${(s.roi * 100).toFixed(1)}%`;
  return `n=${s.count}, settled=${s.settled}, ${s.wins}-${s.losses}${s.pushes ? `-${s.pushes}` : ""}, units=${s.units.toFixed(2)}, ROI=${roi}, avgPrice=${s.avgPrice ?? "n/a"}, avgModel=${s.avgModelProbability ?? "n/a"}, avgEdge=${s.avgEdge ?? "n/a"}`;
}

function mdError(e: ErrorSummary): string {
  return `n=${e.count}, away MAE/RMSE/bias=${e.awayMae}/${e.awayRmse}/${e.awayBias}, home=${e.homeMae}/${e.homeRmse}/${e.homeBias}, total=${e.totalMae}/${e.totalRmse}/${e.totalBias}, margin=${e.marginMae}/${e.marginRmse}/${e.marginBias}`;
}

function mdCalibration(c: CalibrationSummary): string {
  return `${mdSummary(c)}, Brier=${c.brier}, LogLoss=${c.logLoss}, ECE=${c.ece}, calGap=${c.calibrationGap}`;
}

function table(title: string, entries: Record<string, unknown>, mode: "summary" | "error" | "cal" = "summary", max = 25): string {
  const rows = Object.entries(entries).slice(0, max);
  return `\n### ${title}\n\n${rows.map(([k, v]) => `- ${k}: ${mode === "error" ? mdError(v as ErrorSummary) : mode === "cal" ? mdCalibration(v as CalibrationSummary) : mdSummary(v as Summary)}`).join("\n") || "No rows."}\n`;
}

function markdown(report: ReturnType<typeof buildReport>): string {
  return `# MLB Projection Model Diagnostic Lab v1

Generated: ${report.generatedAt}

Read-only: no DB writes, no production changes, no paid AI calls.

## Dataset Coverage

- Rows: ${report.dataset.rows}
- Settled rows: ${report.dataset.settledRows}
- True projection rows: ${report.dataset.trueProjectionRows}
- Final-score joined rows: ${report.dataset.finalScoreJoinedRows}
- Date range: ${report.dataset.dateRange.from} to ${report.dataset.dateRange.to}
- Train / validation / holdout: ${report.dataset.splitCounts.train} / ${report.dataset.splitCounts.validation} / ${report.dataset.splitCounts.holdout}

Coverage:
- Projected scores: ${report.dataset.coverage.projectedScores}
- Projected total: ${report.dataset.coverage.projectedTotal}
- ML probability: ${report.dataset.coverage.mlProbability}
- Total probability: ${report.dataset.coverage.totalProbability}
- FI probability: ${report.dataset.coverage.fiProbability}
- Line movement: ${report.dataset.coverage.lineMovement}
- Consensus: ${report.dataset.coverage.consensus}
- Sharp: ${report.dataset.coverage.sharp}

## Projection Error

Overall: ${mdError(report.projectionError.overall)}

${table("Projection Error by Projected Total Bucket", report.projectionError.byProjectedTotalBucket, "error")}
${table("Projection Error by Market Total Bucket", report.projectionError.byMarketTotalBucket, "error")}
${table("Projection Error by Data Quality", report.projectionError.byDataQuality, "error")}
${table("Projection Error by Line Movement", report.projectionError.byLineMovement, "error")}

## Probability Calibration

- ML: ${mdCalibration(report.probabilityCalibration.moneyline.overall)}
- Totals: ${mdCalibration(report.probabilityCalibration.total.overall)}
- FI: ${mdCalibration(report.probabilityCalibration.first_inning.overall)}

${table("ML Probability Buckets", report.probabilityCalibration.moneyline.byBucket, "cal")}
${table("Totals Probability Buckets", report.probabilityCalibration.total.byBucket, "cal")}
${table("FI Probability Buckets", report.probabilityCalibration.first_inning.byBucket, "cal")}

## Model vs Market

${table("ML Edge Buckets", report.modelVsMarket.moneyline.byEdgeBucket)}
${table("Totals Edge Buckets", report.modelVsMarket.total.byEdgeBucket)}
${table("FI Edge Buckets", report.modelVsMarket.first_inning.byEdgeBucket)}
${table("All Market Movement Buckets - ML", report.modelVsMarket.moneyline.byMovement)}
${table("All Market Movement Buckets - Totals", report.modelVsMarket.total.byMovement)}

## Feature/Input Diagnostics

${table("Starter Buckets", report.featureDiagnostics.starter)}
${table("Bullpen Buckets", report.featureDiagnostics.bullpen)}
${table("Offense Buckets", report.featureDiagnostics.offense)}
${table("Weather Buckets", report.featureDiagnostics.weather)}
${table("Park Buckets", report.featureDiagnostics.park)}

Persistence gaps:
${report.featureDiagnostics.persistenceGaps.map((x) => `- ${x}`).join("\n")}

## Residual / Leak Finder

${report.residualLeaks.map((l) => `- ${l.id} (${l.likelyIssue}): ${mdSummary(l.summary)}; projection ${mdError(l.projectionError)}`).join("\n")}

## Counterfactual Probability Calibration

${report.counterfactualCalibration.map((r) => `- ${r.rule}: sample=${r.sample}, class=${r.classification}, Brier delta=${r.brierDelta}, ECE delta=${r.eceDelta}, original=${r.original.brier}/${r.original.ece}, adjusted=${r.adjusted.brier}/${r.adjusted.ece}`).join("\n")}

## Candidate Classification

- production_candidate_now: ${report.candidates.production_candidate_now.length}
- controlled_rollout_candidate: ${report.candidates.controlled_rollout_candidate.length}
- shadow_only: ${report.candidates.shadow_only.length}
- needs_more_data: ${report.candidates.needs_more_data.length}
- reject: ${report.candidates.reject.length}

## Next Actions

${report.nextActions.map((x) => `- ${x}`).join("\n")}
`;
}

async function main() {
  const args = parseArgs();
  const rows = await loadRows(args);
  const report = buildReport(rows, args);
  await mkdir(args.outDir, { recursive: true });
  const jsonPath = `${args.outDir}/mlb-projection-model-diagnostic-v1.json`;
  const mdPath = `${args.outDir}/mlb-projection-model-diagnostic-v1.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown(report), "utf8");
  if (args.json) {
    console.log(JSON.stringify({
      output: { jsonPath, mdPath },
      dataset: report.dataset,
      projectionError: report.projectionError.overall,
      probabilityCalibration: {
        moneyline: report.probabilityCalibration.moneyline.overall,
        total: report.probabilityCalibration.total.overall,
        first_inning: report.probabilityCalibration.first_inning.overall,
      },
      strongestModelLeaks: report.residualLeaks.slice(0, 8),
      candidateCounts: Object.fromEntries(Object.entries(report.candidates).map(([k, v]) => [k, v.length])),
      candidates: report.candidates,
      nextActions: report.nextActions,
    }, null, 2));
    return;
  }
  console.log(`Projection diagnostic written:\n- ${jsonPath}\n- ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
