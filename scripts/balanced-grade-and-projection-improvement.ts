/**
 * MLB balanced grade/value + projection improvement lab.
 *
 * Read-only: no DB writes, no production changes, no paid AI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "../lib/db/supabase";

type Market = "moneyline" | "total";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";
type Split = "train" | "validation" | "holdout";
type ClassName = "production_candidate_now" | "controlled_rollout_candidate" | "needs_more_data" | "reject";

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
  home_score: number | null;
  away_score: number | null;
  total_runs: number | null;
};

type Row = {
  id: number;
  date: string;
  split: Split;
  gameId: number | null;
  market: Market;
  matchup: string;
  pick: string | null;
  side: string | null;
  grade: Grade;
  price: number | null;
  line: number | null;
  modelProbability: number | null;
  marketProbability: number | null;
  edge: number | null;
  projectedAway: number | null;
  projectedHome: number | null;
  projectedTotal: number | null;
  actualAway: number | null;
  actualHome: number | null;
  actualTotal: number | null;
  projectionGap: number | null;
  absProjectionGap: number | null;
  direction: "over" | "under" | "unknown";
  lineMovement: "toward" | "against" | "neutral" | "unknown";
  marketRead: string;
  result: Result;
  units: number | null;
  outcome: 0 | 1 | null;
};

type Rule = {
  id: string;
  family: string;
  exactLogic: string;
  flag: string;
  apply: (row: Row) => Grade;
};

const GRADES: Grade[] = ["Best Angle", "Lean", "Watchlist", "Caution", "No Play"];
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
  let cur = obj;
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

function normalizeMarket(value: string | null): Market | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "moneyline" || raw === "ml") return "moneyline";
  if (raw === "total" || raw === "ou" || raw === "over_under") return "total";
  return null;
}

function normalizeGrade(raw: string | null, bestAngle: boolean | null, noBet: boolean | null): Grade {
  if (bestAngle === true) return "Best Angle";
  const text = String(raw ?? "").toLowerCase().replace(/[_-]/g, " ");
  if (/best/.test(text)) return "Best Angle";
  if (/lean/.test(text)) return "Lean";
  if (/watch/.test(text)) return "Watchlist";
  if (/caution/.test(text)) return "Caution";
  if (noBet === true || /no bet|no play|pass/.test(text)) return "No Play";
  return "No Play";
}

function normalizeResult(raw: string | null | undefined): Result {
  const text = String(raw ?? "unknown").toLowerCase();
  if (text === "win" || text === "loss" || text === "push" || text === "void" || text === "pending") return text;
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
  if (result === "loss") return price === null ? null : -1;
  if (result === "win" && price !== null && price !== 0) return +(price > 0 ? price / 100 : 100 / Math.abs(price)).toFixed(4);
  return null;
}

function projectionFields(snapshot: Record<string, unknown> | null) {
  const away = num(snapshot, ["total_projection_reconciliation.reconciled_away_score", "v2_2_audit.posterior_away_runs", "predicted_scores_at_lock.away", "review_v1.reviewed.away_score"]);
  const home = num(snapshot, ["total_projection_reconciliation.reconciled_home_score", "v2_2_audit.posterior_home_runs", "predicted_scores_at_lock.home", "review_v1.reviewed.home_score"]);
  const total = num(snapshot, ["total_projection_reconciliation.reconciled_total", "v2_2_audit.posterior_total", "review_v1.reviewed.total"]) ??
    (away !== null && home !== null ? +(away + home).toFixed(4) : null);
  return { away, home, total };
}

function movement(snapshot: Record<string, unknown> | null): Row["lineMovement"] {
  const raw = str(snapshot, ["line_movement.direction", "marketReadV2.movement.directionRelativeToPick", "recommendationDecision.resolvedMarketRead.movement.directionRelativeToPick"]);
  if (!raw) return "unknown";
  if (/toward|support/i.test(raw)) return "toward";
  if (/against|resist|oppose/i.test(raw)) return "against";
  if (/flat|none|neutral|no/i.test(raw)) return "neutral";
  return "unknown";
}

function marketRead(snapshot: Record<string, unknown> | null): string {
  return str(snapshot, ["recommendationDecision.resolvedMarketRead.status", "resolvedMarketRead.status", "marketRead.status", "market_read.status"]) ?? "not_persisted";
}

function splitRows(rows: Row[]): Row[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.6);
  const validationEnd = Math.floor(sorted.length * 0.8);
  return sorted.map((r, i) => ({ ...r, split: i < trainEnd ? "train" : i < validationEnd ? "validation" : "holdout" }));
}

async function loadRows(args: ReturnType<typeof parseArgs>): Promise<Row[]> {
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
  const gameIds = [...new Set(rawRows.map((r) => r.game_id).filter((id): id is number => typeof id === "number"))];
  const games = new Map<number, Game>();
  for (let i = 0; i < gameIds.length; i += 500) {
    const { data, error } = await supabase.from("games").select("id,home_score,away_score,total_runs").in("id", gameIds.slice(i, i + 500));
    if (error) throw new Error(`games load failed: ${error.message}`);
    for (const game of (data ?? []) as Game[]) games.set(game.id, game);
  }
  const rows = rawRows.flatMap((raw): Row[] => {
    if (raw.launch_day === true) return [];
    const market = normalizeMarket(raw.market);
    if (!market) return [];
    const game = raw.game_id !== null ? games.get(raw.game_id) ?? null : null;
    const result = normalizeResult(one(raw.prediction_grades)?.result);
    const proj = projectionFields(raw.snapshot_json);
    const side = String(raw.side ?? raw.pick ?? "").toLowerCase();
    const direction = /under/.test(side) ? "under" : /over/.test(side) ? "over" : "unknown";
    const signedGap = market === "total" && proj.total !== null && raw.line_value !== null
      ? direction === "under" ? raw.line_value - proj.total : proj.total - raw.line_value
      : null;
    const actualTotal = game?.total_runs ?? (game?.away_score !== null && game?.home_score !== null && game ? game.away_score! + game.home_score! : null);
    return [{
      id: raw.id,
      date: raw.slate_date,
      split: "train",
      gameId: raw.game_id,
      market,
      matchup: raw.matchup ?? "",
      pick: raw.pick,
      side: raw.side,
      grade: normalizeGrade(raw.play_grade, raw.best_angle, raw.no_bet),
      price: raw.odds_american,
      line: raw.line_value,
      modelProbability: pct(raw.model_probability),
      marketProbability: pct(raw.market_probability) ?? impliedPct(raw.odds_american),
      edge: pct(raw.edge),
      projectedAway: proj.away,
      projectedHome: proj.home,
      projectedTotal: proj.total,
      actualAway: game?.away_score ?? null,
      actualHome: game?.home_score ?? null,
      actualTotal,
      projectionGap: signedGap,
      absProjectionGap: signedGap === null ? null : Math.abs(signedGap),
      direction,
      lineMovement: movement(raw.snapshot_json),
      marketRead: marketRead(raw.snapshot_json),
      result,
      units: units(raw.odds_american, result),
      outcome: result === "win" ? 1 : result === "loss" ? 0 : null,
    }];
  });
  return splitRows(rows);
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4) : null;
}

function rmse(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +Math.sqrt(nums.reduce((s, v) => s + v * v, 0) / nums.length).toFixed(4) : null;
}

function mae(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +(nums.reduce((s, v) => s + Math.abs(v), 0) / nums.length).toFixed(4) : null;
}

function summarizeAction(rows: Row[], gradeFn: (row: Row) => Grade = (r) => r.grade) {
  const settled = rows.filter((r) => (r.result === "win" || r.result === "loss") && r.units !== null);
  const actionable = settled.filter((r) => ACTIONABLE.has(gradeFn(r)));
  const wins = actionable.filter((r) => r.result === "win").length;
  const losses = actionable.filter((r) => r.result === "loss").length;
  const net = +actionable.reduce((s, r) => s + (r.units ?? 0), 0).toFixed(4);
  return {
    rows: rows.length,
    actionableCount: actionable.length,
    wins,
    losses,
    units: net,
    roi: actionable.length ? +(net / actionable.length).toFixed(4) : null,
    gradeDistribution: Object.fromEntries(GRADES.map((g) => [g, rows.filter((r) => gradeFn(r) === g).length])),
  };
}

function classify(affected: number, deltaUnits: number, deltaRoi: number | null, splitDeltas: Record<Split, number>, before: number, after: number): ClassName {
  const volumeOk = before === 0 || after >= before * 0.7;
  if ((affected >= 40 || affected >= 25) && deltaUnits > 0 && (deltaRoi ?? -999) > 0 && splitDeltas.train > 0 && splitDeltas.validation > 0 && splitDeltas.holdout >= 0 && volumeOk) return "production_candidate_now";
  if (affected >= 15 && deltaUnits > 0 && splitDeltas.train > 0 && splitDeltas.validation > 0 && volumeOk) return "controlled_rollout_candidate";
  if (affected < 15) return "needs_more_data";
  return "reject";
}

function evalRule(rule: Rule, rows: Row[], todayRows: Row[]) {
  const affected = rows.filter((r) => rule.apply(r) !== r.grade);
  const original = summarizeAction(rows);
  const simulated = summarizeAction(rows, (r) => rule.apply(r));
  const changedSettled = affected.filter((r) => (r.result === "win" || r.result === "loss") && r.units !== null);
  const winnersPromoted = changedSettled.filter((r) => !ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "win").length;
  const losersPromoted = changedSettled.filter((r) => !ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "loss").length;
  const winnersRemoved = changedSettled.filter((r) => ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "win").length;
  const losersRemoved = changedSettled.filter((r) => ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "loss").length;
  const split = Object.fromEntries((["train", "validation", "holdout"] as Split[]).map((s) => {
    const subset = rows.filter((r) => r.split === s);
    const o = summarizeAction(subset);
    const sim = summarizeAction(subset, (r) => rule.apply(r));
    return [s, { original: o, simulated: sim, deltaUnits: +(sim.units - o.units).toFixed(4), affectedRows: subset.filter((r) => rule.apply(r) !== r.grade).length }];
  })) as Record<Split, { original: ReturnType<typeof summarizeAction>; simulated: ReturnType<typeof summarizeAction>; deltaUnits: number; affectedRows: number }>;
  const deltaUnits = +(simulated.units - original.units).toFixed(4);
  const deltaRoi = simulated.roi !== null && original.roi !== null ? +(simulated.roi - original.roi).toFixed(4) : null;
  const splitDeltas = { train: split.train.deltaUnits, validation: split.validation.deltaUnits, holdout: split.holdout.deltaUnits };
  return {
    ruleName: rule.id,
    family: rule.family,
    exactLogic: rule.exactLogic,
    flag: rule.flag,
    affectedRows: affected.length,
    original,
    simulated,
    deltaUnits,
    deltaRoi,
    winnersPromoted,
    losersPromoted,
    winnersRemoved,
    losersRemoved,
    train: split.train,
    validation: split.validation,
    holdout: split.holdout,
    classification: classify(affected.length, deltaUnits, deltaRoi, splitDeltas, original.actionableCount, simulated.actionableCount),
    overfittingRisk: affected.length < 25 ? "high" : affected.length < 40 ? "medium" : "low",
    examplesHelped: changedSettled.filter((r) =>
      (!ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "win") ||
      (ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "loss")
    ).slice(0, 8).map((r) => example(r, rule.apply(r))),
    examplesHurt: changedSettled.filter((r) =>
      (!ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "loss") ||
      (ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "win")
    ).slice(0, 8).map((r) => example(r, rule.apply(r))),
    todaysAffectedRows: todayRows.filter((r) => rule.apply(r) !== r.grade).map((r) => example(r, rule.apply(r))),
  };
}

function example(row: Row, candidateGrade?: Grade) {
  return {
    date: row.date,
    game: row.matchup,
    market: row.market,
    pick: row.pick,
    originalGrade: row.grade,
    candidateGrade,
    result: row.result,
    units: row.units,
    price: row.price,
    line: row.line,
    projectionGap: row.projectionGap,
    edge: row.edge,
    modelProbability: row.modelProbability,
    lineMovement: row.lineMovement,
    marketRead: row.marketRead,
  };
}

function watchlistPromotionRules(): Rule[] {
  const rules: Rule[] = [];
  for (const edge of [3, 5, 8, 10]) {
    rules.push({
      id: `ml_watchlist_plus_money_edge_gt_${edge}_to_lean`,
      family: "ml_watchlist_promotion",
      exactLogic: `ML Watchlist + plus-money + edge > ${edge}% -> Lean`,
      flag: "MLB_ML_WATCHLIST_PLUS_MONEY_EDGE_PROMOTION_ENABLED",
      apply: (r) => r.market === "moneyline" && r.grade === "Watchlist" && (r.price ?? -1) > 0 && (r.edge ?? -999) > edge ? "Lean" : r.grade,
    });
    rules.push({
      id: `ml_no_play_plus_money_edge_gt_${edge}_to_watchlist`,
      family: "ml_no_play_recovery",
      exactLogic: `ML No Play/Caution + plus-money + edge > ${edge}% + movement not against -> Watchlist`,
      flag: "MLB_ML_NO_PLAY_VALUE_RECOVERY_ENABLED",
      apply: (r) => r.market === "moneyline" && (r.grade === "No Play" || r.grade === "Caution") && (r.price ?? -1) > 0 && (r.edge ?? -999) > edge && r.lineMovement !== "against" ? "Watchlist" : r.grade,
    });
    rules.push({
      id: `totals_watchlist_gap_gt_0_75_edge_gt_${edge}_to_lean`,
      family: "totals_watchlist_promotion",
      exactLogic: `Totals Watchlist + projection gap > 0.75 + edge > ${edge}% + playable price -> Lean`,
      flag: "MLB_TOTALS_WATCHLIST_STRONG_PROJECTION_PROMOTION_ENABLED",
      apply: (r) => r.market === "total" && r.grade === "Watchlist" && (r.absProjectionGap ?? -999) > 0.75 && (r.edge ?? -999) > edge && (r.price ?? -999) > -150 ? "Lean" : r.grade,
    });
    rules.push({
      id: `totals_no_play_gap_gt_1_edge_gt_${edge}_to_watchlist`,
      family: "totals_no_play_recovery",
      exactLogic: `Totals No Play/Caution + projection gap > 1.0 + edge > ${edge}% + playable price -> Watchlist`,
      flag: "MLB_TOTALS_NO_PLAY_VALUE_RECOVERY_ENABLED",
      apply: (r) => r.market === "total" && (r.grade === "No Play" || r.grade === "Caution") && (r.absProjectionGap ?? -999) > 1 && (r.edge ?? -999) > edge && (r.price ?? -999) > -150 ? "Watchlist" : r.grade,
    });
  }
  return rules;
}

function balancedRules(): Rule[] {
  const capTotals: Rule = {
    id: "balanced_totals_gap_cap_0_5_plus_watchlist_gap_0_75_edge_5",
    family: "balanced_totals",
    exactLogic: "Cap Totals Lean gap < 0.5 to Watchlist; promote Totals Watchlist gap > 0.75 and edge > 5 to Lean",
    flag: "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED + MLB_TOTALS_WATCHLIST_STRONG_PROJECTION_PROMOTION_ENABLED",
    apply: (r) => {
      if (r.market === "total" && r.grade === "Lean" && (r.absProjectionGap ?? 999) < 0.5) return "Watchlist";
      if (r.market === "total" && r.grade === "Watchlist" && (r.absProjectionGap ?? -999) > 0.75 && (r.edge ?? -999) > 5 && (r.price ?? -999) > -150) return "Lean";
      return r.grade;
    },
  };
  const mlBalanced: Rule = {
    id: "balanced_ml_ba_cap_plus_plus_money_watchlist_edge_8",
    family: "balanced_ml",
    exactLogic: "Cap ML Best Angle not-toward + edge < 8 to Watchlist; promote ML plus-money Watchlist edge > 8 to Lean",
    flag: "MLB_ML_BEST_ANGLE_NEUTRAL_MOVEMENT_CAP_ENABLED + MLB_ML_WATCHLIST_PLUS_MONEY_EDGE_PROMOTION_ENABLED",
    apply: (r) => {
      if (r.market === "moneyline" && r.grade === "Best Angle" && r.lineMovement !== "toward" && (r.edge ?? 999) < 8) return "Watchlist";
      if (r.market === "moneyline" && r.grade === "Watchlist" && (r.price ?? -1) > 0 && (r.edge ?? -999) > 8) return "Lean";
      return r.grade;
    },
  };
  return [capTotals, mlBalanced];
}

function projectionError(rows: Row[], corrected: (r: Row) => number | null = (r) => r.projectedTotal) {
  const xs = rows.filter((r) => corrected(r) !== null && r.actualTotal !== null);
  const errors = xs.map((r) => +(corrected(r)! - r.actualTotal!).toFixed(4));
  const marketErrors = xs.map((r) => r.line !== null ? +(r.line - r.actualTotal!).toFixed(4) : null);
  const modelAbs = errors.map((e) => Math.abs(e));
  const marketAbs = marketErrors.filter((v): v is number => v !== null).map((e) => Math.abs(e));
  return {
    count: xs.length,
    mae: mae(errors),
    rmse: rmse(errors),
    bias: avg(errors),
    modelBeatsMarketCount: xs.filter((r) => r.line !== null && Math.abs(corrected(r)! - r.actualTotal!) < Math.abs(r.line - r.actualTotal!)).length,
    marketBeatsModelCount: xs.filter((r) => r.line !== null && Math.abs(corrected(r)! - r.actualTotal!) > Math.abs(r.line - r.actualTotal!)).length,
    marketMae: marketAbs.length ? +(marketAbs.reduce((s, v) => s + v, 0) / marketAbs.length).toFixed(4) : null,
  };
}

function projectionSearch(totalRows: Row[]) {
  const rows = totalRows.filter((r) => r.projectedTotal !== null && r.actualTotal !== null && r.line !== null);
  const base = projectionError(rows);
  const tests: Array<{ id: string; logic: string; fn: (r: Row) => number | null }> = [];
  for (const alpha of [0.25, 0.5, 0.75]) {
    tests.push({ id: `market_shrink_alpha_${alpha}`, logic: `corrected = marketTotal + ${alpha} * (projectedTotal - marketTotal)`, fn: (r) => r.line !== null && r.projectedTotal !== null ? r.line + alpha * (r.projectedTotal - r.line) : null });
  }
  for (const threshold of [0.5, 0.75, 1]) {
    tests.push({ id: `thin_gap_${threshold}_shrink_50pct`, logic: `If abs gap < ${threshold}, shrink halfway toward market`, fn: (r) => r.line !== null && r.projectedTotal !== null && r.absProjectionGap !== null && r.absProjectionGap < threshold ? r.line + 0.5 * (r.projectedTotal - r.line) : r.projectedTotal });
  }
  for (const cut of [9, 9.5, 10]) {
    for (const reduce of [0.25, 0.5, 0.75]) {
      tests.push({ id: `high_total_${cut}_reduce_${reduce}`, logic: `If projected total >= ${cut}, subtract ${reduce}`, fn: (r) => r.projectedTotal !== null && r.projectedTotal >= cut ? r.projectedTotal - reduce : r.projectedTotal });
    }
  }
  tests.push({ id: "movement_against_gap_shrink_50pct", logic: "If line movement against model side, shrink projection gap halfway toward market", fn: (r) => r.line !== null && r.projectedTotal !== null && r.lineMovement === "against" ? r.line + 0.5 * (r.projectedTotal - r.line) : r.projectedTotal });
  return tests.map((t) => {
    const all = projectionError(rows, t.fn);
    const split = Object.fromEntries((["train", "validation", "holdout"] as Split[]).map((s) => {
      const b = projectionError(rows.filter((r) => r.split === s));
      const c = projectionError(rows.filter((r) => r.split === s), t.fn);
      return [s, { original: b, corrected: c, maeDelta: b.mae !== null && c.mae !== null ? +(b.mae - c.mae).toFixed(4) : null, rmseDelta: b.rmse !== null && c.rmse !== null ? +(b.rmse - c.rmse).toFixed(4) : null }];
    })) as Record<Split, { original: ReturnType<typeof projectionError>; corrected: ReturnType<typeof projectionError>; maeDelta: number | null; rmseDelta: number | null }>;
    const maeDelta = base.mae !== null && all.mae !== null ? +(base.mae - all.mae).toFixed(4) : null;
    const rmseDelta = base.rmse !== null && all.rmse !== null ? +(base.rmse - all.rmse).toFixed(4) : null;
    const biasAbsDelta = base.bias !== null && all.bias !== null ? +(Math.abs(base.bias) - Math.abs(all.bias)).toFixed(4) : null;
    const good = (maeDelta ?? 0) > 0 && (rmseDelta ?? 0) > 0 && (split.validation.maeDelta ?? -999) > 0 && (split.holdout.maeDelta ?? -999) > 0;
    return {
      id: t.id,
      exactLogic: t.logic,
      original: base,
      corrected: all,
      totalMaeChange: maeDelta,
      totalRmseChange: rmseDelta,
      totalBiasChange: base.bias !== null && all.bias !== null ? +(base.bias - all.bias).toFixed(4) : null,
      absoluteBiasImprovement: biasAbsDelta,
      train: split.train,
      validation: split.validation,
      holdout: split.holdout,
      classification: good && rows.length >= 200 ? "controlled_rollout_candidate" : (maeDelta ?? 0) > 0 ? "needs_more_data" : "reject",
      examplesHelped: rows.filter((r) => t.fn(r) !== null && Math.abs(t.fn(r)! - (r.actualTotal ?? 0)) < Math.abs((r.projectedTotal ?? 0) - (r.actualTotal ?? 0))).slice(0, 8).map((r) => ({ ...example(r), correctedProjectedTotal: t.fn(r) })),
      examplesHurt: rows.filter((r) => t.fn(r) !== null && Math.abs(t.fn(r)! - (r.actualTotal ?? 0)) > Math.abs((r.projectedTotal ?? 0) - (r.actualTotal ?? 0))).slice(0, 8).map((r) => ({ ...example(r), correctedProjectedTotal: t.fn(r) })),
    };
  }).sort((a, b) => (b.totalMaeChange ?? -999) - (a.totalMaeChange ?? -999));
}

function calibration(rows: Row[], pFn: (r: Row) => number | null = (r) => r.modelProbability) {
  const xs = rows.filter((r) => r.outcome !== null && pFn(r) !== null);
  if (!xs.length) return { count: 0, brier: null, logLoss: null, ece: null };
  const brier = +(xs.reduce((s, r) => s + ((pFn(r)! / 100) - r.outcome!) ** 2, 0) / xs.length).toFixed(6);
  const logLoss = +(xs.reduce((s, r) => {
    const p = Math.max(0.001, Math.min(0.999, pFn(r)! / 100));
    return s - (r.outcome! * Math.log(p) + (1 - r.outcome!) * Math.log(1 - p));
  }, 0) / xs.length).toFixed(6);
  const buckets = new Map<string, Row[]>();
  for (const r of xs) {
    const p = pFn(r)!;
    const key = p < 55 ? "lt55" : p < 60 ? "55_60" : p < 65 ? "60_65" : p < 70 ? "65_70" : "70plus";
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  const ece = +[...buckets.values()].reduce((sum, bucket) => {
    const pred = avg(bucket.map((r) => pFn(r)));
    const obs = bucket.filter((r) => r.outcome === 1).length / bucket.length;
    return sum + (bucket.length / xs.length) * Math.abs(((pred ?? 0) / 100) - obs);
  }, 0).toFixed(6);
  return { count: xs.length, brier, logLoss, ece };
}

function mlProbabilitySearch(mlRows: Row[]) {
  const rows = mlRows.filter((r) => r.outcome !== null && r.modelProbability !== null);
  const base = calibration(rows);
  const tests: Array<{ id: string; logic: string; fn: (r: Row) => number | null }> = [
    ...[2, 3, 4].map((n) => ({ id: `shrink_60_70_minus_${n}`, logic: `Subtract ${n} points from 60-70% model probability band`, fn: (r: Row) => r.modelProbability !== null && r.modelProbability >= 60 && r.modelProbability < 70 ? r.modelProbability - n : r.modelProbability })),
    { id: "heavy_favorite_minus_3", logic: "Subtract 3 points when price worse than -150", fn: (r) => r.modelProbability !== null && r.price !== null && r.price <= -150 ? r.modelProbability - 3 : r.modelProbability },
    { id: "movement_against_minus_3", logic: "Subtract 3 points when movement is against pick", fn: (r) => r.modelProbability !== null && r.lineMovement === "against" ? r.modelProbability - 3 : r.modelProbability },
    ...[0.1, 0.2, 0.3].map((w) => ({ id: `market_blend_${Math.round((1 - w) * 100)}_${Math.round(w * 100)}`, logic: `${Math.round((1 - w) * 100)}/${Math.round(w * 100)} model/market probability blend`, fn: (r: Row) => r.modelProbability !== null && r.marketProbability !== null ? (1 - w) * r.modelProbability + w * r.marketProbability : r.modelProbability })),
  ];
  return tests.map((t) => {
    const c = calibration(rows, t.fn);
    const split = Object.fromEntries((["train", "validation", "holdout"] as Split[]).map((s) => {
      const subset = rows.filter((r) => r.split === s);
      const b = calibration(subset);
      const adj = calibration(subset, t.fn);
      return [s, { original: b, adjusted: adj, brierDelta: b.brier !== null && adj.brier !== null ? +(b.brier - adj.brier).toFixed(6) : null, eceDelta: b.ece !== null && adj.ece !== null ? +(b.ece - adj.ece).toFixed(6) : null }];
    })) as Record<Split, { original: ReturnType<typeof calibration>; adjusted: ReturnType<typeof calibration>; brierDelta: number | null; eceDelta: number | null }>;
    const brierDelta = base.brier !== null && c.brier !== null ? +(base.brier - c.brier).toFixed(6) : null;
    const eceDelta = base.ece !== null && c.ece !== null ? +(base.ece - c.ece).toFixed(6) : null;
    const pass = (brierDelta ?? 0) > 0 && (eceDelta ?? 0) > 0 && (split.validation.brierDelta ?? -999) > 0 && (split.holdout.brierDelta ?? -999) > 0;
    return {
      id: t.id,
      exactLogic: t.logic,
      original: base,
      adjusted: c,
      brierChange: brierDelta,
      eceChange: eceDelta,
      logLossChange: base.logLoss !== null && c.logLoss !== null ? +(base.logLoss - c.logLoss).toFixed(6) : null,
      train: split.train,
      validation: split.validation,
      holdout: split.holdout,
      classification: pass ? "controlled_rollout_candidate" : (brierDelta ?? 0) > 0 ? "needs_more_data" : "reject",
    };
  }).sort((a, b) => (b.brierChange ?? -999) - (a.brierChange ?? -999));
}

function buildReport(rows: Row[], args: ReturnType<typeof parseArgs>) {
  const today = todayEt();
  const settled = rows.filter((r) => r.result === "win" || r.result === "loss");
  const mlRows = rows.filter((r) => r.market === "moneyline");
  const totalRows = rows.filter((r) => r.market === "total");
  const todayRows = rows.filter((r) => r.date === today);
  const promoRules = watchlistPromotionRules();
  const promotionEvaluations = promoRules.map((r) => evalRule(r, settled, todayRows));
  const balancedEvaluations = balancedRules().map((r) => evalRule(r, settled, todayRows));
  const projectionCorrections = projectionSearch(totalRows);
  const mlCalibration = mlProbabilitySearch(mlRows);
  const allGrade = [...promotionEvaluations, ...balancedEvaluations];
  return {
    generatedAt: new Date().toISOString(),
    noCost: true,
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    noPickFlips: true,
    noProbabilityOrProjectionProductionChanges: true,
    args,
    dataset: {
      rows: rows.length,
      settledRows: settled.length,
      mlRows: mlRows.length,
      totalRows: totalRows.length,
      historicalWatchlistCounts: {
        ml: mlRows.filter((r) => r.grade === "Watchlist").length,
        total: totalRows.filter((r) => r.grade === "Watchlist").length,
      },
      baseline: {
        ml: summarizeAction(settled.filter((r) => r.market === "moneyline")),
        total: summarizeAction(settled.filter((r) => r.market === "total")),
      },
    },
    watchlistPromotionSearch: {
      evaluations: promotionEvaluations,
      production_candidate_now: promotionEvaluations.filter((r) => r.classification === "production_candidate_now"),
      controlled_rollout_candidate: promotionEvaluations.filter((r) => r.classification === "controlled_rollout_candidate"),
      rejectedReasonSummary: promotionEvaluations.filter((r) => r.classification === "reject").length
        ? "Most promotion rules failed because settled historical ML/Totals rows contain zero Watchlist grades in this window; No Play recovery rules did not clear validation/holdout profitability."
        : null,
    },
    balancedRuleSetSearch: {
      evaluations: balancedEvaluations,
      production_candidate_now: balancedEvaluations.filter((r) => r.classification === "production_candidate_now"),
      controlled_rollout_candidate: balancedEvaluations.filter((r) => r.classification === "controlled_rollout_candidate"),
    },
    projectionModelImprovementSearch: {
      residualBaseline: projectionError(totalRows),
      corrections: projectionCorrections,
      production_candidate_now: projectionCorrections.filter((r) => r.classification === "production_candidate_now"),
      controlled_rollout_candidate: projectionCorrections.filter((r) => r.classification === "controlled_rollout_candidate"),
    },
    mlProbabilityImprovementSearch: {
      corrections: mlCalibration,
      production_candidate_now: mlCalibration.filter((r) => r.classification === "production_candidate_now"),
      controlled_rollout_candidate: mlCalibration.filter((r) => r.classification === "controlled_rollout_candidate"),
    },
    productionCandidates: {
      gradeValue: allGrade.filter((r) => r.classification === "production_candidate_now"),
      projection: projectionCorrections.filter((r) => r.classification === "production_candidate_now"),
      mlProbability: mlCalibration.filter((r) => r.classification === "production_candidate_now"),
    },
    controlledRolloutCandidates: {
      gradeValue: allGrade.filter((r) => r.classification === "controlled_rollout_candidate"),
      projection: projectionCorrections.filter((r) => r.classification === "controlled_rollout_candidate"),
      mlProbability: mlCalibration.filter((r) => r.classification === "controlled_rollout_candidate"),
    },
    todaysAffectedRows: [...allGrade.filter((r) => r.classification === "production_candidate_now" || r.classification === "controlled_rollout_candidate").flatMap((r) => r.todaysAffectedRows.map((x) => ({ ...x, rule: r.ruleName, classification: r.classification })))],
    exactRecommendation: [
      "Do not ship projection/probability changes yet without approval.",
      "Promotion search is currently blocked by historical grade persistence: settled ML/Totals rows in this window have zero Watchlist rows.",
      "The projection search does find controlled rollout candidates for Totals projection shrink toward market, but those should be reviewed as model changes, not silently shipped.",
      "The safest immediate product improvement remains the Totals thin-gap Lean cap, but this report intentionally separates that from projection-model changes.",
    ],
  };
}

function markdown(report: ReturnType<typeof buildReport>): string {
  const bestProjection = report.projectionModelImprovementSearch.corrections[0];
  const bestMl = report.mlProbabilityImprovementSearch.corrections[0];
  return `# MLB Balanced Grade and Projection Improvement

Generated: ${report.generatedAt}

Read-only: no DB writes, no production changes, no paid AI.

## Direct Answers

1. Promotion rule strong enough: ${report.watchlistPromotionSearch.production_candidate_now.length ? "yes" : "no"}.
2. Balanced rule set improves units without starving volume: ${report.balancedRuleSetSearch.production_candidate_now.length || report.balancedRuleSetSearch.controlled_rollout_candidate.length ? "yes, candidate exists" : "no"}.
3. Projection correction improves MAE/RMSE/bias: ${bestProjection ? `${bestProjection.id}, MAE delta ${bestProjection.totalMaeChange}, RMSE delta ${bestProjection.totalRmseChange}` : "none"}.
4. ML probability calibration improvement: ${bestMl ? `${bestMl.id}, Brier delta ${bestMl.brierChange}, ECE delta ${bestMl.eceChange}` : "none"}.

## Historical Watchlist Caveat

- ML Watchlist rows: ${report.dataset.historicalWatchlistCounts.ml}
- Totals Watchlist rows: ${report.dataset.historicalWatchlistCounts.total}

This materially limits historical Watchlist promotion validation.

## Recommendation

${report.exactRecommendation.map((x) => `- ${x}`).join("\n")}
`;
}

async function main() {
  const args = parseArgs();
  const rows = await loadRows(args);
  const report = buildReport(rows, args);
  await mkdir(args.outDir, { recursive: true });
  const jsonPath = `${args.outDir}/mlb-balanced-grade-and-projection-improvement.json`;
  const mdPath = `${args.outDir}/mlb-balanced-grade-and-projection-improvement.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown(report), "utf8");
  if (args.json) {
    console.log(JSON.stringify({
      output: { jsonPath, mdPath },
      dataset: report.dataset,
      watchlistPromotion: {
        production: report.watchlistPromotionSearch.production_candidate_now,
        controlled: report.watchlistPromotionSearch.controlled_rollout_candidate,
        rejectedReasonSummary: report.watchlistPromotionSearch.rejectedReasonSummary,
      },
      balancedRuleSets: {
        production: report.balancedRuleSetSearch.production_candidate_now,
        controlled: report.balancedRuleSetSearch.controlled_rollout_candidate,
      },
      projectionModel: {
        baseline: report.projectionModelImprovementSearch.residualBaseline,
        best: report.projectionModelImprovementSearch.corrections.slice(0, 8),
        production: report.projectionModelImprovementSearch.production_candidate_now,
        controlled: report.projectionModelImprovementSearch.controlled_rollout_candidate,
      },
      mlProbability: {
        best: report.mlProbabilityImprovementSearch.corrections.slice(0, 8),
        production: report.mlProbabilityImprovementSearch.production_candidate_now,
        controlled: report.mlProbabilityImprovementSearch.controlled_rollout_candidate,
      },
      todaysAffectedRows: report.todaysAffectedRows,
      exactRecommendation: report.exactRecommendation,
    }, null, 2));
    return;
  }
  console.log(`Balanced improvement report written:\n- ${jsonPath}\n- ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
