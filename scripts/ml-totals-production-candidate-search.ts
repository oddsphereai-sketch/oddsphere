/**
 * MLB ML/Totals Production Candidate Rule Search.
 *
 * Read-only: no DB writes, no production changes, no paid AI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "../lib/db/supabase";

type Market = "moneyline" | "total";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";
type Split = "train" | "validation" | "holdout";
type CandidateClass = "production_candidate_now" | "controlled_rollout_candidate" | "needs_more_data" | "reject";

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

type Row = {
  id: number;
  date: string;
  split: Split;
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
  projectedTotal: number | null;
  projectionGap: number | null;
  absProjectionGap: number | null;
  direction: "over" | "under" | "unknown";
  lineMovement: "toward" | "against" | "neutral" | "unknown";
  marketRead: string;
  sourceContext: string;
  result: Result;
  units: number | null;
};

type Rule = {
  id: string;
  family: "ml_cap" | "ml_promotion" | "totals_cap" | "totals_promotion" | "combined";
  market: Market | "both";
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

function projectionTotal(snapshot: Record<string, unknown> | null): number | null {
  const away = num(snapshot, ["total_projection_reconciliation.reconciled_away_score", "v2_2_audit.posterior_away_runs", "predicted_scores_at_lock.away", "review_v1.reviewed.away_score"]);
  const home = num(snapshot, ["total_projection_reconciliation.reconciled_home_score", "v2_2_audit.posterior_home_runs", "predicted_scores_at_lock.home", "review_v1.reviewed.home_score"]);
  return num(snapshot, ["total_projection_reconciliation.reconciled_total", "v2_2_audit.posterior_total", "review_v1.reviewed.total"]) ??
    (away !== null && home !== null ? +(away + home).toFixed(4) : null);
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

function sourceContext(snapshot: Record<string, unknown> | null): string {
  const rows = snapshot?.signal_rows_at_lock;
  const hasConsensus = Array.isArray(rows) && rows.some((r) => r && typeof r === "object" && ((r as Record<string, unknown>).public_money_pct !== null || (r as Record<string, unknown>).public_betting_pct !== null));
  const hasSharp = Array.isArray(rows) && rows.some((r) => r && typeof r === "object" && ((r as Record<string, unknown>).has_steam_move === true || (r as Record<string, unknown>).has_reverse_line_movement === true || typeof (r as Record<string, unknown>).signal_strength === "string"));
  const conflict = JSON.stringify(snapshot ?? {}).toLowerCase().includes("source_conflict") || JSON.stringify(snapshot ?? {}).toLowerCase().includes('"conflict":true');
  if (conflict) return "source_conflict";
  if (hasConsensus && hasSharp) return "consensus_and_sharp";
  if (hasConsensus) return "consensus_only";
  if (hasSharp) return "sharp_only";
  return "not_persisted";
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
  const rows = rawRows.flatMap((raw): Row[] => {
    if (raw.launch_day === true) return [];
    const market = normalizeMarket(raw.market);
    if (!market) return [];
    const result = normalizeResult(one(raw.prediction_grades)?.result);
    const projectedTotal = projectionTotal(raw.snapshot_json);
    const side = String(raw.side ?? raw.pick ?? "").toLowerCase();
    const direction = /under/.test(side) ? "under" : /over/.test(side) ? "over" : "unknown";
    const signedGap = market === "total" && projectedTotal !== null && raw.line_value !== null
      ? direction === "under" ? raw.line_value - projectedTotal : projectedTotal - raw.line_value
      : null;
    return [{
      id: raw.id,
      date: raw.slate_date,
      split: "train",
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
      projectedTotal,
      projectionGap: signedGap,
      absProjectionGap: signedGap === null ? null : Math.abs(signedGap),
      direction,
      lineMovement: movement(raw.snapshot_json),
      marketRead: marketRead(raw.snapshot_json),
      sourceContext: sourceContext(raw.snapshot_json),
      result,
      units: units(raw.odds_american, result),
    }];
  });
  return splitRows(rows);
}

function setGrade(target: Grade) {
  return (_: Row) => target;
}

function worseThan(price: number | null, threshold: number): boolean {
  return price !== null && price <= threshold;
}

function notToward(row: Row): boolean {
  return row.lineMovement === "neutral" || row.lineMovement === "against" || row.lineMovement === "unknown";
}

function marketFriction(row: Row): boolean {
  const read = row.marketRead.toLowerCase();
  return /mixed|resist|conflict/.test(read) || row.sourceContext === "source_conflict" || row.lineMovement === "against";
}

function playablePrice(row: Row): boolean {
  return row.price !== null && row.price > -150;
}

function rules(): Rule[] {
  const out: Rule[] = [];
  const edgeThresholds = [2, 5, 8];
  const mlPrices = [-150, -200];
  for (const edge of edgeThresholds) {
    out.push({
      id: `ml_ba_not_toward_edge_lt_${edge}_to_watchlist`,
      family: "ml_cap",
      market: "moneyline",
      exactLogic: `ML Best Angle + line movement not toward pick + edge < ${edge}% -> Watchlist`,
      flag: "MLB_ML_BEST_ANGLE_NEUTRAL_MOVEMENT_CAP_ENABLED",
      apply: (r) => r.market === "moneyline" && r.grade === "Best Angle" && notToward(r) && (r.edge ?? 999) < edge ? "Watchlist" : r.grade,
    });
    out.push({
      id: `ml_lean_heavy_edge_lt_${edge}_to_watchlist`,
      family: "ml_cap",
      market: "moneyline",
      exactLogic: `ML Lean + price worse than -150 + edge < ${edge}% -> Watchlist`,
      flag: "MLB_ML_FAVORITE_PRICE_CAP_ENABLED",
      apply: (r) => r.market === "moneyline" && r.grade === "Lean" && worseThan(r.price, -150) && (r.edge ?? 999) < edge ? "Watchlist" : r.grade,
    });
    out.push({
      id: `ml_watchlist_plus_money_edge_gt_${edge}_to_lean`,
      family: "ml_promotion",
      market: "moneyline",
      exactLogic: `ML Watchlist + plus-money price + edge > ${edge}% -> Lean`,
      flag: "MLB_ML_WATCHLIST_PLUS_MONEY_EDGE_PROMOTION_ENABLED",
      apply: (r) => r.market === "moneyline" && r.grade === "Watchlist" && (r.price ?? -1) > 0 && (r.edge ?? -999) > edge ? "Lean" : r.grade,
    });
    out.push({
      id: `ml_watchlist_edge_gt_${edge}_toward_to_lean`,
      family: "ml_promotion",
      market: "moneyline",
      exactLogic: `ML Watchlist + edge > ${edge}% + line movement toward pick -> Lean`,
      flag: "MLB_ML_WATCHLIST_PLUS_MONEY_EDGE_PROMOTION_ENABLED",
      apply: (r) => r.market === "moneyline" && r.grade === "Watchlist" && (r.edge ?? -999) > edge && r.lineMovement === "toward" ? "Lean" : r.grade,
    });
  }
  for (const price of mlPrices) {
    for (const edge of [5, 8]) {
      out.push({
        id: `ml_ba_price_${Math.abs(price)}_edge_lt_${edge}_not_toward_to_watchlist`,
        family: "ml_cap",
        market: "moneyline",
        exactLogic: `ML Best Angle + price worse than ${price} + edge < ${edge}% + movement not toward -> Watchlist`,
        flag: "MLB_ML_FAVORITE_PRICE_CAP_ENABLED",
        apply: (r) => r.market === "moneyline" && r.grade === "Best Angle" && worseThan(r.price, price) && (r.edge ?? 999) < edge && notToward(r) ? "Watchlist" : r.grade,
      });
    }
  }
  out.push({
    id: "ml_ba_prob_60_70_not_toward_to_watchlist",
    family: "ml_cap",
    market: "moneyline",
    exactLogic: "ML Best Angle + model probability 60-70% + movement not toward -> Watchlist",
    flag: "MLB_ML_PROBABILITY_BAND_GRADE_CAP_ENABLED",
    apply: (r) => r.market === "moneyline" && r.grade === "Best Angle" && (r.modelProbability ?? 0) >= 60 && (r.modelProbability ?? 0) < 70 && notToward(r) ? "Watchlist" : r.grade,
  });

  for (const gap of [0.5, 0.75, 1, 1.25]) {
    out.push({
      id: `totals_lean_gap_lt_${String(gap).replace(".", "_")}_to_watchlist`,
      family: "totals_cap",
      market: "total",
      exactLogic: `Totals Lean + projection gap < ${gap} -> Watchlist`,
      flag: "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED",
      apply: (r) => r.market === "total" && r.grade === "Lean" && (r.absProjectionGap ?? 999) < gap ? "Watchlist" : r.grade,
    });
    out.push({
      id: `totals_watchlist_gap_gt_${String(gap).replace(".", "_")}_playable_to_lean`,
      family: "totals_promotion",
      market: "total",
      exactLogic: `Totals Watchlist + projection gap > ${gap} + playable price -> Lean`,
      flag: "MLB_TOTALS_WATCHLIST_STRONG_PROJECTION_PROMOTION_ENABLED",
      apply: (r) => r.market === "total" && r.grade === "Watchlist" && (r.absProjectionGap ?? -999) > gap && playablePrice(r) ? "Lean" : r.grade,
    });
  }
  for (const edge of [2, 5, 8]) {
    out.push({
      id: `totals_lean_edge_lt_${edge}_friction_to_watchlist`,
      family: "totals_cap",
      market: "total",
      exactLogic: `Totals Lean + edge < ${edge}% + market friction -> Watchlist`,
      flag: "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED",
      apply: (r) => r.market === "total" && r.grade === "Lean" && (r.edge ?? 999) < edge && marketFriction(r) ? "Watchlist" : r.grade,
    });
    out.push({
      id: `totals_watchlist_edge_gt_${edge}_toward_to_lean`,
      family: "totals_promotion",
      market: "total",
      exactLogic: `Totals Watchlist + edge > ${edge}% + movement toward pick -> Lean`,
      flag: "MLB_TOTALS_WATCHLIST_STRONG_PROJECTION_PROMOTION_ENABLED",
      apply: (r) => r.market === "total" && r.grade === "Watchlist" && (r.edge ?? -999) > edge && r.lineMovement === "toward" ? "Lean" : r.grade,
    });
  }
  out.push({
    id: "totals_ba_gap_lt_1_to_lean",
    family: "totals_cap",
    market: "total",
    exactLogic: "Totals Best Angle + projection gap < 1.0 -> Lean",
    flag: "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED",
    apply: (r) => r.market === "total" && r.grade === "Best Angle" && (r.absProjectionGap ?? 999) < 1 ? "Lean" : r.grade,
  });
  const byId = new Map(out.map((r) => [r.id, r]));
  const comboPairs = [
    ["totals_lean_gap_lt_1_to_watchlist", "totals_watchlist_gap_gt_1_playable_to_lean", "combined_totals_thin_cap_plus_strong_watchlist_promo", "Totals thin Lean cap + strong Watchlist projection promotion", "MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED + MLB_TOTALS_WATCHLIST_STRONG_PROJECTION_PROMOTION_ENABLED"],
    ["ml_ba_prob_60_70_not_toward_to_watchlist", "ml_watchlist_plus_money_edge_gt_5_to_lean", "combined_ml_band_cap_plus_plus_money_promo", "ML 60-70 Best Angle cap + plus-money Watchlist promotion", "MLB_ML_PROBABILITY_BAND_GRADE_CAP_ENABLED + MLB_ML_WATCHLIST_PLUS_MONEY_EDGE_PROMOTION_ENABLED"],
    ["ml_ba_price_150_edge_lt_8_not_toward_to_watchlist", "ml_watchlist_plus_money_edge_gt_5_to_lean", "combined_ml_favorite_cap_plus_plus_money_promo", "ML favorite Best Angle cap + plus-money Watchlist promotion", "MLB_ML_FAVORITE_PRICE_CAP_ENABLED + MLB_ML_WATCHLIST_PLUS_MONEY_EDGE_PROMOTION_ENABLED"],
  ];
  for (const [a, b, id, exactLogic, flag] of comboPairs) {
    const ra = byId.get(a);
    const rb = byId.get(b);
    if (!ra || !rb) continue;
    out.push({
      id,
      family: "combined",
      market: "both",
      exactLogic,
      flag,
      apply: (r) => rb.apply({ ...r, grade: ra.apply(r) }),
    });
  }
  return out;
}

function summarize(rows: Row[], gradeFn: (r: Row) => Grade = (r) => r.grade) {
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
    avgPrice: avg(actionable.map((r) => r.price)),
    gradeDistribution: Object.fromEntries(GRADES.map((g) => [g, rows.filter((r) => gradeFn(r) === g).length])),
  };
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4) : null;
}

function evaluateRule(rule: Rule, rows: Row[], todayRows: Row[]) {
  const eligible = rows.filter((r) => rule.market === "both" || r.market === rule.market);
  const affected = eligible.filter((r) => rule.apply(r) !== r.grade);
  const original = summarize(eligible);
  const simulated = summarize(eligible, (r) => rule.apply(r));
  const changedSettled = affected.filter((r) => (r.result === "win" || r.result === "loss") && r.units !== null);
  const winnersRemoved = changedSettled.filter((r) => ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "win").length;
  const losersRemoved = changedSettled.filter((r) => ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "loss").length;
  const winnersPromoted = changedSettled.filter((r) => !ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "win").length;
  const losersPromoted = changedSettled.filter((r) => !ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "loss").length;
  const bySplit = Object.fromEntries((["train", "validation", "holdout"] as Split[]).map((split) => {
    const subset = eligible.filter((r) => r.split === split);
    const o = summarize(subset);
    const s = summarize(subset, (r) => rule.apply(r));
    return [split, { original: o, simulated: s, deltaUnits: +(s.units - o.units).toFixed(4), deltaRoi: s.roi !== null && o.roi !== null ? +(s.roi - o.roi).toFixed(4) : null, affectedRows: subset.filter((r) => rule.apply(r) !== r.grade).length }];
  }));
  const deltaUnits = +(simulated.units - original.units).toFixed(4);
  const deltaRoi = simulated.roi !== null && original.roi !== null ? +(simulated.roi - original.roi).toFixed(4) : null;
  const todayAffected = todayRows.filter((r) => rule.apply(r) !== r.grade).map((r) => ({
    game: r.matchup,
    market: r.market,
    pick: r.pick,
    originalGrade: r.grade,
    candidateGrade: rule.apply(r),
    ruleTriggered: rule.id,
    price: r.price,
    line: r.line,
    projectionGap: r.projectionGap,
    edge: r.edge,
    lineMovement: r.lineMovement,
    marketRead: r.marketRead,
    wouldAffectPublicBestAngleLeanCountToday: ACTIONABLE.has(r.grade) !== ACTIONABLE.has(rule.apply(r)),
  }));
  return {
    ruleName: rule.id,
    family: rule.family,
    exactLogic: rule.exactLogic,
    flag: rule.flag,
    eligibleRows: eligible.length,
    affectedRows: affected.length,
    originalGradeDistribution: original.gradeDistribution,
    simulatedGradeDistribution: simulated.gradeDistribution,
    originalRecordUnitsRoi: original,
    simulatedRecordUnitsRoi: simulated,
    deltaUnits,
    deltaRoi,
    actionableCountBefore: original.actionableCount,
    actionableCountAfter: simulated.actionableCount,
    winnersRemoved,
    losersRemoved,
    winnersPromoted,
    losersPromoted,
    averagePriceBefore: original.avgPrice,
    averagePriceAfter: simulated.avgPrice,
    train: bySplit.train,
    validation: bySplit.validation,
    holdout: bySplit.holdout,
    minimumSampleWarning: affected.length < 25 ? "affected_lt_25_high_variance" : affected.length < 40 ? "affected_25_39_moderate_sample" : "sample_ok",
    overfittingRisk: overfitRisk(affected.length, bySplit),
    classification: classify(affected.length, deltaUnits, deltaRoi, original, simulated, bySplit),
    examplesHelped: changedSettled.filter((r) =>
      (ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "loss") ||
      (!ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "win")
    ).slice(0, 8).map((r) => example(r, rule.apply(r))),
    examplesHurt: changedSettled.filter((r) =>
      (ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)) && r.result === "win") ||
      (!ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)) && r.result === "loss")
    ).slice(0, 8).map((r) => example(r, rule.apply(r))),
    todaysAffectedRowsIfEnabled: todayAffected,
  };
}

function overfitRisk(affected: number, bySplit: Record<string, { deltaUnits: number }>): "low" | "medium" | "high" {
  if (affected < 25) return "high";
  const vals = [bySplit.train.deltaUnits, bySplit.validation.deltaUnits, bySplit.holdout.deltaUnits];
  const positives = vals.filter((v) => v > 0).length;
  if (affected >= 40 && positives >= 3) return "low";
  if (affected >= 25 && positives >= 2) return "medium";
  return "high";
}

function classify(
  affected: number,
  deltaUnits: number,
  deltaRoi: number | null,
  original: ReturnType<typeof summarize>,
  simulated: ReturnType<typeof summarize>,
  bySplit: Record<string, { deltaUnits: number; deltaRoi: number | null }>,
): CandidateClass {
  const trainOk = bySplit.train.deltaUnits > 0;
  const valOk = bySplit.validation.deltaUnits > 0;
  const holdoutOk = bySplit.holdout.deltaUnits >= -0.25;
  const volumeOk = original.actionableCount === 0 || simulated.actionableCount >= original.actionableCount * 0.65;
  if ((affected >= 40 || (affected >= 25 && trainOk && valOk && bySplit.holdout.deltaUnits >= 0)) && deltaUnits > 0 && (deltaRoi ?? -999) > 0 && trainOk && valOk && holdoutOk && volumeOk) return "production_candidate_now";
  if (affected >= 15 && deltaUnits > 0 && trainOk && valOk && volumeOk) return "controlled_rollout_candidate";
  if (affected < 15) return "needs_more_data";
  return "reject";
}

function example(row: Row, candidateGrade: Grade) {
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

function pickBest(evaluations: ReturnType<typeof evaluateRule>[], family: Rule["family"], n = 8) {
  return evaluations
    .filter((r) => r.family === family)
    .sort((a, b) => {
      const classScore = (x: string) => x === "production_candidate_now" ? 4 : x === "controlled_rollout_candidate" ? 3 : x === "needs_more_data" ? 2 : 1;
      return classScore(b.classification) - classScore(a.classification) || b.deltaUnits - a.deltaUnits || b.affectedRows - a.affectedRows;
    })
    .slice(0, n);
}

function buildReport(rows: Row[], args: ReturnType<typeof parseArgs>) {
  const today = todayEt();
  const settled = rows.filter((r) => r.result === "win" || r.result === "loss");
  const todayRows = rows.filter((r) => r.date === today);
  const evaluations = rules().map((rule) => evaluateRule(rule, settled, todayRows));
  const candidates = {
    production_candidate_now: evaluations.filter((r) => r.classification === "production_candidate_now"),
    controlled_rollout_candidate: evaluations.filter((r) => r.classification === "controlled_rollout_candidate"),
    needs_more_data: evaluations.filter((r) => r.classification === "needs_more_data"),
    reject: evaluations.filter((r) => r.classification === "reject"),
  };
  const viable = [...candidates.production_candidate_now, ...candidates.controlled_rollout_candidate];
  return {
    generatedAt: new Date().toISOString(),
    noCost: true,
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    noPickFlips: true,
    noProbabilityOrProjectionChanges: true,
    args,
    dataset: {
      rows: rows.length,
      settledRows: settled.length,
      mlRows: rows.filter((r) => r.market === "moneyline").length,
      totalRows: rows.filter((r) => r.market === "total").length,
      today,
      todayRows: todayRows.length,
      baseline: {
        moneyline: summarize(settled.filter((r) => r.market === "moneyline")),
        total: summarize(settled.filter((r) => r.market === "total")),
      },
    },
    bestMlCapRules: pickBest(evaluations, "ml_cap"),
    bestMlPromotionRules: pickBest(evaluations, "ml_promotion"),
    bestTotalsCapRules: pickBest(evaluations, "totals_cap"),
    bestTotalsPromotionRules: pickBest(evaluations, "totals_promotion"),
    bestCombinedRuleSets: pickBest(evaluations, "combined"),
    candidates,
    rejectedRules: candidates.reject.slice(0, 20),
    todaysAffectedRows: viable.flatMap((r) => r.todaysAffectedRowsIfEnabled.map((row) => ({ ...row, candidateRule: r.ruleName, classification: r.classification }))),
    recommendedImmediateActions: [
      candidates.production_candidate_now.length
        ? "Review production_candidate_now rules for approval behind default-off flags."
        : "No ML/Totals rule cleared production_candidate_now criteria in this run.",
      candidates.controlled_rollout_candidate.length
        ? "There are controlled rollout candidates worth approving for preview/admin review."
        : "No controlled rollout candidates found.",
      "Do not mutate model probabilities, projections, picks, or historical rows.",
    ],
    exactFeatureFlags: [...new Set(viable.map((r) => r.flag))],
  };
}

function markdown(report: ReturnType<typeof buildReport>): string {
  const line = (r: ReturnType<typeof evaluateRule>) => `- ${r.ruleName}: ${r.classification}, affected=${r.affectedRows}, deltaUnits=${r.deltaUnits}, deltaROI=${r.deltaRoi}, volume ${r.actionableCountBefore}->${r.actionableCountAfter}, train/val/holdout=${r.train.deltaUnits}/${r.validation.deltaUnits}/${r.holdout.deltaUnits}`;
  return `# MLB ML/Totals Production Candidate Rule Search

Generated: ${report.generatedAt}

Read-only: no DB writes, no production changes, no paid AI.

## Candidate Counts

- production_candidate_now: ${report.candidates.production_candidate_now.length}
- controlled_rollout_candidate: ${report.candidates.controlled_rollout_candidate.length}
- needs_more_data: ${report.candidates.needs_more_data.length}
- reject: ${report.candidates.reject.length}

## Best ML Cap Rules

${report.bestMlCapRules.map(line).join("\n") || "None."}

## Best ML Promotion Rules

${report.bestMlPromotionRules.map(line).join("\n") || "None."}

## Best Totals Cap Rules

${report.bestTotalsCapRules.map(line).join("\n") || "None."}

## Best Totals Promotion Rules

${report.bestTotalsPromotionRules.map(line).join("\n") || "None."}

## Best Combined Rule Sets

${report.bestCombinedRuleSets.map(line).join("\n") || "None."}

## Today's Affected Rows

${report.todaysAffectedRows.map((r) => `- ${r.game} ${r.market} ${r.pick}: ${r.originalGrade} -> ${r.candidateGrade} via ${r.candidateRule}`).join("\n") || "No today rows affected by viable candidates."}

## Recommended Immediate Actions

${report.recommendedImmediateActions.map((x) => `- ${x}`).join("\n")}
`;
}

async function main() {
  const args = parseArgs();
  const rows = await loadRows(args);
  const report = buildReport(rows, args);
  await mkdir(args.outDir, { recursive: true });
  const jsonPath = `${args.outDir}/mlb-ml-totals-production-candidate-search.json`;
  const mdPath = `${args.outDir}/mlb-ml-totals-production-candidate-search.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown(report), "utf8");
  if (args.json) {
    console.log(JSON.stringify({
      output: { jsonPath, mdPath },
      dataset: report.dataset,
      candidateCounts: {
        production_candidate_now: report.candidates.production_candidate_now.length,
        controlled_rollout_candidate: report.candidates.controlled_rollout_candidate.length,
        needs_more_data: report.candidates.needs_more_data.length,
        reject: report.candidates.reject.length,
      },
      productionCandidateNow: report.candidates.production_candidate_now,
      controlledRolloutCandidate: report.candidates.controlled_rollout_candidate,
      bestMlCapRules: report.bestMlCapRules.slice(0, 5),
      bestMlPromotionRules: report.bestMlPromotionRules.slice(0, 5),
      bestTotalsCapRules: report.bestTotalsCapRules.slice(0, 5),
      bestTotalsPromotionRules: report.bestTotalsPromotionRules.slice(0, 5),
      bestCombinedRuleSets: report.bestCombinedRuleSets.slice(0, 5),
      todaysAffectedRows: report.todaysAffectedRows,
      exactFeatureFlags: report.exactFeatureFlags,
      recommendedImmediateActions: report.recommendedImmediateActions,
    }, null, 2));
    return;
  }
  console.log(`ML/Totals candidate search written:\n- ${jsonPath}\n- ${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
