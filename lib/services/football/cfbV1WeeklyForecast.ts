import baseArtifactJson from "./modelArtifacts/cfbV1JointScoreArtifact.json";
import weeklyArtifactJson from "./modelArtifacts/cfbV1WeeklyRuntimeArtifact.json";
import type { NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbV1Forecast } from "./cfbV1Decision";

export const CFB_V1_WEEKLY_RUNTIME_RELEASE =
  "cfb_v1_joint_score_artifact_2026_08_25_r3_weekly" as const;
export const CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE =
  "cfb_v1_joint_score_artifact_2026_08_25_r2" as const;

type NullableNumber = number | null;
type TeamProfile = {
  displayName: string;
  elo: number;
  lastPlayedAt: string | null;
  priorGames: number;
  rolling: Record<string, NullableNumber>;
  personnel: Record<string, NullableNumber>;
};
type LinearPipeline = {
  inputFeatures: string[];
  imputerStatistics: NullableNumber[];
  missingIndicatorFeatureIndexes: number[];
  scalerMean: number[];
  scalerScale: number[];
  coefficients: number[];
  intercept: number;
};
type BaseArtifact = {
  artifactRelease: string;
  modelRelease: string;
  pipeline: { home: LinearPipeline; away: LinearPipeline };
  residualSample: Array<[number, number]>;
  forecasts: CfbV1Forecast[];
};
type WeeklyArtifact = {
  artifactRelease: string;
  baseArtifactRelease: string;
  modelRelease: string;
  season: number;
  globalMeans: Record<string, number>;
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
const FOOTBALL_SCORE_SUPPORT = [
  0, 2, 3, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76,
  77, 78, 79, 80,
] as const;

assertRuntimeArtifact();

export function getCfbV1WeeklyForecast(args: {
  game: NcaafGame;
  completedGames?: NcaafGame[];
}): CfbV1WeeklyForecastResult {
  const frozen = baseArtifact.forecasts.find((row) => row.providerGameId === args.game.providerGameId);
  if (frozen) {
    return {
      forecast: cloneForecast(frozen),
      featureHealth: { awayProfile: "matched", homeProfile: "matched", completedGamesApplied: 0 },
    };
  }
  if (args.game.season !== weeklyArtifact.season) {
    throw new Error(`CFB weekly runtime supports season ${weeklyArtifact.season}, not ${args.game.season}.`);
  }
  const states = initialStates();
  const completed = (args.completedGames ?? [])
    .filter((game) => game.season === args.game.season && game.homeScore !== null && game.awayScore !== null && Date.parse(game.scheduledStart) < Date.parse(args.game.scheduledStart))
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) || first.providerGameId.localeCompare(second.providerGameId));
  for (const game of completed) applyCompletedGame(states, game);
  const away = resolveState(states, args.game.away.name);
  const home = resolveState(states, args.game.home.name);
  const features = matchupFeatures({ game: args.game, away: away.state, home: home.state });
  const rawHome = predict(baseArtifact.pipeline.home, features);
  const rawAway = predict(baseArtifact.pipeline.away, features);
  return {
    forecast: distributionForecast(args.game, rawHome, rawAway),
    featureHealth: {
      awayProfile: away.matched ? "matched" : "neutral_imputation",
      homeProfile: home.matched ? "matched" : "neutral_imputation",
      completedGamesApplied: completed.length,
    },
  };
}

export function getFrozenCfbV1Forecasts(): CfbV1Forecast[] {
  return baseArtifact.forecasts.map(cloneForecast);
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
    personnel: { roster_continuity: null, roster_experience: null, returning_qb: null },
  };
  const state = { profile: neutral, sourceMatched: false, elo: 1500, lastPlayedAt: null, currentGames: 0, sums: {}, counts: {} };
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

function matchupFeatures(args: { game: NcaafGame; away: MutableTeamState; home: MutableTeamState }): Record<string, NullableNumber> {
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
  }
  for (const key of ["roster_continuity", "roster_experience", "returning_qb"] as const) {
    const home = args.home.profile.personnel[key];
    const away = args.away.profile.personnel[key];
    output[`${key}_diff`] = home === null || away === null ? null : home - away;
    output[`${key}_sum`] = home === null || away === null ? null : home + away;
  }
  return output;
}

function blendedValue(state: MutableTeamState, key: string): number {
  const prior = state.profile.rolling[key] ?? weeklyArtifact.globalMeans[key] ?? 0;
  if (state.currentGames === 0 || !state.counts[key]) return prior;
  const current = state.sums[key]! / state.counts[key]!;
  const weight = state.currentGames / (state.currentGames + 4);
  return weight * current + (1 - weight) * prior;
}

function applyCompletedGame(states: Map<string, MutableTeamState>, game: NcaafGame): void {
  const home = resolveState(states, game.home.name).state;
  const away = resolveState(states, game.away.name).state;
  const homeScore = game.homeScore!;
  const awayScore = game.awayScore!;
  observe(home, { points_for: homeScore, points_against: awayScore, margin: homeScore - awayScore, total: homeScore + awayScore });
  observe(away, { points_for: awayScore, points_against: homeScore, margin: awayScore - homeScore, total: homeScore + awayScore });
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

function observe(state: MutableTeamState, metrics: Record<string, number>): void {
  state.currentGames += 1;
  for (const [key, value] of Object.entries(metrics)) {
    state.sums[key] = (state.sums[key] ?? 0) + value;
    state.counts[key] = (state.counts[key] ?? 0) + 1;
  }
}

function predict(pipeline: LinearPipeline, features: Record<string, NullableNumber>): number {
  if (pipeline.inputFeatures.length !== pipeline.imputerStatistics.length) throw new Error("CFB pipeline imputer shape is invalid.");
  const missing = pipeline.inputFeatures.map((name) => features[name] === null || features[name] === undefined || !Number.isFinite(features[name]));
  const values = pipeline.inputFeatures.map((name, index) => missing[index] ? pipeline.imputerStatistics[index] : features[name]);
  if (values.some((value) => value === null || !Number.isFinite(value))) throw new Error("CFB pipeline cannot impute a required feature.");
  const transformed = [
    ...(values as number[]),
    ...pipeline.missingIndicatorFeatureIndexes.map((index) => missing[index] ? 1 : 0),
  ];
  if (transformed.length !== pipeline.coefficients.length || transformed.length !== pipeline.scalerMean.length || transformed.length !== pipeline.scalerScale.length) {
    throw new Error("CFB pipeline transformed feature shape is invalid.");
  }
  return transformed.reduce((sum, value, index) => {
    const scale = pipeline.scalerScale[index]!;
    const standardized = scale === 0 ? 0 : (value - pipeline.scalerMean[index]!) / scale;
    return sum + standardized * pipeline.coefficients[index]!;
  }, pipeline.intercept);
}

function distributionForecast(game: NcaafGame, rawHome: number, rawAway: number): CfbV1Forecast {
  const counts = new Map<string, { home: number; away: number; count: number }>();
  const homes: number[] = [];
  const aways: number[] = [];
  for (const [homeResidual, awayResidual] of baseArtifact.residualSample) {
    const home = nearestScore(clamp(rawHome + homeResidual, 0, 90));
    const away = nearestScore(clamp(rawAway + awayResidual, 0, 90));
    homes.push(home);
    aways.push(away);
    const key = `${home}:${away}`;
    const current = counts.get(key);
    counts.set(key, current ? { ...current, count: current.count + 1 } : { home, away, count: 1 });
  }
  if (homes.length === 0) throw new Error("CFB empirical residual distribution is empty.");
  const expectedHome = mean(homes);
  const expectedAway = mean(aways);
  const margins = homes.map((home, index) => home - aways[index]!);
  const totals = homes.map((home, index) => home + aways[index]!);
  const expectedMargin = mean(margins);
  const expectedTotal = mean(totals);
  const homeWinProbability = (margins.filter((value) => value > 0).length + 0.5 * margins.filter((value) => value === 0).length) / margins.length;
  const pmf = [...counts.values()].sort((a, b) => a.home - b.home || a.away - b.away).map((cell) => ({ home: cell.home, away: cell.away, probability: cell.count / homes.length }));
  const representativePool = [...counts.values()].filter((cell) => homeWinProbability > 0.5 ? cell.home > cell.away : homeWinProbability < 0.5 ? cell.home < cell.away : true);
  const representative = representativePool.sort((first, second) => representativeDistance(first, expectedHome, expectedAway, expectedMargin, expectedTotal) - representativeDistance(second, expectedHome, expectedAway, expectedMargin, expectedTotal) || second.count - first.count)[0]!;
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
      away: [quantile(aways, 0.1), quantile(aways, 0.9)],
      home: [quantile(homes, 0.1), quantile(homes, 0.9)],
      marginHome: [quantile(margins, 0.1), quantile(margins, 0.9)],
      total: [quantile(totals, 0.1), quantile(totals, 0.9)],
    },
    pmf,
  };
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
  return { ...forecast, representativeScore: { ...forecast.representativeScore }, interval80: { away: [...forecast.interval80.away], home: [...forecast.interval80.home], marginHome: [...forecast.interval80.marginHome], total: [...forecast.interval80.total] }, pmf: forecast.pmf.map((cell) => ({ ...cell })) };
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll("'", "").replaceAll(".", "").trim().replace(/\s+/g, " ");
}

function foldName(value: string): string {
  return normalizeName(value).normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }

function assertRuntimeArtifact(): void {
  if (weeklyArtifact.artifactRelease !== CFB_V1_WEEKLY_RUNTIME_RELEASE || weeklyArtifact.baseArtifactRelease !== CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE) throw new Error("CFB weekly runtime artifact release mismatch.");
  if (baseArtifact.artifactRelease !== CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE || baseArtifact.modelRelease !== weeklyArtifact.modelRelease) throw new Error("CFB weekly runtime base/model release mismatch.");
  if (Object.keys(weeklyArtifact.teamProfiles).length < 180) throw new Error("CFB weekly runtime team coverage is incomplete.");
  if (baseArtifact.residualSample.length < 1000) throw new Error("CFB weekly runtime residual coverage is incomplete.");
}
