/**
 * Daily Edge same-day answer search.
 *
 * Read-only: no DB writes, no paid AI, no production changes.
 * Looks for deterministic same-day promotion/cap candidates and validates
 * their historical feature cohorts.
 */
import { buildDailyEdgeResponseForCostPreview } from "@/lib/services/aiAuditor/costPreview";
import { supabase } from "@/lib/db/supabase";

type Market = "moneyline" | "total" | "first_inning";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";
type Split = "train" | "validation" | "holdout";

type RawPrediction = {
  id: number;
  sport: string;
  slate_date: string;
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
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
};

type Row = {
  id: number;
  date: string;
  split: Split;
  market: Market;
  game: string;
  pick: string | null;
  grade: Grade;
  price: number | null;
  line: number | null;
  modelProbability: number | null;
  marketImplied: number | null;
  edge: number | null;
  projectedTotal: number | null;
  projectionGap: number | null;
  absProjectionGap: number | null;
  movement: "toward" | "against" | "neutral" | "unknown";
  result: Result;
  units: number | null;
};

type CurrentRow = Omit<Row, "id" | "date" | "split" | "result" | "units"> & {
  verdict: string | null;
  capReasons: string[];
};

type CandidateRule = {
  id: string;
  intent: "promotion" | "cap";
  target: Grade;
  description: string;
  applies: (row: Row | CurrentRow) => boolean;
};

const ACTIONABLE = new Set<Grade>(["Best Angle", "Lean"]);

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseArgs() {
  const today = todayEt();
  const out = { sport: "mlb", from: "2026-06-07", to: today, date: today, json: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") out.json = true;
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "sport") out.sport = value.toLowerCase();
    if (key === "from") out.from = value;
    if (key === "to") out.to = value === "today" ? today : value;
    if (key === "date") out.date = value === "today" ? today : value;
  }
  return out;
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
  for (const path of paths) {
    const value = pathValue(obj, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function str(obj: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = pathValue(obj, path);
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
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

function normalizeMarket(value: string | null): Market | null {
  const text = String(value ?? "").toLowerCase();
  if (text === "moneyline" || text === "ml") return "moneyline";
  if (text === "total" || text === "ou" || text === "over_under") return "total";
  if (text === "first_inning" || text === "first_inning_total" || text === "fi") return "first_inning";
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

function gradeFromVerdict(label: string | null | undefined): Grade {
  if (label === "Best Angle" || label === "Lean" || label === "Watchlist" || label === "Caution" || label === "No Play") return label;
  return "No Play";
}

function normalizeResult(raw: string | null | undefined): Result {
  const text = String(raw ?? "unknown").toLowerCase();
  if (text === "win" || text === "loss" || text === "push" || text === "void" || text === "pending") return text;
  return "unknown";
}

function movement(snapshot: Record<string, unknown> | null): Row["movement"] {
  const raw = str(snapshot, [
    "line_movement.direction",
    "marketReadV2.movement.directionRelativeToPick",
    "recommendationDecision.resolvedMarketRead.movement.directionRelativeToPick",
  ]);
  if (!raw) return "unknown";
  if (/toward|support/i.test(raw)) return "toward";
  if (/against|resist|oppose/i.test(raw)) return "against";
  if (/flat|none|neutral|no/i.test(raw)) return "neutral";
  return "unknown";
}

function projectionTotal(snapshot: Record<string, unknown> | null): number | null {
  const away = num(snapshot, ["total_projection_reconciliation.reconciled_away_score", "v2_2_audit.posterior_away_runs", "predicted_scores_at_lock.away", "review_v1.reviewed.away_score"]);
  const home = num(snapshot, ["total_projection_reconciliation.reconciled_home_score", "v2_2_audit.posterior_home_runs", "predicted_scores_at_lock.home", "review_v1.reviewed.home_score"]);
  return num(snapshot, ["total_projection_reconciliation.reconciled_total", "v2_2_audit.posterior_total", "review_v1.reviewed.total"]) ??
    (away !== null && home !== null ? +(away + home).toFixed(4) : null);
}

function directionFromPick(pick: string | null): "over" | "under" | "unknown" {
  const text = String(pick ?? "").toLowerCase();
  if (/under/.test(text)) return "under";
  if (/over/.test(text)) return "over";
  return "unknown";
}

function projectionGap(market: Market, projected: number | null, line: number | null, pick: string | null): number | null {
  if (market !== "total" || projected === null || line === null) return null;
  const direction = directionFromPick(pick);
  if (direction === "under") return +(line - projected).toFixed(4);
  if (direction === "over") return +(projected - line).toFixed(4);
  return null;
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

async function loadHistoricalRows(args: ReturnType<typeof parseArgs>): Promise<Row[]> {
  const rawRows: RawPrediction[] = [];
  for (let from = 0; from < 6000; from += 750) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,best_angle,no_bet,launch_day,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .gte("slate_date", args.from)
      .lte("slate_date", args.to)
      .order("slate_date", { ascending: true })
      .range(from, from + 749);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records load failed: ${error.message}`);
    rawRows.push(...((data ?? []) as RawPrediction[]));
    if ((data ?? []).length < 750) break;
  }
  return splitRows(rawRows.flatMap((raw): Row[] => {
    if (raw.launch_day === true) return [];
    const market = normalizeMarket(raw.market);
    if (!market) return [];
    const projectedTotal = projectionTotal(raw.snapshot_json);
    const pick = raw.pick ?? raw.side;
    const gap = projectionGap(market, projectedTotal, raw.line_value, pick);
    const result = normalizeResult(one(raw.prediction_grades)?.result);
    return [{
      id: raw.id,
      date: raw.slate_date,
      split: "train",
      market,
      game: raw.matchup ?? "",
      pick,
      grade: normalizeGrade(raw.play_grade, raw.best_angle, raw.no_bet),
      price: raw.odds_american,
      line: raw.line_value,
      modelProbability: pct(raw.model_probability),
      marketImplied: pct(raw.market_probability) ?? impliedPct(raw.odds_american),
      edge: pct(raw.edge),
      projectedTotal,
      projectionGap: gap,
      absProjectionGap: gap === null ? null : Math.abs(gap),
      movement: movement(raw.snapshot_json),
      result,
      units: units(raw.odds_american, result),
    }];
  }));
}

async function loadCurrentRows(args: ReturnType<typeof parseArgs>): Promise<CurrentRow[]> {
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport as "mlb", date: args.date });
  return response.games.flatMap((game): CurrentRow[] => {
    const label = `${game.awayTeam} @ ${game.homeTeam}`;
    const marketMap: Array<[Market, keyof typeof game.markets]> = [
      ["moneyline", "moneyline"],
      ["total", "total"],
      ["first_inning", "first_inning"],
    ];
    return marketMap.map(([market, key]) => {
      const m = game.markets[key];
      const projectedTotal = typeof m.modelTotal === "number" ? m.modelTotal : null;
      const line = typeof m.line === "number" ? m.line : null;
      const gap = projectionGap(market, projectedTotal, line, m.pick);
      const movementRaw = m.marketReadV2?.movement?.directionRelativeToPick ?? null;
      const move =
        movementRaw === "support" ? "toward" :
        movementRaw === "resistance" ? "against" :
        movementRaw === "neutral" ? "neutral" :
        "unknown";
      return {
        market,
        game: label,
        pick: m.pick,
        grade: gradeFromVerdict(m.verdict?.label),
        verdict: m.verdict?.label ?? null,
        capReasons: m.capReasons ?? [],
        price: m.priceAmerican,
        line,
        modelProbability: typeof m.modelTrustPct === "number" ? m.modelTrustPct : typeof m.modelProb === "number" ? +(m.modelProb * 100).toFixed(1) : null,
        marketImplied: m.marketImpliedPct,
        edge: m.modelMarketGapPct,
        projectedTotal,
        projectionGap: gap,
        absProjectionGap: gap === null ? null : Math.abs(gap),
        movement: move,
      };
    });
  });
}

const rules: CandidateRule[] = [
  {
    id: "ml_plus_money_edge_5_non_actionable_to_lean",
    intent: "promotion",
    target: "Lean",
    description: "ML non-actionable + plus-money + edge >= 5 -> Lean candidate.",
    applies: (row) => row.market === "moneyline" && !ACTIONABLE.has(row.grade) && (row.price ?? -1) > 0 && (row.edge ?? -999) >= 5,
  },
  {
    id: "ml_edge_8_playable_non_actionable_to_lean",
    intent: "promotion",
    target: "Lean",
    description: "ML non-actionable + edge >= 8 + price better than -160 -> Lean candidate.",
    applies: (row) => row.market === "moneyline" && !ACTIONABLE.has(row.grade) && (row.edge ?? -999) >= 8 && row.price !== null && row.price > -160,
  },
  {
    id: "total_gap_1_edge_5_non_actionable_to_lean",
    intent: "promotion",
    target: "Lean",
    description: "Total non-actionable + projection gap >= 1 + edge >= 5 + playable price -> Lean candidate.",
    applies: (row) => row.market === "total" && !ACTIONABLE.has(row.grade) && (row.absProjectionGap ?? -999) >= 1 && (row.edge ?? -999) >= 5 && row.price !== null && row.price > -130,
  },
  {
    id: "total_gap_0_75_edge_5_caution_watchlist_to_lean",
    intent: "promotion",
    target: "Lean",
    description: "Total Caution/Watchlist + projection gap >= .75 + edge >= 5 + playable price -> Lean candidate.",
    applies: (row) => row.market === "total" && (row.grade === "Caution" || row.grade === "Watchlist") && (row.absProjectionGap ?? -999) >= 0.75 && (row.edge ?? -999) >= 5 && row.price !== null && row.price > -130,
  },
  {
    id: "total_gap_0_75_edge_4_toward_watchlist_to_lean",
    intent: "promotion",
    target: "Lean",
    description: "Total Watchlist + projection gap >= .75 + edge >= 4 + playable price + movement toward pick -> Lean candidate.",
    applies: (row) => row.market === "total" && row.grade === "Watchlist" && (row.absProjectionGap ?? -999) >= 0.75 && (row.edge ?? -999) >= 4 && row.price !== null && row.price > -130 && row.movement === "toward",
  },
  {
    id: "fi_price_edge_5_watchlist_to_lean",
    intent: "promotion",
    target: "Lean",
    description: "FI Watchlist + trusted price + edge >= 5 -> Lean candidate.",
    applies: (row) => row.market === "first_inning" && row.grade === "Watchlist" && row.price !== null && (row.edge ?? -999) >= 5,
  },
  {
    id: "ml_heavy_favorite_edge_lt_5_actionable_cap",
    intent: "cap",
    target: "Watchlist",
    description: "ML actionable + price <= -160 + edge < 5 -> Watchlist candidate.",
    applies: (row) => row.market === "moneyline" && ACTIONABLE.has(row.grade) && row.price !== null && row.price <= -160 && (row.edge ?? 999) < 5,
  },
  {
    id: "total_lean_projection_opposed_cap_v1_2026_07_11",
    intent: "cap",
    target: "Watchlist",
    description: "Total Lean + signed same-side projection gap below 0 -> projection-opposed stand-down/cap candidate.",
    applies: (row) => row.market === "total" && row.grade === "Lean" && (row.projectionGap ?? 999) < 0,
  },
];

function settled(rows: Row[]): Row[] {
  return rows.filter((row) => (row.result === "win" || row.result === "loss") && row.units !== null);
}

function summarize(rows: Row[]) {
  const done = settled(rows);
  const wins = done.filter((row) => row.result === "win").length;
  const losses = done.filter((row) => row.result === "loss").length;
  const unitsValue = +done.reduce((sum, row) => sum + (row.units ?? 0), 0).toFixed(4);
  return {
    rows: rows.length,
    settled: done.length,
    wins,
    losses,
    units: unitsValue,
    roi: done.length ? +(unitsValue / done.length).toFixed(4) : null,
    avgPrice: avg(done.map((row) => row.price)),
    avgEdge: avg(done.map((row) => row.edge)),
  };
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return nums.length ? +(nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(4) : null;
}

function splitSummary(rows: Row[], rule: CandidateRule) {
  return Object.fromEntries((["train", "validation", "holdout"] as Split[]).map((split) => [
    split,
    summarize(rows.filter((row) => row.split === split && rule.applies(row))),
  ]));
}

function classify(rule: CandidateRule, historicalMatches: Row[], currentMatches: CurrentRow[]) {
  const s = summarize(historicalMatches);
  const splits = splitSummary(historicalMatches, rule);
  const trainOk = rule.intent === "cap" ? splits.train.units < 0 : splits.train.units > 0;
  const validationOk = rule.intent === "cap" ? splits.validation.units < 0 : splits.validation.units > 0;
  const holdoutOk = rule.intent === "cap" ? splits.holdout.units <= 0 : splits.holdout.units >= 0;
  const directionOk = rule.intent === "cap"
    ? s.units < 0 && (s.roi ?? 999) < 0
    : s.units > 0 && (s.roi ?? -999) > 0;
  if (currentMatches.length === 0) return "no_current_target";
  if (s.settled >= 25 && directionOk && trainOk && validationOk && holdoutOk) return "enable_today_candidate";
  if (s.settled >= 15 && directionOk && trainOk && validationOk) return "controlled_candidate";
  if (s.settled < 15) return "needs_more_data";
  return "reject_today";
}

async function main() {
  const args = parseArgs();
  const historical = await loadHistoricalRows(args);
  const current = await loadCurrentRows(args);
  const settledHistorical = settled(historical);
  const evaluations = rules.map((rule) => {
    const historicalMatches = settledHistorical.filter((row) => rule.applies(row));
    const currentMatches = current.filter((row) => rule.applies(row));
    return {
      id: rule.id,
      intent: rule.intent,
      target: rule.target,
      description: rule.description,
      classification: classify(rule, historicalMatches, currentMatches),
      historical: summarize(historicalMatches),
      split: splitSummary(historicalMatches, rule),
      currentMatches: currentMatches.map((row) => ({
        game: row.game,
        market: row.market,
        pick: row.pick,
        currentGrade: row.grade,
        candidateGrade: rule.target,
        price: row.price,
        line: row.line,
        modelProbability: row.modelProbability,
        marketImplied: row.marketImplied,
        edge: row.edge,
        projectedTotal: row.projectedTotal,
        projectionGap: row.projectionGap,
        movement: row.movement,
        capReasons: row.capReasons,
      })),
      examples: historicalMatches.slice(0, 8).map((row) => ({
        date: row.date,
        game: row.game,
        market: row.market,
        pick: row.pick,
        grade: row.grade,
        result: row.result,
        units: row.units,
        price: row.price,
        edge: row.edge,
        projectionGap: row.projectionGap,
        movement: row.movement,
      })),
    };
  });
  const report = {
    mode: "daily_edge_same_day_answer_search",
    generatedAt: new Date().toISOString(),
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    noPickFlips: true,
    noProbabilityChanges: true,
    noProjectionChanges: true,
    noTrackingChanges: true,
    args,
    currentSlate: {
      rows: current.length,
      gradeCounts: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "Caution", "No Play"].map((grade) => [grade, current.filter((row) => row.grade === grade).length])),
      marketGradeCounts: Object.fromEntries(["moneyline", "total", "first_inning"].map((market) => [
        market,
        Object.fromEntries(["Best Angle", "Lean", "Watchlist", "Caution", "No Play"].map((grade) => [grade, current.filter((row) => row.market === market && row.grade === grade).length])),
      ])),
    },
    evaluations,
    enableTodayCandidates: evaluations.filter((row) => row.classification === "enable_today_candidate"),
    controlledCandidates: evaluations.filter((row) => row.classification === "controlled_candidate"),
    rejectsToday: evaluations.filter((row) => row.classification === "reject_today"),
    directAnswer: {
      foundNewEnableTodayRule: evaluations.some((row) => row.classification === "enable_today_candidate"),
      bestCandidates: evaluations.filter((row) => row.classification === "enable_today_candidate" || row.classification === "controlled_candidate").map((row) => row.id),
      recommendation: evaluations.some((row) => row.classification === "enable_today_candidate")
        ? "Review enableTodayCandidates; these have current targets and historically positive train/validation/holdout cohorts."
        : "No additional promotion/cap rule cleared the same-day enable bar beyond the already approved guardrails.",
    },
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Same-day answer search: ${report.directAnswer.recommendation}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
