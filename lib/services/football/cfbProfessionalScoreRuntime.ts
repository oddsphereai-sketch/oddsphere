import baseArtifactJson from "./modelArtifacts/cfbProfessionalScoreArtifact.json";
import weeklyArtifactJson from "./modelArtifacts/cfbProfessionalScoreWeeklyArtifact.json";
import legacyArtifactJson from "./modelArtifacts/cfbV1JointScoreArtifact.json";
import type { NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbCurrentAdvancedGame, CfbCurrentAdvancedMetrics } from "./cfbCurrentAdvancedState";
import type { CfbV1Forecast } from "./cfbV1Decision";

export const CFB_V1_WEEKLY_RUNTIME_RELEASE =
  "cfb_professional_weekly_runtime_2026_10_01_r7_compact48" as const;
export const CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE =
  "cfb_professional_joint_score_artifact_2026_10_01_r7_compact48" as const;
export const CFB_V1_DIRECTIONAL_ALIGNMENT_RELEASE =
  "cfb_professional_directional_joint_pmf_alignment_2026_10_01_r7_compact48" as const;
export const CFB_PROFESSIONAL_SCORE_RUNTIME_RELEASE =
  "cfb_professional_independent_score_model_2026_10_01_r7_compact48" as const;

type NullableNumber = number | null;
type TeamProfile = {
  displayName: string;
  elo: number;
  lastPlayedAt: string | null;
  priorGames: number;
  rolling: Record<string, NullableNumber>;
  defenseRolling: Record<string, NullableNumber>;
  personnel: Record<string, NullableNumber>;
};
type LinearPipeline = {
  kind: "linear_regressor";
  inputFeatures: string[];
  imputerStatistics: NullableNumber[];
  missingIndicatorFeatureIndexes: number[];
  scalerMean: number[];
  scalerScale: number[];
  coefficients: number[];
  intercept: number;
};
type CompactTreeNode = [value: number, featureIndex: number, threshold: number, missingGoToLeft: 0 | 1, left: number, right: number, isLeaf: 0 | 1];
type ImputedModel = {
  inputFeatures: string[];
  imputerStatistics: NullableNumber[];
  missingIndicatorFeatureIndexes: number[];
};
type ForestPipeline = ImputedModel & {
  kind: "extra_trees_regressor";
  trees: Array<{ nodes: CompactTreeNode[] }>;
};
type HgbPipeline = ImputedModel & {
  kind: "hgb_regressor";
  baseline: number;
  trees: Array<Array<{ nodes: CompactTreeNode[] }>>;
};
type BaseArtifact = {
  artifactRelease: string;
  modelRelease: string;
  domain: { weeklyActivationThreshold: number; correctionStrength: number };
  models: {
    sharedScore: LinearPipeline;
    directMargin: ForestPipeline;
    domainTotalHist: HgbPipeline;
    domainTotalForest: ForestPipeline;
  };
  weights: { sharedMargin: number; directMargin: number };
  residualSample: Array<[number, number]>;
  forecasts: CfbV1Forecast[];
};
type WeeklyArtifact = {
  artifactRelease: string;
  baseArtifactRelease: string;
  modelRelease: string;
  season: number;
  globalMeans: Record<string, number>;
  currentSeasonPriorGames: number;
  teamProfiles: Record<string, TeamProfile>;
};
type MutableTeamState = {
  profile: TeamProfile;
  sourceMatched: boolean;
  elo: number;
  lastPlayedAt: string | null;
  currentGames: number;
  sums: Record<string, number>;
  counts: Record<string, number>;
  defenseSums: Record<string, number>;
  defenseCounts: Record<string, number>;
};

export type CfbV1WeeklyForecastResult = {
  forecast: CfbV1Forecast;
  featureHealth: {
    awayProfile: "matched" | "neutral_imputation";
    homeProfile: "matched" | "neutral_imputation";
    completedGamesApplied: number;
  };
};

export type CfbV1WeeklyProfileCoverage = {
  awayProfile: "matched" | "neutral_imputation";
  homeProfile: "matched" | "neutral_imputation";
  supported: boolean;
};

const baseArtifact = baseArtifactJson as unknown as BaseArtifact;
const weeklyArtifact = weeklyArtifactJson as unknown as WeeklyArtifact;
const legacyArtifact = legacyArtifactJson as unknown as { forecasts: CfbV1Forecast[] };
const FOOTBALL_SCORE_SUPPORT = [
  0, 2, 3, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76,
  77, 78, 79, 80,
] as const;

assertRuntimeArtifact();

export function getCfbProfessionalScoreForecast(args: {
  game: NcaafGame;
  completedGames?: NcaafGame[];
  advancedGames?: CfbCurrentAdvancedGame[];
}): CfbV1WeeklyForecastResult {
  const frozen = legacyArtifact.forecasts.find((forecast) => forecast.providerGameId === args.game.providerGameId);
  if (frozen) {
    return {
      forecast: cloneForecast(frozen),
      featureHealth: { awayProfile: "matched", homeProfile: "matched", completedGamesApplied: 0 },
    };
  }
  return getCfbProfessionalScoreForecasts({
    games: [args.game],
    completedGames: args.completedGames,
    advancedGames: args.advancedGames,
  }).get(args.game.providerGameId)!;
}

export function getCfbProfessionalScoreForecasts(args: {
  games: NcaafGame[];
  completedGames?: NcaafGame[];
  advancedGames?: CfbCurrentAdvancedGame[];
}): Map<string, CfbV1WeeklyForecastResult> {
  if (args.games.length === 0) return new Map();
  const groups = new Map<string, NcaafGame[]>();
  for (const game of args.games) {
    const key = `${game.season}:${game.providerWeek}`;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  if (groups.size > 1) {
    const output = new Map<string, CfbV1WeeklyForecastResult>();
    for (const games of groups.values()) {
      for (const [gameId, forecast] of getCfbProfessionalScoreForecasts({ ...args, games })) output.set(gameId, forecast);
    }
    return output;
  }
  const season = args.games[0]!.season;
  const week = args.games[0]!.providerWeek;
  if (args.games.some((game) => game.season !== season || game.providerWeek !== week)) {
    throw new Error("CFB professional score batch must contain one season and week.");
  }
  if (season !== weeklyArtifact.season) {
    throw new Error(`CFB weekly runtime supports season ${weeklyArtifact.season}, not ${season}.`);
  }
  const advanced = (args.advancedGames ?? [])
    .filter((game) => game.season === season)
    .sort(compareObservation);
  const advancedKeys = new Set(advanced.map(observationKey));
  const scoreOnly = (args.completedGames ?? [])
    .filter((game) => game.season === season && game.homeScore !== null && game.awayScore !== null)
    .filter((game) => !advancedKeys.has(observationKey(game)))
    .map(toScoreOnlyObservation);
  const observations = [...advanced, ...scoreOnly].sort(compareObservation);
  const raw = args.games.map((game) => {
    const states = initialStates();
    const completed = observations.filter((row) => Date.parse(row.scheduledStart) < Date.parse(game.scheduledStart));
    for (const row of completed) applyCompletedGame(states, row);
    return { ...rawSelectedPrediction(states, game), completedGamesApplied: completed.length };
  });
  const disagreement = mean(raw.map((row) => row.robustDomainTotal - row.sharedTotal));
  const domainCorrection = Math.abs(disagreement) >= baseArtifact.domain.weeklyActivationThreshold
    ? disagreement * baseArtifact.domain.correctionStrength
    : 0;
  return new Map(args.games.map((game, index) => {
    const row = raw[index]!;
    const total = row.sharedTotal + domainCorrection;
    const rawHome = (total + row.margin) / 2;
    const rawAway = (total - row.margin) / 2;
    return [game.providerGameId, {
      forecast: distributionForecast(game, rawHome, rawAway),
      featureHealth: {
        awayProfile: row.awayMatched ? "matched" : "neutral_imputation",
        homeProfile: row.homeMatched ? "matched" : "neutral_imputation",
        completedGamesApplied: row.completedGamesApplied,
      },
    }];
  }));
}

export function getFrozenCfbV1Forecasts(): CfbV1Forecast[] {
  return legacyArtifact.forecasts.map(cloneForecast);
}

export function cfbV1WeeklyGameProfileCoverage(game: NcaafGame): CfbV1WeeklyProfileCoverage {
  const awayProfile = profileForName(game.away.name) === null ? "neutral_imputation" : "matched";
  const homeProfile = profileForName(game.home.name) === null ? "neutral_imputation" : "matched";
  return { awayProfile, homeProfile, supported: awayProfile === "matched" && homeProfile === "matched" };
}

function initialStates(): Map<string, MutableTeamState> {
  return new Map(Object.entries(weeklyArtifact.teamProfiles).map(([name, profile]) => [name, {
    profile,
    sourceMatched: true,
    elo: profile.elo,
    lastPlayedAt: profile.lastPlayedAt,
    currentGames: 0,
    sums: {},
    counts: {},
    defenseSums: {},
    defenseCounts: {},
  }]));
}

function resolveState(states: Map<string, MutableTeamState>, name: string): { state: MutableTeamState; matched: boolean } {
  const exact = states.get(normalizeName(name));
  if (exact) return { state: exact, matched: exact.sourceMatched };
  const folded = foldName(name);
  const matches = [...states.entries()].filter(([candidate]) => foldName(candidate) === folded);
  if (matches.length === 1) return { state: matches[0]![1], matched: matches[0]![1].sourceMatched };
  if (matches.length > 1) throw new Error(`CFB team identity is ambiguous for ${name}.`);
  const neutral: TeamProfile = {
    displayName: name,
    elo: 1500,
    lastPlayedAt: null,
    priorGames: 0,
    rolling: Object.fromEntries(Object.keys(weeklyArtifact.globalMeans).map((key) => [key, weeklyArtifact.globalMeans[key]!])),
    defenseRolling: Object.fromEntries(Object.keys(weeklyArtifact.globalMeans).map((key) => [key, 0])),
    personnel: { roster_continuity: null, roster_experience: null, returning_qb: null },
  };
  const state = { profile: neutral, sourceMatched: false, elo: 1500, lastPlayedAt: null, currentGames: 0, sums: {}, counts: {}, defenseSums: {}, defenseCounts: {} };
  states.set(normalizeName(name), state);
  return { state, matched: false };
}

function profileForName(name: string): TeamProfile | null {
  const exact = weeklyArtifact.teamProfiles[normalizeName(name)];
  if (exact) return exact;
  const folded = foldName(name);
  const matches = Object.entries(weeklyArtifact.teamProfiles).filter(([candidate]) => foldName(candidate) === folded);
  if (matches.length === 1) return matches[0]![1];
  if (matches.length > 1) throw new Error(`CFB team identity is ambiguous for ${name}.`);
  return null;
}

type ForecastGame = {
  scheduledStart: string;
  neutralSite?: boolean;
  away: { name: string };
  home: { name: string };
};

function matchupFeatures(args: { game: ForecastGame; away: MutableTeamState; home: MutableTeamState }): Record<string, NullableNumber> {
  const neutral = args.game.neutralSite === true;
  const homeRest = restDays(args.home.lastPlayedAt, args.game.scheduledStart);
  const awayRest = restDays(args.away.lastPlayedAt, args.game.scheduledStart);
  const output: Record<string, NullableNumber> = {
    neutral: neutral ? 1 : 0,
    home_field: neutral ? 0 : 1,
    elo_diff: args.home.elo - args.away.elo + (neutral ? 0 : 55),
    elo_sum_strength: args.home.elo + args.away.elo - 3000,
    rest_diff: clamp(homeRest - awayRest, -14, 14),
    home_prior_games: args.home.profile.priorGames,
    away_prior_games: args.away.profile.priorGames,
    home_current_games: args.home.currentGames,
    away_current_games: args.away.currentGames,
  };
  for (const key of Object.keys(weeklyArtifact.globalMeans)) {
    const home = blendedValue(args.home, key);
    const away = blendedValue(args.away, key);
    output[`home_${key}`] = home;
    output[`away_${key}`] = away;
    output[`${key}_diff`] = home - away;
    output[`${key}_sum`] = home + away;
    const homeMatchup = home + blendedDefenseValue(args.away, key);
    const awayMatchup = away + blendedDefenseValue(args.home, key);
    output[`matchup_${key}_diff`] = homeMatchup - awayMatchup;
    output[`matchup_${key}_sum`] = homeMatchup + awayMatchup;
  }
  for (const key of ["roster_continuity", "roster_experience", "returning_qb"] as const) {
    const home = args.home.profile.personnel[key];
    const away = args.away.profile.personnel[key];
    output[`${key}_diff`] = home === null || away === null ? null : home - away;
    output[`${key}_sum`] = home === null || away === null ? null : home + away;
  }
  return output;
}

function rawSelectedPrediction(states: Map<string, MutableTeamState>, game: NcaafGame): {
  margin: number;
  sharedTotal: number;
  robustDomainTotal: number;
  awayMatched: boolean;
  homeMatched: boolean;
} {
  const away = resolveState(states, game.away.name);
  const home = resolveState(states, game.home.name);
  const gameFeatures = matchupFeatures({ game, away: away.state, home: home.state });
  const sharedHome = predictModel(baseArtifact.models.sharedScore, symmetricTeamFeatures(gameFeatures, true));
  const sharedAway = predictModel(baseArtifact.models.sharedScore, symmetricTeamFeatures(gameFeatures, false));
  const directMargin = predictModel(baseArtifact.models.directMargin, directGameFeatures(gameFeatures, "margin"));
  const domainTotalHist = predictModel(baseArtifact.models.domainTotalHist, directGameFeatures(gameFeatures, "total"));
  const domainTotalForest = predictModel(baseArtifact.models.domainTotalForest, directGameFeatures(gameFeatures, "total"));
  return {
    margin: baseArtifact.weights.sharedMargin * (sharedHome - sharedAway) + baseArtifact.weights.directMargin * directMargin,
    sharedTotal: sharedHome + sharedAway,
    robustDomainTotal: 0.5 * (domainTotalHist + domainTotalForest),
    awayMatched: away.matched,
    homeMatched: home.matched,
  };
}

function symmetricTeamFeatures(game: Record<string, NullableNumber>, home: boolean): Record<string, NullableNumber> {
  const side = home ? "home" : "away";
  const opponent = home ? "away" : "home";
  const sign = home ? 1 : -1;
  const output: Record<string, NullableNumber> = {
    venue_side: value(game.home_field) * sign,
    neutral: game.neutral ?? null,
    elo_advantage: value(game.elo_diff) * sign,
    rest_advantage: value(game.rest_diff) * sign,
    team_prior_games: game[`${side}_prior_games`] ?? null,
    opponent_prior_games: game[`${opponent}_prior_games`] ?? null,
    team_current_games: game[`${side}_current_games`] ?? null,
    opponent_current_games: game[`${opponent}_current_games`] ?? null,
  };
  for (const key of Object.keys(weeklyArtifact.globalMeans)) {
    const team = game[`${side}_${key}`] ?? null;
    const opposing = game[`${opponent}_${key}`] ?? null;
    const matchup = 0.5 * (value(game[`matchup_${key}_sum`]) + sign * value(game[`matchup_${key}_diff`]));
    output[`team_${key}`] = team;
    output[`opponent_${key}`] = opposing;
    output[`opponent_defense_${key}`] = team === null ? null : matchup - team;
    output[`matchup_${key}`] = matchup;
  }
  for (const key of ["roster_continuity", "roster_experience", "returning_qb"] as const) {
    const total = game[`${key}_sum`];
    const difference = game[`${key}_diff`];
    output[`team_${key}`] = total === null || total === undefined || difference === null || difference === undefined
      ? null : 0.5 * (total + sign * difference);
    output[`opponent_${key}`] = total === null || total === undefined || difference === null || difference === undefined
      ? null : 0.5 * (total - sign * difference);
  }
  output.pass_qb_matchup = value(output.matchup_pass_epa) + value(output.matchup_qb_epa);
  output.rush_trench_matchup = value(output.matchup_rush_epa) + value(output.matchup_line_yards) - value(output.matchup_stuff_rate);
  output.scoring_opportunity_matchup = value(output.matchup_drives) + value(output.matchup_field_position) + value(output.matchup_red_zone_success);
  return output;
}

function directGameFeatures(game: Record<string, NullableNumber>, target: "margin" | "total"): Record<string, NullableNumber> {
  const suffix = target === "margin" ? "diff" : "sum";
  const output: Record<string, NullableNumber> = {
    neutral: game.neutral ?? null,
    home_field: game.home_field ?? null,
    elo: game[target === "margin" ? "elo_diff" : "elo_sum_strength"] ?? null,
    rest: target === "margin" ? game.rest_diff ?? null : Math.abs(value(game.rest_diff)),
    home_prior_games: game.home_prior_games ?? null,
    away_prior_games: game.away_prior_games ?? null,
    home_current_games: game.home_current_games ?? null,
    away_current_games: game.away_current_games ?? null,
  };
  for (const key of Object.keys(weeklyArtifact.globalMeans)) {
    output[`matchup_${key}_${suffix}`] = game[`matchup_${key}_${suffix}`] ?? null;
    output[`raw_${key}_${suffix}`] = game[`${key}_${suffix}`] ?? null;
  }
  for (const key of ["roster_continuity", "roster_experience", "returning_qb"] as const) {
    output[`${key}_${suffix}`] = game[`${key}_${suffix}`] ?? null;
  }
  output[`pass_qb_matchup_${suffix}`] = value(output[`matchup_pass_epa_${suffix}`]) + value(output[`matchup_qb_epa_${suffix}`]);
  output[`rush_trench_matchup_${suffix}`] = value(output[`matchup_rush_epa_${suffix}`]) + value(output[`matchup_line_yards_${suffix}`]) - value(output[`matchup_stuff_rate_${suffix}`]);
  return output;
}

function blendedValue(state: MutableTeamState, key: string): number {
  const prior = state.profile.rolling[key] ?? weeklyArtifact.globalMeans[key] ?? 0;
  if (state.currentGames === 0 || !state.counts[key]) return prior;
  const current = state.sums[key]! / state.counts[key]!;
  const weight = state.currentGames / (state.currentGames + weeklyArtifact.currentSeasonPriorGames);
  return weight * current + (1 - weight) * prior;
}

function blendedDefenseValue(state: MutableTeamState, key: string): number {
  const prior = state.profile.defenseRolling[key] ?? 0;
  if (state.currentGames === 0 || !state.defenseCounts[key]) return prior;
  const current = state.defenseSums[key]! / state.defenseCounts[key]!;
  const weight = state.currentGames / (state.currentGames + weeklyArtifact.currentSeasonPriorGames);
  return weight * current + (1 - weight) * prior;
}

type CompletedObservation = {
  sourceGameId: string;
  season: number;
  week: number;
  scheduledStart: string;
  neutralSite: boolean;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeMetrics: CfbCurrentAdvancedMetrics;
  awayMetrics: CfbCurrentAdvancedMetrics;
};

function applyCompletedGame(states: Map<string, MutableTeamState>, game: CompletedObservation): void {
  const home = resolveState(states, game.homeTeam).state;
  const away = resolveState(states, game.awayTeam).state;
  const homeOffense = Object.fromEntries(Object.keys(weeklyArtifact.globalMeans).map((key) => [key, blendedValue(home, key)]));
  const awayOffense = Object.fromEntries(Object.keys(weeklyArtifact.globalMeans).map((key) => [key, blendedValue(away, key)]));
  const homeScore = game.homeScore;
  const awayScore = game.awayScore;
  const homeMetrics = { ...game.homeMetrics, points_for: homeScore, points_against: awayScore, margin: homeScore - awayScore, total: homeScore + awayScore };
  const awayMetrics = { ...game.awayMetrics, points_for: awayScore, points_against: homeScore, margin: awayScore - homeScore, total: homeScore + awayScore };
  observe(home, homeMetrics);
  observe(away, awayMetrics);
  observeDefense(home, awayMetrics, awayOffense);
  observeDefense(away, homeMetrics, homeOffense);
  const expected = 1 / (1 + 10 ** (-(home.elo - away.elo + (game.neutralSite === true ? 0 : 55)) / 400));
  const outcome = homeScore > awayScore ? 1 : homeScore === awayScore ? 0.5 : 0;
  const margin = homeScore - awayScore;
  const multiplier = Math.log1p(Math.abs(margin)) * (2.2 / ((home.elo - away.elo) * 0.001 + 2.2));
  const delta = 24 * multiplier * (outcome - expected);
  home.elo += delta;
  away.elo -= delta;
  home.lastPlayedAt = game.scheduledStart;
  away.lastPlayedAt = game.scheduledStart;
}

function observe(state: MutableTeamState, metrics: Record<string, number | null>): void {
  state.currentGames += 1;
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      state.sums[key] = (state.sums[key] ?? 0) + value;
      state.counts[key] = (state.counts[key] ?? 0) + 1;
    }
  }
}

function toScoreOnlyObservation(game: NcaafGame): CompletedObservation {
  return {
    sourceGameId: game.providerGameId,
    season: game.season,
    week: game.providerWeek,
    scheduledStart: game.scheduledStart,
    neutralSite: game.neutralSite === true,
    homeTeam: game.home.name,
    awayTeam: game.away.name,
    homeScore: game.homeScore!,
    awayScore: game.awayScore!,
    homeMetrics: {},
    awayMetrics: {},
  };
}

function observationKey(game: CfbCurrentAdvancedGame | NcaafGame): string {
  const home = "homeTeam" in game ? game.homeTeam : game.home.name;
  const away = "awayTeam" in game ? game.awayTeam : game.away.name;
  return `${game.scheduledStart.slice(0, 10)}:${foldName(away)}:${foldName(home)}`;
}

function compareObservation(first: CompletedObservation, second: CompletedObservation): number {
  return Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) || first.sourceGameId.localeCompare(second.sourceGameId);
}

function observeDefense(state: MutableTeamState, opponentMetrics: CfbCurrentAdvancedMetrics, opponentExpectation: Record<string, number>): void {
  for (const key of Object.keys(weeklyArtifact.globalMeans)) {
    const value = opponentMetrics[key];
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      state.defenseSums[key] = (state.defenseSums[key] ?? 0) + value - opponentExpectation[key]!;
      state.defenseCounts[key] = (state.defenseCounts[key] ?? 0) + 1;
    }
  }
}

function transformedInputs(pipeline: ImputedModel, features: Record<string, NullableNumber>): number[] {
  if (pipeline.inputFeatures.length !== pipeline.imputerStatistics.length) throw new Error("CFB pipeline imputer shape is invalid.");
  const missing = pipeline.inputFeatures.map((name) => features[name] === null || features[name] === undefined || !Number.isFinite(features[name]));
  const values = pipeline.inputFeatures.map((name, index) => missing[index] ? pipeline.imputerStatistics[index] : features[name]);
  if (values.some((value) => value === null || !Number.isFinite(value))) throw new Error("CFB pipeline cannot impute a required feature.");
  return [
    ...(values as number[]),
    ...pipeline.missingIndicatorFeatureIndexes.map((index) => missing[index] ? 1 : 0),
  ];
}

function predictModel(pipeline: LinearPipeline | ForestPipeline | HgbPipeline, features: Record<string, NullableNumber>): number {
  const transformed = transformedInputs(pipeline, features);
  if (pipeline.kind === "extra_trees_regressor") {
    return mean(pipeline.trees.map((tree) => predictTree(tree.nodes, transformed)));
  }
  if (pipeline.kind === "hgb_regressor") {
    return pipeline.trees.reduce((sum, iteration) => sum + iteration.reduce((value, tree) => value + predictTree(tree.nodes, transformed), 0), pipeline.baseline);
  }
  if (transformed.length !== pipeline.coefficients.length || transformed.length !== pipeline.scalerMean.length || transformed.length !== pipeline.scalerScale.length) {
    throw new Error("CFB pipeline transformed feature shape is invalid.");
  }
  return transformed.reduce((sum, value, index) => {
    const scale = pipeline.scalerScale[index]!;
    const standardized = scale === 0 ? 0 : (value - pipeline.scalerMean[index]!) / scale;
    return sum + standardized * pipeline.coefficients[index]!;
  }, pipeline.intercept);
}

function predictTree(nodes: CompactTreeNode[], inputs: number[]): number {
  let index = 0;
  while (true) {
    const node = nodes[index];
    if (!node) throw new Error("CFB runtime tree node is missing.");
    if (node[6]) return node[0];
    const input = inputs[node[1]];
    index = input === undefined || !Number.isFinite(input)
      ? (node[3] ? node[4] : node[5])
      : (input <= node[2] ? node[4] : node[5]);
  }
}

function distributionForecast(game: NcaafGame, rawHome: number, rawAway: number): CfbV1Forecast {
  const initial = quantizedDistribution(rawHome, rawAway);
  const initialExpectedMargin = mean(initial.homes.map((home, index) => home - initial.aways[index]!));
  const initialHomeWinProbability = winProbability(initial.homes, initial.aways);
  const targetDirection =
    direction(initialHomeWinProbability - 0.5) ||
    direction(initialExpectedMargin) ||
    direction(rawHome - rawAway) ||
    1;
  const initialMeanDirection = direction(initialExpectedMargin);
  const initialWinDirection = direction(initialHomeWinProbability - 0.5);
  let distribution = initial;
  let targetHome = rawHome;
  let targetAway = rawAway;
  let alignment: CfbV1Forecast["directionalAlignment"];

  if (initialMeanDirection !== targetDirection || initialWinDirection !== targetDirection) {
    const step = 0.025;
    const maximum = 1;
    let resolved: { distribution: ReturnType<typeof quantizedDistribution>; points: number } | null = null;
    for (let points = step; points <= maximum + 1e-12; points += step) {
      const candidate = quantizedDistribution(
        rawHome + targetDirection * points,
        rawAway - targetDirection * points,
      );
      const candidateMargins = candidate.homes.map((home, index) => home - candidate.aways[index]!);
      if (
        direction(mean(candidateMargins)) === targetDirection &&
        direction(winProbability(candidate.homes, candidate.aways) - 0.5) === targetDirection
      ) {
        resolved = { distribution: candidate, points: +points.toFixed(3) };
        break;
      }
    }
    if (!resolved) {
      throw new Error("CFB dynamic joint PMF cannot align score and winner direction inside the one-point symmetric correction bound.");
    }
    distribution = resolved.distribution;
    targetHome += targetDirection * resolved.points;
    targetAway -= targetDirection * resolved.points;
    alignment = {
      release: CFB_V1_DIRECTIONAL_ALIGNMENT_RELEASE,
      target: targetDirection > 0 ? "home" : "away",
      symmetricPoints: resolved.points,
      reason: initialMeanDirection === 0 || initialWinDirection === 0
        ? "exact_direction_tie"
        : "mean_probability_direction_cross",
    };
  }

  const counts = new Map<string, { home: number; away: number; count: number }>();
  const homes = distribution.homes;
  const aways = distribution.aways;
  for (let index = 0; index < homes.length; index += 1) {
    const home = homes[index]!;
    const away = aways[index]!;
    const key = `${home}:${away}`;
    const current = counts.get(key);
    counts.set(key, current ? { ...current, count: current.count + 1 } : { home, away, count: 1 });
  }
  if (homes.length === 0) throw new Error("CFB empirical residual distribution is empty.");
  const basePmf = [...counts.values()].sort((a, b) => a.home - b.home || a.away - b.away).map((cell) => ({ home: cell.home, away: cell.away, probability: cell.count / homes.length }));
  const pmf = tiltPmfToTeamMeans(basePmf, targetHome, targetAway);
  const expectedHome = pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  const expectedAway = pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const expectedMargin = expectedHome - expectedAway;
  const expectedTotal = expectedHome + expectedAway;
  const homeWinProbability = pmf.reduce((sum, cell) => sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0), 0);
  const representativePool = pmf.filter((cell) => homeWinProbability > 0.5 ? cell.home > cell.away : homeWinProbability < 0.5 ? cell.home < cell.away : true);
  const representative = representativePool.sort((first, second) => representativeDistance(first, expectedHome, expectedAway, expectedMargin, expectedTotal) - representativeDistance(second, expectedHome, expectedAway, expectedMargin, expectedTotal) || second.probability - first.probability)[0]!;
  return {
    providerGameId: game.providerGameId,
    awayTeam: game.away.abbreviation,
    homeTeam: game.home.abbreviation,
    gameStartsAt: game.scheduledStart,
    expectedAwayPoints: expectedAway,
    expectedHomePoints: expectedHome,
    expectedMarginHome: expectedMargin,
    expectedTotal,
    homeWinProbability,
    representativeScore: { away: representative.away, home: representative.home },
    interval80: {
      away: [weightedQuantile(pmf, (cell) => cell.away, 0.1), weightedQuantile(pmf, (cell) => cell.away, 0.9)],
      home: [weightedQuantile(pmf, (cell) => cell.home, 0.1), weightedQuantile(pmf, (cell) => cell.home, 0.9)],
      marginHome: [weightedQuantile(pmf, (cell) => cell.home - cell.away, 0.1), weightedQuantile(pmf, (cell) => cell.home - cell.away, 0.9)],
      total: [weightedQuantile(pmf, (cell) => cell.home + cell.away, 0.1), weightedQuantile(pmf, (cell) => cell.home + cell.away, 0.9)],
    },
    pmf,
    ...(alignment ? { directionalAlignment: alignment } : {}),
  };
}

function tiltPmfToTeamMeans(pmf: CfbV1Forecast["pmf"], targetHome: number, targetAway: number): CfbV1Forecast["pmf"] {
  let homeLambda = 0;
  let awayLambda = 0;
  let output = pmf;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const referenceHome = output.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
    const referenceAway = output.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
    const weighted = pmf.map((cell) => ({
      ...cell,
      weight: cell.probability * Math.exp(Math.max(-700, Math.min(700,
        homeLambda * (cell.home - referenceHome) + awayLambda * (cell.away - referenceAway)))),
    }));
    const mass = weighted.reduce((sum, cell) => sum + cell.weight, 0);
    output = weighted.map((cell) => ({ home: cell.home, away: cell.away, probability: cell.weight / mass }));
    const homeMean = output.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
    const awayMean = output.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
    const homeError = targetHome - homeMean;
    const awayError = targetAway - awayMean;
    if (Math.max(Math.abs(homeError), Math.abs(awayError)) < 1e-8) break;
    const homeVariance = output.reduce((sum, cell) => sum + (cell.home - homeMean) ** 2 * cell.probability, 0);
    const awayVariance = output.reduce((sum, cell) => sum + (cell.away - awayMean) ** 2 * cell.probability, 0);
    const covariance = output.reduce((sum, cell) => sum + (cell.home - homeMean) * (cell.away - awayMean) * cell.probability, 0);
    const determinant = homeVariance * awayVariance - covariance ** 2;
    if (!(determinant > 1e-9)) break;
    homeLambda += Math.max(-0.5, Math.min(0.5, (awayVariance * homeError - covariance * awayError) / determinant));
    awayLambda += Math.max(-0.5, Math.min(0.5, (homeVariance * awayError - covariance * homeError) / determinant));
  }
  return output;
}

function weightedQuantile(
  pmf: CfbV1Forecast["pmf"],
  value: (cell: CfbV1Forecast["pmf"][number]) => number,
  probability: number,
): number {
  const ordered = [...pmf].sort((first, second) => value(first) - value(second));
  let cumulative = 0;
  for (const cell of ordered) {
    cumulative += cell.probability;
    if (cumulative >= probability) return value(cell);
  }
  return value(ordered.at(-1)!);
}

function quantizedDistribution(rawHome: number, rawAway: number): { homes: number[]; aways: number[] } {
  const homes: number[] = [];
  const aways: number[] = [];
  for (const [homeResidual, awayResidual] of baseArtifact.residualSample) {
    homes.push(nearestScore(clamp(rawHome + homeResidual, 0, 90)));
    aways.push(nearestScore(clamp(rawAway + awayResidual, 0, 90)));
  }
  return { homes, aways };
}

function winProbability(homes: number[], aways: number[]): number {
  if (homes.length === 0 || homes.length !== aways.length) {
    throw new Error("CFB empirical residual distribution is empty or misaligned.");
  }
  const margins = homes.map((home, index) => home - aways[index]!);
  return (
    margins.filter((value) => value > 0).length +
    0.5 * margins.filter((value) => value === 0).length
  ) / margins.length;
}

function direction(value: number): -1 | 0 | 1 {
  if (Math.abs(value) <= 1e-12) return 0;
  return value > 0 ? 1 : -1;
}

function representativeDistance(cell: { home: number; away: number }, expectedHome: number, expectedAway: number, expectedMargin: number, expectedTotal: number): number {
  return (cell.home - expectedHome) ** 2 + (cell.away - expectedAway) ** 2 + ((cell.home - cell.away) - expectedMargin) ** 2 + ((cell.home + cell.away) - expectedTotal) ** 2;
}

function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function nearestScore(value: number): number {
  return FOOTBALL_SCORE_SUPPORT.reduce((best, score) => Math.abs(value - score) < Math.abs(value - best) ? score : best, FOOTBALL_SCORE_SUPPORT[0]);
}

function restDays(lastPlayedAt: string | null, startsAt: string): number {
  if (!lastPlayedAt) return 14;
  return (Date.parse(startsAt) - Date.parse(lastPlayedAt)) / 86_400_000;
}

function cloneForecast(forecast: CfbV1Forecast): CfbV1Forecast {
  return { ...forecast, representativeScore: { ...forecast.representativeScore }, interval80: { away: [...forecast.interval80.away], home: [...forecast.interval80.home], marginHome: [...forecast.interval80.marginHome], total: [...forecast.interval80.total] }, pmf: forecast.pmf.map((cell) => ({ ...cell })), ...(forecast.directionalAlignment ? { directionalAlignment: { ...forecast.directionalAlignment } } : {}) };
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll("'", "").replaceAll(".", "").trim().replace(/\s+/g, " ");
}

function foldName(value: string): string {
  return normalizeName(value).normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function value(input: NullableNumber | undefined): number { return input ?? 0; }
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }

function assertRuntimeArtifact(): void {
  if (weeklyArtifact.artifactRelease !== CFB_V1_WEEKLY_RUNTIME_RELEASE || weeklyArtifact.baseArtifactRelease !== CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE) throw new Error("CFB weekly runtime artifact release mismatch.");
  if (baseArtifact.artifactRelease !== CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE || baseArtifact.modelRelease !== weeklyArtifact.modelRelease) throw new Error("CFB weekly runtime base/model release mismatch.");
  if (baseArtifact.modelRelease !== CFB_PROFESSIONAL_SCORE_RUNTIME_RELEASE) throw new Error("CFB professional score model release mismatch.");
  if (Object.keys(weeklyArtifact.teamProfiles).length < 180) throw new Error("CFB weekly runtime team coverage is incomplete.");
  if (baseArtifact.residualSample.length < 1000) throw new Error("CFB weekly runtime residual coverage is incomplete.");
}
