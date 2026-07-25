/**
 * Read-only r8 research audit.
 *
 * Fits a small ridge-logistic calibration on exact-current probability-head
 * rows before the holdout date, then evaluates fixed dynamic-price tiers on
 * the untouched holdout. Odds are used only for actionability/break-even,
 * never as the sole prediction-strength grade.
 *
 * This script never writes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- snapshot_json is schemaless historical audit input */

import { supabase } from "../../lib/db/supabase";
import { MLB_MODEL_LAYER_VERSION_IDS } from "../../lib/automodel/mlbModelLayerVersions";

type Row = Record<string, any>;
type Market = "moneyline" | "total";

const HOLDOUT_DATE = "2026-07-20";
const ABSOLUTE_MAX_JUICE = -200;
const LEAN_VALUE_MARGIN = 0.02;
const BEST_ANGLE_VALUE_MARGIN = 0.05;
const LEAN_MIN_PROBABILITY = 0.53;
const BEST_ANGLE_MIN_PROBABILITY = 0.56;
const RIDGE = 0.35;
const STEPS = 4_000;
const RATE = 0.03;

function relation(row: Row): Row | null {
  return Array.isArray(row.prediction_grades)
    ? row.prediction_grades[0] ?? null
    : row.prediction_grades ?? null;
}

function layer(row: Row): Row {
  return row.snapshot_json?.model_layer_versions ??
    row.snapshot_json?.mlb_model_layer_versions ??
    {};
}

function exactHead(row: Row): boolean {
  const active = layer(row).active_probability_head;
  return row.market === "moneyline"
    ? active === MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head
    : active === MLB_MODEL_LAYER_VERSION_IDS.total_probability_head;
}

function clamp(value: number): number {
  return Math.min(0.999, Math.max(0.001, value));
}

function logit(value: number): number {
  const p = clamp(value);
  return Math.log(p / (1 - p));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function lineDirection(row: Row): number {
  const direction = row.snapshot_json?.line_movement?.direction;
  if (direction === "toward_pick") return 1;
  if (direction === "against_pick") return -1;
  return 0;
}

function features(row: Row): number[] | null {
  const model = Number(row.model_probability);
  const market = Number(row.market_probability);
  if (!(model > 0 && model < 1) || !(market > 0 && market < 1)) return null;
  return [
    1,
    logit(model),
    logit(market),
    lineDirection(row),
    row.snapshot_json?.public_splits?.conflict === true ? 1 : 0,
    row.snapshot_json?.public_splits?.support === true ? 1 : 0,
  ];
}

function outcome(row: Row): number | null {
  const result = String(relation(row)?.result ?? "").toLowerCase();
  if (result === "win") return 1;
  if (result === "loss") return 0;
  return null;
}

function fit(rows: Row[]): number[] {
  const examples = rows.flatMap((row) => {
    const x = features(row);
    const y = outcome(row);
    return x === null || y === null ? [] : [{ x, y }];
  });
  const weights = Array.from({ length: 6 }, () => 0);
  for (let step = 0; step < STEPS; step++) {
    const gradient = Array.from({ length: weights.length }, () => 0);
    for (const example of examples) {
      const predicted = sigmoid(
        example.x.reduce((sum, value, index) => sum + value * weights[index]!, 0),
      );
      for (let index = 0; index < weights.length; index++) {
        gradient[index]! += (predicted - example.y) * example.x[index]!;
      }
    }
    for (let index = 0; index < weights.length; index++) {
      const penalty = index === 0 ? 0 : RIDGE * weights[index]!;
      weights[index]! -= RATE * (gradient[index]! / Math.max(1, examples.length) + penalty);
    }
  }
  return weights;
}

function calibratedProbability(row: Row, weights: number[]): number | null {
  const x = features(row);
  if (x === null) return null;
  return sigmoid(x.reduce((sum, value, index) => sum + value * weights[index]!, 0));
}

function impliedProbability(odds: unknown): number | null {
  const value = Number(odds);
  if (!Number.isFinite(value) || value === 0) return null;
  return value > 0 ? 100 / (value + 100) : -value / (-value + 100);
}

function priceAllowed(odds: unknown): boolean {
  const value = Number(odds);
  return Number.isFinite(value) && value >= ABSOLUTE_MAX_JUICE;
}

function completeness(row: Row): Row {
  return row.snapshot_json?.mlb_data_completeness ?? {};
}

function candidateGrade(row: Row, probability: number | null): string {
  const implied = impliedProbability(row.odds_american);
  const data = completeness(row);
  if (
    probability === null ||
    implied === null ||
    row.held === true ||
    row.no_bet === true ||
    data.status === "incomplete_missing_required_data" ||
    !priceAllowed(row.odds_american)
  ) {
    return "watchlist";
  }
  const valueMargin = probability - implied;
  if (
    data.best_angle_allowed === true &&
    probability >= BEST_ANGLE_MIN_PROBABILITY &&
    valueMargin >= BEST_ANGLE_VALUE_MARGIN
  ) {
    return "best_angle";
  }
  if (probability >= LEAN_MIN_PROBABILITY && valueMargin >= LEAN_VALUE_MARGIN) {
    return "lean";
  }
  return "watchlist";
}

function projectionAligned(row: Row): boolean {
  if (row.market !== "moneyline") return true;
  const side = String(row.pick ?? row.side ?? "").toLowerCase();
  const homeDiff = Number(
    row.snapshot_json?.v2_2_audit?.posterior_home_diff ??
      row.snapshot_json?.v2_2_audit?.independent_home_diff,
  );
  if (!Number.isFinite(homeDiff)) return true;
  return side === "home" ? homeDiff >= 0 : side === "away" ? homeDiff <= 0 : false;
}

function sameSideProjectionGap(row: Row): number | null {
  const side = String(row.pick ?? row.side ?? "").toLowerCase();
  const homeDiff = Number(
    row.snapshot_json?.v2_2_audit?.posterior_home_diff ??
      row.snapshot_json?.v2_2_audit?.independent_home_diff,
  );
  if (!Number.isFinite(homeDiff)) return null;
  return side === "home" ? homeDiff : side === "away" ? -homeDiff : null;
}

function addOnGrade(
  row: Row,
  probability: number | null,
  valueMarginFloor: number,
): string {
  const existing = storedGrade(row);
  if (existing === "best_angle" || existing === "lean") return existing;
  const implied = impliedProbability(row.odds_american);
  const data = completeness(row);
  if (
    probability === null ||
    implied === null ||
    probability < 0.55 ||
    probability - implied < valueMarginFloor ||
    !priceAllowed(row.odds_american) ||
    row.held === true ||
    row.no_bet === true ||
    data.status === "incomplete_missing_required_data" ||
    lineDirection(row) < 0 ||
    row.snapshot_json?.public_splits?.conflict === true ||
    !projectionAligned(row)
  ) {
    return "watchlist";
  }
  return "lean";
}

function storedGrade(row: Row): string {
  if (row.held === true || row.no_bet === true) return "watchlist";
  if (row.best_angle === true) return "best_angle";
  return row.play_grade === "lean" ? "lean" : "watchlist";
}

function currentR7EligibilityGrade(row: Row): string {
  const stored = storedGrade(row);
  if (stored === "best_angle" || stored === "lean" || row.market !== "moneyline") {
    return stored;
  }
  const probability = Number(row.model_probability);
  const implied = impliedProbability(row.odds_american);
  const edge = Number(row.edge);
  const odds = Number(row.odds_american);
  const projectionGap = sameSideProjectionGap(row);
  const clean =
    row.held !== true &&
    row.no_bet !== true &&
    lineDirection(row) >= 0 &&
    row.snapshot_json?.public_splits?.conflict !== true;
  const cleanTightBestAngle =
    clean &&
    probability >= 0.55 &&
    probability < 0.58 &&
    edge >= 0.5 &&
    odds > -220 &&
    projectionGap !== null &&
    Math.abs(projectionGap) < 0.75;
  const tightMarketBestAngle =
    clean &&
    edge >= -1 &&
    edge < 1 &&
    odds >= -160 &&
    odds <= -131;
  if (cleanTightBestAngle || tightMarketBestAngle) return "best_angle";
  const genericLean =
    clean &&
    probability >= 0.55 &&
    probability < 0.58 &&
    edge >= 0.5 &&
    odds > -220 &&
    implied !== null &&
    probability >= implied &&
    (projectionGap === null || projectionGap >= 0);
  return genericLean ? "lean" : "watchlist";
}

function tightMarketFallbackGrade(row: Row): string {
  const existing = storedGrade(row);
  if (existing === "best_angle" || existing === "lean") return existing;
  const edge = Number(row.edge);
  const odds = Number(row.odds_american);
  const data = completeness(row);
  const eligible =
    row.market === "moneyline" &&
    Number.isFinite(edge) &&
    edge >= -1 &&
    edge < 2 &&
    Number.isFinite(odds) &&
    odds >= -200 &&
    odds <= -101 &&
    row.held !== true &&
    row.no_bet !== true &&
    data.status !== "incomplete_missing_required_data" &&
    lineDirection(row) >= 0 &&
    row.snapshot_json?.public_splits?.conflict !== true &&
    projectionAligned(row);
  return eligible ? "lean" : "watchlist";
}

function boundaryFallbackGrade(
  row: Row,
  kind: "edge_upper" | "price_lighter" | "price_heavier",
): string {
  const existing = storedGrade(row);
  if (existing === "best_angle" || existing === "lean") return existing;
  const edge = Number(row.edge);
  const odds = Number(row.odds_american);
  const data = completeness(row);
  const boundaryEligible =
    kind === "edge_upper"
      ? edge >= 1 && edge < 2 && odds >= -160 && odds <= -131
      : kind === "price_lighter"
        ? edge >= -1 && edge < 1 && odds >= -130 && odds <= -101
        : edge >= -1 && edge < 1 && odds >= -200 && odds <= -161;
  const eligible =
    row.market === "moneyline" &&
    Number.isFinite(edge) &&
    Number.isFinite(odds) &&
    boundaryEligible &&
    row.held !== true &&
    row.no_bet !== true &&
    data.status !== "incomplete_missing_required_data" &&
    lineDirection(row) >= 0 &&
    row.snapshot_json?.public_splits?.conflict !== true &&
    projectionAligned(row);
  return eligible ? "lean" : "watchlist";
}

function midPriceNearMarketEligible(row: Row): boolean {
  const edge = Number(row.edge);
  const odds = Number(row.odds_american);
  const data = completeness(row);
  const common =
    row.held !== true &&
    row.no_bet !== true &&
    data.status !== "incomplete_missing_required_data" &&
    lineDirection(row) >= 0 &&
    row.snapshot_json?.public_splits?.conflict !== true &&
    projectionAligned(row);
  const promotion =
    row.market === "moneyline" &&
    Number.isFinite(edge) &&
    edge >= -1 &&
    edge < 2 &&
    Number.isFinite(odds) &&
    odds >= -145 &&
    odds <= -121;
  return common && promotion;
}

function unifiedPromotionGrade(row: Row): string {
  const existing = currentR7EligibilityGrade(row);
  if (existing === "best_angle" || existing === "lean") return existing;
  if (!midPriceNearMarketEligible(row)) return "watchlist";
  return Number(row.odds_american) <= -131 ? "best_angle" : "lean";
}

function profit(row: Row): number {
  const result = outcome(row);
  const odds = Number(row.odds_american);
  if (result === null || !Number.isFinite(odds) || odds === 0) return 0;
  if (result === 0) return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function metrics(rows: Row[], gradeOf: (row: Row) => string) {
  const actionable = rows.filter((row) => ["lean", "best_angle"].includes(gradeOf(row)));
  const wins = actionable.filter((row) => outcome(row) === 1).length;
  const losses = actionable.filter((row) => outcome(row) === 0).length;
  const units = actionable.reduce((sum, row) => sum + profit(row), 0);
  return {
    rows: actionable.length,
    record: `${wins}-${losses}`,
    winRatePct: wins + losses ? Number((wins / (wins + losses) * 100).toFixed(1)) : null,
    units: Number(units.toFixed(3)),
    roiPct: actionable.length ? Number((units / actionable.length * 100).toFixed(1)) : null,
    byGrade: actionable.reduce((counts: Record<string, number>, row) => {
      const grade = gradeOf(row);
      counts[grade] = (counts[grade] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function probabilityMetrics(
  rows: Row[],
  probabilityOf: (row: Row) => number | null,
) {
  const scored = rows.flatMap((row) => {
    const probability = probabilityOf(row);
    const result = outcome(row);
    return probability === null || result === null ? [] : [{ probability, result }];
  });
  const brier = scored.reduce(
    (sum, item) => sum + (item.probability - item.result) ** 2,
    0,
  ) / Math.max(1, scored.length);
  const logLoss = scored.reduce((sum, item) => {
    const probability = clamp(item.probability);
    return sum - (
      item.result * Math.log(probability) +
      (1 - item.result) * Math.log(1 - probability)
    );
  }, 0) / Math.max(1, scored.length);
  return {
    rows: scored.length,
    brier: Number(brier.toFixed(4)),
    logLoss: Number(logLoss.toFixed(4)),
    averageProbability: Number((
      scored.reduce((sum, item) => sum + item.probability, 0) /
      Math.max(1, scored.length)
    ).toFixed(4)),
    actualWinRate: Number((
      scored.reduce((sum, item) => sum + item.result, 0) /
      Math.max(1, scored.length)
    ).toFixed(4)),
  };
}

function oddsBand(row: Row): string {
  const odds = Number(row.odds_american);
  if (odds > 0) return "plus_money";
  if (odds >= -120) return "-120_to_-101";
  if (odds >= -145) return "-145_to_-121";
  if (odds >= -170) return "-170_to_-146";
  return "-200_to_-171";
}

function groupedMetrics(rows: Row[]) {
  const dimensions: Record<string, (row: Row) => string> = {
    date: (row) => String(row.slate_date),
    side: (row) => String(row.pick ?? row.side ?? "unknown").toLowerCase(),
    oddsBand,
  };
  return Object.fromEntries(
    Object.entries(dimensions).map(([dimension, keyOf]) => [
      dimension,
      Object.fromEntries(
        [...new Set(rows.map(keyOf))].sort().map((key) => [
          key,
          metrics(rows.filter((row) => keyOf(row) === key), () => "lean"),
        ]),
      ),
    ]),
  );
}

async function pageAll(): Promise<Row[]> {
  const output: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id", "slate_date", "market", "pick", "side", "odds_american", "model_probability",
        "market_probability", "edge", "play_grade", "best_angle", "no_bet", "held",
        "locked_at", "launch_day", "snapshot_json", "prediction_grades(result)",
      ].join(","))
      .eq("sport", "mlb")
      .in("market", ["moneyline", "total"])
      .gte("slate_date", "2026-06-07")
      .not("locked_at", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...(data ?? []));
    if ((data ?? []).length < 1000) return output;
  }
}

async function currentRows(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select([
      "id", "matchup", "slate_date", "market", "pick", "odds_american",
      "model_probability", "market_probability", "edge", "play_grade", "best_angle",
      "no_bet", "no_bet_reason", "held", "hold_reason", "locked_at", "snapshot_json",
    ].join(","))
    .eq("sport", "mlb")
    .in("market", ["moneyline", "total"])
    .eq("slate_date", "2026-07-25")
    .order("id");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function main() {
  const settled = (await pageAll()).filter(
    (row) =>
      exactHead(row) &&
      row.launch_day !== true &&
      row.held !== true &&
      outcome(row) !== null,
  );
  const current = (await currentRows()).filter(exactHead);
  const output: Record<string, unknown> = {
    mode: "read_only_r8_dynamic_price_candidate",
    noWrites: true,
    fixedPolicy: {
      absoluteMaxJuice: ABSOLUTE_MAX_JUICE,
      leanValueMarginPp: LEAN_VALUE_MARGIN * 100,
      bestAngleValueMarginPp: BEST_ANGLE_VALUE_MARGIN * 100,
      leanMinProbability: LEAN_MIN_PROBABILITY,
      bestAngleMinProbability: BEST_ANGLE_MIN_PROBABILITY,
      holdoutDate: HOLDOUT_DATE,
    },
    markets: {},
  };

  for (const market of ["moneyline", "total"] as Market[]) {
    const marketRows = settled.filter((row) => row.market === market);
    const train = marketRows.filter((row) => row.slate_date < HOLDOUT_DATE);
    const holdout = marketRows.filter((row) => row.slate_date >= HOLDOUT_DATE);
    const weights = fit(train);
    const candidate = (row: Row) =>
      candidateGrade(row, calibratedProbability(row, weights));
    const added = holdout.filter(
      (row) =>
        ["lean", "best_angle"].includes(candidate(row)) &&
        !["lean", "best_angle"].includes(storedGrade(row)),
    );
    const removed = holdout.filter(
      (row) =>
        !["lean", "best_angle"].includes(candidate(row)) &&
        ["lean", "best_angle"].includes(storedGrade(row)),
    );
    const currentMarket = current.filter((row) => row.market === market);
    const tightFallbackAdded = (rows: Row[]) => rows.filter(
      (row) =>
        tightMarketFallbackGrade(row) === "lean" &&
        !["lean", "best_angle"].includes(storedGrade(row)),
    );
    const boundaryFallbacks = market === "moneyline"
      ? (["edge_upper", "price_lighter", "price_heavier"] as const).map((kind) => {
          const grade = (row: Row) => boundaryFallbackGrade(row, kind);
          const addedRows = (rows: Row[]) => rows.filter(
            (row) =>
              grade(row) === "lean" &&
              !["lean", "best_angle"].includes(storedGrade(row)),
          );
          return {
            kind,
            trainAdded: metrics(addedRows(train), grade),
            holdoutAdded: metrics(addedRows(holdout), grade),
            holdoutByDate: groupedMetrics(addedRows(holdout)).date,
            currentAdded: addedRows(currentMarket).map((row) => ({
              matchup: row.matchup,
              pick: row.pick,
              odds: row.odds_american,
              edgePct: row.edge,
            })),
          };
        })
      : [];
    const oddsDiagnostics = Object.fromEntries(
      ["train", "holdout"].map((period) => {
        const rows = period === "train" ? train : holdout;
        return [
          period,
          Object.fromEntries(
            [...new Set(rows.map(oddsBand))].sort().map((band) => {
              const bandRows = rows.filter((row) => oddsBand(row) === band);
              const nonActionable = bandRows.filter(
                (row) => !["lean", "best_angle"].includes(storedGrade(row)),
              );
              return [
                band,
                {
                  allPicks: metrics(bandRows, () => "lean"),
                  storedActionable: metrics(bandRows, storedGrade),
                  storedNonActionable: metrics(nonActionable, () => "lean"),
                },
              ];
            }),
          ),
        ];
      }),
    );
    const unifiedAdded = (rows: Row[]) => rows.filter(
      (row) =>
        ["lean", "best_angle"].includes(unifiedPromotionGrade(row)) &&
        !["lean", "best_angle"].includes(currentR7EligibilityGrade(row)),
    );
    const existingEligibilityOverlap = (rows: Row[]) => rows.filter(
      (row) =>
        midPriceNearMarketEligible(row) &&
        ["lean", "best_angle"].includes(currentR7EligibilityGrade(row)),
    );
    const bestAngleSignalDefinitions: Record<string, (row: Row) => boolean> = {
      model_probability_56_plus: (row) => Number(row.model_probability) >= 0.56,
      edge_1_plus: (row) => Number(row.edge) >= 1,
      probability_56_and_edge_1: (row) =>
        Number(row.model_probability) >= 0.56 && Number(row.edge) >= 1,
      projection_gap_half_run_plus: (row) =>
        (sameSideProjectionGap(row) ?? Number.NEGATIVE_INFINITY) >= 0.5,
      line_toward_pick: (row) => lineDirection(row) > 0,
      public_support: (row) => row.snapshot_json?.public_splits?.support === true,
      fully_confirmed_data: (row) => completeness(row).best_angle_allowed === true,
      established_price_minus_131_or_shorter: (row) => Number(row.odds_american) <= -131,
    };
    const bestAngleSignalAudit = market === "moneyline"
      ? Object.fromEntries(
          Object.entries(bestAngleSignalDefinitions).map(([signal, qualifies]) => {
            const trainRows = unifiedAdded(train).filter(qualifies);
            const holdoutRows = unifiedAdded(holdout).filter(qualifies);
            return [
              signal,
              {
                train: metrics(trainRows, () => "best_angle"),
                holdout: metrics(holdoutRows, () => "best_angle"),
                current: unifiedAdded(currentMarket).filter(qualifies).map((row) => ({
                  matchup: row.matchup,
                  pick: row.pick,
                  odds: row.odds_american,
                  probability: row.model_probability,
                  edgePct: row.edge,
                  projectionGap: sameSideProjectionGap(row),
                })),
              },
            ];
          }),
        )
      : {};
    const fullSleeveBestAngleSignalAudit = market === "moneyline"
      ? Object.fromEntries(
          Object.entries(bestAngleSignalDefinitions).map(([signal, qualifies]) => {
            const rowsFor = (rows: Row[]) =>
              rows.filter(midPriceNearMarketEligible).filter(qualifies);
            return [
              signal,
              {
                train: metrics(rowsFor(train), () => "best_angle"),
                holdout: metrics(rowsFor(holdout), () => "best_angle"),
                current: rowsFor(currentMarket).map((row) => ({
                  matchup: row.matchup,
                  pick: row.pick,
                  odds: row.odds_american,
                  probability: row.model_probability,
                  edgePct: row.edge,
                  projectionGap: sameSideProjectionGap(row),
                })),
              },
            ];
          }),
        )
      : {};
    const addOnGrid = [0.03, 0.04, 0.05, 0.06, 0.07, 0.08].map((margin) => {
      const grade = (row: Row) =>
        addOnGrade(row, calibratedProbability(row, weights), margin);
      const trainAddedRows = train.filter(
        (row) =>
          grade(row) === "lean" &&
          !["lean", "best_angle"].includes(storedGrade(row)),
      );
      const addedRows = holdout.filter(
        (row) =>
          grade(row) === "lean" &&
          !["lean", "best_angle"].includes(storedGrade(row)),
      );
      return {
        valueMarginPp: margin * 100,
        trainAll: metrics(train, grade),
        trainAdded: metrics(trainAddedRows, grade),
        holdoutAll: metrics(holdout, grade),
        holdoutAdded: metrics(addedRows, grade),
        robustness: {
          trainAdded: groupedMetrics(trainAddedRows),
          holdoutAdded: groupedMetrics(addedRows),
          trainAddedCalibration: probabilityMetrics(
            trainAddedRows,
            (row) => calibratedProbability(row, weights),
          ),
          holdoutAddedCalibration: probabilityMetrics(
            addedRows,
            (row) => calibratedProbability(row, weights),
          ),
        },
        currentBoard: metrics(currentMarket, grade),
        currentAdded: currentMarket
          .filter(
            (row) =>
              grade(row) === "lean" &&
              !["lean", "best_angle"].includes(storedGrade(row)),
          )
          .map((row) => ({
            matchup: row.matchup,
            pick: row.pick,
            odds: row.odds_american,
            calibratedProbability: calibratedProbability(row, weights),
            impliedProbability: impliedProbability(row.odds_american),
          })),
      };
    });
    const rawProbabilityGrid = [0.55, 0.57, 0.59, 0.61].flatMap((minimumProbability) =>
      [0, 0.02, 0.04].map((margin) => {
        const grade = (row: Row) => {
          const probability = Number(row.model_probability);
          return probability >= minimumProbability
            ? addOnGrade(row, probability, margin)
            : storedGrade(row);
        };
        const addedRows = (rows: Row[]) => rows.filter(
          (row) =>
            grade(row) === "lean" &&
            !["lean", "best_angle"].includes(storedGrade(row)),
        );
        return {
          minimumProbability,
          valueMarginPp: margin * 100,
          trainAdded: metrics(addedRows(train), grade),
          holdoutAdded: metrics(addedRows(holdout), grade),
          currentBoard: metrics(currentMarket, grade),
          currentAdded: currentMarket
            .filter(
              (row) =>
                grade(row) === "lean" &&
                !["lean", "best_angle"].includes(storedGrade(row)),
            )
            .map((row) => ({
              matchup: row.matchup,
              pick: row.pick,
              odds: row.odds_american,
              modelProbability: row.model_probability,
              impliedProbability: impliedProbability(row.odds_american),
            })),
        };
      }),
    );
    (output.markets as Record<string, unknown>)[market] = {
      sample: { train: train.length, holdout: holdout.length },
      weights: weights.map((weight) => Number(weight.toFixed(4))),
      calibration: {
        train: {
          rawModel: probabilityMetrics(train, (row) => Number(row.model_probability)),
          market: probabilityMetrics(train, (row) => Number(row.market_probability)),
          candidate: probabilityMetrics(
            train,
            (row) => calibratedProbability(row, weights),
          ),
        },
        holdout: {
          rawModel: probabilityMetrics(holdout, (row) => Number(row.model_probability)),
          market: probabilityMetrics(holdout, (row) => Number(row.market_probability)),
          candidate: probabilityMetrics(
            holdout,
            (row) => calibratedProbability(row, weights),
          ),
        },
      },
      holdout: {
        r7: metrics(holdout, storedGrade),
        r8: metrics(holdout, candidate),
        added: metrics(added, candidate),
        removed: metrics(removed, storedGrade),
      },
      addOnGrid,
      rawProbabilityGrid,
      tightMarketFallback: {
        policy: {
          edgePct: "[-1, 2)",
          oddsAmerican: "[-200, -101]",
          purpose: "Best Angle near-miss becomes Lean only",
        },
        trainAdded: metrics(
          tightFallbackAdded(train),
          tightMarketFallbackGrade,
        ),
        holdoutAdded: metrics(
          tightFallbackAdded(holdout),
          tightMarketFallbackGrade,
        ),
        holdoutAddedRobustness: groupedMetrics(tightFallbackAdded(holdout)),
        currentBoard: metrics(currentMarket, tightMarketFallbackGrade),
        currentAdded: tightFallbackAdded(currentMarket).map((row) => ({
          matchup: row.matchup,
          pick: row.pick,
          odds: row.odds_american,
          edgePct: row.edge,
        })),
      },
      boundaryFallbacks,
      oddsDiagnostics,
      unifiedPromotionCandidate: {
        currentR7EligibilityTrain: metrics(train, currentR7EligibilityGrade),
        currentR7EligibilityHoldout: metrics(holdout, currentR7EligibilityGrade),
        existingEligibilityOverlapTrain: metrics(
          existingEligibilityOverlap(train),
          currentR7EligibilityGrade,
        ),
        existingEligibilityOverlapHoldout: metrics(
          existingEligibilityOverlap(holdout),
          currentR7EligibilityGrade,
        ),
        trainAdded: metrics(unifiedAdded(train), unifiedPromotionGrade),
        holdoutAdded: metrics(unifiedAdded(holdout), unifiedPromotionGrade),
        holdoutByDate: groupedMetrics(unifiedAdded(holdout)).date,
        fullTrainBundle: metrics(train, unifiedPromotionGrade),
        fullHoldoutBundle: metrics(holdout, unifiedPromotionGrade),
        currentBoard: metrics(currentMarket, unifiedPromotionGrade),
        currentAdded: unifiedAdded(currentMarket).map((row) => ({
          matchup: row.matchup,
          market: row.market,
          pick: row.pick,
          odds: row.odds_american,
          probability: row.model_probability,
          edgePct: row.edge,
          grade: unifiedPromotionGrade(row),
        })),
      },
      bestAngleSignalAudit,
      fullSleeveBestAngleSignalAudit,
      currentBoard: {
        r7: metrics(currentMarket, storedGrade),
        r8: metrics(currentMarket, candidate),
        proposed: currentMarket
          .map((row) => ({
            matchup: row.matchup,
            market: row.market,
            pick: row.pick,
            odds: row.odds_american,
            calibratedProbability: calibratedProbability(row, weights),
            impliedProbability: impliedProbability(row.odds_american),
            r7: storedGrade(row),
            r8: candidate(row),
            dataStatus: completeness(row).status ?? null,
            bestAngleAllowed: completeness(row).best_angle_allowed === true,
          }))
          .filter((row) => row.r7 !== row.r8 || ["lean", "best_angle"].includes(row.r8)),
      },
    };
  }

  if (process.env.R8_BA_SIGNALS === "1") {
    console.log(JSON.stringify({
      moneyline: {
        incremental: (output.markets as Record<string, any>).moneyline.bestAngleSignalAudit,
        fullSleeve:
          (output.markets as Record<string, any>).moneyline.fullSleeveBestAngleSignalAudit,
      },
    }, null, 2));
    return;
  }
  if (process.env.R8_UNIFIED === "1") {
    console.log(JSON.stringify({
      markets: Object.fromEntries(
        Object.entries(output.markets as Record<string, any>).map(([market, audit]) => [
          market,
          {
            sample: audit.sample,
            baselineHoldout: audit.unifiedPromotionCandidate.currentR7EligibilityHoldout,
            candidate: audit.unifiedPromotionCandidate,
          },
        ]),
      ),
    }, null, 2));
    return;
  }
  if (process.env.R8_TRANSITIONS === "1") {
    console.log(JSON.stringify({
      rows: current
        .filter((row) => ["ARI@WSH", "CLE@TB"].includes(row.matchup))
        .map((row) => ({
          matchup: row.matchup,
          market: row.market,
          current: {
            odds: row.odds_american,
            edge: row.edge,
            playGrade: row.play_grade,
            bestAngle: row.best_angle,
            noBet: row.no_bet,
          },
          history: (Array.isArray(row.snapshot_json?.prediction_grade_history_v1)
            ? row.snapshot_json.prediction_grade_history_v1
            : []).map((entry: Row) => ({
              replacedAt: entry.replaced_at,
              odds: entry.odds_american,
              edge: entry.edge,
              modelProbability: entry.model_probability,
              playGrade: entry.play_grade,
              bestAngle: entry.best_angle,
              noBet: entry.no_bet,
              calibrationVersion: entry.calibration_version,
            })),
        })),
    }, null, 2));
    return;
  }
  if (process.env.R8_CURRENT === "1") {
    console.log(JSON.stringify({
      rows: current.map((row) => {
        const history = Array.isArray(row.snapshot_json?.prediction_grade_history_v1)
          ? row.snapshot_json.prediction_grade_history_v1
          : [];
        return {
          matchup: row.matchup,
          market: row.market,
          pick: row.pick,
          odds: row.odds_american,
          edgePct: row.edge,
          grade: storedGrade(row),
          rawPlayGrade: row.play_grade,
          noBet: row.no_bet === true,
          noBetReason: row.no_bet_reason ?? null,
          held: row.held === true,
          holdReason: row.hold_reason ?? null,
          locked: row.locked_at !== null,
          dataStatus: completeness(row).status ?? null,
          decisionRelease: layer(row).decision_release_id ?? null,
          actionRule: row.snapshot_json?.decision_pipeline?.action_rule_id ?? null,
          previousDecision: history.at(-1) ?? null,
          historyCount: history.length,
        };
      }),
    }, null, 2));
    return;
  }
  if (process.env.R8_ODDS === "1") {
    console.log(JSON.stringify({
      moneyline: (output.markets as Record<string, any>).moneyline.oddsDiagnostics,
    }, null, 2));
    return;
  }
  if (process.env.R8_COMPACT === "1") {
    console.log(JSON.stringify({
      mode: output.mode,
      markets: Object.fromEntries(
        Object.entries(output.markets as Record<string, any>).map(([market, audit]) => [
          market,
          {
            sample: audit.sample,
            calibration: audit.calibration,
            r7Holdout: audit.holdout.r7,
            rawProbabilityGrid: audit.rawProbabilityGrid,
            tightMarketFallback: audit.tightMarketFallback,
            boundaryFallbacks: audit.boundaryFallbacks,
            oddsDiagnostics: audit.oddsDiagnostics,
            unifiedPromotionCandidate: audit.unifiedPromotionCandidate,
          },
        ]),
      ),
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
