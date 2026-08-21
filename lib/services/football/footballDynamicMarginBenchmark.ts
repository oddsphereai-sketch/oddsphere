import type { FootballLeague, FootballSeasonPhase } from "./footballModelContract";

export const FOOTBALL_DYNAMIC_MARGIN_BENCHMARK_RELEASE = "football_dynamic_margin_diagonal_state_space_2026_08_19_r1" as const;

export type CompletedMarginGame = {
  league: FootballLeague;
  gameId: string;
  season: number;
  week: number;
  seasonPhase: FootballSeasonPhase;
  kickoff: string;
  homeTeamId: string;
  awayTeamId: string;
  neutralSite: boolean;
  homeScore: number;
  awayScore: number;
};

export type MarginPredictionTarget = Omit<CompletedMarginGame, "homeScore" | "awayScore"> & {
  decisionTimestamp: string;
};

export type DynamicMarginConfig = {
  initialTeamVariance: number;
  weeklyEvolutionVariance: number;
  offseasonEvolutionVariance: number;
  seasonCarryover: number;
  observationVariance: number;
  homeFieldPoints: number;
};

export type DynamicMarginPrediction = {
  release: typeof FOOTBALL_DYNAMIC_MARGIN_BENCHMARK_RELEASE;
  league: FootballLeague;
  gameId: string;
  generatedFor: string;
  trainedThrough: string | null;
  trainingGames: number;
  projectedHomeMargin: number;
  marginStdDev: number;
  homeWinProbability: number;
  homeRating: number;
  awayRating: number;
  marketIndependent: true;
  warnings: string[];
};

type TeamState = {
  mean: number;
  variance: number;
  season: number;
  lastKickoff: string;
  games: number;
};

function validateConfig(config: DynamicMarginConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value)) throw new Error(`${key} must be finite`);
  }
  if (config.initialTeamVariance <= 0 || config.weeklyEvolutionVariance < 0 || config.offseasonEvolutionVariance < 0 || config.observationVariance <= 0) {
    throw new Error("Dynamic margin variances must be positive (evolution variances may be zero).");
  }
  if (config.seasonCarryover < 0 || config.seasonCarryover > 1) throw new Error("seasonCarryover must be between 0 and 1");
}

export function footballNormalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function blankState(season: number, kickoff: string, config: DynamicMarginConfig): TeamState {
  return { mean: 0, variance: config.initialTeamVariance, season, lastKickoff: kickoff, games: 0 };
}

function advanceState(state: TeamState, season: number, week: number, kickoff: string, config: DynamicMarginConfig): TeamState {
  const priorKickoff = Date.parse(state.lastKickoff);
  const nextKickoff = Date.parse(kickoff);
  if (!Number.isFinite(priorKickoff) || !Number.isFinite(nextKickoff) || nextKickoff < priorKickoff || season < state.season) {
    throw new Error("Games must be processed chronologically.");
  }
  let mean = state.mean;
  let variance = state.variance;
  if (season > state.season) {
    const seasons = season - state.season;
    mean *= Math.pow(config.seasonCarryover, seasons);
    variance += seasons * config.offseasonEvolutionVariance;
    // Offseason variance represents the inter-season gap; only add weeks
    // elapsed inside the new phase/season before this team's first appearance.
    variance += Math.max(0, week - 1) * config.weeklyEvolutionVariance;
  } else {
    variance += ((nextKickoff - priorKickoff) / (7 * 86_400_000)) * config.weeklyEvolutionVariance;
  }
  return { ...state, mean, variance, season, lastKickoff: kickoff };
}

/**
 * A lightweight independent benchmark inspired by dynamic state-space team
 * strength models. It keeps diagonal team uncertainty for runtime simplicity;
 * a full covariance Bayesian model remains a separate tournament candidate.
 */
export function predictDynamicMargin(args: {
  history: CompletedMarginGame[];
  target: MarginPredictionTarget;
  config: DynamicMarginConfig;
  includedHistoryPhases: FootballSeasonPhase[];
}): DynamicMarginPrediction {
  validateConfig(args.config);
  if (args.includedHistoryPhases.length === 0) throw new Error("At least one history season phase must be selected.");
  const decision = Date.parse(args.target.decisionTimestamp);
  const kickoff = Date.parse(args.target.kickoff);
  if (!Number.isFinite(decision) || !Number.isFinite(kickoff) || decision > kickoff) {
    throw new Error("Target requires valid timestamps and a pregame decision time.");
  }
  const history = args.history
    .filter((game) => game.league === args.target.league)
    .filter((game) => args.includedHistoryPhases.includes(game.seasonPhase))
    .filter((game) => Date.parse(game.kickoff) < decision)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const states = new Map<string, TeamState>();
  let trainedThrough: string | null = null;
  let trainingGames = 0;
  for (const game of history) {
    if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) continue;
    let home = advanceState(states.get(game.homeTeamId) ?? blankState(game.season, game.kickoff, args.config), game.season, game.week, game.kickoff, args.config);
    let away = advanceState(states.get(game.awayTeamId) ?? blankState(game.season, game.kickoff, args.config), game.season, game.week, game.kickoff, args.config);
    const homeField = game.neutralSite ? 0 : args.config.homeFieldPoints;
    const prediction = home.mean - away.mean + homeField;
    const residual = (game.homeScore - game.awayScore) - prediction;
    const innovationVariance = home.variance + away.variance + args.config.observationVariance;
    const homeGain = home.variance / innovationVariance;
    const awayGain = away.variance / innovationVariance;
    home = { ...home, mean: home.mean + homeGain * residual, variance: home.variance * (1 - homeGain), games: home.games + 1 };
    away = { ...away, mean: away.mean - awayGain * residual, variance: away.variance * (1 - awayGain), games: away.games + 1 };
    states.set(game.homeTeamId, home);
    states.set(game.awayTeamId, away);
    trainingGames++;
    trainedThrough = game.kickoff;
  }
  const home = advanceState(states.get(args.target.homeTeamId) ?? blankState(args.target.season, args.target.kickoff, args.config), args.target.season, args.target.week, args.target.kickoff, args.config);
  const away = advanceState(states.get(args.target.awayTeamId) ?? blankState(args.target.season, args.target.kickoff, args.config), args.target.season, args.target.week, args.target.kickoff, args.config);
  const projectedHomeMargin = home.mean - away.mean + (args.target.neutralSite ? 0 : args.config.homeFieldPoints);
  const marginStdDev = Math.sqrt(home.variance + away.variance + args.config.observationVariance);
  const warnings: string[] = [];
  if (home.games === 0) warnings.push("home_team_prior_only");
  if (away.games === 0) warnings.push("away_team_prior_only");
  return {
    release: FOOTBALL_DYNAMIC_MARGIN_BENCHMARK_RELEASE,
    league: args.target.league,
    gameId: args.target.gameId,
    generatedFor: args.target.decisionTimestamp,
    trainedThrough,
    trainingGames,
    projectedHomeMargin,
    marginStdDev,
    homeWinProbability: footballNormalCdf(projectedHomeMargin / marginStdDev),
    homeRating: home.mean,
    awayRating: away.mean,
    marketIndependent: true,
    warnings,
  };
}
