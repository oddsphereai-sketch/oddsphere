import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sport } from "@/lib/types/domain/Sport";

type Market = "moneyline" | "total" | "first_inning";
type Grade = "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";

type Args = {
  sport: Sport;
  from: string | null;
  to: string | null;
  limit: number;
  outDir: string;
  json: boolean;
};

type RawPredictionRecord = {
  id: number;
  sport: string;
  slate_date: string;
  game_id: number | null;
  external_id: number | null;
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
  locked_at: string | null;
  published_at: string | null;
  created_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
};

type Row = {
  id: number;
  date: string;
  market: Market;
  matchup: string;
  pick: string | null;
  side: string | null;
  line: number | null;
  price: number | null;
  modelProbabilityPct: number | null;
  marketProbabilityPct: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  originalGrade: Grade;
  result: Result;
  units: number;
  outcome: number | null;
  marketRead: string;
  lineMovement: string;
  clv: number | null;
  hasConsensus: boolean;
  hasSharp: boolean;
  sourceConflict: boolean;
  missingHistoricalSource: boolean;
  dataWarning: boolean;
  criticalDataWarning: boolean;
  directionBucket: string;
  priceBand: string;
};

type BucketSummary = {
  count: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  unknown: number;
  units: number;
  roi: number | null;
  winRate: number | null;
  avgModelProbabilityPct: number | null;
  avgEdgePct: number | null;
  avgPrice: number | null;
  brier: number | null;
  logLoss: number | null;
};

const MARKETS: Market[] = ["moneyline", "total", "first_inning"];
const GRADES: Grade[] = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    from: null,
    to: null,
    limit: 20000,
    outDir: "ops-local/ai-sharp-analyst",
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") out.sport = value.toLowerCase() as Sport;
    if (key === "from") out.from = value;
    if (key === "to") out.to = value;
    if (key === "limit") out.limit = Number(value);
    if (key === "out-dir") out.outDir = value;
  }
  return out;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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
  if (noBet === true || /no bet|no play|pass/.test(text)) return "No Play";
  return "No Play";
}

function normalizeResult(raw: string | null | undefined): Result {
  const text = String(raw ?? "unknown").toLowerCase();
  if (text === "win" || text === "loss" || text === "push" || text === "void" || text === "pending") return text;
  return "unknown";
}

function pct(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return +(value <= 1 ? value * 100 : value).toFixed(4);
}

function americanUnits(odds: number | null, result: Result): number {
  if (result === "loss") return -1;
  if (result !== "win") return 0;
  if (odds === null || odds === 0) return 0;
  return odds > 0 ? +(odds / 100).toFixed(4) : +(100 / Math.abs(odds)).toFixed(4);
}

function impliedPct(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  const p = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  return +(p * 100).toFixed(4);
}

function getPath(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    let current = obj as Record<string, unknown> | null;
    let ok = true;
    for (const part of p.split(".")) {
      if (current === null || typeof current !== "object" || !(part in current)) {
        ok = false;
        break;
      }
      current = current[part] as Record<string, unknown> | null;
    }
    if (ok && current !== null && current !== undefined) return current;
  }
  return null;
}

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
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
    Boolean(getPath(snapshot, ["recommendationDecision.consensusSplits", "consensusSplits", "public_splits"]));
  const hasSharp = rows.some((row) =>
    row.has_steam_move === true ||
    row.has_reverse_line_movement === true ||
    typeof row.signal_strength === "string" ||
    typeof row.rlm_direction === "string"
  ) || Boolean(getPath(snapshot, ["recommendationDecision.sharpBookSplits", "sharpBookSplits", "sharp_signal"]));
  const conflict = boolish(getPath(snapshot, [
    "recommendationDecision.sourceConflict",
    "sourceConflict",
    "public_splits.conflict",
    "v2_1_audit.market_read_summary.market_disagreement_ml",
    "v2_1_audit.market_read_summary.market_disagreement_ou",
  ]));
  return {
    hasConsensus,
    hasSharp,
    sourceConflict: conflict,
    missingHistoricalSource: !hasConsensus && !hasSharp,
  };
}

function marketRead(snapshot: Record<string, unknown> | null, market: Market): string {
  const direct = getPath(snapshot, [
    "recommendationDecision.resolvedMarketRead.status",
    "resolvedMarketRead.status",
    "marketRead.status",
    "market_read.status",
  ]);
  if (typeof direct === "string" && direct.trim()) return direct;
  const rows = snapshotRows(snapshot, market);
  if (market === "first_inning" && rows.length === 0) return "historical_market_read_not_persisted";
  const pickedSide = typeof getPath(snapshot, ["side", "pick_side"]) === "string"
    ? String(getPath(snapshot, ["side", "pick_side"]))
    : null;
  const picked = pickedSide ? rows.find((row) => row.side === pickedSide) : null;
  const money = typeof picked?.public_money_pct === "number" ? picked.public_money_pct : null;
  const bets = typeof picked?.public_betting_pct === "number" ? picked.public_betting_pct : null;
  if (money !== null || bets !== null) {
    const value = money ?? bets ?? 0;
    if (money !== null && bets !== null && ((money >= 50 && bets < 50) || (money < 50 && bets >= 50))) return "mixed";
    return value >= 50 ? "consensus_support" : "consensus_resistance";
  }
  return rows.length > 0 ? "no_clear_signal" : "historical_market_read_not_persisted";
}

function lineMovement(snapshot: Record<string, unknown> | null): string {
  const direction = getPath(snapshot, [
    "line_movement.direction",
    "marketReadV2.movement.directionRelativeToPick",
    "recommendationDecision.resolvedMarketRead.movement.directionRelativeToPick",
  ]);
  if (typeof direction === "string" && direction.trim()) return direction;
  const movement = getPath(snapshot, ["line_movement"]);
  if (movement && typeof movement === "object") return "present_unclassified";
  return "unknown";
}

function clv(snapshot: Record<string, unknown> | null, price: number | null): number | null {
  const close = getPath(snapshot, [
    "line_movement.close_odds_american",
    "line_movement.closing_odds_american",
    "closing_odds_american",
  ]);
  if (typeof close !== "number" || price === null) return null;
  return +(close - price).toFixed(2);
}

function dataWarnings(snapshot: Record<string, unknown> | null) {
  const text = JSON.stringify(snapshot ?? {}).toLowerCase();
  const any = /warning|missing|fallback|stale|lineup|starter|injury|provisional|mismatch/.test(text);
  const critical = /starter|lineup|injury|stale|mismatch|critical/.test(text);
  return { any, critical };
}

function directionBucket(market: Market, pick: string | null, side: string | null, price: number | null): string {
  if (market === "moneyline") return price !== null && price < 0 ? "favorite" : "dog";
  if (market === "total") return /under/i.test(pick ?? side ?? "") ? "under" : /over/i.test(pick ?? side ?? "") ? "over" : "unknown";
  return /nrfi/i.test(pick ?? side ?? "") ? "nrfi" : /yrfi/i.test(pick ?? side ?? "") ? "yrfi" : "unknown";
}

function priceBand(price: number | null): string {
  if (price === null) return "missing_price";
  if (price > 150) return "dog_150_plus";
  if (price > 100) return "dog_101_150";
  if (price >= -110) return "near_even";
  if (price >= -130) return "juice_111_130";
  if (price >= -150) return "juice_131_150";
  if (price >= -175) return "juice_151_175";
  if (price >= -200) return "juice_176_200";
  return "heavy_juice_200_plus";
}

function binned(value: number | null, cuts: number[], labels: string[]): string {
  if (value === null || !Number.isFinite(value)) return "missing";
  for (let i = 0; i < cuts.length; i += 1) if (value < cuts[i]) return labels[i];
  return labels[labels.length - 1];
}

function probabilityBin(value: number | null): string {
  return binned(value, [45, 50, 52.5, 55, 57.5, 60, 65, 70], ["<45", "45-50", "50-52.5", "52.5-55", "55-57.5", "57.5-60", "60-65", "65-70", "70+"]);
}

function edgeBin(value: number | null): string {
  return binned(value, [-2, 0, 2, 4, 6, 8, 10, 12], ["<-2", "-2-0", "0-2", "2-4", "4-6", "6-8", "8-10", "10-12", "12+"]);
}

function confidenceBin(value: number | null): string {
  return binned(value, [45, 50, 52.5, 55, 57.5, 60, 65], ["<45", "45-50", "50-52.5", "52.5-55", "55-57.5", "57.5-60", "60-65", "65+"]);
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return null;
  return +(nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(4);
}

function summarize(rows: Row[]): BucketSummary {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  const settled = wins + losses;
  const units = +rows.reduce((sum, row) => sum + row.units, 0).toFixed(4);
  const calibrationRows = rows.filter((row) => row.outcome !== null && row.modelProbabilityPct !== null);
  const brier = calibrationRows.length
    ? +(calibrationRows.reduce((sum, row) => {
        const p = Number(row.modelProbabilityPct) / 100;
        return sum + (p - Number(row.outcome)) ** 2;
      }, 0) / calibrationRows.length).toFixed(6)
    : null;
  const logLoss = calibrationRows.length
    ? +(calibrationRows.reduce((sum, row) => {
        const p = Math.max(0.001, Math.min(0.999, Number(row.modelProbabilityPct) / 100));
        const y = Number(row.outcome);
        return sum - (y * Math.log(p) + (1 - y) * Math.log(1 - p));
      }, 0) / calibrationRows.length).toFixed(6)
    : null;
  return {
    count: rows.length,
    settled,
    wins,
    losses,
    pushes: rows.filter((row) => row.result === "push").length,
    voids: rows.filter((row) => row.result === "void").length,
    pending: rows.filter((row) => row.result === "pending").length,
    unknown: rows.filter((row) => row.result === "unknown").length,
    units,
    roi: settled > 0 ? +(units / settled).toFixed(4) : null,
    winRate: settled > 0 ? +(wins / settled).toFixed(4) : null,
    avgModelProbabilityPct: avg(rows.map((row) => row.modelProbabilityPct)),
    avgEdgePct: avg(rows.map((row) => row.edgePct)),
    avgPrice: avg(rows.map((row) => row.price)),
    brier,
    logLoss,
  };
}

function groupSummary(rows: Row[], keyFn: (row: Row) => string): Record<string, BucketSummary> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, summarize(value)]));
}

function example(row: Row) {
  return {
    date: row.date,
    matchup: row.matchup,
    market: row.market,
    pick: row.pick,
    grade: row.originalGrade,
    result: row.result,
    units: row.units,
    price: row.price,
    modelProbabilityPct: row.modelProbabilityPct,
    marketProbabilityPct: row.marketProbabilityPct,
    edgePct: row.edgePct,
    marketRead: row.marketRead,
    lineMovement: row.lineMovement,
    hasConsensus: row.hasConsensus,
    hasSharp: row.hasSharp,
    sourceConflict: row.sourceConflict,
    dataWarning: row.dataWarning,
  };
}

function examples(rows: Row[]) {
  const byMarket: Record<Market, Record<string, unknown[]>> = {
    moneyline: {},
    total: {},
    first_inning: {},
  };
  for (const market of MARKETS) {
    const m = rows.filter((row) => row.market === market);
    byMarket[market] = {
      badBestAngles: m.filter((row) => row.originalGrade === "Best Angle" && row.result === "loss").slice(0, 8).map(example),
      strongLeans: m.filter((row) => row.originalGrade === "Lean" && row.result === "win").sort((a, b) => b.units - a.units).slice(0, 8).map(example),
      underGradedWinners: m.filter((row) => ["Watchlist", "Caution", "No Play"].includes(row.originalGrade) && row.result === "win").sort((a, b) => (b.edgePct ?? -99) - (a.edgePct ?? -99)).slice(0, 8).map(example),
      badPromotionRisks: m.filter((row) => ["Watchlist", "Caution"].includes(row.originalGrade) && row.result === "loss").sort((a, b) => (b.edgePct ?? -99) - (a.edgePct ?? -99)).slice(0, 8).map(example),
      goodPromotionCandidates: m.filter((row) => ["Watchlist", "Caution"].includes(row.originalGrade) && row.result === "win" && (row.edgePct ?? 0) >= 4 && row.price !== null).slice(0, 8).map(example),
      marketResistanceMattered: m.filter((row) => /resistance|mixed/.test(row.marketRead) && row.result === "loss").slice(0, 8).map(example),
      marketResistanceWasNoise: m.filter((row) => /resistance|mixed/.test(row.marketRead) && row.result === "win").slice(0, 8).map(example),
      missingSourceDidNotMatter: m.filter((row) => row.missingHistoricalSource && row.result === "win").slice(0, 8).map(example),
      missingSourceWasMaterial: m.filter((row) => row.missingHistoricalSource && row.result === "loss").slice(0, 8).map(example),
    };
  }
  return byMarket;
}

async function loadRows(args: Args): Promise<Row[]> {
  const { supabase } = await import("@/lib/db/supabase");
  const rawRows: RawPredictionRecord[] = [];
  const pageSize = 750;
  for (let from = 0; from < args.limit; from += pageSize) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,game_id,external_id,matchup,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,edge,play_grade,best_angle,no_bet,locked_at,published_at,created_at,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .in("market", MARKETS)
      .order("slate_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.from) query = query.gte("slate_date", args.from);
    if (args.to) query = query.lte("slate_date", args.to);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records load failed: ${error.message}`);
    rawRows.push(...((data ?? []) as RawPredictionRecord[]));
    if ((data ?? []).length < pageSize) break;
  }
  return rawRows.flatMap((raw) => {
    const market = normalizeMarket(raw.market);
    if (!market) return [];
    const result = normalizeResult(one(raw.prediction_grades)?.result);
    const sources = sourceState(raw.snapshot_json, market);
    const warnings = dataWarnings(raw.snapshot_json);
    const modelProbabilityPct = pct(raw.model_probability);
    const marketProbabilityPct = pct(raw.market_probability) ?? impliedPct(raw.odds_american);
    return [{
      id: raw.id,
      date: raw.slate_date,
      market,
      matchup: raw.matchup ?? "",
      pick: raw.pick,
      side: raw.side,
      line: raw.line_value,
      price: raw.odds_american,
      modelProbabilityPct,
      marketProbabilityPct,
      edgePct: raw.edge,
      confidencePct: pct(raw.confidence),
      originalGrade: normalizeGrade(raw.play_grade, raw.best_angle, raw.no_bet),
      result,
      units: americanUnits(raw.odds_american, result),
      outcome: result === "win" ? 1 : result === "loss" ? 0 : null,
      marketRead: marketRead(raw.snapshot_json, market),
      lineMovement: lineMovement(raw.snapshot_json),
      clv: clv(raw.snapshot_json, raw.odds_american),
      hasConsensus: sources.hasConsensus,
      hasSharp: sources.hasSharp,
      sourceConflict: sources.sourceConflict,
      missingHistoricalSource: sources.missingHistoricalSource,
      dataWarning: warnings.any,
      criticalDataWarning: warnings.critical,
      directionBucket: directionBucket(market, raw.pick, raw.side, raw.odds_american),
      priceBand: priceBand(raw.odds_american),
    }];
  });
}

function modelMemoryPack(rows: Row[]) {
  const byMarket: Record<string, unknown> = {};
  for (const market of MARKETS) {
    const marketRows = rows.filter((row) => row.market === market);
    byMarket[market] = {
      sample: summarize(marketRows),
      modelCalibration: {
        probabilityBins: groupSummary(marketRows, (row) => probabilityBin(row.modelProbabilityPct)),
        edgeBins: groupSummary(marketRows, (row) => edgeBin(row.edgePct)),
        confidenceBins: groupSummary(marketRows, (row) => confidenceBin(row.confidencePct)),
        overconfidenceZones: Object.entries(groupSummary(marketRows, (row) => probabilityBin(row.modelProbabilityPct)))
          .filter(([, s]) => s.avgModelProbabilityPct !== null && s.winRate !== null && (s.avgModelProbabilityPct / 100) - s.winRate > 0.05)
          .map(([bucket, s]) => ({ bucket, avgModelProbabilityPct: s.avgModelProbabilityPct, actualWinRate: s.winRate })),
        underconfidenceZones: Object.entries(groupSummary(marketRows, (row) => probabilityBin(row.modelProbabilityPct)))
          .filter(([, s]) => s.avgModelProbabilityPct !== null && s.winRate !== null && s.winRate - (s.avgModelProbabilityPct / 100) > 0.05)
          .map(([bucket, s]) => ({ bucket, avgModelProbabilityPct: s.avgModelProbabilityPct, actualWinRate: s.winRate })),
      },
      profitability: {
        byGrade: groupSummary(marketRows, (row) => row.originalGrade),
        byEdgeBin: groupSummary(marketRows, (row) => edgeBin(row.edgePct)),
        byProbabilityBin: groupSummary(marketRows, (row) => probabilityBin(row.modelProbabilityPct)),
        byPriceBand: groupSummary(marketRows, (row) => row.priceBand),
        byDirection: groupSummary(marketRows, (row) => row.directionBucket),
      },
      marketContext: {
        byMarketRead: groupSummary(marketRows, (row) => row.marketRead),
        byLineMovement: groupSummary(marketRows, (row) => row.lineMovement),
        byClv: groupSummary(marketRows, (row) => row.clv === null ? "clv_unavailable" : row.clv > 10 ? "beat_close_10_plus" : row.clv > 0 ? "beat_close_0_10" : row.clv < -10 ? "lost_close_10_plus" : "lost_close_0_10"),
        byConsensusAvailability: groupSummary(marketRows, (row) => row.hasConsensus ? "consensus_present" : "consensus_missing_or_not_persisted"),
        bySharpAvailability: groupSummary(marketRows, (row) => row.hasSharp ? "sharp_present" : "sharp_missing_or_not_persisted"),
        bySourceConflict: groupSummary(marketRows, (row) => row.sourceConflict ? "source_conflict" : "no_source_conflict"),
        byMissingHistoricalSource: groupSummary(marketRows, (row) => row.missingHistoricalSource ? "historical_source_not_persisted" : "source_context_present_or_partial"),
        byDataWarnings: groupSummary(marketRows, (row) => row.criticalDataWarning ? "critical_warning" : row.dataWarning ? "warning" : "no_warning"),
      },
      gradeQuality: {
        originalBestAngle: summarize(marketRows.filter((row) => row.originalGrade === "Best Angle")),
        originalLean: summarize(marketRows.filter((row) => row.originalGrade === "Lean")),
        originalWatchlist: summarize(marketRows.filter((row) => row.originalGrade === "Watchlist")),
        originalCaution: summarize(marketRows.filter((row) => row.originalGrade === "Caution")),
        originalNoPlay: summarize(marketRows.filter((row) => row.originalGrade === "No Play")),
        badBestAnglePatterns: groupSummary(marketRows.filter((row) => row.originalGrade === "Best Angle" && row.result === "loss"), (row) => `${row.priceBand}|${row.marketRead}|${row.dataWarning ? "warning" : "clean"}`),
        profitableLeanPatterns: groupSummary(marketRows.filter((row) => row.originalGrade === "Lean" && row.result === "win"), (row) => `${row.priceBand}|${row.marketRead}|${edgeBin(row.edgePct)}`),
        underGradedWinnerPatterns: groupSummary(marketRows.filter((row) => ["Watchlist", "Caution", "No Play"].includes(row.originalGrade) && row.result === "win"), (row) => `${row.originalGrade}|${row.priceBand}|${edgeBin(row.edgePct)}|${row.marketRead}`),
        overGradedLoserPatterns: groupSummary(marketRows.filter((row) => ["Lean", "Best Angle"].includes(row.originalGrade) && row.result === "loss"), (row) => `${row.originalGrade}|${row.priceBand}|${edgeBin(row.edgePct)}|${row.marketRead}`),
      },
    };
  }
  return byMarket;
}

function sharpAnalystPrinciples() {
  return [
    "A good prediction is not automatically a good bet.",
    "Price and juice matter; a high probability at bad juice may be a pass.",
    "Judge edge against no-vig market implied probability where possible.",
    "Calibration matters more than raw accuracy.",
    "CLV is useful only when computed from reliable close/no-vig close data.",
    "Mixed market does not automatically mean Caution.",
    "Market resistance does not automatically mean No Play.",
    "Missing FI market/split signal is low materiality by default and does not downgrade FI by itself.",
    "Missing historical source fields are replay limitations, not live data failures.",
    "Public consensus is context, not truth.",
    "Sharp-book signal is meaningful only if fresh, mapped correctly, and material.",
    "Promote only when edge, price, data quality, and market context justify it.",
    "Downgrade only when risk materially hurts EV or confidence.",
    "Preserve profitable historical cohorts unless a high-materiality issue exists.",
  ];
}

function marketPlaybooks(memory: Record<string, unknown>) {
  const m = memory as Record<Market, {
    profitability?: { byGrade?: Record<string, BucketSummary>; byDirection?: Record<string, BucketSummary>; byPriceBand?: Record<string, BucketSummary> };
    marketContext?: { byMarketRead?: Record<string, BucketSummary>; byDataWarnings?: Record<string, BucketSummary> };
  }>;
  return {
    moneyline: {
      focus: ["price/juice discipline", "favorite/dog behavior", "heavy favorite risk", "model calibration", "edge vs implied", "market resistance", "sharp-source materiality", "Watchlist promotion", "Best Angle caps"],
      cohortNotes: {
        gradePerformance: m.moneyline?.profitability?.byGrade ?? {},
        favoriteDog: m.moneyline?.profitability?.byDirection ?? {},
        priceBands: m.moneyline?.profitability?.byPriceBand ?? {},
      },
      analystRules: [
        "Require real edge after price; do not promote a favorite simply because win probability is high.",
        "Treat heavy juice as an EV tax; cap Best Angle unless model edge and market support are both strong.",
        "Dog Watchlists can promote when edge is meaningful, price is playable, and data is clean.",
        "Market resistance matters most when edge is thin or price is expensive; resistance can be noise when historical cohort says similar setups win.",
      ],
    },
    total: {
      focus: ["projection vs line", "edge size", "Over/Under direction", "line movement", "market resistance vs noise", "Watchlist promotion", "Best Angle caps"],
      cohortNotes: {
        gradePerformance: m.total?.profitability?.byGrade ?? {},
        overUnder: m.total?.profitability?.byDirection ?? {},
        marketReads: m.total?.marketContext?.byMarketRead ?? {},
      },
      analystRules: [
        "A total needs a playable number and edge against that number, not just an Over/Under label.",
        "Do not downgrade Totals Lean just because market is mixed; ask whether the conflict is material to EV.",
        "Thin edge plus worse price or sharp resistance should cap promotion.",
        "Watchlist can promote when edge is large, price is reasonable, and there is no critical data warning.",
      ],
    },
    first_inning: {
      focus: ["protect FI Lean cohort", "NRFI/YRFI split", "starter/top-order data", "missing FI splits low materiality", "edge/price/starter freshness", "Watchlist promotion"],
      cohortNotes: {
        gradePerformance: m.first_inning?.profitability?.byGrade ?? {},
        nrfiYrfi: m.first_inning?.profitability?.byDirection ?? {},
        dataWarnings: m.first_inning?.marketContext?.byDataWarnings ?? {},
      },
      analystRules: [
        "Do not downgrade FI solely because FI consensus/sharp split source is missing.",
        "Protect profitable FI Lean cohorts unless starter, lineup, stale-data, price, or edge issues are high materiality.",
        "FI Watchlist can promote when price is present, edge is real, starter/top-order context is fresh, and no critical data warning exists.",
        "YRFI/NRFI price quality matters; do not chase heavy juice without calibrated edge.",
      ],
    },
  };
}

function candidateLogic() {
  return {
    promotions: [
      "Watchlist -> Lean when model edge clears market-specific historical threshold, price is playable, data is clean, and market resistance is non-material or historically noisy.",
      "Caution -> Watchlist/Lean only when caution source is low-materiality and historical cohort performance supports actionability.",
      "No Play -> Watchlist only for clear under-graded winners pattern; never jump straight to live Best Angle.",
      "FI Watchlist -> Lean when price + edge + starter freshness support actionability; missing FI split source alone should not block.",
    ],
    downgrades: [
      "Best Angle -> Lean/Watchlist when heavy juice, thin edge, critical data warning, or material market resistance historically damages ROI.",
      "Lean -> Watchlist/Caution only when risk materially hurts EV/confidence, not because the card is imperfect.",
      "Historical source-not-persisted is a non-escalating replay limitation.",
      "Market resistance is a downgrade reason only when material relative to edge, price, and historical cohort.",
    ],
  };
}

function promptContext(memory: Record<string, unknown>, playbooks: ReturnType<typeof marketPlaybooks>) {
  const pickMarketContext = (market: Market) => ({
    playbook: playbooks[market],
    memorySummary: (memory as Record<string, unknown>)[market],
  });
  return {
    systemRole: "OddSphere Sharp Market Analyst",
    job: "Evaluate Daily Edge cards as a disciplined betting analyst, not a blanket safety reviewer.",
    principles: sharpAnalystPrinciples(),
    outputSections: [
      "data_integrity_review",
      "market_read_review",
      "betting_value_review",
      "play_grade_review",
      "promotion_review",
      "downgrade_review",
      "issue_materiality",
      "card_coherence_review",
    ],
    requiredQuestions: [
      "Is this actually +EV/actionable?",
      "Is the market read meaningful or noise?",
      "Is this a promotion candidate?",
      "Is this over-graded?",
      "Is this a model pick but not a bet?",
      "What would a disciplined betting analyst do?",
    ],
    contextByMarket: {
      moneyline: pickMarketContext("moneyline"),
      total: pickMarketContext("total"),
      first_inning: pickMarketContext("first_inning"),
    },
    guardrails: {
      noLiveChanges: true,
      noMemberFacingChanges: true,
      noPickFlips: true,
      noProbabilityChanges: true,
      noProjectedScoreChanges: true,
      noProviderNames: true,
      noBlanketDowngrades: true,
      noBlindPromotions: true,
    },
  };
}

function supportAssessment(memory: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const market of MARKETS) {
    const item = (memory as Record<string, {
      profitability?: { byGrade?: Record<string, BucketSummary> };
      marketContext?: { byMarketRead?: Record<string, BucketSummary>; byMissingHistoricalSource?: Record<string, BucketSummary> };
      sample?: BucketSummary;
    }>)[market];
    const byGrade = item?.profitability?.byGrade ?? {};
    out[market] = {
      sample: item?.sample ?? null,
      supportsProtectingLean: (byGrade.Lean?.roi ?? -999) > 0,
      bestAngleNeedsScrutiny: (byGrade["Best Angle"]?.roi ?? 0) < (byGrade.Lean?.roi ?? 0),
      watchlistPromotionPossible: (byGrade.Watchlist?.roi ?? -999) > 0,
      cautionPromotionPossible: (byGrade.Caution?.roi ?? -999) > 0,
      missingSourceOftenReplayLimitation: item?.marketContext?.byMissingHistoricalSource ?? {},
      marketReadPerformance: item?.marketContext?.byMarketRead ?? {},
      sampleWarning: (item?.sample?.settled ?? 0) < 100 ? "small_sample_high_overfit_risk" : "use_as_directional_memory_not_hard_rule",
    };
  }
  return out;
}

function markdownReport(pack: {
  generatedAt: string;
  args: Args;
  rowsLoaded: number;
  settledRows: number;
  memory: Record<string, unknown>;
  playbooks: ReturnType<typeof marketPlaybooks>;
  support: Record<string, unknown>;
}) {
  const lines: string[] = [];
  lines.push("# OddSphere Sharp Analyst Research Pack");
  lines.push("");
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push(`Sport: ${pack.args.sport.toUpperCase()}`);
  lines.push(`Rows loaded: ${pack.rowsLoaded}`);
  lines.push(`Settled rows: ${pack.settledRows}`);
  lines.push("");
  lines.push("## Sharp Analyst Principles");
  for (const principle of sharpAnalystPrinciples()) lines.push(`- ${principle}`);
  lines.push("");
  lines.push("## Market Snapshots");
  for (const market of MARKETS) {
    const memory = pack.memory[market] as {
      sample?: BucketSummary;
      profitability?: { byGrade?: Record<string, BucketSummary>; byDirection?: Record<string, BucketSummary> };
    };
    lines.push(`### ${market}`);
    lines.push(`Sample: ${JSON.stringify(memory.sample)}`);
    lines.push(`Grade performance: ${JSON.stringify(memory.profitability?.byGrade ?? {})}`);
    lines.push(`Direction performance: ${JSON.stringify(memory.profitability?.byDirection ?? {})}`);
    lines.push(`Support assessment: ${JSON.stringify(pack.support[market])}`);
    lines.push("");
  }
  lines.push("## Candidate Logic");
  lines.push(JSON.stringify(candidateLogic(), null, 2));
  lines.push("");
  lines.push("## Playbooks");
  lines.push(JSON.stringify(pack.playbooks, null, 2));
  lines.push("");
  lines.push("No OpenAI calls were made. This pack is offline research context only.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadRows(args);
  const settled = rows.filter((row) => row.result === "win" || row.result === "loss");
  const memory = modelMemoryPack(rows);
  const playbooks = marketPlaybooks(memory);
  const support = supportAssessment(memory);
  const pack = {
    generatedAt: new Date().toISOString(),
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    args,
    rowsLoaded: rows.length,
    settledRows: settled.length,
    coverage: {
      markets: Object.fromEntries(MARKETS.map((market) => [market, {
        rows: rows.filter((row) => row.market === market).length,
        settled: settled.filter((row) => row.market === market).length,
        price: rows.filter((row) => row.market === market && row.price !== null).length,
        modelProbability: rows.filter((row) => row.market === market && row.modelProbabilityPct !== null).length,
        edge: rows.filter((row) => row.market === market && row.edgePct !== null).length,
        consensus: rows.filter((row) => row.market === market && row.hasConsensus).length,
        sharp: rows.filter((row) => row.market === market && row.hasSharp).length,
        marketReadUsableOrLabeled: rows.filter((row) => row.market === market && row.marketRead !== "").length,
      }])),
    },
    modelMemoryPack: memory,
    sharpAnalystPrinciples: sharpAnalystPrinciples(),
    marketSpecificPlaybooks: playbooks,
    candidatePromotionDowngradeLogic: candidateLogic(),
    historicalSupportAssessment: support,
    examples: examples(rows),
    aiPromptContextPreview: promptContext(memory, playbooks),
    nextStepRecommendation: "Run no paid AI until this pack is reviewed. If approved, test gpt-5.4-mini offline on a representative sample selected from the examples and cohort failures.",
  };
  await mkdir(args.outDir, { recursive: true });
  const base = path.join(args.outDir, `${args.sport}-sharp-analyst-research-pack`);
  await writeFile(`${base}.json`, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  await writeFile(`${base}.md`, markdownReport({
    generatedAt: pack.generatedAt,
    args,
    rowsLoaded: pack.rowsLoaded,
    settledRows: pack.settledRows,
    memory,
    playbooks,
    support,
  }), "utf8");
  if (args.json) {
    console.log(JSON.stringify(pack, null, 2));
    return;
  }
  console.log("OddSphere Sharp Analyst Research Pack");
  console.log("No OpenAI calls. No live changes. No member-facing changes.");
  console.log(`Rows loaded: ${pack.rowsLoaded}; settled rows: ${pack.settledRows}`);
  console.log(`Wrote ${base}.json`);
  console.log(`Wrote ${base}.md`);
  console.log("Coverage:");
  console.log(JSON.stringify(pack.coverage, null, 2));
  console.log("Historical support assessment:");
  console.log(JSON.stringify(pack.historicalSupportAssessment, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
