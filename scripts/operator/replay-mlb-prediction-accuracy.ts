/**
 * Read-only MLB prediction accuracy replay.
 *
 * Purpose: test actual side/projection alternatives, not play-grade labels.
 * It replays settled moneyline + total prediction_records against actual
 * outcomes and reports whether alternate side rules would flip wins/losses.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/replay-mlb-prediction-accuracy.ts \
 *     --date-from 2026-06-01 --date-to 2026-06-24
 */

import { supabase } from "../../lib/db/supabase";
import { overProbabilityPoisson } from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";

type Side = "home" | "away" | "over" | "under";
type Result = "win" | "loss" | "push" | "void" | "pending" | "";

type Opts = { dateFrom: string; dateTo: string };

type Rec = {
  id: number;
  game_id: number;
  slate_date: string;
  market: "moneyline" | "total";
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
  market_aligned: boolean | null;
  snapshot_json: unknown;
  prediction_grades?: unknown;
};

type Game = {
  id: number;
  home_score: number | null;
  away_score: number | null;
  total_runs: number | null;
};

type Agg = {
  n: number;
  w: number;
  l: number;
  push: number;
  units: number;
  staked: number;
  flips: number;
  winToLoss: number;
  lossToWin: number;
  same: number;
};

function parseArgs(argv: string[]): Opts {
  let dateFrom = "2026-06-01";
  let dateTo = "2026-06-24";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date-from" && argv[i + 1]) dateFrom = argv[++i]!;
    else if (argv[i] === "--date-to" && argv[i + 1]) dateTo = argv[++i]!;
  }
  return { dateFrom, dateTo };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function nested(o: Record<string, unknown>, path: string): unknown {
  let cur: unknown = o;
  for (const p of path.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function gradeResult(v: unknown): Result {
  const g = Array.isArray(v) ? obj(v[0]) : obj(v);
  const r = String(g.result ?? "").toLowerCase();
  if (r === "win" || r === "loss" || r === "push" || r === "void" || r === "pending") return r;
  return "";
}

function profit(odds: number | null, result: "win" | "loss"): number | null {
  if (odds === null || !Number.isFinite(odds)) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function newAgg(): Agg {
  return { n: 0, w: 0, l: 0, push: 0, units: 0, staked: 0, flips: 0, winToLoss: 0, lossToWin: 0, same: 0 };
}

function add(a: Agg, row: Rec, shipped: Result, alt: Result, flipped: boolean, odds: number | null): void {
  a.n++;
  if (alt === "win") a.w++;
  else if (alt === "loss") a.l++;
  else if (alt === "push") a.push++;

  if (alt === "win" || alt === "loss") {
    const u = profit(odds, alt);
    if (u !== null) {
      a.units += u;
      a.staked++;
    }
  }

  if (flipped) {
    a.flips++;
    if (shipped === "win" && alt === "loss") a.winToLoss++;
    if (shipped === "loss" && alt === "win") a.lossToWin++;
  } else {
    a.same++;
  }
  void row;
}

function fmt(label: string, a: Agg): string {
  const wl = a.w + a.l;
  const pct = wl ? `${((a.w / wl) * 100).toFixed(1)}%` : "-";
  const roi = a.staked ? `${((a.units / a.staked) * 100).toFixed(1)}%` : "-";
  const units = `${a.units >= 0 ? "+" : ""}${a.units.toFixed(2)}u`;
  return `${label.padEnd(38)} ${String(a.n).padStart(4)} ${`${a.w}-${a.l}`.padStart(8)} ${pct.padStart(7)} ${units.padStart(9)} ${roi.padStart(8)} flips=${String(a.flips).padStart(3)} W→L=${String(a.winToLoss).padStart(3)} L→W=${String(a.lossToWin).padStart(3)}`;
}

function addBucket(groups: Map<string, Agg>, key: string, row: Rec, shipped: Result, alt: Result, flipped = false, odds = row.odds_american): void {
  const agg = groups.get(key) ?? newAgg();
  add(agg, row, shipped, alt, flipped, odds);
  groups.set(key, agg);
}

function opposite(side: Side): Side {
  if (side === "home") return "away";
  if (side === "away") return "home";
  if (side === "over") return "under";
  return "over";
}

function sideOdds(row: Rec, side: Side): number | null {
  const snap = obj(row.snapshot_json);
  const v22 = obj(snap.v2_2_audit);
  if (side === "over") return num(v22.over_odds_american) ?? (row.side === "over" ? row.odds_american : null);
  if (side === "under") return num(v22.under_odds_american) ?? (row.side === "under" ? row.odds_american : null);
  const ml = obj(nested(snap, "odds_source_at_lock_ml"));
  const src = obj(ml[side]);
  return num(src.odds) ?? (row.side === side ? row.odds_american : null);
}

function mlResult(side: "home" | "away", game: Game): Result {
  if (game.home_score === null || game.away_score === null) return "";
  if (game.home_score === game.away_score) return "push";
  const homeWon = game.home_score > game.away_score;
  return (side === "home" ? homeWon : !homeWon) ? "win" : "loss";
}

function totalResult(side: "over" | "under", line: number | null, game: Game): Result {
  if (line === null || game.total_runs === null) return "";
  if (game.total_runs === line) return "push";
  const overWon = game.total_runs > line;
  return (side === "over" ? overWon : !overWon) ? "win" : "loss";
}

function reconstructedHomeProb(row: Rec, value: number | null): number | null {
  if (value === null) return null;
  if (row.side === "home") return value;
  if (row.side === "away") return 1 - value;
  return null;
}

function reconstructedOverProb(row: Rec, value: number | null): number | null {
  if (value === null) return null;
  if (row.side === "over") return value;
  if (row.side === "under") return 1 - value;
  return null;
}

function mlRules(row: Rec): Array<[string, "home" | "away" | null]> {
  const snap = obj(row.snapshot_json);
  const v22 = obj(snap.v2_2_audit);
  const shipped = row.side === "home" || row.side === "away" ? row.side : null;
  const rawHome = reconstructedHomeProb(row, num(v22.ml_raw_model_prob));
  const regHome = reconstructedHomeProb(row, row.model_probability ?? num(v22.ml_regularized_model_prob));
  const marketHome = reconstructedHomeProb(row, row.market_probability ?? num(v22.ml_market_prob));
  const projectedDiff = num(v22.posterior_home_diff);
  const projectedSide = projectedDiff === null ? null : projectedDiff >= 0 ? "home" : "away";
  const marketSide = marketHome === null ? null : marketHome >= 0.5 ? "home" : "away";
  const rawSide = rawHome === null ? null : rawHome >= 0.5 ? "home" : "away";
  const regSide = regHome === null ? null : regHome >= 0.5 ? "home" : "away";
  const conf = row.confidence ?? 0;
  const marketDivergent = shipped !== null && marketSide !== null && shipped !== marketSide;

  return [
    ["shipped", shipped],
    ["projection margin side", projectedSide],
    ["raw model prob side", rawSide],
    ["regularized model side", regSide],
    ["market favorite side", marketSide],
    ["flip market-divergent conf<60", marketDivergent && conf < 60 ? marketSide : shipped],
    ["flip market-divergent conf<65", marketDivergent && conf < 65 ? marketSide : shipped],
  ];
}

function totalRules(row: Rec): Array<[string, "over" | "under" | null]> {
  const snap = obj(row.snapshot_json);
  const v22 = obj(snap.v2_2_audit);
  const shipped = row.side === "over" || row.side === "under" ? row.side : null;
  const line = row.line_value ?? num(v22.market_total);
  const postHome = num(v22.posterior_home_runs);
  const postAway = num(v22.posterior_away_runs);
  const postTotal = num(v22.posterior_total) ?? (postHome !== null && postAway !== null ? postHome + postAway : null);
  const meanSide = line !== null && postTotal !== null ? (postTotal > line ? "over" : "under") : null;
  const rawOver =
    line !== null && postHome !== null && postAway !== null
      ? overProbabilityPoisson(postAway, postHome, line)
      : reconstructedOverProb(row, num(v22.ou_raw_model_prob));
  const marketOver = reconstructedOverProb(row, row.market_probability ?? num(v22.ou_market_prob));
  const regOver05 = rawOver === null ? null : regularizeProbability({ rawProb: rawOver, marketProb: marketOver, k: 0.5, maxDistancePp: 9 }).regularizedProb ?? rawOver;
  const regOver035 = rawOver === null ? null : regularizeProbability({ rawProb: rawOver, marketProb: marketOver, k: 0.35, maxDistancePp: 6 }).regularizedProb ?? rawOver;
  const regOver025 = rawOver === null ? null : regularizeProbability({ rawProb: rawOver, marketProb: marketOver, k: 0.25, maxDistancePp: 5 }).regularizedProb ?? rawOver;
  const marketSide = marketOver === null ? null : marketOver >= 0.5 ? "over" : "under";

  return [
    ["shipped", shipped],
    ["projected total side", meanSide],
    ["raw poisson side", rawOver === null ? null : rawOver >= 0.5 ? "over" : "under"],
    ["regularized k=.50 side", regOver05 === null ? null : regOver05 >= 0.5 ? "over" : "under"],
    ["regularized k=.35 side", regOver035 === null ? null : regOver035 >= 0.5 ? "over" : "under"],
    ["regularized k=.25 side", regOver025 === null ? null : regOver025 >= 0.5 ? "over" : "under"],
    ["market total side", marketSide],
  ];
}

function edgeBucket(edge: number | null): string {
  if (edge === null) return "edge:missing";
  if (edge < 0) return "edge:negative";
  if (edge < 2) return "edge:0-2pp";
  if (edge < 5) return "edge:2-5pp";
  if (edge < 10) return "edge:5-10pp";
  return "edge:10pp+";
}

function probBucket(p: number | null): string {
  if (p === null) return "prob:missing";
  if (p < 0.5) return "prob:<50";
  if (p < 0.55) return "prob:50-55";
  if (p < 0.6) return "prob:55-60";
  if (p < 0.65) return "prob:60-65";
  if (p < 0.7) return "prob:65-70";
  return "prob:70+";
}

function projectionGapBucket(row: Rec): string {
  const v22 = obj(obj(row.snapshot_json).v2_2_audit);
  if (row.market === "moneyline") {
    const diff = num(v22.posterior_home_diff);
    if (diff === null) return "projGap:missing";
    const abs = Math.abs(diff);
    if (abs < 0.3) return "projGap:<0.3r";
    if (abs < 0.7) return "projGap:0.3-0.7r";
    return "projGap:0.7r+";
  }
  const line = row.line_value ?? num(v22.market_total);
  const total = num(v22.posterior_total);
  if (line === null || total === null) return "projGap:missing";
  const gap = total - line;
  if (gap < -0.7) return "projGap:under0.7r+";
  if (gap < -0.3) return "projGap:under0.3-0.7r";
  if (gap <= 0.3) return "projGap:nearLine";
  if (gap <= 0.7) return "projGap:over0.3-0.7r";
  return "projGap:over0.7r+";
}

function lineMovementBucket(row: Rec): string {
  const lm = obj(obj(row.snapshot_json).line_movement);
  const d = String(lm.direction ?? "missing");
  return `lineMove:${d}`;
}

function publicSplitBucket(row: Rec): string {
  const ps = obj(obj(row.snapshot_json).public_splits);
  const conflict = ps.conflict;
  const support = ps.support;
  if (conflict === true) return "public:oppConflict";
  if (support === true) return "public:pickedSupport";
  if (conflict === false || support === false) return "public:knownNeutral";
  return "public:unknown";
}

function featureBuckets(row: Rec): string[] {
  const snap = obj(row.snapshot_json);
  const v22 = obj(snap.v2_2_audit);
  const buckets: string[] = [];
  buckets.push(`tier:${String(row.snapshot_json && v22.data_quality_tier ? v22.data_quality_tier : "unknown")}`);
  const reasons = v22.feature_reason_codes;
  if (Array.isArray(reasons)) {
    for (const r of reasons) {
      if (typeof r === "string") buckets.push(`feature:${r}`);
    }
  }
  const homeRole = String(nested(v22, "home_starter_workload.role") ?? "");
  const awayRole = String(nested(v22, "away_starter_workload.role") ?? "");
  if (homeRole) buckets.push(`homeStarterRole:${homeRole}`);
  if (awayRole) buckets.push(`awayStarterRole:${awayRole}`);
  const weather = obj(snap.playbook_venue_weather);
  if (typeof weather.applied === "boolean") buckets.push(`playbookWeather:${weather.applied}`);
  return buckets;
}

function printBuckets(title: string, groups: Map<string, Agg>, minSample: number, limit = 40): void {
  console.log(`\n${title}`);
  const rows = [...groups.entries()]
    .filter(([, a]) => a.w + a.l >= minSample)
    .sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l) || b[1].w / Math.max(1, b[1].w + b[1].l) - a[1].w / Math.max(1, a[1].w + a[1].l))
    .slice(0, limit);
  if (rows.length === 0) {
    console.log(`  no buckets at minSample=${minSample}`);
    return;
  }
  for (const [label, agg] of rows) console.log(fmt(label, agg));
}

async function withRetry<T>(label: string, fn: () => Promise<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await fn();
    if (!error) return (data ?? []) as T;
    last = error.message;
    const backoff = attempt * 1500;
    console.warn(`  ${label}: attempt ${attempt}/3 failed (${last.slice(0, 120)}); retrying in ${backoff}ms`);
    await sleep(backoff);
  }
  throw new Error(`${label}: ${last}`);
}

async function loadRecordsByDate(opts: Opts): Promise<Rec[]> {
  const all: Rec[] = [];
  for (const slateDate of dateRange(opts.dateFrom, opts.dateTo)) {
    const rows = await withRetry<Rec[]>(`prediction_records ${slateDate}`, async () =>
      await supabase
        .from("prediction_records")
        .select(
          "id, game_id, slate_date, market, pick, side, line_value, odds_american, confidence, model_probability, market_probability, edge, play_grade, best_angle, no_bet, market_aligned, snapshot_json, prediction_grades:prediction_grades!prediction_record_id(result, actual_total, actual_home_score, actual_away_score)",
        )
        .eq("sport", "mlb")
        .in("market", ["moneyline", "total"])
        .eq("slate_date", slateDate)
        .limit(300),
    );
    all.push(...rows);
    console.log(`  loaded ${slateDate}: ${rows.length} records`);
    await sleep(250);
  }
  return all;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const records = await loadRecordsByDate(opts);
  const gameIds = [...new Set(records.map((r) => r.game_id).filter((id) => typeof id === "number"))];
  const games = new Map<number, Game>();
  for (let i = 0; i < gameIds.length; i += 200) {
    const { data: gRows, error: gErr } = await supabase
      .from("games")
      .select("id, home_score, away_score, total_runs")
      .in("id", gameIds.slice(i, i + 200));
    if (gErr) throw new Error(`games: ${gErr.message}`);
    for (const g of (gRows ?? []) as Game[]) games.set(g.id, g);
  }

  console.log(`\nMLB PREDICTION ACCURACY REPLAY ${opts.dateFrom}..${opts.dateTo}`);
  console.log("READ-ONLY. Tests alternate SIDES, not grade labels.\n");

  const mlAgg = new Map<string, Agg>();
  const totalAgg = new Map<string, Agg>();
  const mlBuckets = new Map<string, Agg>();
  const totalBuckets = new Map<string, Agg>();
  let mlRows = 0;
  let totalRows = 0;

  for (const row of records) {
    const game = games.get(row.game_id);
    if (!game) continue;
    const shippedSide = row.side as Side | null;
    const shipped = gradeResult(row.prediction_grades);
    if (shipped !== "win" && shipped !== "loss" && shipped !== "push") continue;
    if (row.market === "moneyline") {
      if (shippedSide !== "home" && shippedSide !== "away") continue;
      mlRows++;
      const priceClass = row.odds_american === null ? "price:missing" : row.odds_american < 0 ? "favorite" : "underdog";
      const shippedMlResult = mlResult(shippedSide, game);
      const mlBaseBuckets = [
        priceClass,
        `${priceClass}|marketAligned:${bool(row.market_aligned)}`,
        `${priceClass}|${lineMovementBucket(row)}`,
        `${priceClass}|${publicSplitBucket(row)}`,
        `${priceClass}|${projectionGapBucket(row)}`,
        `${priceClass}|${probBucket(row.model_probability)}`,
        `${priceClass}|${edgeBucket(row.edge)}`,
      ];
      for (const b of mlBaseBuckets) addBucket(mlBuckets, b, row, shipped, shippedMlResult);
      for (const b of featureBuckets(row)) addBucket(mlBuckets, `${priceClass}|${b}`, row, shipped, shippedMlResult);
      for (const [label, altSide] of mlRules(row)) {
        if (altSide === null) continue;
        const alt = mlResult(altSide, game);
        if (alt === "") continue;
        const agg = mlAgg.get(label) ?? newAgg();
        add(agg, row, shipped, alt, altSide !== shippedSide, sideOdds(row, altSide));
        mlAgg.set(label, agg);
      }
    } else if (row.market === "total") {
      if (shippedSide !== "over" && shippedSide !== "under") continue;
      totalRows++;
      const shippedTotalResult = totalResult(shippedSide, row.line_value, game);
      const totalBaseBuckets = [
        `side:${shippedSide}`,
        `side:${shippedSide}|marketAligned:${bool(row.market_aligned)}`,
        `side:${shippedSide}|${lineMovementBucket(row)}`,
        `side:${shippedSide}|${publicSplitBucket(row)}`,
        `side:${shippedSide}|${projectionGapBucket(row)}`,
        `side:${shippedSide}|${probBucket(row.model_probability)}`,
        `side:${shippedSide}|${edgeBucket(row.edge)}`,
      ];
      for (const b of totalBaseBuckets) addBucket(totalBuckets, b, row, shipped, shippedTotalResult);
      for (const b of featureBuckets(row)) addBucket(totalBuckets, `side:${shippedSide}|${b}`, row, shipped, shippedTotalResult);
      for (const [label, altSide] of totalRules(row)) {
        if (altSide === null) continue;
        const alt = totalResult(altSide, row.line_value, game);
        if (alt === "") continue;
        const agg = totalAgg.get(label) ?? newAgg();
        add(agg, row, shipped, alt, altSide !== shippedSide, sideOdds(row, altSide));
        totalAgg.set(label, agg);
      }
    }
  }

  console.log(`Moneyline settled rows: ${mlRows}`);
  for (const [label, agg] of mlAgg) console.log(fmt(label, agg));

  console.log(`\nTotals settled rows: ${totalRows}`);
  for (const [label, agg] of totalAgg) console.log(fmt(label, agg));

  printBuckets("\nMoneyline interaction buckets", mlBuckets, 5);
  printBuckets("\nTotals interaction buckets", totalBuckets, 5);

  console.log("\nInterpretation:");
  console.log("  • A real flip candidate should have L→W materially larger than W→L.");
  console.log("  • A formula candidate should beat shipped on hit-rate without collapsing sample size.");
  console.log("  • If market/projection side wins, we change the prediction layer; if only BA improves, it is grade-only.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
