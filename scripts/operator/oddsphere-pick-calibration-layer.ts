/**
 * READ-ONLY OddSphere Pick Calibration Layer replay.
 *
 * Goal: evaluate official pick-side rules first, grades second. This script
 * never writes prediction_records, locked rows, tracking, or model output.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/oddsphere-pick-calibration-layer.ts
 *   npx tsx --env-file=.env.local scripts/operator/oddsphere-pick-calibration-layer.ts --json
 */

import { supabase } from "../../lib/db/supabase";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { WNBA_EMERGENCY_SPREAD_HOME_BIAS_POINTS } from "../../lib/automodel/wnbaCoreModelCalibration";

type Row = Record<string, any>;
type Side = string;
type Result = "win" | "loss" | "push" | "void" | "pending";
type Rule = { name: string; family: string; side: Side | null; grade?: string | null; reason?: string };
type BetRow = { rec: Row; side: Side | null; result: Result; odds: number | null; currentResult: Result };

const argv = process.argv.slice(2);
const jsonOnly = argv.includes("--json");
const start = readFlag("--start") ?? "2026-06-01";
const mlbToday = readFlag("--mlb-date") ?? currentSlateDate("mlb");
const wnbaToday = readFlag("--wnba-date") ?? currentSlateDate("wnba");
const soccerToday = readFlag("--soccer-date") ?? currentSlateDate("soccer");

function readFlag(flag: string): string | null {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] ?? null : null;
}

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function r(v: number | null | undefined, places = 2): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const m = 10 ** places;
  return Math.round(v * m) / m;
}

function pct(w: number, l: number): number | null {
  return w + l === 0 ? null : r((w / (w + l)) * 100, 1);
}

function obj(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
}

function path(o: unknown, dotted: string): unknown {
  let cur = o;
  for (const part of dotted.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Row)[part];
  }
  return cur;
}

function gradeRow(rec: Row): Row {
  const g = rec.prediction_grades;
  return Array.isArray(g) ? obj(g[0]) : obj(g);
}

function resultOf(rec: Row): Result {
  const raw = String(gradeRow(rec).result ?? "").toLowerCase();
  return raw === "win" || raw === "loss" || raw === "push" || raw === "void" || raw === "pending" ? raw : "pending";
}

function profit(odds: number | null, result: Result): number | null {
  if (result === "push") return 0;
  if (result !== "win" && result !== "loss") return null;
  if (odds === null) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarize(rows: BetRow[]) {
  const settled = rows.filter((x) => x.result === "win" || x.result === "loss" || x.result === "push");
  const wins = settled.filter((x) => x.result === "win").length;
  const losses = settled.filter((x) => x.result === "loss").length;
  const pushes = settled.filter((x) => x.result === "push").length;
  const roiRows = settled.map((x) => profit(x.odds, x.result)).filter((x): x is number => x !== null);
  const units = roiRows.reduce((a, b) => a + b, 0);
  const changed = settled.filter((x) => x.side !== null && x.side !== x.rec.side);
  const changedWins = changed.filter((x) => x.result === "win").length;
  const changedLosses = changed.filter((x) => x.result === "loss").length;
  const lossToWin = changed.filter((x) => x.currentResult === "loss" && x.result === "win").length;
  const winToLoss = changed.filter((x) => x.currentResult === "win" && x.result === "loss").length;
  return {
    n: settled.length,
    wins,
    losses,
    pushes,
    winPct: pct(wins, losses),
    roi: roiRows.length ? r((units / roiRows.length) * 100, 1) : null,
    units: r(units, 3),
    roiEligible: roiRows.length,
    sideChanges: changed.length,
    changedWL: `${changedWins}-${changedLosses}`,
    changedWinPct: pct(changedWins, changedLosses),
    lossToWin,
    winToLoss,
  };
}

function windowRows(rows: BetRow[], days: number): BetRow[] {
  const dates = rows.map((x) => String(x.rec.slate_date)).sort();
  const last = dates[dates.length - 1];
  if (!last) return [];
  const cutoff = new Date(`${last}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const c = cutoff.toISOString().slice(0, 10);
  return rows.filter((x) => String(x.rec.slate_date) >= c);
}

function actualScores(rec: Row) {
  const g = gradeRow(rec);
  return {
    home: n(g.actual_home_score),
    away: n(g.actual_away_score),
    total: n(g.actual_total) ?? (n(g.actual_home_score) !== null && n(g.actual_away_score) !== null ? n(g.actual_home_score)! + n(g.actual_away_score)! : null),
  };
}

function resultFor(rec: Row, side: Side | null): Result {
  if (!side) return "void";
  const s = actualScores(rec);
  if (rec.market === "moneyline") {
    if (side !== "home" && side !== "away") return "void";
    if (s.home === null || s.away === null) return "pending";
    if (s.home === s.away) return "push";
    return (side === "home") === (s.home > s.away) ? "win" : "loss";
  }
  if (rec.market === "total") {
    if (side !== "over" && side !== "under") return "void";
    const line = n(rec.line_value) ?? n(path(rec.snapshot_json, "model.raw_probabilities.total_at_canonical.line")) ?? 2.5;
    if (s.total === null || line === null) return "pending";
    if (s.total === line) return "push";
    return (side === "over") === (s.total > line) ? "win" : "loss";
  }
  if (rec.market === "spread") {
    if (side !== "home" && side !== "away") return "void";
    const homeLine = homeSpreadLine(rec);
    if (s.home === null || s.away === null || homeLine === null) return "pending";
    const chosenLine = side === "home" ? homeLine : -homeLine;
    const chosenMargin = side === "home" ? s.home - s.away : s.away - s.home;
    const cover = chosenMargin + chosenLine;
    if (cover === 0) return "push";
    return cover > 0 ? "win" : "loss";
  }
  if (rec.sport === "soccer") return soccerResultFor(rec, side, s.home, s.away);
  return "void";
}

function soccerResultFor(rec: Row, side: Side | null, home: number | null, away: number | null): Result {
  if (!side || home === null || away === null) return "pending";
  if (rec.market === "match_result") {
    const actual = home > away ? "home" : away > home ? "away" : "draw";
    return side === actual ? "win" : "loss";
  }
  if (rec.market === "double_chance") {
    const actual = home > away ? "home" : away > home ? "away" : "draw";
    if (side === "home_or_draw") return actual === "home" || actual === "draw" ? "win" : "loss";
    if (side === "away_or_draw") return actual === "away" || actual === "draw" ? "win" : "loss";
    if (side === "home_or_away") return actual === "home" || actual === "away" ? "win" : "loss";
    return "void";
  }
  if (rec.market === "btts") {
    const yes = home > 0 && away > 0;
    return (side === "yes") === yes ? "win" : "loss";
  }
  if (rec.market === "total") {
    const line = n(rec.line_value) ?? n(path(rec.snapshot_json, "model.raw_probabilities.total_at_canonical.line")) ?? 2.5;
    const total = home + away;
    if (total === line) return "push";
    return (side === "over") === (total > line) ? "win" : "loss";
  }
  return "void";
}

function homeSpreadLine(rec: Row): number | null {
  const line = n(rec.line_value);
  if (line === null) return null;
  if (rec.side === "home") return line;
  if (rec.side === "away") return -line;
  return null;
}

function chosenOdds(rec: Row, side: Side | null): number | null {
  if (!side) return null;
  if (side === rec.side) return n(rec.odds_american);
  const snap = obj(rec.snapshot_json);
  const lines = path(snap, "lines_at_lock");
  if (Array.isArray(lines)) {
    const market = rec.market === "first_inning" ? "first_inning_total" : rec.market;
    const targetLine = rec.market === "spread"
      ? side === "home" ? homeSpreadLine(rec) : homeSpreadLine(rec) === null ? null : -homeSpreadLine(rec)!
      : rec.market === "total" ? n(rec.line_value) : null;
    const matches = lines
      .filter((x: Row) => x.market_type === market && x.side === side)
      .filter((x: Row) => targetLine === null || n(x.line_value) === targetLine)
      .map((x: Row) => n(x.odds_american))
      .filter((x: number | null): x is number => x !== null);
    if (matches.length) return matches[Math.floor(matches.length / 2)]!;
  }
  const v22 = obj(snap.v2_2_audit);
  if (rec.market === "total") {
    if (side === "over") return n(v22.over_odds_american);
    if (side === "under") return n(v22.under_odds_american);
  }
  const ml = obj(path(snap, "odds_source_at_lock_ml"));
  return n(path(ml, `${side}.odds`));
}

function sideFromProb(homeOrOverProb: number | null, a: Side, b: Side): Side | null {
  if (homeOrOverProb === null) return null;
  if (homeOrOverProb === 0.5) return null;
  return homeOrOverProb > 0.5 ? a : b;
}

function pickSideProb(rec: Row): number | null {
  return n(rec.model_probability) ?? (n(rec.confidence) !== null ? n(rec.confidence)! / 100 : null);
}

function marketPickProb(rec: Row): number | null {
  return n(rec.market_probability);
}

function homeProbFromPickProb(rec: Row, p: number | null): number | null {
  if (p === null) return null;
  if (rec.side === "home") return p;
  if (rec.side === "away") return 1 - p;
  return null;
}

function overProbFromPickProb(rec: Row, p: number | null): number | null {
  if (p === null) return null;
  if (rec.side === "over") return p;
  if (rec.side === "under") return 1 - p;
  return null;
}

function mlbMlRules(rec: Row): Rule[] {
  const modelHome = homeProbFromPickProb(rec, pickSideProb(rec));
  const marketHome = homeProbFromPickProb(rec, marketPickProb(rec));
  const final25 = modelHome !== null && marketHome !== null ? marketHome + 0.25 * (modelHome - marketHome) : null;
  const current = rec.side === "home" || rec.side === "away" ? rec.side : null;
  const marketSide = sideFromProb(marketHome, "home", "away");
  const modelSide = sideFromProb(modelHome, "home", "away");
  return [
    { name: "A_current_official", family: "current", side: current },
    { name: "B_market_no_vig_favorite", family: "market", side: marketSide },
    { name: "C_market_plus_25pct_model_edge", family: "calibrated", side: sideFromProb(final25, "home", "away") },
    { name: "G_current_unless_calibrated_crosses_2pp", family: "threshold", side: final25 !== null && current !== null && Math.abs(final25 - 0.5) >= 0.02 ? sideFromProb(final25, "home", "away") : current },
    { name: "G_current_unless_calibrated_crosses_4pp", family: "threshold", side: final25 !== null && current !== null && Math.abs(final25 - 0.5) >= 0.04 ? sideFromProb(final25, "home", "away") : current },
    { name: "raw_model_side", family: "raw", side: modelSide },
  ];
}

function mlbTotalProjection(rec: Row): number | null {
  return n(path(rec.snapshot_json, "mlb_core_model_calibration.raw_projected_total"))
    ?? n(path(rec.snapshot_json, "mlb_core_model_calibration.market_aware_projected_total_if_enabled"))
    ?? n(path(rec.snapshot_json, "v2_2_audit.posterior_total"))
    ?? (n(path(rec.snapshot_json, "v2_2_audit.posterior_home_runs")) !== null && n(path(rec.snapshot_json, "v2_2_audit.posterior_away_runs")) !== null
      ? n(path(rec.snapshot_json, "v2_2_audit.posterior_home_runs"))! + n(path(rec.snapshot_json, "v2_2_audit.posterior_away_runs"))!
      : null);
}

function sideFromTotal(total: number | null, line: number | null): Side | null {
  if (total === null || line === null || total === line) return null;
  return total > line ? "over" : "under";
}

function mlbTotalRules(rec: Row): Rule[] {
  const line = n(rec.line_value);
  const raw = mlbTotalProjection(rec);
  const market = line;
  const c25 = raw !== null && market !== null ? market + 0.25 * (raw - market) : null;
  const c50 = raw !== null && market !== null ? market + 0.50 * (raw - market) : null;
  const current = rec.side === "over" || rec.side === "under" ? rec.side : null;
  const threshold = (runs: number) => raw !== null && line !== null && Math.abs(raw - line) >= runs ? sideFromTotal(c25, line) : current;
  return [
    { name: "A_current_official", family: "current", side: current },
    { name: "A_raw_projected_total_side", family: "raw", side: sideFromTotal(raw, line) },
    { name: "C_market_plus_25pct_raw_edge", family: "calibrated", side: sideFromTotal(c25, line) },
    { name: "D_market_plus_50pct_raw_edge", family: "calibrated", side: sideFromTotal(c50, line) },
    { name: "E_calibrated_only_raw_edge_0_50", family: "threshold", side: threshold(0.5) },
    { name: "F_calibrated_only_raw_edge_0_75", family: "threshold", side: threshold(0.75) },
  ];
}

function wnbaRawTotal(rec: Row): number | null {
  return n(path(rec.snapshot_json, "model.total"))
    ?? (n(path(rec.snapshot_json, "projected_score.home")) !== null && n(path(rec.snapshot_json, "projected_score.away")) !== null
      ? n(path(rec.snapshot_json, "projected_score.home"))! + n(path(rec.snapshot_json, "projected_score.away"))!
      : null);
}

function wnbaRawHomeMargin(rec: Row): number | null {
  return n(path(rec.snapshot_json, "model.margin"))
    ?? (n(path(rec.snapshot_json, "projected_score.home")) !== null && n(path(rec.snapshot_json, "projected_score.away")) !== null
      ? n(path(rec.snapshot_json, "projected_score.home"))! - n(path(rec.snapshot_json, "projected_score.away"))!
      : null);
}

function sideFromSpreadMargin(homeMargin: number | null, rec: Row, threshold = 0): Side | null {
  const homeLine = homeSpreadLine(rec);
  if (homeMargin === null || homeLine === null) return null;
  const edge = homeMargin + homeLine;
  if (Math.abs(edge) < threshold || edge === 0) return null;
  return edge > 0 ? "home" : "away";
}

function wnbaTotalRules(rec: Row): Rule[] {
  const line = n(rec.line_value);
  const raw = wnbaRawTotal(rec);
  const c10 = raw !== null && line !== null ? line + 0.10 * (raw - line) : null;
  const c25 = raw !== null && line !== null ? line + 0.25 * (raw - line) : null;
  const c50 = raw !== null && line !== null ? line + 0.50 * (raw - line) : null;
  return [
    { name: "A_current_official", family: "current", side: rec.side },
    { name: "A_raw_total_side", family: "raw", side: sideFromTotal(raw, line) },
    { name: "C_market_plus_10pct_raw_edge", family: "calibrated", side: sideFromTotal(c10, line) },
    { name: "D_market_plus_25pct_raw_edge", family: "calibrated", side: sideFromTotal(c25, line) },
    { name: "E_market_plus_50pct_raw_edge", family: "calibrated", side: sideFromTotal(c50, line) },
    { name: "G_conservative_market_led", family: "market", side: rec.side },
  ];
}

function wnbaSpreadRules(rec: Row): Rule[] {
  const raw = wnbaRawHomeMargin(rec);
  const market = homeSpreadLine(rec) === null ? null : -homeSpreadLine(rec)!;
  const emergency = raw !== null && market !== null
    ? market + 0.25 * (raw - market) + 0.25 * WNBA_EMERGENCY_SPREAD_HOME_BIAS_POINTS
    : null;
  const sideAt = (margin: number | null, threshold = 0) => sideFromSpreadMargin(margin, rec, threshold) ?? rec.side;
  return [
    { name: "A_current_official", family: "current", side: rec.side },
    { name: "A_raw_margin_side", family: "raw", side: sideAt(raw) },
    { name: "C_emergency_formula_side", family: "calibrated", side: sideAt(emergency) },
    { name: "D_market_anchored_side", family: "market", side: sideAt(market) },
    { name: "E_emergency_edge_1_0", family: "threshold", side: sideAt(emergency, 1.0) },
    { name: "F_emergency_edge_1_5", family: "threshold", side: sideAt(emergency, 1.5) },
    { name: "G_emergency_edge_2_0", family: "threshold", side: sideAt(emergency, 2.0) },
  ];
}

function soccerModelProbMap(rec: Row): Record<string, number> {
  const raw = obj(path(rec.snapshot_json, "model.raw_probabilities"));
  if (rec.market === "match_result") return obj(raw.match_result) as Record<string, number>;
  if (rec.market === "double_chance") return obj(raw.double_chance) as Record<string, number>;
  if (rec.market === "btts") return obj(raw.btts) as Record<string, number>;
  if (rec.market === "total") return obj(raw.total_at_canonical) as Record<string, number>;
  return {};
}

function soccerMarketProbMap(rec: Row): Record<string, number> {
  const devig = obj(path(rec.snapshot_json, "market.devigged_probabilities"));
  const prefix = `${rec.market}|`;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(devig)) {
    if (!k.startsWith(prefix)) continue;
    const side = rec.market === "total" ? k.split("|")[1] : k.slice(prefix.length);
    if (typeof v === "number") out[side] = v;
  }
  return out;
}

function maxSide(map: Record<string, number>): Side | null {
  let best: [string, number] | null = null;
  for (const [k, v] of Object.entries(map)) {
    if (k === "line" || k === "push") continue;
    if (!Number.isFinite(v)) continue;
    if (!best || v > best[1]) best = [k, v];
  }
  return best?.[0] ?? null;
}

function soccerRules(rec: Row): Rule[] {
  const model = soccerModelProbMap(rec);
  const market = soccerMarketProbMap(rec);
  const residual: Record<string, number> = {};
  for (const side of new Set([...Object.keys(model), ...Object.keys(market)])) {
    if (side === "line" || side === "push") continue;
    const m = n(model[side]);
    const mk = n(market[side]);
    if (m !== null && mk !== null) residual[side] = mk + 0.25 * (m - mk);
  }
  return [
    { name: "A_current_official", family: "current", side: rec.side },
    { name: "A_current_model_side", family: "raw", side: maxSide(model) },
    { name: "B_market_implied_side", family: "market", side: maxSide(market) },
    { name: "C_market_plus_model_residual_25", family: "calibrated", side: maxSide(residual) },
  ];
}

function rulesFor(rec: Row): Rule[] {
  if (rec.sport === "mlb" && rec.market === "moneyline") return mlbMlRules(rec);
  if (rec.sport === "mlb" && rec.market === "total") return mlbTotalRules(rec);
  if (rec.sport === "wnba" && rec.market === "total") return wnbaTotalRules(rec);
  if (rec.sport === "wnba" && rec.market === "spread") return wnbaSpreadRules(rec);
  if (rec.sport === "soccer") return soccerRules(rec);
  return [{ name: "A_current_official", family: "current", side: rec.side ?? null }];
}

function evaluate(records: Row[]) {
  const byScope = new Map<string, Row[]>();
  for (const rec of records) {
    const key = `${rec.sport}:${rec.market}`;
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key)!.push(rec);
  }
  const scopes: Row[] = [];
  for (const [scope, rows] of byScope) {
    const byRule = new Map<string, BetRow[]>();
    for (const rec of rows) {
      const currentResult = resultFor(rec, rec.side);
      for (const rule of rulesFor(rec)) {
        if (!byRule.has(rule.name)) byRule.set(rule.name, []);
        byRule.get(rule.name)!.push({
          rec,
          side: rule.side,
          result: resultFor(rec, rule.side),
          odds: chosenOdds(rec, rule.side),
          currentResult,
        });
      }
    }
    const rules = [...byRule.entries()].map(([name, bets]) => ({
      name,
      ...summarize(bets),
      last14: summarize(windowRows(bets, 14)),
      last7: summarize(windowRows(bets, 7)),
      last3: summarize(windowRows(bets, 3)),
    })).sort((a, b) => (b.winPct ?? -1) - (a.winPct ?? -1) || (b.roi ?? -999) - (a.roi ?? -999));
    scopes.push({ scope, settledRows: rows.length, rules } as Row);
  }
  return scopes.sort((a, b) => String(a.scope).localeCompare(String(b.scope)));
}

function gradeSummary(records: Row[]) {
  const groups = new Map<string, BetRow[]>();
  for (const rec of records) {
    const key = `${rec.sport}:${rec.market}:${rec.play_grade ?? "null"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ rec, side: rec.side, result: resultFor(rec, rec.side), odds: chosenOdds(rec, rec.side), currentResult: resultFor(rec, rec.side) });
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, ...summarize(rows) })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function currentSlateReport(records: Row[]) {
  return records.map((rec) => {
    const candidates = rulesFor(rec);
    const current = candidates.find((x) => x.name === "A_current_official")?.side ?? rec.side ?? null;
    const calibrated = candidates.find((x) => /calibrated|emergency|residual|threshold/.test(x.name) && x.side !== null)?.side ?? current;
    const ruleSides = Object.fromEntries(candidates.map((x) => [x.name, x.side]));
    return {
      sport: rec.sport,
      market: rec.market,
      matchup: rec.matchup,
      locked: rec.locked_at !== null,
      currentPick: current,
      proposedPick: calibrated,
      pickChanges: calibrated !== null && current !== null && calibrated !== current,
      currentGrade: rec.play_grade,
      line: rec.line_value,
      price: rec.odds_american,
      confidence: rec.confidence,
      modelProbability: rec.model_probability,
      marketProbability: rec.market_probability,
      safeToUpdate: rec.locked_at === null,
      reason: candidates.find((x) => x.side === calibrated && x.name !== "A_current_official")?.name ?? "current_official",
      ruleSides,
    };
  });
}

async function page(table: string, build: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await build(supabase.from(table).select("*, prediction_grades(*)")).range(from, from + 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    out.push(...((res.data ?? []) as Row[]));
    if ((res.data ?? []).length < 1000) return out;
  }
}

async function main() {
  const settled = await page("prediction_records", (q) =>
    q
      .in("sport", ["mlb", "wnba", "soccer"])
      .gte("slate_date", start)
      .in("market", ["moneyline", "total", "spread", "match_result", "double_chance", "btts"])
      .order("slate_date", { ascending: true })
  );
  const usable = settled.filter((r) => ["win", "loss", "push"].includes(resultOf(r)));
  const current = await page("prediction_records", (q) =>
    q
      .in("sport", ["mlb", "wnba", "soccer"])
      .in("slate_date", [mlbToday, wnbaToday, soccerToday])
      .in("market", ["moneyline", "total", "spread", "match_result", "double_chance", "btts"])
      .order("game_date", { ascending: true })
  );
  const pendingCurrent = current.filter((r) => resultOf(r) === "pending" || gradeRow(r).result === undefined);
  const report = {
    generatedAt: new Date().toISOString(),
    start,
    settledRows: usable.length,
    scopes: evaluate(usable),
    gradeSummary: gradeSummary(usable),
    currentSlate: currentSlateReport(pendingCurrent),
    deploymentRecommendation: "analysis_only_no_production_change",
    flags: [
      "MLB_PICK_CALIBRATION_ENABLED",
      "MLB_TOTAL_PICK_CALIBRATION_ENABLED",
      "MLB_ML_PICK_CALIBRATION_ENABLED",
      "WNBA_PICK_CALIBRATION_ENABLED",
      "WNBA_SPREAD_PICK_CALIBRATION_ENABLED",
      "WNBA_TOTAL_PICK_CALIBRATION_ENABLED",
      "WORLD_CUP_PICK_CALIBRATION_ENABLED",
    ],
  };
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`OddSphere Pick Calibration Layer Replay (${report.generatedAt})`);
  console.log(`Settled official rows: ${report.settledRows}`);
  for (const scope of report.scopes) {
    console.log(`\n${scope.scope} settled=${scope.settledRows}`);
    for (const rule of scope.rules.slice(0, 8)) {
      console.log(
        `  ${rule.name.padEnd(42)} ${String(rule.wins).padStart(3)}-${String(rule.losses).padEnd(3)} ` +
        `win=${String(rule.winPct ?? "n/a").padStart(5)}% roi=${String(rule.roi ?? "n/a").padStart(6)}% ` +
        `chg=${String(rule.sideChanges).padStart(3)} changed=${rule.changedWL} L->W=${rule.lossToWin} W->L=${rule.winToLoss} ` +
        `last7=${rule.last7.wins}-${rule.last7.losses}/${rule.last7.roi ?? "n/a"}%`
      );
    }
  }
  console.log("\nCurrent slate candidate changes:");
  for (const row of report.currentSlate.filter((x) => x.pickChanges)) {
    console.log(`  ${row.sport} ${row.market} ${row.matchup}: ${row.currentPick} -> ${row.proposedPick} locked=${row.locked} safe=${row.safeToUpdate} via ${row.reason}`);
  }
  if (!report.currentSlate.some((x) => x.pickChanges)) console.log("  none");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
