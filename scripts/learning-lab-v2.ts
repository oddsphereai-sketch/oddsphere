/**
 * Learning Lab v2 — read-only MLB calibration / counterfactual report.
 *
 * No DB writes. No production logic changes. No member-facing changes.
 *
 * Usage:
 *   npm run learning-lab:v2 -- --sport=mlb --from=2026-06-07 --to=today --json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "../lib/db/supabase";

type Market = "moneyline" | "total" | "first_inning";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";
type Split = "train" | "validation" | "holdout";

type RawPredictionRecord = {
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

type Row = {
  id: number;
  date: string;
  split: Split;
  market: Market;
  matchup: string;
  pick: string | null;
  side: string | null;
  line: number | null;
  price: number | null;
  impliedPct: number | null;
  modelPct: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  grade: Grade;
  result: Result;
  units: number;
  outcome: 0 | 1 | null;
  priceBucket: string;
  mlProbBucket: string;
  mlEdgeBucket: string;
  totalGapBucket: string;
  totalLineBucket: string;
  totalDirection: string;
  directionBucket: string;
  lineMovement: string;
  lineMovementMagnitude: number | null;
  marketRead: string;
  hasConsensus: boolean;
  hasSharp: boolean;
  sourceRelationship: string;
  dataQuality: string;
  dataWarning: boolean;
  coverage: {
    lineMovement: boolean;
    consensus: boolean;
    sharp: boolean;
    price: boolean;
    edge: boolean;
    lockedSnapshot: boolean;
  };
};

type Summary = {
  count: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  unknown: number;
  winRate: number | null;
  units: number;
  roi: number | null;
  avgPrice: number | null;
  avgImpliedProbability: number | null;
  avgModelProbability: number | null;
  avgEdge: number | null;
  avgConfidence: number | null;
};

type RuleResult = {
  id: string;
  family: string;
  description: string;
  market: Market;
  threshold?: number;
  overfittingRisk: "low" | "medium" | "high";
  sampleWarning: string;
  full: CounterfactualSummary;
  train: CounterfactualSummary;
  validation: CounterfactualSummary;
  holdout: CounterfactualSummary;
};

type CounterfactualSummary = {
  affectedRows: number;
  originalActionable: Summary;
  simulatedActionable: Summary;
  originalBestAngleCount: number;
  simulatedBestAngleCount: number;
  originalLeanCount: number;
  simulatedLeanCount: number;
  winnersRemoved: number;
  losersRemoved: number;
  winnersPromoted: number;
  losersPromoted: number;
  deltaUnits: number;
  deltaRoi: number | null;
  avgPriceBefore: number | null;
  avgPriceAfter: number | null;
};

const MARKETS: Market[] = ["moneyline", "total", "first_inning"];
const GRADES: Grade[] = ["Best Angle", "Lean", "Watchlist", "Caution", "No Play"];
const ACTIONABLE = new Set<Grade>(["Best Angle", "Lean"]);

function parseArgs() {
  const args = {
    sport: "mlb",
    from: "2026-06-07",
    to: todayEt(),
    outDir: "ops-local/learning-lab",
    json: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") args.json = true;
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") args.sport = value.toLowerCase();
    if (key === "from") args.from = value;
    if (key === "to") args.to = value === "today" ? todayEt() : value;
    if (key === "out-dir") args.outDir = value;
  }
  return args;
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function numberPath(obj: unknown, paths: string[]): number | null {
  for (const p of paths) {
    let cur = obj as Record<string, unknown> | null;
    let ok = true;
    for (const part of p.split(".")) {
      if (cur === null || typeof cur !== "object" || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part] as Record<string, unknown> | null;
    }
    if (ok && typeof cur === "number" && Number.isFinite(cur)) return cur;
  }
  return null;
}

function stringPath(obj: unknown, paths: string[]): string | null {
  for (const p of paths) {
    let cur: unknown = obj;
    let ok = true;
    for (const part of p.split(".")) {
      if (cur === null || typeof cur !== "object" || !(part in cur)) {
        ok = false;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (ok && typeof cur === "string" && cur.trim()) return cur;
  }
  return null;
}

function boolPath(obj: unknown, paths: string[]): boolean {
  for (const p of paths) {
    let cur: unknown = obj;
    let ok = true;
    for (const part of p.split(".")) {
      if (cur === null || typeof cur !== "object" || !(part in cur)) {
        ok = false;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (ok && (cur === true || cur === "true" || cur === 1 || cur === "1")) return true;
  }
  return false;
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
  if (text === "win" || text === "loss" || text === "push" || text === "void" || text === "pending") return text;
  return "unknown";
}

function pct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return +(value <= 1 ? value * 100 : value).toFixed(4);
}

function edgePct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return +(Math.abs(value) <= 1 ? value * 100 : value).toFixed(4);
}

function units(price: number | null, result: Result): number {
  if (result === "loss") return -1;
  if (result !== "win" || price === null || price === 0) return 0;
  return +(price > 0 ? price / 100 : 100 / Math.abs(price)).toFixed(4);
}

function impliedPct(price: number | null): number | null {
  if (price === null || price === 0) return null;
  const p = price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
  return +(p * 100).toFixed(4);
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

function probabilityBucket(value: number | null): string {
  if (value === null) return "missing";
  if (value < 50) return "lt_50";
  if (value < 55) return "50_55";
  if (value < 60) return "55_60";
  if (value < 65) return "60_65";
  if (value < 70) return "65_70";
  return "70_plus";
}

function edgeBucket(value: number | null): string {
  if (value === null) return "missing";
  if (value <= 0) return "negative_or_zero";
  if (value < 2) return "0_2";
  if (value < 5) return "2_5";
  if (value < 8) return "5_8";
  return "8_plus";
}

function totalGapBucket(value: number | null): string {
  if (value === null) return "missing";
  const abs = Math.abs(value);
  if (abs === 0) return "zero";
  if (abs < 0.5) return "0_0.5";
  if (abs < 1) return "0.5_1.0";
  return "1.0_plus";
}

function totalLineBucket(value: number | null): string {
  if (value === null) return "missing";
  if (value <= 7.5) return "lte_7.5";
  if (value < 9) return "8_8.5";
  if (value < 10) return "9_9.5";
  return "10_plus";
}

function snapshotRows(snapshot: Record<string, unknown> | null, market: Market): Array<Record<string, unknown>> {
  const raw = snapshot?.signal_rows_at_lock;
  if (!Array.isArray(raw)) return [];
  const marketType = market === "first_inning" ? "first_inning_total" : market;
  return raw.filter((row): row is Record<string, unknown> =>
    row !== null && typeof row === "object" && (row as Record<string, unknown>).market_type === marketType
  );
}

function sourceState(snapshot: Record<string, unknown> | null, market: Market) {
  const rows = snapshotRows(snapshot, market);
  const hasConsensus = rows.some((row) => row.public_money_pct !== null || row.public_betting_pct !== null) ||
    Boolean(snapshot?.public_splits) ||
    Boolean((snapshot as any)?.recommendationDecision?.consensusSplits);
  const hasSharp = rows.some((row) =>
    row.has_steam_move === true ||
    row.has_reverse_line_movement === true ||
    typeof row.signal_strength === "string" ||
    typeof row.rlm_direction === "string"
  ) || Boolean((snapshot as any)?.recommendationDecision?.sharpBookSplits);
  const sourceConflict = boolPath(snapshot, [
    "recommendationDecision.sourceConflict",
    "sourceConflict",
    "public_splits.conflict",
    "v2_1_audit.market_read_summary.market_disagreement_ml",
    "v2_1_audit.market_read_summary.market_disagreement_ou",
  ]);
  return {
    hasConsensus,
    hasSharp,
    sourceConflict,
    relationship: sourceConflict ? "source_conflict" : hasConsensus && hasSharp ? "both_available_no_conflict" : hasConsensus ? "consensus_only" : hasSharp ? "sharp_only" : "not_persisted",
  };
}

function marketRead(snapshot: Record<string, unknown> | null, market: Market): string {
  const direct = stringPath(snapshot, [
    "recommendationDecision.resolvedMarketRead.status",
    "resolvedMarketRead.status",
    "marketRead.status",
    "market_read.status",
  ]);
  if (direct) return direct;
  const rows = snapshotRows(snapshot, market);
  if (market === "first_inning" && rows.length === 0) return "historical_fi_market_context_not_persisted";
  if (rows.length > 0) return "source_rows_present_unclassified";
  return "historical_market_read_not_persisted";
}

function lineMovement(snapshot: Record<string, unknown> | null): { bucket: string; magnitude: number | null } {
  const direction = stringPath(snapshot, [
    "line_movement.direction",
    "marketReadV2.movement.directionRelativeToPick",
    "recommendationDecision.resolvedMarketRead.movement.directionRelativeToPick",
  ]);
  const magnitude = numberPath(snapshot, [
    "line_movement.magnitude",
    "line_movement.magnitude_pp",
    "line_movement.price_delta",
    "line_movement.delta",
  ]);
  if (direction) {
    if (/toward|support/i.test(direction)) return { bucket: "toward_pick", magnitude };
    if (/against|resist|oppose/i.test(direction)) return { bucket: "against_pick", magnitude };
    if (/flat|none|no/i.test(direction)) return { bucket: "no_movement", magnitude };
    return { bucket: direction, magnitude };
  }
  if (snapshot?.line_movement && typeof snapshot.line_movement === "object") return { bucket: "present_unclassified", magnitude };
  return { bucket: "unknown", magnitude };
}

function totalProjectionGap(snapshot: Record<string, unknown> | null, line: number | null, side: string | null, pick: string | null): number | null {
  const projected = numberPath(snapshot, [
    "total_projection_reconciliation.reconciled_total",
    "v2_2_audit.posterior_total",
    "review_v1.reviewed.total",
    "review_v1.raw.total",
  ]);
  if (projected === null || line === null) return null;
  const rawGap = projected - line;
  const direction = String(side ?? pick ?? "").toLowerCase();
  return direction.includes("under") ? -rawGap : rawGap;
}

function dataQuality(snapshot: Record<string, unknown> | null, market: Market): string {
  if (market === "first_inning") {
    return stringPath(snapshot, ["fi_v2_audit.data_quality_tier", "v2_data_quality_tier"]) ?? "unknown";
  }
  return stringPath(snapshot, ["v2_2_audit.data_quality_tier", "v2_data_quality_tier"]) ?? "unknown";
}

function dataWarning(snapshot: Record<string, unknown> | null): boolean {
  const text = JSON.stringify(snapshot ?? {}).toLowerCase();
  return /warning|missing|fallback|stale|lineup|starter|injury|provisional|mismatch/.test(text);
}

function directionBucket(market: Market, price: number | null, side: string | null, pick: string | null): string {
  if (market === "moneyline") return price !== null && price < 0 ? "favorite" : "dog";
  if (market === "total") return /under/i.test(side ?? pick ?? "") ? "under" : /over/i.test(side ?? pick ?? "") ? "over" : "unknown";
  return /nrfi|under/i.test(side ?? pick ?? "") ? "nrfi" : /yrfi|over/i.test(side ?? pick ?? "") ? "yrfi" : "toss_up";
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return +(nums.reduce((sum, v) => sum + v, 0) / nums.length).toFixed(4);
}

function summarize(rows: Row[]): Summary {
  const wins = rows.filter((r) => r.result === "win").length;
  const losses = rows.filter((r) => r.result === "loss").length;
  const settled = wins + losses;
  const unitsNet = +rows.reduce((sum, r) => sum + r.units, 0).toFixed(4);
  return {
    count: rows.length,
    settled,
    wins,
    losses,
    pushes: rows.filter((r) => r.result === "push").length,
    voids: rows.filter((r) => r.result === "void").length,
    pending: rows.filter((r) => r.result === "pending").length,
    unknown: rows.filter((r) => r.result === "unknown").length,
    winRate: settled ? +(wins / settled).toFixed(4) : null,
    units: unitsNet,
    roi: settled ? +(unitsNet / settled).toFixed(4) : null,
    avgPrice: avg(rows.map((r) => r.price)),
    avgImpliedProbability: avg(rows.map((r) => r.impliedPct)),
    avgModelProbability: avg(rows.map((r) => r.modelPct)),
    avgEdge: avg(rows.map((r) => r.edgePct)),
    avgConfidence: avg(rows.map((r) => r.confidencePct)),
  };
}

function group(rows: Row[], keyFn: (row: Row) => string): Record<string, Summary> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, bucket]) => [key, summarize(bucket)]));
}

function splitRows(rows: Row[]): Row[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.6);
  const validationEnd = Math.floor(sorted.length * 0.8);
  return sorted.map((row, index) => ({
    ...row,
    split: index < trainEnd ? "train" : index < validationEnd ? "validation" : "holdout",
  }));
}

async function loadRows(args: ReturnType<typeof parseArgs>): Promise<Row[]> {
  const rawRows: RawPredictionRecord[] = [];
  const pageSize = 750;
  for (let from = 0; from < 5000; from += pageSize) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,game_id,matchup,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,edge,play_grade,best_angle,no_bet,launch_day,locked_at,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .order("slate_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.from) query = query.gte("slate_date", args.from);
    if (args.to) query = query.lte("slate_date", args.to);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records load failed: ${error.message}`);
    rawRows.push(...((data ?? []) as RawPredictionRecord[]));
    if ((data ?? []).length < pageSize) break;
  }

  const mapped = rawRows.flatMap((raw): Row[] => {
    if (raw.launch_day === true) return [];
    const market = normalizeMarket(raw.market);
    if (!market || !MARKETS.includes(market)) return [];
    const result = normalizeResult(one(raw.prediction_grades)?.result);
    const source = sourceState(raw.snapshot_json, market);
    const move = lineMovement(raw.snapshot_json);
    const model = pct(raw.model_probability);
    const implied = pct(raw.market_probability) ?? impliedPct(raw.odds_american);
    const gap = market === "total" ? totalProjectionGap(raw.snapshot_json, raw.line_value, raw.side, raw.pick) : null;
    const grade = normalizeGrade(raw.play_grade, raw.best_angle, raw.no_bet);
    return [{
      id: raw.id,
      date: raw.slate_date,
      split: "train",
      market,
      matchup: raw.matchup ?? "",
      pick: raw.pick,
      side: raw.side,
      line: raw.line_value,
      price: raw.odds_american,
      impliedPct: implied,
      modelPct: model,
      edgePct: edgePct(raw.edge),
      confidencePct: pct(raw.confidence),
      grade,
      result,
      units: units(raw.odds_american, result),
      outcome: result === "win" ? 1 : result === "loss" ? 0 : null,
      priceBucket: priceBucket(raw.odds_american),
      mlProbBucket: probabilityBucket(model),
      mlEdgeBucket: edgeBucket(raw.edge),
      totalGapBucket: totalGapBucket(gap),
      totalLineBucket: totalLineBucket(raw.line_value),
      totalDirection: directionBucket("total", raw.odds_american, raw.side, raw.pick),
      directionBucket: directionBucket(market, raw.odds_american, raw.side, raw.pick),
      lineMovement: move.bucket,
      lineMovementMagnitude: move.magnitude,
      marketRead: marketRead(raw.snapshot_json, market),
      hasConsensus: source.hasConsensus,
      hasSharp: source.hasSharp,
      sourceRelationship: source.relationship,
      dataQuality: dataQuality(raw.snapshot_json, market),
      dataWarning: dataWarning(raw.snapshot_json),
      coverage: {
        lineMovement: move.bucket !== "unknown",
        consensus: source.hasConsensus,
        sharp: source.hasSharp,
        price: raw.odds_american !== null,
        edge: raw.edge !== null,
        lockedSnapshot: raw.locked_at !== null || raw.snapshot_json?.stage === "t60_locked",
      },
    }];
  });
  return splitRows(mapped);
}

function gradeRank(grade: Grade): number {
  return GRADES.indexOf(grade);
}

function capGrade(grade: Grade, cap: Grade): Grade {
  return gradeRank(grade) < gradeRank(cap) ? cap : grade;
}

function promoteGrade(grade: Grade, target: Grade): Grade {
  return gradeRank(grade) > gradeRank(target) ? target : grade;
}

type Rule = {
  id: string;
  family: string;
  description: string;
  market: Market;
  threshold?: number;
  apply: (row: Row) => Grade;
};

function rules(): Rule[] {
  const mlHeavy = [-150, -175, -200];
  const out: Rule[] = [];
  for (const edge of [5, 8, 10]) {
    out.push({
      id: `ml_heavy_fav_ba_edge_lt_${edge}_to_lean`,
      family: "ML cap",
      market: "moneyline",
      threshold: edge,
      description: `Heavy favorite Best Angle with edge below ${edge}pp -> Lean`,
      apply: (r) => r.market === "moneyline" && r.grade === "Best Angle" && r.price !== null && r.price <= -150 && (r.edgePct ?? -99) < edge ? "Lean" : r.grade,
    });
    out.push({
      id: `ml_heavy_fav_lean_edge_lt_${edge}_to_watchlist`,
      family: "ML cap",
      market: "moneyline",
      threshold: edge,
      description: `Heavy favorite Lean with edge below ${edge}pp -> Watchlist`,
      apply: (r) => r.market === "moneyline" && r.grade === "Lean" && r.price !== null && r.price <= -150 && (r.edgePct ?? -99) < edge ? "Watchlist" : r.grade,
    });
  }
  for (const price of mlHeavy) {
    for (const edge of [5, 8]) {
      out.push({
        id: `ml_60_70_price_${Math.abs(price)}_edge_lt_${edge}_cap`,
        family: "ML cap",
        market: "moneyline",
        threshold: edge,
        description: `ML 60-70% band, price worse than ${price}, edge below ${edge}pp -> cap to Lean/Watchlist`,
        apply: (r) => {
          if (r.market !== "moneyline" || r.price === null || r.modelPct === null || r.modelPct < 60 || r.modelPct >= 70 || r.price > price || (r.edgePct ?? -99) >= edge) return r.grade;
          return r.grade === "Best Angle" ? "Lean" : r.grade === "Lean" ? "Watchlist" : r.grade;
        },
      });
    }
  }
  for (const edge of [2, 5, 8]) {
    out.push({
      id: `ml_against_move_edge_lt_${edge}_cap`,
      family: "ML cap",
      market: "moneyline",
      threshold: edge,
      description: `ML movement against pick with edge below ${edge}pp -> cap one tier`,
      apply: (r) => r.market === "moneyline" && r.lineMovement === "against_pick" && (r.edgePct ?? -99) < edge
        ? capGrade(r.grade, r.grade === "Best Angle" ? "Lean" : "Watchlist")
        : r.grade,
    });
  }
  out.push({
    id: "ml_market_resistance_no_move_support_cap",
    family: "ML cap",
    market: "moneyline",
    description: "ML market resistance/mixed without movement support -> cap one tier",
    apply: (r) => r.market === "moneyline" && /resistance|mixed|conflict/.test(`${r.marketRead} ${r.sourceRelationship}`) && r.lineMovement !== "toward_pick"
      ? capGrade(r.grade, r.grade === "Best Angle" ? "Lean" : "Watchlist")
      : r.grade,
  });
  for (const edge of [2, 5, 8]) {
    out.push({
      id: `ml_watchlist_dog_edge_${edge}_to_lean`,
      family: "ML promotion",
      market: "moneyline",
      threshold: edge,
      description: `Watchlist plus-money dog with edge >= ${edge}pp -> Lean`,
      apply: (r) => r.market === "moneyline" && r.grade === "Watchlist" && r.price !== null && r.price >= 100 && (r.edgePct ?? -99) >= edge ? "Lean" : r.grade,
    });
    out.push({
      id: `ml_watchlist_edge_${edge}_market_support_to_lean`,
      family: "ML promotion",
      market: "moneyline",
      threshold: edge,
      description: `Watchlist with edge >= ${edge}pp and support/toward movement -> Lean`,
      apply: (r) => r.market === "moneyline" && r.grade === "Watchlist" && (r.edgePct ?? -99) >= edge && (r.lineMovement === "toward_pick" || /support|aligned/.test(r.marketRead)) ? "Lean" : r.grade,
    });
  }
  out.push({
    id: "ml_caution_plus_money_strong_edge_to_watchlist",
    family: "ML promotion",
    market: "moneyline",
    description: "Caution plus-money with edge >= 8pp and no data warning -> Watchlist",
    apply: (r) => r.market === "moneyline" && r.grade === "Caution" && r.price !== null && r.price >= 100 && (r.edgePct ?? -99) >= 8 && !r.dataWarning ? "Watchlist" : r.grade,
  });

  for (const gap of [0.5, 1]) {
    out.push({
      id: `totals_lean_gap_lt_${String(gap).replace(".", "_")}_to_watchlist`,
      family: "Totals cap",
      market: "total",
      threshold: gap,
      description: `Totals Lean with projection gap below ${gap} -> Watchlist`,
      apply: (r) => r.market === "total" && r.grade === "Lean" && Math.abs(totalGapValue(r)) < gap ? "Watchlist" : r.grade,
    });
  }
  for (const edge of [2, 5]) {
    out.push({
      id: `totals_lean_edge_lt_${edge}_resistance_to_watchlist`,
      family: "Totals cap",
      market: "total",
      threshold: edge,
      description: `Totals Lean with edge below ${edge}pp and market resistance -> Watchlist`,
      apply: (r) => r.market === "total" && r.grade === "Lean" && (r.edgePct ?? -99) < edge && /resistance|mixed|conflict/.test(`${r.marketRead} ${r.sourceRelationship}`) ? "Watchlist" : r.grade,
    });
  }
  out.push({
    id: "totals_high_line_weak_gap_cap",
    family: "Totals cap",
    market: "total",
    description: "Totals line 9+ with weak projection gap -> cap Best Angle/Lean one tier",
    apply: (r) => r.market === "total" && r.line !== null && r.line >= 9 && Math.abs(totalGapValue(r)) < 0.5
      ? capGrade(r.grade, r.grade === "Best Angle" ? "Lean" : "Watchlist")
      : r.grade,
  });
  for (const edge of [2, 5]) {
    out.push({
      id: `totals_against_move_thin_edge_${edge}_cap`,
      family: "Totals cap",
      market: "total",
      threshold: edge,
      description: `Totals movement against pick with edge below ${edge}pp -> cap one tier`,
      apply: (r) => r.market === "total" && r.lineMovement === "against_pick" && (r.edgePct ?? -99) < edge
        ? capGrade(r.grade, r.grade === "Best Angle" ? "Lean" : "Watchlist")
        : r.grade,
    });
  }
  for (const gap of [0.5, 1]) {
    out.push({
      id: `totals_watchlist_gap_${String(gap).replace(".", "_")}_to_lean`,
      family: "Totals promotion",
      market: "total",
      threshold: gap,
      description: `Totals Watchlist with projection gap >= ${gap} -> Lean`,
      apply: (r) => r.market === "total" && r.grade === "Watchlist" && Math.abs(totalGapValue(r)) >= gap ? "Lean" : r.grade,
    });
  }
  for (const edge of [5, 8]) {
    out.push({
      id: `totals_watchlist_edge_${edge}_toward_to_lean`,
      family: "Totals promotion",
      market: "total",
      threshold: edge,
      description: `Totals Watchlist with edge >= ${edge}pp and movement/support -> Lean`,
      apply: (r) => r.market === "total" && r.grade === "Watchlist" && (r.edgePct ?? -99) >= edge && (r.lineMovement === "toward_pick" || /support|aligned/.test(r.marketRead)) ? "Lean" : r.grade,
    });
  }
  out.push({
    id: "totals_caution_strong_gap_low_materiality_to_watchlist",
    family: "Totals promotion",
    market: "total",
    description: "Totals Caution with projection gap >= 1.0 and no data warning -> Watchlist",
    apply: (r) => r.market === "total" && r.grade === "Caution" && Math.abs(totalGapValue(r)) >= 1 && !r.dataWarning ? "Watchlist" : r.grade,
  });

  out.push({
    id: "fi_price_too_expensive_for_edge_cap",
    family: "FI exploratory",
    market: "first_inning",
    description: "FI price <= -150 and edge below 5pp -> cap to Watchlist/No Play",
    apply: (r) => r.market === "first_inning" && r.price !== null && r.price <= -150 && (r.edgePct ?? -99) < 5
      ? capGrade(r.grade, r.grade === "Lean" ? "Watchlist" : "No Play")
      : r.grade,
  });
  out.push({
    id: "fi_negative_edge_priced_no_play",
    family: "FI exploratory",
    market: "first_inning",
    description: "FI priced play with negative/zero edge -> No Play",
    apply: (r) => r.market === "first_inning" && r.price !== null && (r.edgePct ?? 0) <= 0 ? "No Play" : r.grade,
  });
  out.push({
    id: "fi_missing_price_lean_to_watchlist",
    family: "FI exploratory",
    market: "first_inning",
    description: "FI Lean with missing price -> Watchlist",
    apply: (r) => r.market === "first_inning" && r.grade === "Lean" && r.price === null ? "Watchlist" : r.grade,
  });
  out.push({
    id: "fi_toss_up_no_play",
    family: "FI exploratory",
    market: "first_inning",
    description: "FI Toss-Up/unknown side -> No Play",
    apply: (r) => r.market === "first_inning" && r.directionBucket === "toss_up" ? "No Play" : r.grade,
  });
  return out;
}

function totalGapValue(row: Row): number {
  const label = row.totalGapBucket;
  if (label === "1.0_plus") return 1;
  if (label === "0.5_1.0") return 0.75;
  if (label === "0_0.5") return 0.25;
  return 0;
}

function simulate(rows: Row[], rule: Rule): CounterfactualSummary {
  const beforeActionable = rows.filter((r) => ACTIONABLE.has(r.grade));
  const afterRows = rows.map((r) => ({ ...r, grade: rule.apply(r) }));
  const afterActionable = afterRows.filter((r) => ACTIONABLE.has(r.grade));
  const affected = rows.filter((r) => rule.apply(r) !== r.grade);
  const removed = rows.filter((r) => ACTIONABLE.has(r.grade) && !ACTIONABLE.has(rule.apply(r)));
  const promoted = rows.filter((r) => !ACTIONABLE.has(r.grade) && ACTIONABLE.has(rule.apply(r)));
  const before = summarize(beforeActionable);
  const after = summarize(afterActionable);
  return {
    affectedRows: affected.length,
    originalActionable: before,
    simulatedActionable: after,
    originalBestAngleCount: beforeActionable.filter((r) => r.grade === "Best Angle").length,
    simulatedBestAngleCount: afterActionable.filter((r) => r.grade === "Best Angle").length,
    originalLeanCount: beforeActionable.filter((r) => r.grade === "Lean").length,
    simulatedLeanCount: afterActionable.filter((r) => r.grade === "Lean").length,
    winnersRemoved: removed.filter((r) => r.result === "win").length,
    losersRemoved: removed.filter((r) => r.result === "loss").length,
    winnersPromoted: promoted.filter((r) => r.result === "win").length,
    losersPromoted: promoted.filter((r) => r.result === "loss").length,
    deltaUnits: +((after.units ?? 0) - (before.units ?? 0)).toFixed(4),
    deltaRoi: before.roi !== null && after.roi !== null ? +(after.roi - before.roi).toFixed(4) : null,
    avgPriceBefore: before.avgPrice,
    avgPriceAfter: after.avgPrice,
  };
}

function sampleWarning(summary: CounterfactualSummary): string {
  const n = summary.affectedRows;
  if (n < 20) return "exploratory_only_n_lt_20";
  if (n < 40) return "caution_n_20_40";
  return "more_credible_n_40_plus_still_needs_validation";
}

function overfittingRisk(full: CounterfactualSummary, train: CounterfactualSummary, validation: CounterfactualSummary, holdout: CounterfactualSummary): "low" | "medium" | "high" {
  if (full.affectedRows < 20 || validation.affectedRows < 5 || holdout.affectedRows < 5) return "high";
  const signs = [train.deltaUnits, validation.deltaUnits, holdout.deltaUnits].map((v) => Math.sign(v));
  if (signs.every((s) => s >= 0) || signs.every((s) => s <= 0)) return "low";
  return "medium";
}

function runRules(rows: Row[]): RuleResult[] {
  return rules().map((rule) => {
    const marketRows = rows.filter((r) => r.market === rule.market);
    const full = simulate(marketRows, rule);
    const train = simulate(marketRows.filter((r) => r.split === "train"), rule);
    const validation = simulate(marketRows.filter((r) => r.split === "validation"), rule);
    const holdout = simulate(marketRows.filter((r) => r.split === "holdout"), rule);
    return {
      id: rule.id,
      family: rule.family,
      description: rule.description,
      market: rule.market,
      threshold: rule.threshold,
      overfittingRisk: overfittingRisk(full, train, validation, holdout),
      sampleWarning: sampleWarning(full),
      full,
      train,
      validation,
      holdout,
    };
  }).sort((a, b) => b.full.deltaUnits - a.full.deltaUnits);
}

function topEntries<T extends Record<string, Summary>>(obj: T, n = 10): Array<{ key: string; summary: Summary }> {
  return Object.entries(obj)
    .map(([key, summary]) => ({ key, summary }))
    .filter((entry) => entry.summary.settled > 0)
    .sort((a, b) => a.summary.units - b.summary.units)
    .slice(0, n);
}

function buildReport(rows: Row[], args: ReturnType<typeof parseArgs>) {
  const settled = rows.filter((r) => r.result === "win" || r.result === "loss");
  const byMarket = Object.fromEntries(MARKETS.map((m) => [m, summarize(rows.filter((r) => r.market === m))]));
  const byMarketGrade = Object.fromEntries(MARKETS.map((m) => [m, group(rows.filter((r) => r.market === m), (r) => r.grade)]));
  const ml = rows.filter((r) => r.market === "moneyline");
  const totals = rows.filter((r) => r.market === "total");
  const fi = rows.filter((r) => r.market === "first_inning");
  const mlSegmentation = {
    byPriceBucket: group(ml, (r) => r.priceBucket),
    byProbabilityBand: group(ml, (r) => r.mlProbBucket),
    byEdgeBucket: group(ml, (r) => r.mlEdgeBucket),
    byFavoriteDog: group(ml, (r) => r.directionBucket),
    byGradePrice: group(ml, (r) => `${r.grade}__${r.priceBucket}`),
    byGradeProbability: group(ml, (r) => `${r.grade}__${r.mlProbBucket}`),
    byGradeEdge: group(ml, (r) => `${r.grade}__${r.mlEdgeBucket}`),
    specialFocus: {
      band60to70: summarize(ml.filter((r) => r.modelPct !== null && r.modelPct >= 60 && r.modelPct < 70)),
      heavyFavorites: summarize(ml.filter((r) => r.price !== null && r.price <= -150)),
      plusMoneyDogsWithEdge: summarize(ml.filter((r) => r.price !== null && r.price >= 100 && (r.edgePct ?? -99) > 0)),
      watchlists: summarize(ml.filter((r) => r.grade === "Watchlist")),
    },
  };
  const totalsSegmentation = {
    byProjectedTotalGap: group(totals, (r) => r.totalGapBucket),
    byTotalLineRange: group(totals, (r) => r.totalLineBucket),
    byDirection: group(totals, (r) => r.totalDirection),
    byEdgeBucket: group(totals, (r) => r.mlEdgeBucket),
    byGradeGap: group(totals, (r) => `${r.grade}__${r.totalGapBucket}`),
    byGradeLine: group(totals, (r) => `${r.grade}__${r.totalLineBucket}`),
    byGradeDirection: group(totals, (r) => `${r.grade}__${r.totalDirection}`),
    specialFocus: {
      line9Plus: summarize(totals.filter((r) => r.line !== null && r.line >= 9)),
      overs: summarize(totals.filter((r) => r.totalDirection === "over")),
      unders: summarize(totals.filter((r) => r.totalDirection === "under")),
      watchlists: summarize(totals.filter((r) => r.grade === "Watchlist")),
      leans: summarize(totals.filter((r) => r.grade === "Lean")),
    },
  };
  const lineMovement = {
    byMarket: Object.fromEntries(MARKETS.map((m) => [m, group(rows.filter((r) => r.market === m), (r) => r.lineMovement)])),
    byMarketGrade: Object.fromEntries(MARKETS.map((m) => [m, group(rows.filter((r) => r.market === m), (r) => `${r.grade}__${r.lineMovement}`)])),
    byMlPrice: group(ml, (r) => `${r.priceBucket}__${r.lineMovement}`),
    byMlEdge: group(ml, (r) => `${r.mlEdgeBucket}__${r.lineMovement}`),
    byTotalDirection: group(totals, (r) => `${r.totalDirection}__${r.lineMovement}`),
    byTotalEdge: group(totals, (r) => `${r.mlEdgeBucket}__${r.lineMovement}`),
    byMarketRead: group(rows, (r) => `${r.market}__${r.marketRead}__${r.lineMovement}`),
    bySourceRelationship: group(rows, (r) => `${r.market}__${r.sourceRelationship}__${r.lineMovement}`),
  };
  const watchlistLean = {
    moneyline: {
      watchlist: summarize(ml.filter((r) => r.grade === "Watchlist")),
      lean: summarize(ml.filter((r) => r.grade === "Lean")),
      byPrice: group(ml.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.priceBucket}`),
      byEdge: group(ml.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.mlEdgeBucket}`),
      byMovement: group(ml.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.lineMovement}`),
      byMarketRead: group(ml.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.marketRead}`),
    },
    total: {
      watchlist: summarize(totals.filter((r) => r.grade === "Watchlist")),
      lean: summarize(totals.filter((r) => r.grade === "Lean")),
      byPrice: group(totals.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.priceBucket}`),
      byEdge: group(totals.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.mlEdgeBucket}`),
      byGap: group(totals.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.totalGapBucket}`),
      byMovement: group(totals.filter((r) => r.grade === "Watchlist" || r.grade === "Lean"), (r) => `${r.grade}__${r.lineMovement}`),
    },
  };
  const coverageBias = {
    lineMovement: group(rows, (r) => r.coverage.lineMovement ? "line_movement_available" : "line_movement_missing"),
    consensus: group(rows, (r) => r.coverage.consensus ? "consensus_available" : "consensus_missing"),
    sharp: group(rows, (r) => r.coverage.sharp ? "sharp_available" : "sharp_missing"),
    fiPrice: group(fi, (r) => r.coverage.price ? "fi_price_available" : "fi_price_missing"),
    lockedSnapshot: group(rows, (r) => r.coverage.lockedSnapshot ? "locked_snapshot_available" : "locked_snapshot_missing_or_prelock"),
    edge: group(rows, (r) => r.coverage.edge ? "edge_available" : "edge_missing"),
  };
  const ruleResults = runRules(rows);
  const leaks = [
    ...topEntries(mlSegmentation.byGradePrice, 8).map((e) => ({ market: "moneyline", type: "grade_price_leak", ...e })),
    ...topEntries(totalsSegmentation.byGradeGap, 8).map((e) => ({ market: "total", type: "grade_gap_leak", ...e })),
    ...topEntries(lineMovement.byMarketGrade.moneyline, 6).map((e) => ({ market: "moneyline", type: "movement_grade_leak", ...e })),
    ...topEntries(lineMovement.byMarketGrade.total, 6).map((e) => ({ market: "total", type: "movement_grade_leak", ...e })),
  ].sort((a, b) => a.summary.units - b.summary.units).slice(0, 20);
  const opportunities = [
    ...Object.entries(byMarketGrade.moneyline ?? {}).map(([key, summary]) => ({ market: "moneyline", key, summary })),
    ...Object.entries(byMarketGrade.total ?? {}).map(([key, summary]) => ({ market: "total", key, summary })),
    ...Object.entries(watchlistLean.moneyline.byPrice).map(([key, summary]) => ({ market: "moneyline", key, summary })),
    ...Object.entries(watchlistLean.total.byGap).map(([key, summary]) => ({ market: "total", key, summary })),
  ].filter((entry) => entry.summary.settled >= 5).sort((a, b) => b.summary.units - a.summary.units).slice(0, 20);
  return {
    generatedAt: new Date().toISOString(),
    noCost: true,
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    args,
    dataset: {
      rows: rows.length,
      settledRows: settled.length,
      strictSampleSize: settled.filter((r) => r.modelPct !== null).length,
      dateRange: { from: rows[0]?.date ?? null, to: rows[rows.length - 1]?.date ?? null },
      splitCounts: {
        train: rows.filter((r) => r.split === "train").length,
        validation: rows.filter((r) => r.split === "validation").length,
        holdout: rows.filter((r) => r.split === "holdout").length,
      },
    },
    baseline: { byMarket, byMarketGrade },
    mlSegmentation,
    totalsSegmentation,
    lineMovement,
    watchlistLean,
    coverageBias,
    leakFinder: leaks,
    opportunityFinder: opportunities,
    counterfactuals: {
      strongestRules: ruleResults.slice(0, 15),
      weakestRules: [...ruleResults].sort((a, b) => a.full.deltaUnits - b.full.deltaUnits).slice(0, 15),
      allRules: ruleResults,
    },
    recommendations: recommendations(ruleResults, coverageBias),
  };
}

function recommendations(ruleResults: RuleResult[], coverageBias: Record<string, Record<string, Summary>>) {
  const candidateRules = ruleResults.filter((r) => r.full.deltaUnits > 0 && r.overfittingRisk !== "high" && r.full.affectedRows >= 20).slice(0, 8);
  const rejectedRules = ruleResults.filter((r) => r.full.deltaUnits < 0).sort((a, b) => a.full.deltaUnits - b.full.deltaUnits).slice(0, 8);
  const dataFirst = [];
  const fiPriceMissing = coverageBias.fiPrice?.fi_price_missing;
  if (fiPriceMissing && fiPriceMissing.count > 0) dataFirst.push("FI price coverage remains a calibration blocker; do not ship FI rule changes until FI price/line-history coverage improves.");
  const sharpMissing = coverageBias.sharp?.sharp_missing;
  if (sharpMissing && sharpMissing.count > 0) dataFirst.push("Historical sharp context is missing for many rows; treat sharp-source conclusions as persistence limitations, not model truth.");
  return {
    candidateRules,
    rejectedRules,
    noChange: [
      "Do not alter production probabilities from this sample alone.",
      "Do not auto-promote Watchlists globally; only market-specific sub-cohorts should be shadow-tested.",
      "Do not tune FI production rules until price/edge/line-history coverage is materially better.",
    ],
    dataFirst,
    nextActions: [
      "Run this Learning Lab after each graded slate.",
      "Move only low-overfit candidate rules into shadow mode, not production.",
      "Add real bullpen/weather fallback booleans to future locked snapshots.",
      "Improve FI price and line-history persistence before FI calibration changes.",
    ],
  };
}

function mdSummary(s: Summary): string {
  const record = `${s.wins}-${s.losses}${s.pushes ? `-${s.pushes}` : ""}`;
  const win = s.winRate === null ? "n/a" : `${(s.winRate * 100).toFixed(1)}%`;
  const roi = s.roi === null ? "n/a" : `${(s.roi * 100).toFixed(1)}%`;
  return `n=${s.count}, settled=${s.settled}, ${record}, win=${win}, units=${s.units.toFixed(2)}, ROI=${roi}, avgPrice=${s.avgPrice ?? "n/a"}, avgImp=${s.avgImpliedProbability ?? "n/a"}, avgModel=${s.avgModelProbability ?? "n/a"}, avgEdge=${s.avgEdge ?? "n/a"}`;
}

function table(title: string, entries: Record<string, Summary>, max = 20): string {
  const rows = Object.entries(entries).slice(0, max);
  if (!rows.length) return `\n### ${title}\n\nNo rows.\n`;
  return `\n### ${title}\n\n| Cohort | Sample | Record | Units | ROI | Avg Price | Avg Imp | Avg Model | Avg Edge |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.map(([key, s]) => `| ${key} | ${s.count} | ${s.wins}-${s.losses}${s.pushes ? `-${s.pushes}` : ""} | ${s.units.toFixed(2)} | ${s.roi === null ? "n/a" : `${(s.roi * 100).toFixed(1)}%`} | ${s.avgPrice ?? "n/a"} | ${s.avgImpliedProbability ?? "n/a"} | ${s.avgModelProbability ?? "n/a"} | ${s.avgEdge ?? "n/a"} |`).join("\n")}\n`;
}

function toMarkdown(report: ReturnType<typeof buildReport>): string {
  const strongest = report.counterfactuals.strongestRules.slice(0, 10);
  const weakest = report.counterfactuals.weakestRules.slice(0, 8);
  return `# MLB Learning Lab v2

Generated: ${report.generatedAt}

Read-only: no DB writes, no production changes, no paid AI calls.

## Dataset

- Rows: ${report.dataset.rows}
- Settled rows: ${report.dataset.settledRows}
- Strict sample size: ${report.dataset.strictSampleSize}
- Date range: ${report.dataset.dateRange.from} to ${report.dataset.dateRange.to}
- Split counts: train ${report.dataset.splitCounts.train}, validation ${report.dataset.splitCounts.validation}, holdout ${report.dataset.splitCounts.holdout}

## Baseline By Market

${Object.entries(report.baseline.byMarket).map(([market, s]) => `- ${market}: ${mdSummary(s)}`).join("\n")}

${table("Moneyline by Grade", report.baseline.byMarketGrade.moneyline)}
${table("Totals by Grade", report.baseline.byMarketGrade.total)}
${table("FI by Grade", report.baseline.byMarketGrade.first_inning)}

## ML Segmentation

${table("ML Price Bucket", report.mlSegmentation.byPriceBucket)}
${table("ML Probability Band", report.mlSegmentation.byProbabilityBand)}
${table("ML Edge Bucket", report.mlSegmentation.byEdgeBucket)}
${table("ML Grade x Price", report.mlSegmentation.byGradePrice, 40)}

Special focus:
- 60-70% band: ${mdSummary(report.mlSegmentation.specialFocus.band60to70)}
- Heavy favorites: ${mdSummary(report.mlSegmentation.specialFocus.heavyFavorites)}
- Plus-money dogs with edge: ${mdSummary(report.mlSegmentation.specialFocus.plusMoneyDogsWithEdge)}
- Watchlists: ${mdSummary(report.mlSegmentation.specialFocus.watchlists)}

## Totals Segmentation

${table("Totals Projection Gap", report.totalsSegmentation.byProjectedTotalGap)}
${table("Totals Line Range", report.totalsSegmentation.byTotalLineRange)}
${table("Totals Direction", report.totalsSegmentation.byDirection)}
${table("Totals Edge Bucket", report.totalsSegmentation.byEdgeBucket)}
${table("Totals Grade x Gap", report.totalsSegmentation.byGradeGap, 40)}

Special focus:
- Line 9+: ${mdSummary(report.totalsSegmentation.specialFocus.line9Plus)}
- Overs: ${mdSummary(report.totalsSegmentation.specialFocus.overs)}
- Unders: ${mdSummary(report.totalsSegmentation.specialFocus.unders)}
- Watchlists: ${mdSummary(report.totalsSegmentation.specialFocus.watchlists)}
- Leans: ${mdSummary(report.totalsSegmentation.specialFocus.leans)}

## Line Movement

${table("Line Movement: ML", report.lineMovement.byMarket.moneyline)}
${table("Line Movement: Totals", report.lineMovement.byMarket.total)}
${table("Line Movement: FI", report.lineMovement.byMarket.first_inning)}
${table("ML Grade x Movement", report.lineMovement.byMarketGrade.moneyline, 40)}
${table("Totals Grade x Movement", report.lineMovement.byMarketGrade.total, 40)}

## Watchlist / Lean Inversion

- ML Watchlist: ${mdSummary(report.watchlistLean.moneyline.watchlist)}
- ML Lean: ${mdSummary(report.watchlistLean.moneyline.lean)}
- Totals Watchlist: ${mdSummary(report.watchlistLean.total.watchlist)}
- Totals Lean: ${mdSummary(report.watchlistLean.total.lean)}

${table("ML Watchlist/Lean by Price", report.watchlistLean.moneyline.byPrice, 40)}
${table("Totals Watchlist/Lean by Gap", report.watchlistLean.total.byGap, 40)}

## Coverage Bias

${table("Line Movement Coverage", report.coverageBias.lineMovement)}
${table("Consensus Coverage", report.coverageBias.consensus)}
${table("Sharp Coverage", report.coverageBias.sharp)}
${table("FI Price Coverage", report.coverageBias.fiPrice)}
${table("Edge Coverage", report.coverageBias.edge)}

## Biggest Leaks

${report.leakFinder.map((item) => `- ${item.market} / ${item.type} / ${item.key}: ${mdSummary(item.summary)}`).join("\n")}

## Biggest Opportunities

${report.opportunityFinder.map((item) => `- ${item.market} / ${item.key}: ${mdSummary(item.summary)}`).join("\n")}

## Counterfactual Rule Simulator v2

### Strongest Rules

| Rule | Family | Affected | Delta Units | Delta ROI | Winners Removed | Losers Removed | Winners Promoted | Losers Promoted | Train | Validation | Holdout | Risk |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${strongest.map((r) => `| ${r.id} | ${r.family} | ${r.full.affectedRows} | ${r.full.deltaUnits.toFixed(2)} | ${r.full.deltaRoi === null ? "n/a" : `${(r.full.deltaRoi * 100).toFixed(1)}%`} | ${r.full.winnersRemoved} | ${r.full.losersRemoved} | ${r.full.winnersPromoted} | ${r.full.losersPromoted} | ${r.train.deltaUnits.toFixed(2)} | ${r.validation.deltaUnits.toFixed(2)} | ${r.holdout.deltaUnits.toFixed(2)} | ${r.overfittingRisk}/${r.sampleWarning} |`).join("\n")}

### Weakest Rules

${weakest.map((r) => `- ${r.id}: delta ${r.full.deltaUnits.toFixed(2)}u, affected ${r.full.affectedRows}, risk ${r.overfittingRisk}`).join("\n")}

## Recommendations

Candidate rules for shadow only:
${report.recommendations.candidateRules.length ? report.recommendations.candidateRules.map((r) => `- ${r.id}: ${r.description}; full delta ${r.full.deltaUnits.toFixed(2)}u; train/val/holdout ${r.train.deltaUnits.toFixed(2)} / ${r.validation.deltaUnits.toFixed(2)} / ${r.holdout.deltaUnits.toFixed(2)}; ${r.overfittingRisk}`).join("\n") : "- None credible enough yet."}

Rejected / risky rules:
${report.recommendations.rejectedRules.map((r) => `- ${r.id}: ${r.description}; full delta ${r.full.deltaUnits.toFixed(2)}u`).join("\n")}

Data-first warnings:
${report.recommendations.dataFirst.map((x) => `- ${x}`).join("\n") || "- None."}

No-change recommendations:
${report.recommendations.noChange.map((x) => `- ${x}`).join("\n")}

Next actions:
${report.recommendations.nextActions.map((x) => `- ${x}`).join("\n")}
`;
}

async function main() {
  const args = parseArgs();
  const rows = await loadRows(args);
  const report = buildReport(rows, args);
  await mkdir(args.outDir, { recursive: true });
  const jsonPath = `${args.outDir}/mlb-learning-lab-v2.json`;
  const mdPath = `${args.outDir}/mlb-learning-lab-v2.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, toMarkdown(report), "utf8");
  if (args.json) {
    console.log(JSON.stringify({
      generatedAt: report.generatedAt,
      output: { jsonPath, mdPath },
      dataset: report.dataset,
      baseline: report.baseline.byMarket,
      baselineByMarketGrade: report.baseline.byMarketGrade,
      biggestLeaks: report.leakFinder.slice(0, 10),
      biggestOpportunities: report.opportunityFinder.slice(0, 10),
      strongestRules: report.counterfactuals.strongestRules.slice(0, 10),
      recommendations: report.recommendations,
    }, null, 2));
    return;
  }
  console.log(`Learning Lab v2 written:\n- ${jsonPath}\n- ${mdPath}`);
  console.log(`Rows=${report.dataset.rows}, settled=${report.dataset.settledRows}, strict=${report.dataset.strictSampleSize}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
