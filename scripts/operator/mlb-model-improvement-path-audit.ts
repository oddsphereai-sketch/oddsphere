/**
 * Read-only MLB model improvement-path audit.
 *
 * Tests the follow-up ideas from the model review without changing picks:
 *   1. Totals distribution candidates: Poisson vs negative-binomial vs ZIP.
 *   2. Situation-specific totals regularization grid.
 *   3. FI empirical-Bayes-style posterior shrink candidates.
 *   4. Play-grade monotonicity by market using lock-time prediction_records.
 *   5. Lock-time substrate coverage.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/mlb-model-improvement-path-audit.ts \
 *     --date-from 2026-06-07 --date-to 2026-07-08
 */

import { supabase } from "../../lib/db/supabase";
import {
  overProbabilityNegativeBinomial,
  overProbabilityPoisson,
  overProbabilityZeroInflatedPoisson,
} from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";

type Market = "moneyline" | "total" | "first_inning";
type Side = "home" | "away" | "over" | "under" | null;
type Result = "win" | "loss" | "push" | "void" | "pending" | "";

type Opts = { dateFrom: string; dateTo: string; json: boolean };

type Rec = {
  id: number;
  game_id: number;
  slate_date: string;
  market: Market;
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
  locked_at: string | null;
  snapshot_json: unknown;
  prediction_grades?: unknown;
};

type Game = {
  id: number;
  home_score: number | null;
  away_score: number | null;
  total_runs: number | null;
  first_inning_runs: number | null;
};

type Agg = {
  n: number;
  w: number;
  l: number;
  push: number;
  units: number;
  staked: number;
  brierSum: number;
  brierN: number;
  clvN: number;
  clvBeat: number;
};

function parseArgs(argv: string[]): Opts {
  let dateFrom = "2026-06-07";
  let dateTo = "2026-07-08";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date-from" && argv[i + 1]) dateFrom = argv[++i]!;
    else if (argv[i] === "--date-to" && argv[i + 1]) dateTo = argv[++i]!;
    else if (argv[i] === "--json") json = true;
  }
  return { dateFrom, dateTo, json };
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

function result(v: unknown): Result {
  const g = Array.isArray(v) ? obj(v[0]) : obj(v);
  const r = String(g.result ?? "").toLowerCase();
  if (r === "win" || r === "loss" || r === "push" || r === "void" || r === "pending") return r;
  return "";
}

function profit(odds: number | null, r: "win" | "loss"): number | null {
  if (odds === null || !Number.isFinite(odds)) return null;
  if (r === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function newAgg(): Agg {
  return { n: 0, w: 0, l: 0, push: 0, units: 0, staked: 0, brierSum: 0, brierN: 0, clvN: 0, clvBeat: 0 };
}

function add(a: Agg, odds: number | null, r: Result, prob: number | null, clvBeat: boolean | null): void {
  a.n++;
  if (r === "win") a.w++;
  else if (r === "loss") a.l++;
  else if (r === "push") a.push++;
  if (r === "win" || r === "loss") {
    const u = profit(odds, r);
    if (u !== null) {
      a.units += u;
      a.staked++;
    }
    if (prob !== null) {
      const y = r === "win" ? 1 : 0;
      a.brierSum += (prob - y) ** 2;
      a.brierN++;
    }
  }
  if (clvBeat !== null) {
    a.clvN++;
    if (clvBeat) a.clvBeat++;
  }
}

function summarize(a: Agg): Record<string, number | string | null> {
  const wl = a.w + a.l;
  return {
    n: a.n,
    record: `${a.w}-${a.l}${a.push ? `-${a.push}` : ""}`,
    winPct: wl ? Number(((a.w / wl) * 100).toFixed(1)) : null,
    units: Number(a.units.toFixed(2)),
    roiPct: a.staked ? Number(((a.units / a.staked) * 100).toFixed(1)) : null,
    brier: a.brierN ? Number((a.brierSum / a.brierN).toFixed(4)) : null,
    clvBeatPct: a.clvN ? Number(((a.clvBeat / a.clvN) * 100).toFixed(1)) : null,
  };
}

function fmt(label: string, a: Agg): string {
  const s = summarize(a);
  return `${label.padEnd(44)} ${String(s.n).padStart(4)} ${String(s.record).padStart(10)} ${String(s.winPct ?? "-").padStart(6)}% ${String(s.units).padStart(8)}u ${String(s.roiPct ?? "-").padStart(7)}% brier=${s.brier ?? "-"} clv=${s.clvBeatPct ?? "-"}`;
}

function totalResult(side: "over" | "under", line: number | null, game: Game | undefined): Result {
  if (!game || line === null || game.total_runs === null) return "";
  if (game.total_runs === line) return "push";
  const overWon = game.total_runs > line;
  return side === "over" ? (overWon ? "win" : "loss") : overWon ? "loss" : "win";
}

function fiResult(side: "nrfi" | "yrfi", game: Game | undefined, shipped: Result): Result {
  if (game?.first_inning_runs !== null && game?.first_inning_runs !== undefined) {
    const nrfiWon = game.first_inning_runs === 0;
    return side === "nrfi" ? (nrfiWon ? "win" : "loss") : nrfiWon ? "loss" : "win";
  }
  return shipped;
}

function sideOdds(row: Rec, side: Side | "nrfi" | "yrfi"): number | null {
  const snap = obj(row.snapshot_json);
  const v22 = obj(snap.v2_2_audit);
  const fi = obj(snap.fi_v2_audit);
  if (side === "over") return num(v22.over_odds_american) ?? (row.side === "over" ? row.odds_american : null);
  if (side === "under") return num(v22.under_odds_american) ?? (row.side === "under" ? row.odds_american : null);
  if (side === "nrfi") return num(fi.market_nrfi_odds_american) ?? (row.pick === "NRFI" ? row.odds_american : null);
  if (side === "yrfi") return num(fi.market_yrfi_odds_american) ?? (row.pick === "YRFI" ? row.odds_american : null);
  return row.odds_american;
}

function clvBeat(row: Rec): boolean | null {
  const clv = obj(obj(row.snapshot_json).closing_line_value);
  const beat = clv.beat_closing_line ?? clv.beatClosingLine;
  return typeof beat === "boolean" ? beat : null;
}

function totalLineBucket(line: number | null): string {
  if (line === null) return "line:missing";
  if (line < 8) return "line:<8";
  if (line < 9.5) return "line:8-9";
  if (line < 10.5) return "line:9.5-10";
  return "line:10.5+";
}

function totalGapBucket(row: Rec): string {
  const v22 = obj(obj(row.snapshot_json).v2_2_audit);
  const line = row.line_value ?? num(v22.market_total);
  const total = num(v22.posterior_total);
  if (line === null || total === null) return "gap:missing";
  const gap = total - line;
  if (Math.abs(gap) < 0.35) return "gap:<0.35";
  if (Math.abs(gap) < 0.75) return "gap:0.35-0.75";
  return "gap:0.75+";
}

function gradeLabel(row: Rec): string {
  if (row.play_grade) return row.play_grade;
  if (row.no_bet) return "no_play";
  return "ungraded";
}

async function withRetry<T>(label: string, fn: () => Promise<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await fn();
    if (!error) return (data ?? []) as T;
    last = error.message;
    await sleep(attempt * 1000);
  }
  throw new Error(`${label}: ${last}`);
}

async function loadRecords(opts: Opts): Promise<Rec[]> {
  const all: Rec[] = [];
  for (const slateDate of dateRange(opts.dateFrom, opts.dateTo)) {
    const rows = await withRetry<Rec[]>(`prediction_records ${slateDate}`, async () =>
      await supabase
        .from("prediction_records")
        .select("id,game_id,slate_date,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,edge,play_grade,best_angle,no_bet,locked_at,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result)")
        .eq("sport", "mlb")
        .in("market", ["moneyline", "total", "first_inning"])
        .eq("slate_date", slateDate)
        .limit(500),
    );
    all.push(...rows);
    console.log(`  loaded ${slateDate}: ${rows.length} records`);
    await sleep(150);
  }
  return all;
}

async function loadGames(records: Rec[]): Promise<Map<number, Game>> {
  const ids = [...new Set(records.map((r) => r.game_id).filter((id) => typeof id === "number"))];
  const out = new Map<number, Game>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("games")
      .select("id,home_score,away_score,total_runs,first_inning_runs")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`games: ${error.message}`);
    for (const g of (data ?? []) as Game[]) out.set(g.id, g);
  }
  return out;
}

function sortedEntries(groups: Map<string, Agg>, min = 1): Array<[string, Agg]> {
  return [...groups.entries()]
    .filter(([, a]) => a.w + a.l >= min)
    .sort((a, b) => (b[1].units - a[1].units) || (b[1].w + b[1].l) - (a[1].w + a[1].l));
}

function auditTotals(records: Rec[], games: Map<number, Game>): Record<string, unknown> {
  const candidates = new Map<string, Agg>();
  const buckets = new Map<string, Map<string, Agg>>();
  const totalRows = records.filter((r) => r.market === "total" && (r.side === "over" || r.side === "under"));
  const addCandidate = (label: string, row: Rec, probOver: number | null, game: Game | undefined) => {
    if (probOver === null) return;
    const side = probOver >= 0.5 ? "over" : "under";
    const r = totalResult(side, row.line_value, game);
    if (r !== "win" && r !== "loss" && r !== "push") return;
    const prob = side === "over" ? probOver : 1 - probOver;
    const agg = candidates.get(label) ?? newAgg();
    add(agg, sideOdds(row, side), r, prob, clvBeat(row));
    candidates.set(label, agg);
  };

  for (const row of totalRows) {
    const game = games.get(row.game_id);
    const v22 = obj(obj(row.snapshot_json).v2_2_audit);
    const home = num(v22.posterior_home_runs);
    const away = num(v22.posterior_away_runs);
    const line = row.line_value ?? num(v22.market_total);
    if (home === null || away === null || line === null) continue;
    const marketOver = row.side === "over"
      ? row.market_probability
      : row.market_probability !== null
        ? 1 - row.market_probability
        : num(v22.ou_market_prob) !== null
          ? row.side === "over" ? num(v22.ou_market_prob) : 1 - (num(v22.ou_market_prob) as number)
          : null;
    const rawPoisson = overProbabilityPoisson(home, away, line);
    addCandidate("poisson_raw", row, rawPoisson, game);
    for (const alpha of [0.08, 0.12, 0.18, 0.25]) {
      addCandidate(`negative_binomial_alpha_${alpha}`, row, overProbabilityNegativeBinomial(home, away, line, alpha), game);
    }
    for (const pi of [0.015, 0.03, 0.05]) {
      addCandidate(`zero_inflated_poisson_pi_${pi}`, row, overProbabilityZeroInflatedPoisson(home, away, line, pi), game);
    }
    for (const k of [0.15, 0.25, 0.35, 0.5]) {
      for (const cap of [3, 5, 8]) {
        const p = regularizeProbability({ rawProb: rawPoisson, marketProb: marketOver, k, maxDistancePp: cap }).regularizedProb ?? rawPoisson;
        addCandidate(`poisson_regularized_k_${k}_cap_${cap}`, row, p, game);
        const bucketKey = `${totalLineBucket(line)}|${totalGapBucket(row)}`;
        const bucketMap = buckets.get(bucketKey) ?? new Map<string, Agg>();
        const side = p >= 0.5 ? "over" : "under";
        const rr = totalResult(side, line, game);
        if (rr === "win" || rr === "loss" || rr === "push") {
          const agg = bucketMap.get(`k_${k}_cap_${cap}`) ?? newAgg();
          add(agg, sideOdds(row, side), rr, side === "over" ? p : 1 - p, clvBeat(row));
          bucketMap.set(`k_${k}_cap_${cap}`, agg);
          buckets.set(bucketKey, bucketMap);
        }
      }
    }
  }

  return {
    candidates: Object.fromEntries(sortedEntries(candidates).map(([k, v]) => [k, summarize(v)])),
    situationBuckets: Object.fromEntries(
      [...buckets.entries()].map(([bucket, group]) => [
        bucket,
        Object.fromEntries(sortedEntries(group, 5).slice(0, 5).map(([k, v]) => [k, summarize(v)])),
      ]),
    ),
  };
}

function auditFi(records: Rec[], games: Map<number, Game>): Record<string, unknown> {
  const candidates = new Map<string, Agg>();
  const fiRows = records.filter((r) => r.market === "first_inning");
  for (const row of fiRows) {
    const shipped = result(row.prediction_grades);
    if (shipped !== "win" && shipped !== "loss" && shipped !== "push") continue;
    const fi = obj(obj(row.snapshot_json).fi_v2_audit);
    const posterior = num(fi.posterior_p_nrfi) ?? (row.pick === "NRFI" ? row.model_probability : row.pick === "YRFI" && row.model_probability !== null ? 1 - row.model_probability : null);
    if (posterior === null) continue;
    for (const shrink of [1, 0.85, 0.7, 0.55, 0.4]) {
      const pNrfi = 0.55 + shrink * (posterior - 0.55);
      const pick = pNrfi >= 0.52 ? "nrfi" : pNrfi <= 0.48 ? "yrfi" : null;
      const label = shrink === 1 ? "current_posterior_thresholds" : `empirical_bayes_shrink_${shrink}`;
      if (pick === null) {
        const agg = candidates.get(`${label}_tossup_hold`) ?? newAgg();
        add(agg, null, "push", null, null);
        candidates.set(`${label}_tossup_hold`, agg);
        continue;
      }
      const rr = fiResult(pick, games.get(row.game_id), shipped);
      const agg = candidates.get(label) ?? newAgg();
      add(agg, sideOdds(row, pick), rr, pick === "nrfi" ? pNrfi : 1 - pNrfi, clvBeat(row));
      candidates.set(label, agg);
    }
  }
  return Object.fromEntries(sortedEntries(candidates).map(([k, v]) => [k, summarize(v)]));
}

function auditGrades(records: Rec[]): Record<string, unknown> {
  const groups = new Map<string, Agg>();
  const markets: Market[] = ["moneyline", "total", "first_inning"];
  for (const row of records) {
    const r = result(row.prediction_grades);
    if (r !== "win" && r !== "loss" && r !== "push") continue;
    const key = `${row.market}::${gradeLabel(row)}`;
    const agg = groups.get(key) ?? newAgg();
    add(agg, row.odds_american, r, row.model_probability, clvBeat(row));
    groups.set(key, agg);
  }
  return Object.fromEntries(markets.map((market) => [
    market,
    Object.fromEntries(
      [...groups.entries()]
        .filter(([k]) => k.startsWith(`${market}::`))
        .sort((a, b) => {
          const order = ["best_angle", "best_signal", "lean", "market_aligned", "market_watch", "provisional", "no_play", "ungraded"];
          return order.indexOf(a[0].split("::")[1] ?? "") - order.indexOf(b[0].split("::")[1] ?? "");
        })
        .map(([k, v]) => [k.split("::")[1], summarize(v)]),
    ),
  ]));
}

function auditLockCoverage(records: Rec[]): Record<string, unknown> {
  const byMarket = new Map<string, { n: number; locked: number; lines: number; signals: number; memberFacing: number; clv: number }>();
  for (const row of records) {
    const m = row.market;
    const item = byMarket.get(m) ?? { n: 0, locked: 0, lines: 0, signals: 0, memberFacing: 0, clv: 0 };
    const snap = obj(row.snapshot_json);
    item.n++;
    if (row.locked_at) item.locked++;
    if (Array.isArray(snap.lines_at_lock) && snap.lines_at_lock.length > 0) item.lines++;
    if (Array.isArray(snap.signal_rows_at_lock) && snap.signal_rows_at_lock.length > 0) item.signals++;
    if (obj(snap.member_facing_at_lock).schema_version) item.memberFacing++;
    if (obj(snap.closing_line_value).closing_price !== undefined || obj(snap.closing_line_value).closingOdds !== undefined) item.clv++;
    byMarket.set(m, item);
  }
  return Object.fromEntries([...byMarket.entries()]);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const records = await loadRecords(opts);
  const games = await loadGames(records);
  const report = {
    scope: { sport: "mlb", dateFrom: opts.dateFrom, dateTo: opts.dateTo, rows: records.length },
    totalsDistributionAndRegularization: auditTotals(records, games),
    firstInningEmpiricalBayes: auditFi(records, games),
    playGradeMonotonicity: auditGrades(records),
    lockTimeCoverage: auditLockCoverage(records),
    recommendation: [
      "Promote a candidate only if it improves ROI/Brier without collapsing sample size and without using post-lock data.",
      "Use totals distribution candidates as shadow/audit until they beat current k=.25/cap=5 out-of-sample.",
      "Use FI shrink candidates to decide whether posterior probabilities need stronger empirical-Bayes shrinkage before changing FI runtime.",
      "Retune play-grade thresholds only if Best Angle/Lean/Watchlist are not monotonic by ROI and CLV over lock-time rows.",
    ],
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\nMLB MODEL IMPROVEMENT PATH AUDIT ${opts.dateFrom}..${opts.dateTo}`);
  console.log(`Rows: ${records.length}`);
  console.log("\nTotals candidates");
  for (const [label, s] of Object.entries(report.totalsDistributionAndRegularization.candidates as Record<string, unknown>).slice(0, 20)) {
    const a = s as Record<string, unknown>;
    console.log(`${label.padEnd(44)} n=${a.n} rec=${a.record} win=${a.winPct}% units=${a.units} roi=${a.roiPct}% brier=${a.brier}`);
  }
  console.log("\nFI posterior shrink candidates");
  for (const [label, s] of Object.entries(report.firstInningEmpiricalBayes)) {
    const a = s as Record<string, unknown>;
    console.log(`${label.padEnd(44)} n=${a.n} rec=${a.record} win=${a.winPct}% units=${a.units} roi=${a.roiPct}% brier=${a.brier}`);
  }
  console.log("\nPlay grade monotonicity");
  console.log(JSON.stringify(report.playGradeMonotonicity, null, 2));
  console.log("\nLock-time coverage");
  console.log(JSON.stringify(report.lockTimeCoverage, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
