import type { NbaPlayerPropFeatureRow } from "./nbaPlayerPropsPointInTimeFeatures";

export const NBA_PLAYER_PROPS_INDEPENDENT_RESEARCH_RELEASE =
  "nba_player_props_independent_research_unfit_2026_10_20_r1" as const;

export const NBA_PLAYER_PROP_COMPONENTS = ["points", "rebounds", "assists", "threes"] as const;
export type NbaPlayerPropComponent = (typeof NBA_PLAYER_PROP_COMPONENTS)[number];
export type NbaPlayerPropCombination =
  | NbaPlayerPropComponent
  | "points_rebounds_assists"
  | "points_rebounds"
  | "points_assists"
  | "rebounds_assists";

type NumericFeature = keyof Pick<NbaPlayerPropFeatureRow,
  | "points_per_minute_10"
  | "rebounds_per_minute_10"
  | "assists_per_minute_10"
  | "threes_per_minute_10"
  | "fga_per_minute_10"
  | "fg3a_per_minute_10"
  | "fta_per_minute_10"
  | "usage_mean_5"
  | "touches_per_minute_5"
  | "passes_per_minute_5"
  | "rebound_chances_per_minute_5"
  | "true_shooting_mean_5"
  | "assist_percentage_mean_5"
  | "points_share_mean_5"
  | "fga_share_mean_5"
>;

type TargetKey = keyof Pick<NbaPlayerPropFeatureRow,
  | "target_points"
  | "target_rebounds"
  | "target_assists"
  | "target_threes"
>;

type MinuteWeights = {
  recent3: number;
  recent5: number;
  recent10: number;
  season: number;
};

type StandardizedRidge = {
  features: NumericFeature[];
  means: number[];
  scales: number[];
  coefficients: number[];
  lambda: number;
};

export type NbaPlayerPropsIndependentResearchModel = {
  release: typeof NBA_PLAYER_PROPS_INDEPENDENT_RESEARCH_RELEASE;
  mode: "offline_research_only";
  actionable: false;
  trainedThrough: string;
  trainingRows: number;
  validationRows: number;
  minuteWeights: MinuteWeights;
  participationPrior: number;
  participationPriorStrength: number;
  componentModels: Record<NbaPlayerPropComponent, StandardizedRidge>;
  validationResiduals: Array<Record<NbaPlayerPropComponent, number>>;
  validationMetrics: {
    minutesMae: number | null;
    componentMae: Record<NbaPlayerPropComponent, number | null>;
  };
};

export type NbaPlayerPropsIndependentProjection = {
  release: typeof NBA_PLAYER_PROPS_INDEPENDENT_RESEARCH_RELEASE;
  mode: "offline_research_only";
  actionable: false;
  gameId: number;
  playerId: number;
  participationProbability: number;
  conditionalMinutes: number;
  components: Record<NbaPlayerPropComponent, number>;
  combinations: Record<NbaPlayerPropCombination, number>;
  health: string[];
};

const MINUTE_CANDIDATES: MinuteWeights[] = [
  { recent3: 0.45, recent5: 0.30, recent10: 0.15, season: 0.10 },
  { recent3: 0.25, recent5: 0.30, recent10: 0.25, season: 0.20 },
  { recent3: 0.10, recent5: 0.20, recent10: 0.30, season: 0.40 },
  { recent3: 0.00, recent5: 0.35, recent10: 0.40, season: 0.25 },
];

const PARTICIPATION_PRIOR_STRENGTHS = [2, 5, 10] as const;
const RIDGE_LAMBDAS = [0.1, 1, 5, 20] as const;

const COMPONENT_SPEC: Record<NbaPlayerPropComponent, { target: TargetKey; features: NumericFeature[] }> = {
  points: {
    target: "target_points",
    features: ["points_per_minute_10", "fga_per_minute_10", "fg3a_per_minute_10", "fta_per_minute_10", "usage_mean_5", "true_shooting_mean_5", "points_share_mean_5", "fga_share_mean_5"],
  },
  rebounds: {
    target: "target_rebounds",
    features: ["rebounds_per_minute_10", "rebound_chances_per_minute_5", "usage_mean_5"],
  },
  assists: {
    target: "target_assists",
    features: ["assists_per_minute_10", "touches_per_minute_5", "passes_per_minute_5", "assist_percentage_mean_5", "usage_mean_5"],
  },
  threes: {
    target: "target_threes",
    features: ["threes_per_minute_10", "fg3a_per_minute_10", "true_shooting_mean_5", "usage_mean_5"],
  },
};

/**
 * Fits only from resolved, chronologically ordered rows. Candidate selection is
 * performed on the later portion of the supplied training window; production
 * callers must still supply a separate untouched confirmation season/window.
 */
export function fitNbaPlayerPropsIndependentResearchModel(
  rows: readonly NbaPlayerPropFeatureRow[],
): NbaPlayerPropsIndependentResearchModel {
  const ordered = [...rows]
    .filter((row) => Number.isFinite(Date.parse(row.feature_cutoff)))
    .sort((a, b) => Date.parse(a.feature_cutoff) - Date.parse(b.feature_cutoff) || a.game_id - b.game_id || a.player_id - b.player_id);
  if (ordered.length < 8) throw new Error("NBA player-props research fit requires at least 8 chronological rows.");
  const split = Math.max(4, Math.min(ordered.length - 4, Math.floor(ordered.length * 0.75)));
  const train = ordered.slice(0, split);
  const validate = ordered.slice(split);
  const appearanceTrain = train.filter((row) => (row.target_minutes ?? 0) > 0);
  if (appearanceTrain.length < 4) throw new Error("NBA player-props research fit requires at least 4 training appearances.");

  const participationPrior = clamp01(train.filter((row) => (row.target_minutes ?? 0) > 0).length / train.length);
  const minuteWeights = selectMinuteWeights(validate);
  const participationPriorStrength = selectParticipationStrength(validate, participationPrior);
  const componentModels = {} as Record<NbaPlayerPropComponent, StandardizedRidge>;
  const validationMetrics = {} as Record<NbaPlayerPropComponent, number | null>;

  for (const component of NBA_PLAYER_PROP_COMPONENTS) {
    const spec = COMPONENT_SPEC[component];
    const lambda = selectRidgeLambda(train, validate, spec, minuteWeights);
    componentModels[component] = fitStandardizedRidge(appearanceTrain, spec, lambda);
    validationMetrics[component] = componentMae(validate, componentModels[component], spec, minuteWeights);
  }

  const validationResiduals = validate.flatMap((row) => {
    if ((row.target_minutes ?? 0) <= 0) return [];
    const minutes = predictMinutes(row, minuteWeights);
    const residual = {} as Record<NbaPlayerPropComponent, number>;
    for (const component of NBA_PLAYER_PROP_COMPONENTS) {
      const spec = COMPONENT_SPEC[component];
      const target = row[spec.target];
      if (target === null) return [];
      residual[component] = target - clampNonnegative(predictRate(row, componentModels[component]) * minutes);
    }
    return [residual];
  });

  return {
    release: NBA_PLAYER_PROPS_INDEPENDENT_RESEARCH_RELEASE,
    mode: "offline_research_only",
    actionable: false,
    trainedThrough: ordered.at(-1)!.feature_cutoff,
    trainingRows: train.length,
    validationRows: validate.length,
    minuteWeights,
    participationPrior,
    participationPriorStrength,
    componentModels,
    validationResiduals,
    validationMetrics: {
      minutesMae: meanAbsolute(validate
        .filter((row) => (row.target_minutes ?? 0) > 0)
        .map((row) => predictMinutes(row, minuteWeights) - row.target_minutes!)),
      componentMae: validationMetrics,
    },
  };
}

export function projectNbaPlayerPropsIndependent(
  row: NbaPlayerPropFeatureRow,
  model: NbaPlayerPropsIndependentResearchModel,
): NbaPlayerPropsIndependentProjection {
  const conditionalMinutes = predictMinutes(row, model.minuteWeights);
  const participationProbability = predictParticipation(row, model.participationPrior, model.participationPriorStrength);
  const components = Object.fromEntries(NBA_PLAYER_PROP_COMPONENTS.map((component) => [
    component,
    round(clampNonnegative(predictRate(row, model.componentModels[component]) * conditionalMinutes), 3),
  ])) as Record<NbaPlayerPropComponent, number>;
  const combinations = combine(components);
  const health: string[] = [];
  if (row.player_games_prior < 3) health.push("limited_player_history");
  if (row.changed_team_since_last_game === 1) health.push("team_change_requires_role_confirmation");
  if (participationProbability < 0.8) health.push("participation_uncertain");
  if (model.validationResiduals.length < 25) health.push("insufficient_out_of_sample_residuals");
  return {
    release: model.release,
    mode: "offline_research_only",
    actionable: false,
    gameId: row.game_id,
    playerId: row.player_id,
    participationProbability: round(participationProbability, 4),
    conditionalMinutes: round(conditionalMinutes, 3),
    components,
    combinations,
    health,
  };
}

/** Empirical joint-residual probability; combinations keep observed P/R/A/3PM dependence. */
export function nbaPlayerPropsProbabilityOver(args: {
  projection: NbaPlayerPropsIndependentProjection;
  model: NbaPlayerPropsIndependentResearchModel;
  market: NbaPlayerPropCombination;
  line: number;
}): number | null {
  if (args.model.validationResiduals.length < 25) return null;
  const components = combinationComponents(args.market);
  const center = args.projection.combinations[args.market];
  let over = 0;
  for (const residual of args.model.validationResiduals) {
    const outcome = center + components.reduce((sum, component) => sum + residual[component], 0);
    if (outcome > args.line) over += 1;
  }
  return round((over + 0.5) / (args.model.validationResiduals.length + 1), 6);
}

function selectMinuteWeights(validate: NbaPlayerPropFeatureRow[]): MinuteWeights {
  const candidates = validate.filter((row) => (row.target_minutes ?? 0) > 0);
  if (candidates.length === 0) return MINUTE_CANDIDATES[1]!;
  return [...MINUTE_CANDIDATES].sort((left, right) => minuteMae(candidates, left) - minuteMae(candidates, right))[0]!;
}

function selectParticipationStrength(validate: NbaPlayerPropFeatureRow[], prior: number): number {
  if (validate.length === 0) return 5;
  return [...PARTICIPATION_PRIOR_STRENGTHS].sort((left, right) =>
    brier(validate, prior, left) - brier(validate, prior, right))[0]!;
}

function selectRidgeLambda(
  train: NbaPlayerPropFeatureRow[],
  validate: NbaPlayerPropFeatureRow[],
  spec: { target: TargetKey; features: NumericFeature[] },
  minuteWeights: MinuteWeights,
): number {
  const appearances = train.filter((row) => (row.target_minutes ?? 0) > 0 && row[spec.target] !== null);
  if (appearances.length < spec.features.length + 2) return 20;
  return [...RIDGE_LAMBDAS].sort((left, right) => {
    const leftModel = fitStandardizedRidge(appearances, spec, left);
    const rightModel = fitStandardizedRidge(appearances, spec, right);
    return (componentMae(validate, leftModel, spec, minuteWeights) ?? Infinity)
      - (componentMae(validate, rightModel, spec, minuteWeights) ?? Infinity);
  })[0]!;
}

function fitStandardizedRidge(
  rows: NbaPlayerPropFeatureRow[],
  spec: { target: TargetKey; features: NumericFeature[] },
  lambda: number,
): StandardizedRidge {
  const usable = rows.filter((row) => (row.target_minutes ?? 0) > 0 && row[spec.target] !== null);
  const means = spec.features.map((feature) => mean(nonNull(usable.map((row) => row[feature]))) ?? 0);
  const scales = spec.features.map((feature, index) => standardDeviation(nonNull(usable.map((row) => row[feature]))) || Math.max(Math.abs(means[index]!), 1));
  const x = usable.map((row) => [1, ...spec.features.map((feature, index) => ((row[feature] ?? means[index]!) - means[index]!) / scales[index]!)]);
  const y = usable.map((row) => row[spec.target]! / row.target_minutes!);
  const coefficients = ridgeSolve(x, y, lambda);
  return { features: spec.features, means, scales, coefficients, lambda };
}

function ridgeSolve(x: number[][], y: number[], lambda: number): number[] {
  const width = x[0]?.length ?? 1;
  const matrix = Array.from({ length: width }, (_, row) => Array.from({ length: width + 1 }, (_, column) => {
    if (column === width) return x.reduce((sum, values, index) => sum + values[row]! * y[index]!, 0);
    const ridge = row === column && row > 0 ? lambda : 0;
    return x.reduce((sum, values) => sum + values[row]! * values[column]!, ridge);
  }));
  for (let pivot = 0; pivot < width; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < width; row += 1) if (Math.abs(matrix[row]![pivot]!) > Math.abs(matrix[best]![pivot]!)) best = row;
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

function predictRate(row: NbaPlayerPropFeatureRow, model: StandardizedRidge): number {
  let value = model.coefficients[0] ?? 0;
  model.features.forEach((feature, index) => {
    value += (model.coefficients[index + 1] ?? 0) * (((row[feature] ?? model.means[index]!) - model.means[index]!) / model.scales[index]!);
  });
  return clampNonnegative(value);
}

function predictMinutes(row: NbaPlayerPropFeatureRow, weights: MinuteWeights): number {
  const entries: Array<[number | null, number]> = [
    [row.minutes_mean_3, weights.recent3],
    [row.minutes_mean_5, weights.recent5],
    [row.minutes_mean_10, weights.recent10],
    [row.minutes_mean_season, weights.season],
  ];
  const available = entries.filter((entry): entry is [number, number] => entry[0] !== null && Number.isFinite(entry[0]) && entry[1] > 0);
  const denominator = available.reduce((sum, [, weight]) => sum + weight, 0);
  return denominator > 0 ? Math.min(48, Math.max(0, available.reduce((sum, [value, weight]) => sum + value * weight, 0) / denominator)) : 0;
}

function predictParticipation(row: NbaPlayerPropFeatureRow, prior: number, strength: number): number {
  const sample = Math.min(10, row.team_games_prior);
  const observed = row.participation_rate_10 ?? prior;
  return clamp01((observed * sample + prior * strength) / (sample + strength));
}

function componentMae(
  rows: NbaPlayerPropFeatureRow[],
  model: StandardizedRidge,
  spec: { target: TargetKey },
  minuteWeights: MinuteWeights,
): number | null {
  return meanAbsolute(rows
    .filter((row) => (row.target_minutes ?? 0) > 0 && row[spec.target] !== null)
    .map((row) => predictRate(row, model) * predictMinutes(row, minuteWeights) - row[spec.target]!));
}

function minuteMae(rows: NbaPlayerPropFeatureRow[], weights: MinuteWeights): number {
  return meanAbsolute(rows.map((row) => predictMinutes(row, weights) - row.target_minutes!)) ?? Infinity;
}

function brier(rows: NbaPlayerPropFeatureRow[], prior: number, strength: number): number {
  return mean(rows.map((row) => (predictParticipation(row, prior, strength) - Number((row.target_minutes ?? 0) > 0)) ** 2)) ?? Infinity;
}

function combine(values: Record<NbaPlayerPropComponent, number>): Record<NbaPlayerPropCombination, number> {
  return {
    ...values,
    points_rebounds_assists: round(values.points + values.rebounds + values.assists, 3),
    points_rebounds: round(values.points + values.rebounds, 3),
    points_assists: round(values.points + values.assists, 3),
    rebounds_assists: round(values.rebounds + values.assists, 3),
  };
}

function combinationComponents(market: NbaPlayerPropCombination): NbaPlayerPropComponent[] {
  if (NBA_PLAYER_PROP_COMPONENTS.includes(market as NbaPlayerPropComponent)) return [market as NbaPlayerPropComponent];
  if (market === "points_rebounds_assists") return ["points", "rebounds", "assists"];
  if (market === "points_rebounds") return ["points", "rebounds"];
  if (market === "points_assists") return ["points", "assists"];
  return ["rebounds", "assists"];
}

function meanAbsolute(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length : null;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  if (average === null || values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function nonNull(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }
function clampNonnegative(value: number): number { return Math.max(0, Number.isFinite(value) ? value : 0); }
function round(value: number, digits: number): number { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
