/**
 * Offline-only NBA player-props model tournament.
 *
 * Candidate selection uses a chronological selection window. The winning
 * family is then refit on development + selection and evaluated exactly once
 * on the later untouched confirmation window. No production or member writes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fitNbaPlayerPropsIndependentResearchModel,
  projectNbaPlayerPropsIndependent,
  type NbaPlayerPropCombination,
  type NbaPlayerPropsIndependentResearchModel,
} from "../../../lib/services/nba/nbaPlayerPropsIndependentModel";
import {
  selectNbaPlayerPropsCanonicalOfferSets,
} from "../../../lib/services/nba/nbaPlayerPropsMarketEvidence";
import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";
import type { NbaPlayerPropFeatureRow } from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

type Dataset = {
  release: string;
  mode: "offline_research_only";
  actionable: false;
  games: Array<{ gameId: number; startTime: string }>;
  featureRows: NbaPlayerPropFeatureRow[];
  openingObservations: NbaPlayerPropPriceObservation[];
  immutableInputsSha256: string;
};

type Market = NbaPlayerPropCombination;
type CandidateName =
  | "ridge_r2"
  | "ridge_r2_minutes_regression"
  | "raw_recent_minutes"
  | "raw_balanced_minutes"
  | "raw_stable_minutes"
  | "hierarchical_recent_minutes"
  | "hierarchical_balanced_minutes"
  | "hierarchical_stable_minutes";

type Candidate = {
  name: CandidateName;
  fit: (rows: readonly NbaPlayerPropFeatureRow[]) => (row: NbaPlayerPropFeatureRow, market: Market) => number;
};

type MinuteFeature = keyof Pick<NbaPlayerPropFeatureRow,
  | "minutes_mean_3"
  | "minutes_mean_5"
  | "minutes_mean_10"
  | "minutes_mean_season"
  | "minutes_sd_10"
  | "participation_rate_10"
  | "same_team_games_10"
  | "changed_team_since_last_game"
  | "days_rest"
  | "is_home"
  | "team_back_to_back"
  | "player_games_prior"
>;

type MinuteRegression = {
  features: MinuteFeature[];
  means: number[];
  scales: number[];
  coefficients: number[];
  lambda: number;
};

type Metrics = {
  rows: number;
  games: number;
  pricedRows: number;
  mae: number | null;
  rmse: number | null;
  medianAbsoluteError: number | null;
  bias: number | null;
  directionHitRate: number | null;
  overShare: number | null;
};

type WalkForwardFold = {
  trainGames: number;
  testGames: number;
  testFrom: string | null;
  testThrough: string | null;
  markets: Record<Market, {
    independent: Metrics;
    twoStageMinutes: Metrics;
    openingMarket: ReturnType<typeof marketDiagnostic>;
  }>;
};

const MARKETS: Market[] = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
];

const MINUTES = {
  recent: [0.45, 0.30, 0.15, 0.10] as const,
  balanced: [0.25, 0.30, 0.25, 0.20] as const,
  stable: [0.10, 0.20, 0.30, 0.40] as const,
};

const MINUTE_FEATURES: MinuteFeature[] = [
  "minutes_mean_3",
  "minutes_mean_5",
  "minutes_mean_10",
  "minutes_mean_season",
  "minutes_sd_10",
  "participation_rate_10",
  "same_team_games_10",
  "changed_team_since_last_game",
  "days_rest",
  "is_home",
  "team_back_to_back",
  "player_games_prior",
];

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const input = value("--input");
  if (!input) throw new Error("--input is required.");
  const outputValue = value("--output");
  const dataset = JSON.parse(await readFile(input, "utf8")) as Dataset;
  if (dataset.mode !== "offline_research_only" || dataset.actionable !== false) {
    throw new Error("NBA props tournament accepts only an offline, non-actionable research dataset.");
  }

  const orderedGames = [...dataset.games]
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.gameId - b.gameId);
  if (orderedGames.length < 30) throw new Error("NBA props tournament requires at least 30 chronological games.");
  const developmentEnd = Math.floor(orderedGames.length * 0.60);
  const selectionEnd = Math.floor(orderedGames.length * 0.80);
  const developmentIds = new Set(orderedGames.slice(0, developmentEnd).map((game) => game.gameId));
  const selectionIds = new Set(orderedGames.slice(developmentEnd, selectionEnd).map((game) => game.gameId));
  const confirmationIds = new Set(orderedGames.slice(selectionEnd).map((game) => game.gameId));
  const development = chronological(dataset.featureRows.filter((row) => developmentIds.has(row.game_id)));
  const selection = chronological(dataset.featureRows.filter((row) => selectionIds.has(row.game_id)));
  const confirmation = chronological(dataset.featureRows.filter((row) => confirmationIds.has(row.game_id)));
  const canonical = selectNbaPlayerPropsCanonicalOfferSets(dataset.openingObservations.filter((row) => row.isOpening));
  const lineByScope = new Map(canonical.map((offer) => [offer.scopeKey, offer.canonicalLine]));
  const marketProbabilityByScope = new Map(canonical.flatMap((offer) => {
    const probability = consensusNoVigOver(offer.observations);
    return probability === null ? [] : [[offer.scopeKey, probability] as const];
  }));

  const candidates: Candidate[] = [
    ridgeCandidate(),
    ridgeMinutesRegressionCandidate(),
    rawCandidate("raw_recent_minutes", MINUTES.recent),
    rawCandidate("raw_balanced_minutes", MINUTES.balanced),
    rawCandidate("raw_stable_minutes", MINUTES.stable),
    hierarchicalCandidate("hierarchical_recent_minutes", MINUTES.recent),
    hierarchicalCandidate("hierarchical_balanced_minutes", MINUTES.balanced),
    hierarchicalCandidate("hierarchical_stable_minutes", MINUTES.stable),
  ];

  const selectionMetrics: Record<string, Partial<Record<Market, Metrics>>> = {};
  const selectionPredictors = new Map<CandidateName, ReturnType<Candidate["fit"]>>();
  for (const candidate of candidates) {
    const predict = candidate.fit(development);
    selectionPredictors.set(candidate.name, predict);
    selectionMetrics[candidate.name] = Object.fromEntries(MARKETS.map((market) => [
      market,
      evaluate(selection, market, predict, lineByScope),
    ]));
  }

  const selectedByMarket = Object.fromEntries(MARKETS.map((market) => [
    market,
    selectCandidate(candidates, selectionMetrics, market),
  ])) as Record<Market, CandidateName>;

  const fitRows = chronological([...development, ...selection]);
  const ridgeDiagnosticModel = fitNbaPlayerPropsIndependentResearchModel(fitRows);
  const predictors = new Map<CandidateName, ReturnType<Candidate["fit"]>>();
  for (const candidate of candidates) predictors.set(candidate.name, candidate.fit(fitRows));
  const confirmationMetrics = Object.fromEntries(MARKETS.map((market) => {
    const candidate = selectedByMarket[market];
    const candidateMetrics = evaluate(confirmation, market, predictors.get(candidate)!, lineByScope);
    const ridgeMetrics = evaluate(confirmation, market, predictors.get("ridge_r2")!, lineByScope);
    return [market, {
      selectedCandidate: candidate,
      metrics: candidateMetrics,
      baselineRidge: ridgeMetrics,
      confirmationVerdict: confirmationVerdict(candidate, candidateMetrics, ridgeMetrics),
      ridgeErrorDecomposition: projectionErrorDecomposition(confirmation, market, ridgeDiagnosticModel),
      failureSegments: segmentFailures(confirmation, market, predictors.get(candidate)!, lineByScope),
      openingMarketSelectionDiagnostic: marketDiagnostic(
        selection,
        market,
        selectionPredictors.get(candidate)!,
        lineByScope,
        marketProbabilityByScope,
      ),
      openingMarketDiagnostic: marketDiagnostic(
        confirmation,
        market,
        predictors.get(candidate)!,
        lineByScope,
        marketProbabilityByScope,
      ),
    }];
  }));
  const walkForwardStability = walkForward(
    orderedGames,
    dataset.featureRows,
    lineByScope,
    marketProbabilityByScope,
  );

  const report = {
    release: "nba_player_props_model_tournament_2026_10_20_r1",
    mode: "offline_research_only",
    actionable: false,
    sourceDatasetRelease: dataset.release,
    immutableInputsSha256: dataset.immutableInputsSha256,
    split: {
      developmentGames: developmentIds.size,
      selectionGames: selectionIds.size,
      untouchedConfirmationGames: confirmationIds.size,
      developmentRows: development.length,
      selectionRows: selection.length,
      confirmationRows: confirmation.length,
      confirmationFrom: confirmation[0]?.feature_cutoff ?? null,
      confirmationThrough: confirmation.at(-1)?.feature_cutoff ?? null,
    },
    selectionMetrics,
    selectedByMarket,
    confirmationMetrics,
    walkForwardStability,
    launchDecision: "not_fit",
    reasons: [
      "A single 12-game confirmation block is a pilot, not production validation.",
      "Opening prices cannot validate same-book movement or lock-time market arbitration.",
      "No grade, stake, promotion, demotion, or member output was evaluated.",
    ],
    integrity: {
      chronologicalGameSplit: true,
      candidateSelectionExcludedConfirmation: true,
      noDatabaseWrites: true,
      noMemberWrites: true,
      noGradesOrStakes: true,
    },
  };
  if (outputValue) {
    const output = path.resolve(outputValue);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function walkForward(
  games: ReadonlyArray<{ gameId: number; startTime: string }>,
  rows: readonly NbaPlayerPropFeatureRow[],
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
) {
  const initialGames = Math.floor(games.length / 2);
  const remaining = games.length - initialGames;
  const blockSize = Math.max(1, Math.floor(remaining / 5));
  const folds: WalkForwardFold[] = [];
  for (let start = initialGames; start < games.length; start += blockSize) {
    const end = Math.min(games.length, start + blockSize);
    const trainIds = new Set(games.slice(0, start).map((game) => game.gameId));
    const testGames = games.slice(start, end);
    const testIds = new Set(testGames.map((game) => game.gameId));
    const train = chronological(rows.filter((row) => trainIds.has(row.game_id)));
    const test = chronological(rows.filter((row) => testIds.has(row.game_id)));
    if (train.length < 8 || test.length === 0) continue;
    const model = fitNbaPlayerPropsIndependentResearchModel(train);
    const predict = (row: NbaPlayerPropFeatureRow, market: Market) =>
      projectNbaPlayerPropsIndependent(row, model).combinations[market];
    const twoStagePredict = ridgeMinutesRegressionCandidate().fit(train);
    folds.push({
      trainGames: trainIds.size,
      testGames: testIds.size,
      testFrom: testGames[0]?.startTime ?? null,
      testThrough: testGames.at(-1)?.startTime ?? null,
      markets: Object.fromEntries(MARKETS.map((market) => [market, {
        independent: evaluate(test, market, predict, lineByScope),
        twoStageMinutes: evaluate(test, market, twoStagePredict, lineByScope),
        openingMarket: marketDiagnostic(test, market, predict, lineByScope, probabilityByScope),
      }])) as WalkForwardFold["markets"],
    });
  }
  return {
    release: "nba_player_props_walk_forward_stability_2026_10_20_r1",
    folds,
    summary: Object.fromEntries(MARKETS.map((market) => {
      const metrics = folds.map((fold) => fold.markets[market]!.independent);
      const twoStageMetrics = folds.map((fold) => fold.markets[market]!.twoStageMinutes);
      const hitRates = metrics.map((metric) => metric.directionHitRate).filter((item): item is number => item !== null);
      const maes = metrics.map((metric) => metric.mae).filter((item): item is number => item !== null);
      const marketHits = folds.map((fold) => fold.markets[market]!.openingMarket.all.marketHitRate)
        .filter((item): item is number => item !== null);
      const candidateWins = twoStageMetrics.reduce((count, candidate, index) => {
        const baseline = metrics[index]!;
        if (candidate.mae === null || baseline.mae === null || candidate.directionHitRate === null || baseline.directionHitRate === null) return count;
        return count + Number(candidate.mae < baseline.mae && candidate.directionHitRate >= baseline.directionHitRate - 0.02);
      }, 0);
      return [market, {
        folds: metrics.length,
        twoStageCandidateWins: candidateWins,
        directionHitRateRange: hitRates.length ? [Math.min(...hitRates), Math.max(...hitRates)] : null,
        projectionMaeRange: maes.length ? [Math.min(...maes), Math.max(...maes)] : null,
        openingMarketHitRateRange: marketHits.length ? [Math.min(...marketHits), Math.max(...marketHits)] : null,
      }];
    })),
  };
}

function ridgeCandidate(): Candidate {
  return {
    name: "ridge_r2",
    fit(rows) {
      const model = fitNbaPlayerPropsIndependentResearchModel(rows);
      return (row, market) => projectNbaPlayerPropsIndependent(row, model).combinations[market];
    },
  };
}

function ridgeMinutesRegressionCandidate(): Candidate {
  return {
    name: "ridge_r2_minutes_regression",
    fit(rows) {
      const baseModel = fitNbaPlayerPropsIndependentResearchModel(rows);
      const minuteModel = fitMinuteRegression(rows);
      return (row, market) => {
        const base = projectNbaPlayerPropsIndependent(row, baseModel);
        if (base.conditionalMinutes <= 0) return base.combinations[market];
        const rate = base.combinations[market] / base.conditionalMinutes;
        return Math.max(0, rate * predictMinuteRegression(row, minuteModel));
      };
    },
  };
}

function fitMinuteRegression(rows: readonly NbaPlayerPropFeatureRow[]): MinuteRegression {
  const ordered = chronological(rows).filter((row) => (row.target_minutes ?? 0) > 0);
  const split = Math.max(8, Math.min(ordered.length - 4, Math.floor(ordered.length * 0.75)));
  const train = ordered.slice(0, split);
  const validate = ordered.slice(split);
  const candidates = [0.1, 1, 5, 20, 100];
  return candidates.map((lambda) => fitMinuteRegressionAtLambda(train, lambda))
    .sort((left, right) => minuteRegressionMae(validate, left) - minuteRegressionMae(validate, right))[0]!;
}

function fitMinuteRegressionAtLambda(rows: readonly NbaPlayerPropFeatureRow[], lambda: number): MinuteRegression {
  const means = MINUTE_FEATURES.map((feature) => mean(nonNull(rows.map((row) => row[feature]))) ?? 0);
  const scales = MINUTE_FEATURES.map((feature, index) => standardDeviation(nonNull(rows.map((row) => row[feature]))) || Math.max(1, Math.abs(means[index]!)));
  const x = rows.map((row) => [1, ...MINUTE_FEATURES.map((feature, index) => ((row[feature] ?? means[index]!) - means[index]!) / scales[index]!)]);
  const y = rows.map((row) => row.target_minutes!);
  return { features: MINUTE_FEATURES, means, scales, coefficients: ridgeSolve(x, y, lambda), lambda };
}

function predictMinuteRegression(row: NbaPlayerPropFeatureRow, model: MinuteRegression): number {
  let value = model.coefficients[0] ?? 0;
  model.features.forEach((feature, index) => {
    value += (model.coefficients[index + 1] ?? 0)
      * (((row[feature] ?? model.means[index]!) - model.means[index]!) / model.scales[index]!);
  });
  return Math.max(0, Math.min(48, value));
}

function minuteRegressionMae(rows: readonly NbaPlayerPropFeatureRow[], model: MinuteRegression): number {
  const errors = rows.flatMap((row) => row.target_minutes === null || row.target_minutes <= 0
    ? []
    : [Math.abs(predictMinuteRegression(row, model) - row.target_minutes)]);
  return mean(errors) ?? Infinity;
}

function ridgeSolve(x: readonly number[][], y: readonly number[], lambda: number): number[] {
  const width = x[0]?.length ?? 1;
  const matrix = Array.from({ length: width }, (_, row) => Array.from({ length: width + 1 }, (_, column) => {
    if (column === width) return x.reduce((sum, values, index) => sum + values[row]! * y[index]!, 0);
    const ridge = row === column && row > 0 ? lambda : 0;
    return x.reduce((sum, values) => sum + values[row]! * values[column]!, ridge);
  }));
  for (let pivot = 0; pivot < width; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < width; row += 1) {
      if (Math.abs(matrix[row]![pivot]!) > Math.abs(matrix[best]![pivot]!)) best = row;
    }
    [matrix[pivot], matrix[best]] = [matrix[best]!, matrix[pivot]!];
    const divisor = matrix[pivot]![pivot]!;
    if (Math.abs(divisor) < 1e-10) continue;
    for (let column = pivot; column <= width; column += 1) matrix[pivot]![column] /= divisor;
    for (let row = 0; row < width; row += 1) {
      if (row === pivot) continue;
      const factor = matrix[row]![pivot]!;
      for (let column = pivot; column <= width; column += 1) matrix[row]![column] -= factor * matrix[pivot]![column]!;
    }
  }
  return matrix.map((row) => Number.isFinite(row[width]) ? row[width]! : 0);
}

function rawCandidate(name: CandidateName, weights: readonly [number, number, number, number]): Candidate {
  return {
    name,
    fit() {
      return (row, market) => componentProjection(row, market, weights, null);
    },
  };
}

function hierarchicalCandidate(name: CandidateName, weights: readonly [number, number, number, number]): Candidate {
  return {
    name,
    fit(rows) {
      const priors = roleRatePriors(rows);
      return (row, market) => componentProjection(row, market, weights, priors);
    },
  };
}

function componentProjection(
  row: NbaPlayerPropFeatureRow,
  market: Market,
  weights: readonly [number, number, number, number],
  priors: Record<string, Record<string, number>> | null,
): number {
  const minutes = predictedMinutes(row, weights);
  const components = marketComponents(market).map((component) => {
    const raw = componentRate(row, component) ?? 0;
    if (!priors) return raw * minutes;
    const role = minuteRole(minutes);
    const prior = priors[component]?.[role] ?? priors[component]?.all ?? raw;
    const sample = Math.min(10, Math.max(0, row.player_games_prior));
    const shrinkage = 8 / (sample + 8);
    return ((1 - shrinkage) * raw + shrinkage * prior) * minutes;
  });
  return Math.max(0, components.reduce((sum, component) => sum + component, 0));
}

function roleRatePriors(rows: readonly NbaPlayerPropFeatureRow[]): Record<string, Record<string, number>> {
  const output: Record<string, Record<string, number>> = {};
  for (const component of ["points", "rebounds", "assists", "threes"] as const) {
    const groups: Record<string, number[]> = { low: [], rotation: [], starter: [], high: [], all: [] };
    for (const row of rows) {
      const minutes = row.target_minutes ?? 0;
      const target = componentTarget(row, component);
      if (minutes <= 0 || target === null) continue;
      const rate = target / minutes;
      groups[minuteRole(predictedMinutes(row, MINUTES.balanced))]!.push(rate);
      groups.all!.push(rate);
    }
    output[component] = Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, median(values) ?? 0]));
  }
  return output;
}

function evaluate(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  predict: (row: NbaPlayerPropFeatureRow, market: Market) => number,
  lineByScope: ReadonlyMap<string, number>,
): Metrics {
  const errors: number[] = [];
  const gameIds = new Set<number>();
  const hits: number[] = [];
  const sides: number[] = [];
  let pricedRows = 0;
  for (const row of rows) {
    const actual = target(row, market);
    if (actual === null) continue;
    const projection = predict(row, market);
    gameIds.add(row.game_id);
    errors.push(projection - actual);
    const line = lineByScope.get(scope(row, market));
    if (line === undefined || actual === line || projection === line) continue;
    pricedRows += 1;
    const over = projection > line;
    sides.push(Number(over));
    hits.push(Number(over === (actual > line)));
  }
  return {
    rows: errors.length,
    games: gameIds.size,
    pricedRows,
    mae: mean(errors.map(Math.abs)),
    rmse: errors.length ? Math.sqrt(mean(errors.map((error) => error ** 2))!) : null,
    medianAbsoluteError: median(errors.map(Math.abs)),
    bias: mean(errors),
    directionHitRate: mean(hits),
    overShare: mean(sides),
  };
}

function projectionErrorDecomposition(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  model: NbaPlayerPropsIndependentResearchModel,
) {
  const fullErrors: number[] = [];
  const perfectMinutesErrors: number[] = [];
  const perfectRateErrors: number[] = [];
  const minuteErrors: number[] = [];
  for (const row of rows) {
    const actual = target(row, market);
    const actualMinutes = row.target_minutes;
    if (actual === null || actualMinutes === null || actualMinutes <= 0) continue;
    const projection = projectNbaPlayerPropsIndependent(row, model);
    const predictedMinutes = projection.conditionalMinutes;
    if (predictedMinutes <= 0) continue;
    const center = projection.combinations[market];
    const predictedRate = center / predictedMinutes;
    const actualRate = actual / actualMinutes;
    fullErrors.push(center - actual);
    perfectMinutesErrors.push(predictedRate * actualMinutes - actual);
    perfectRateErrors.push(actualRate * predictedMinutes - actual);
    minuteErrors.push(predictedMinutes - actualMinutes);
  }
  return {
    rows: fullErrors.length,
    fullProjectionMae: mean(fullErrors.map(Math.abs)),
    rateErrorMaeWithPerfectMinutes: mean(perfectMinutesErrors.map(Math.abs)),
    minutesErrorMaeWithPerfectRate: mean(perfectRateErrors.map(Math.abs)),
    minutesMae: mean(minuteErrors.map(Math.abs)),
    note: "Oracle decompositions diagnose error source only; they are not deployable forecasts.",
  };
}

function selectCandidate(
  candidates: readonly Candidate[],
  metrics: Record<string, Partial<Record<Market, Metrics>>>,
  market: Market,
): CandidateName {
  const ridge = metrics.ridge_r2?.[market];
  const ridgeHit = ridge?.directionHitRate ?? 0;
  const eligible = candidates.filter((candidate) => {
    const item = metrics[candidate.name]?.[market];
    return item !== undefined && item.mae !== null && item.directionHitRate !== null
      && item.pricedRows >= 20
      && item.directionHitRate >= ridgeHit - 0.02;
  });
  const pool = eligible.length > 0 ? eligible : candidates.filter((candidate) => metrics[candidate.name]?.[market]?.mae !== null);
  return [...pool].sort((left, right) => {
    const a = metrics[left.name]![market]!;
    const b = metrics[right.name]![market]!;
    return (a.mae! - b.mae!) || ((b.directionHitRate ?? 0) - (a.directionHitRate ?? 0));
  })[0]!.name;
}

function segmentFailures(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  predict: (row: NbaPlayerPropFeatureRow, market: Market) => number,
  lineByScope: ReadonlyMap<string, number>,
): Record<string, Metrics> {
  const segments: Record<string, (row: NbaPlayerPropFeatureRow) => boolean> = {
    established_role: (row) => row.player_games_prior >= 10 && (row.minutes_sd_10 ?? Infinity) <= 5,
    volatile_minutes: (row) => (row.minutes_sd_10 ?? 0) > 5,
    limited_history: (row) => row.player_games_prior < 10,
    changed_team: (row) => row.changed_team_since_last_game === 1,
    back_to_back: (row) => row.team_back_to_back === 1,
    projected_over: (row) => {
      const line = lineByScope.get(scope(row, market));
      return line !== undefined && predict(row, market) > line;
    },
    projected_under: (row) => {
      const line = lineByScope.get(scope(row, market));
      return line !== undefined && predict(row, market) < line;
    },
  };
  return Object.fromEntries(Object.entries(segments).map(([name, predicate]) => [
    name,
    evaluate(rows.filter(predicate), market, predict, lineByScope),
  ]));
}

function confirmationVerdict(candidate: CandidateName, metrics: Metrics, baseline: Metrics): {
  accepted: false;
  reason: string;
} {
  if (candidate === "ridge_r2") return { accepted: false, reason: "No alternative survived selection." };
  if (metrics.mae === null || baseline.mae === null || metrics.directionHitRate === null || baseline.directionHitRate === null) {
    return { accepted: false, reason: "Confirmation coverage was insufficient." };
  }
  const maeImprovement = (baseline.mae - metrics.mae) / baseline.mae;
  const hitDelta = metrics.directionHitRate - baseline.directionHitRate;
  if (maeImprovement >= 0.02 && hitDelta >= -0.02) {
    // A passing candidate still remains non-actionable because this pilot has
    // only one confirmation block. The return type deliberately stays false.
    return { accepted: false, reason: "Promising on one confirmation block; requires a second season/window before acceptance." };
  }
  return {
    accepted: false,
    reason: `Failed confirmation versus ridge (MAE change ${(maeImprovement * 100).toFixed(1)}%; direction change ${(hitDelta * 100).toFixed(1)} pp).`,
  };
}

function marketDiagnostic(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  predict: (row: NbaPlayerPropFeatureRow, market: Market) => number,
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
) {
  const allIndependent: number[] = [];
  const allMarket: number[] = [];
  const agree: number[] = [];
  const disagreeIndependent: number[] = [];
  const disagreeMarket: number[] = [];
  const disagreementStrength: Record<string, { independent: number[]; market: number[] }> = {
    under_2pp: { independent: [], market: [] },
    from_2_to_5pp: { independent: [], market: [] },
    at_least_5pp: { independent: [], market: [] },
  };
  for (const row of rows) {
    const actual = target(row, market);
    const key = scope(row, market);
    const line = lineByScope.get(key);
    const probability = probabilityByScope.get(key);
    if (actual === null || line === undefined || probability === undefined || actual === line) continue;
    const independentOver = predict(row, market) > line;
    const marketOver = probability >= 0.5;
    const outcomeOver = actual > line;
    const independentHit = Number(independentOver === outcomeOver);
    const marketHit = Number(marketOver === outcomeOver);
    allIndependent.push(independentHit);
    allMarket.push(marketHit);
    if (independentOver === marketOver) {
      agree.push(independentHit);
      continue;
    }
    disagreeIndependent.push(independentHit);
    disagreeMarket.push(marketHit);
    const distance = Math.abs(probability - 0.5);
    const bucket = distance < 0.02 ? "under_2pp" : distance < 0.05 ? "from_2_to_5pp" : "at_least_5pp";
    disagreementStrength[bucket]!.independent.push(independentHit);
    disagreementStrength[bucket]!.market.push(marketHit);
  }
  return {
    limitation: "Archived opening de-vig only; no same-book movement or lock-time evidence.",
    all: { rows: allIndependent.length, independentHitRate: mean(allIndependent), marketHitRate: mean(allMarket) },
    agreement: { rows: agree.length, sharedHitRate: mean(agree) },
    disagreement: {
      rows: disagreeIndependent.length,
      independentHitRate: mean(disagreeIndependent),
      marketHitRate: mean(disagreeMarket),
      byMarketPriceStrength: Object.fromEntries(Object.entries(disagreementStrength).map(([key, item]) => [key, {
        rows: item.independent.length,
        independentHitRate: mean(item.independent),
        marketHitRate: mean(item.market),
      }])),
    },
  };
}

function predictedMinutes(row: NbaPlayerPropFeatureRow, weights: readonly [number, number, number, number]): number {
  const inputs: Array<[number | null, number]> = [
    [row.minutes_mean_3, weights[0]],
    [row.minutes_mean_5, weights[1]],
    [row.minutes_mean_10, weights[2]],
    [row.minutes_mean_season, weights[3]],
  ];
  const available = inputs.filter((item): item is [number, number] => item[0] !== null && Number.isFinite(item[0]));
  const denominator = available.reduce((sum, [, weight]) => sum + weight, 0);
  return denominator > 0 ? Math.max(0, Math.min(48, available.reduce((sum, [minutes, weight]) => sum + minutes * weight, 0) / denominator)) : 0;
}

function componentRate(row: NbaPlayerPropFeatureRow, component: "points" | "rebounds" | "assists" | "threes"): number | null {
  if (component === "points") return row.points_per_minute_10;
  if (component === "rebounds") return row.rebounds_per_minute_10;
  if (component === "assists") return row.assists_per_minute_10;
  return row.threes_per_minute_10;
}

function componentTarget(row: NbaPlayerPropFeatureRow, component: "points" | "rebounds" | "assists" | "threes"): number | null {
  if (component === "points") return row.target_points;
  if (component === "rebounds") return row.target_rebounds;
  if (component === "assists") return row.target_assists;
  return row.target_threes;
}

function target(row: NbaPlayerPropFeatureRow, market: Market): number | null {
  if (market === "points") return row.target_points;
  if (market === "rebounds") return row.target_rebounds;
  if (market === "assists") return row.target_assists;
  if (market === "threes") return row.target_threes;
  if (market === "points_rebounds_assists") return row.target_points_rebounds_assists;
  if (market === "points_rebounds") return row.target_points_rebounds;
  if (market === "points_assists") return row.target_points_assists;
  return row.target_rebounds_assists;
}

function marketComponents(market: Market): Array<"points" | "rebounds" | "assists" | "threes"> {
  if (market === "points_rebounds_assists") return ["points", "rebounds", "assists"];
  if (market === "points_rebounds") return ["points", "rebounds"];
  if (market === "points_assists") return ["points", "assists"];
  if (market === "rebounds_assists") return ["rebounds", "assists"];
  return [market];
}

function minuteRole(minutes: number): "low" | "rotation" | "starter" | "high" {
  if (minutes < 20) return "low";
  if (minutes < 28) return "rotation";
  if (minutes < 34) return "starter";
  return "high";
}

function scope(row: NbaPlayerPropFeatureRow, market: Market): string {
  return `nba-bdl:${row.game_id}|nba-bdl-player:${row.player_id}|${market}`;
}

function consensusNoVigOver(rows: readonly NbaPlayerPropPriceObservation[]): number | null {
  const byBook = new Map<string, NbaPlayerPropPriceObservation[]>();
  for (const row of rows) byBook.set(row.sportsbook, [...(byBook.get(row.sportsbook) ?? []), row]);
  const probabilities: number[] = [];
  for (const bookRows of byBook.values()) {
    const over = bookRows.find((row) => row.side === "over");
    const under = bookRows.find((row) => row.side === "under");
    if (!over || !under) continue;
    const overImplied = implied(over.americanPrice);
    const underImplied = implied(under.americanPrice);
    probabilities.push(overImplied / (overImplied + underImplied));
  }
  return median(probabilities);
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function chronological(rows: readonly NbaPlayerPropFeatureRow[]): NbaPlayerPropFeatureRow[] {
  return [...rows].sort((a, b) => Date.parse(a.feature_cutoff) - Date.parse(b.feature_cutoff) || a.game_id - b.game_id || a.player_id - b.player_id);
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[index]! : (ordered[index - 1]! + ordered[index]!) / 2;
}

function nonNull(values: readonly (number | null)[]): number[] {
  return values.filter((item): item is number => item !== null && Number.isFinite(item));
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  if (average === null || values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
