/**
 * Targeted MLB ML Best Angle movement/edge cap decision review.
 *
 * Read-only: no DB writes, no production changes, no paid AI.
 */
import { buildDailyEdgeResponseForCostPreview } from "@/lib/services/aiAuditor/costPreview";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import { supabase } from "@/lib/db/supabase";

type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
type Result = "win" | "loss" | "push" | "void" | "pending" | "unknown";
type Split = "train" | "validation" | "holdout";
type Movement = "toward" | "against" | "neutral" | "unknown";
type CapTarget = "Lean" | "Watchlist" | "Adaptive";

type RawPrediction = {
  id: number;
  sport: string;
  slate_date: string;
  matchup: string | null;
  market: string | null;
  pick: string | null;
  side: string | null;
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
  matchup: string;
  pick: string | null;
  grade: Grade;
  price: number | null;
  modelProbability: number | null;
  marketProbability: number | null;
  edge: number | null;
  movement: Movement;
  marketRead: string;
  result: Result;
  units: number | null;
};

type Args = {
  sport: string;
  from: string;
  to: string;
  today: string;
  json: boolean;
};

const GRADES: Grade[] = ["Best Angle", "Lean", "Watchlist", "Caution", "No Play"];
const ACTIONABLE = new Set<Grade>(["Best Angle", "Lean"]);

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseArgs(): Args {
  const today = todayEt();
  const out: Args = { sport: "mlb", from: "2026-06-07", to: today, today, json: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") out.sport = value.toLowerCase();
    if (key === "from") out.from = value;
    if (key === "to") out.to = value === "today" ? today : value;
    if (key === "today") out.today = value === "today" ? today : value;
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

function units(price: number | null, result: Result): number | null {
  if (result === "void" || result === "push" || result === "pending" || result === "unknown") return 0;
  if (result === "loss") return price === null ? null : -1;
  if (result === "win" && price !== null && price !== 0) return +(price > 0 ? price / 100 : 100 / Math.abs(price)).toFixed(4);
  return null;
}

function movement(snapshot: Record<string, unknown> | null): Movement {
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

function marketRead(snapshot: Record<string, unknown> | null): string {
  return str(snapshot, [
    "recommendationDecision.resolvedMarketRead.status",
    "resolvedMarketRead.status",
    "marketRead.status",
    "market_read.status",
  ]) ?? "not_persisted";
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

async function loadHistoricalRows(args: Args): Promise<Row[]> {
  const rawRows: RawPrediction[] = [];
  for (let from = 0; from < 6000; from += 750) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,matchup,market,pick,side,odds_american,model_probability,market_probability,edge,play_grade,best_angle,no_bet,launch_day,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .order("slate_date", { ascending: true })
      .range(from, from + 749);
    query = query.gte("slate_date", args.from).lte("slate_date", args.to);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records load failed: ${error.message}`);
    rawRows.push(...((data ?? []) as RawPrediction[]));
    if ((data ?? []).length < 750) break;
  }
  return splitRows(rawRows.flatMap((raw): Row[] => {
    const market = String(raw.market ?? "").toLowerCase();
    if (raw.launch_day === true || (market !== "moneyline" && market !== "ml")) return [];
    const result = normalizeResult(one(raw.prediction_grades)?.result);
    return [{
      id: raw.id,
      date: raw.slate_date,
      split: "train",
      matchup: raw.matchup ?? "",
      pick: raw.pick ?? raw.side,
      grade: normalizeGrade(raw.play_grade, raw.best_angle, raw.no_bet),
      price: raw.odds_american,
      modelProbability: pct(raw.model_probability),
      marketProbability: pct(raw.market_probability) ?? impliedPct(raw.odds_american),
      edge: pct(raw.edge),
      movement: movement(raw.snapshot_json),
      marketRead: marketRead(raw.snapshot_json),
      result,
      units: units(raw.odds_american, result),
    }];
  }));
}

function ruleEligible(row: Row): boolean {
  return row.grade === "Best Angle" &&
    row.movement !== "unknown" &&
    row.movement !== "toward" &&
    typeof row.edge === "number" &&
    row.edge < 8;
}

function adaptiveTarget(row: Row): Grade {
  if (!ruleEligible(row)) return row.grade;
  if (row.movement === "against" || (row.edge ?? 999) < 5 || (row.price !== null && row.price <= -160)) {
    return "Watchlist";
  }
  return "Lean";
}

function candidateGrade(row: Row, target: CapTarget): Grade {
  if (!ruleEligible(row)) return row.grade;
  if (target === "Adaptive") return adaptiveTarget(row);
  return target;
}

function settled(rows: Row[]): Row[] {
  return rows.filter((row) => (row.result === "win" || row.result === "loss") && row.units !== null);
}

function countBy<T>(rows: T[], keyFn: (row: T) => unknown): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(keyFn(row) ?? "null");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function gradeSummary(rows: Row[], gradeFn: (row: Row) => Grade = (row) => row.grade) {
  const done = settled(rows);
  return Object.fromEntries(GRADES.map((grade) => {
    const subset = done.filter((row) => gradeFn(row) === grade);
    const wins = subset.filter((row) => row.result === "win").length;
    const losses = subset.filter((row) => row.result === "loss").length;
    const unitsValue = +subset.reduce((sum, row) => sum + (row.units ?? 0), 0).toFixed(4);
    return [grade, {
      rows: subset.length,
      wins,
      losses,
      units: unitsValue,
      roi: subset.length ? +(unitsValue / subset.length).toFixed(4) : null,
    }];
  }));
}

function actionableSummary(rows: Row[], gradeFn: (row: Row) => Grade = (row) => row.grade) {
  const subset = settled(rows).filter((row) => ACTIONABLE.has(gradeFn(row)));
  const wins = subset.filter((row) => row.result === "win").length;
  const losses = subset.filter((row) => row.result === "loss").length;
  const unitsValue = +subset.reduce((sum, row) => sum + (row.units ?? 0), 0).toFixed(4);
  return {
    rows: subset.length,
    wins,
    losses,
    units: unitsValue,
    roi: subset.length ? +(unitsValue / subset.length).toFixed(4) : null,
    gradeDistribution: Object.fromEntries(GRADES.map((grade) => [grade, rows.filter((row) => gradeFn(row) === grade).length])),
  };
}

function bucketPrice(price: number | null): string {
  if (price === null) return "missing";
  if (price > 0) return "plus_money";
  if (price >= -130) return "-100_to_-129";
  if (price >= -160) return "-130_to_-159";
  if (price >= -200) return "-160_to_-199";
  return "-200_or_worse";
}

function bucketEdge(edge: number | null): string {
  if (edge === null) return "missing";
  if (edge < 2) return "lt_2";
  if (edge < 5) return "2_to_4_99";
  if (edge < 8) return "5_to_7_99";
  return "8_plus";
}

function bucketBreakdown(rows: Row[], keyFn: (row: Row) => string) {
  return Object.entries(countBy(rows, keyFn)).map(([bucket, count]) => {
    const subset = rows.filter((row) => keyFn(row) === bucket);
    const winCount = subset.filter((row) => row.result === "win").length;
    const lossCount = subset.filter((row) => row.result === "loss").length;
    const unitsValue = +subset.reduce((sum, row) => sum + (row.units ?? 0), 0).toFixed(4);
    return {
      bucket,
      count,
      wins: winCount,
      losses: lossCount,
      units: unitsValue,
      roi: count ? +(unitsValue / count).toFixed(4) : null,
    };
  });
}

function example(row: Row, target: Grade) {
  return {
    date: row.date,
    game: row.matchup,
    pick: row.pick,
    originalGrade: row.grade,
    candidateGrade: target,
    result: row.result,
    units: row.units,
    price: row.price,
    modelProbability: row.modelProbability,
    marketImplied: row.marketProbability,
    edge: row.edge,
    lineMovement: row.movement,
    marketRead: row.marketRead,
  };
}

function evaluateTarget(rows: Row[], target: CapTarget) {
  const affected = rows.filter(ruleEligible);
  const original = actionableSummary(rows);
  const simulated = actionableSummary(rows, (row) => candidateGrade(row, target));
  const originalGrades = gradeSummary(rows);
  const simulatedGrades = gradeSummary(rows, (row) => candidateGrade(row, target));
  const changedSettled = settled(affected);
  const winnersRemoved = changedSettled.filter((row) => ACTIONABLE.has(row.grade) && !ACTIONABLE.has(candidateGrade(row, target)) && row.result === "win").length;
  const losersRemoved = changedSettled.filter((row) => ACTIONABLE.has(row.grade) && !ACTIONABLE.has(candidateGrade(row, target)) && row.result === "loss").length;
  const bestAngleWinnersRemoved = changedSettled.filter((row) => row.result === "win").length;
  const bestAngleLosersRemoved = changedSettled.filter((row) => row.result === "loss").length;
  const split = Object.fromEntries((["train", "validation", "holdout"] as Split[]).map((name) => {
    const subset = rows.filter((row) => row.split === name);
    const o = actionableSummary(subset);
    const s = actionableSummary(subset, (row) => candidateGrade(row, target));
    const og = gradeSummary(subset);
    const sg = gradeSummary(subset, (row) => candidateGrade(row, target));
    return [name, {
      affectedRows: subset.filter(ruleEligible).length,
      actionableDeltaUnits: +(s.units - o.units).toFixed(4),
      actionableDeltaRoi: s.roi !== null && o.roi !== null ? +(s.roi - o.roi).toFixed(4) : null,
      bestAngleDeltaUnits: +((sg["Best Angle"].units) - (og["Best Angle"].units)).toFixed(4),
      bestAngleDeltaRoi: sg["Best Angle"].roi !== null && og["Best Angle"].roi !== null
        ? +(sg["Best Angle"].roi - og["Best Angle"].roi).toFixed(4)
        : null,
    }];
  }));
  return {
    target,
    affectedRows: affected.length,
    publicActionableCountImpact: {
      before: original.rows,
      after: simulated.rows,
      delta: simulated.rows - original.rows,
    },
    bestAngleCountBeforeAfter: {
      before: rows.filter((row) => row.grade === "Best Angle").length,
      after: rows.filter((row) => candidateGrade(row, target) === "Best Angle").length,
    },
    leanCountBeforeAfter: {
      before: rows.filter((row) => row.grade === "Lean").length,
      after: rows.filter((row) => candidateGrade(row, target) === "Lean").length,
    },
    watchlistCountBeforeAfter: {
      before: rows.filter((row) => row.grade === "Watchlist").length,
      after: rows.filter((row) => candidateGrade(row, target) === "Watchlist").length,
    },
    actionableOriginal: original,
    actionableSimulated: simulated,
    actionableDeltaUnits: +(simulated.units - original.units).toFixed(4),
    actionableDeltaRoi: simulated.roi !== null && original.roi !== null ? +(simulated.roi - original.roi).toFixed(4) : null,
    gradeOriginal: originalGrades,
    gradeSimulated: simulatedGrades,
    bestAngleDeltaUnits: +((simulatedGrades["Best Angle"].units) - (originalGrades["Best Angle"].units)).toFixed(4),
    bestAngleDeltaRoi: simulatedGrades["Best Angle"].roi !== null && originalGrades["Best Angle"].roi !== null
      ? +(simulatedGrades["Best Angle"].roi - originalGrades["Best Angle"].roi).toFixed(4)
      : null,
    winnersRemoved,
    losersRemoved,
    bestAngleWinnersRemoved,
    bestAngleLosersRemoved,
    train: split.train,
    validation: split.validation,
    holdout: split.holdout,
    examplesHelped: changedSettled.filter((row) => row.result === "loss").slice(0, 8).map((row) => example(row, candidateGrade(row, target))),
    examplesHurt: changedSettled.filter((row) => row.result === "win").slice(0, 8).map((row) => example(row, candidateGrade(row, target))),
  };
}

async function todayBestAngles(args: Args) {
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport as "mlb", date: args.today });
  const selection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport as "mlb",
    date: args.today,
    markets: ["moneyline"],
    response,
  });
  return selection.evidence
    .filter((row) => row.identity.marketType === "ML" && row.identity.originalPlayGrade === "Best Angle")
    .map((row) => {
      const movementInfo = interpretMarketIntelligence(row);
      const movementKnown = movementInfo.priceMovementDirection !== "unknown";
      const eligible = movementKnown &&
        movementInfo.priceMovementDirection !== "toward_pick" &&
        typeof row.modelStatsEvidence.edge === "number" &&
        row.modelStatsEvidence.edge < 8;
      return {
        game: `${row.identity.awayTeam} @ ${row.identity.homeTeam}`,
        pick: row.identity.pick,
        price: row.priceValueEvidence.priceAmerican,
        modelProbability: row.modelStatsEvidence.modelProbability,
        marketImplied: row.modelStatsEvidence.marketImpliedProbability,
        edge: row.modelStatsEvidence.edge,
        lineMovement: movementInfo.priceMovementDirection,
        movementKnown,
        ruleWouldFire: eligible,
        why: eligible
          ? "known movement is neutral/against/not toward and edge is below 8"
          : !movementKnown
            ? "movement unknown, so rule must not fire"
            : movementInfo.priceMovementDirection === "toward_pick"
              ? "movement is toward pick"
              : (row.modelStatsEvidence.edge ?? 999) >= 8
                ? "edge is at or above 8"
                : "not eligible",
      };
    });
}

async function main() {
  const args = parseArgs();
  const rows = await loadHistoricalRows(args);
  const settledRows = settled(rows);
  const bestAngles = settledRows.filter((row) => row.grade === "Best Angle");
  const knownMovementBestAngles = bestAngles.filter((row) => row.movement !== "unknown");
  const unknownMovementBestAngles = bestAngles.filter((row) => row.movement === "unknown");
  const eligibleRows = settledRows.filter(ruleEligible);
  const versionA = evaluateTarget(settledRows, "Lean");
  const versionB = evaluateTarget(settledRows, "Watchlist");
  const adaptive = evaluateTarget(settledRows, "Adaptive");
  const todayRows = await todayBestAngles(args);
  const todayAffected = todayRows.filter((row) => row.ruleWouldFire);
  const adaptivePasses = eligibleRows.length >= 25 &&
    adaptive.actionableDeltaUnits > 0 &&
    adaptive.train.actionableDeltaUnits > 0 &&
    adaptive.validation.actionableDeltaUnits > 0 &&
    adaptive.holdout.actionableDeltaUnits >= 0;
  const leanPassesBestAngleQuality = eligibleRows.length >= 25 &&
    versionA.bestAngleDeltaUnits > 0 &&
    versionA.train.bestAngleDeltaUnits > 0 &&
    versionA.validation.bestAngleDeltaUnits > 0 &&
    versionA.holdout.bestAngleDeltaUnits >= 0;
  const recommendation = adaptivePasses
    ? "enable_today"
    : leanPassesBestAngleQuality
      ? "enable_today_with_lean_cap_only"
      : "keep_default_off";

  const report = {
    mode: "ml_best_angle_movement_edge_cap_decision_review",
    generatedAt: new Date().toISOString(),
    noOpenAiCalls: true,
    noDbWrites: true,
    noProductionChanges: true,
    noPickFlips: true,
    noProbabilityChanges: true,
    noProjectionChanges: true,
    noTrackingChanges: true,
    args,
    historicalKnownMovementOnly: {
      totalMlBestAngleRows: bestAngles.length,
      rowsWithKnownMovement: knownMovementBestAngles.length,
      rowsWithUnknownMovement: unknownMovementBestAngles.length,
      eligibleRowsUnderKnownOnlyRule: eligibleRows.length,
      affectedRows: eligibleRows.length,
      originalBestAngleRecordUnitsRoi: gradeSummary(settledRows)["Best Angle"],
      eligibleRowsRecordUnitsRoi: {
        rows: eligibleRows.length,
        wins: eligibleRows.filter((row) => row.result === "win").length,
        losses: eligibleRows.filter((row) => row.result === "loss").length,
        units: +eligibleRows.reduce((sum, row) => sum + (row.units ?? 0), 0).toFixed(4),
        roi: eligibleRows.length ? +(eligibleRows.reduce((sum, row) => sum + (row.units ?? 0), 0) / eligibleRows.length).toFixed(4) : null,
      },
      priceBucketBreakdown: bucketBreakdown(eligibleRows, (row) => bucketPrice(row.price)),
      edgeBucketBreakdown: bucketBreakdown(eligibleRows, (row) => bucketEdge(row.edge)),
    },
    versionA_BestAngleToLean: versionA,
    versionB_BestAngleToWatchlist: versionB,
    versionC_AdaptiveLeanOrWatchlist: adaptive,
    todaySlateImpact: {
      date: args.today,
      affectedRowsToday: todayAffected.length,
      allMlBestAngleRowsToday: todayRows,
    },
    decision: {
      classification: recommendation,
      recommendedCapTarget: recommendation === "enable_today_with_lean_cap_only" ? "Lean" : "Adaptive",
      rationale: recommendation === "enable_today_with_lean_cap_only"
        ? "Known-only historical rule identifies weak Best Angle cohort, but Lean cap preserves actionable status while removing top-tier presentation today."
        : recommendation === "enable_today"
          ? "Known-only adaptive rule passes historical train/validation/holdout and today's affected rows have no blockers."
          : "Known-only rule did not clear the activation bar.",
      exactFlag: "MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED",
      exactLogic: recommendation === "enable_today_with_lean_cap_only"
        ? "ML only; current grade Best Angle; line movement known; movement neutral/against/not toward pick; edge < 8%; cap to Lean; never fire when movement is unknown."
        : "ML only; current grade Best Angle; line movement known; movement neutral/against/not toward pick; edge < 8%; cap to Lean by default, Watchlist only when separately validated price/risk logic is enabled; never fire when movement is unknown.",
      rollbackFlag: "MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED=false",
      postEnableVerificationCommand: "npm run daily-edge:grade-rule-preview -- --sport=mlb --date=today --rules=ml_best_angle_movement_edge_cap --json",
    },
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`ML BA movement cap decision: ${report.decision.classification}`);
  console.log(`Known-only affected: ${eligibleRows.length}; today affected: ${todayAffected.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
