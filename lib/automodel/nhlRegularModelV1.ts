import type { BdlNhlTeamMetrics } from "../providers/nhl/_ballDontLieNhlClient";
import type { NhlCalibratedTeamState } from "./nhlRegularPriors2026";

export const NHL_REGULAR_MODEL_RELEASE = "nhl_regular_2026_r1" as const;
export const NHL_REGULAR_CALIBRATION_RELEASE = "nhl_regular_calibration_2026_r1" as const;
export const NHL_REGULAR_DECISION_RELEASE = "nhl_regular_decision_2026_r1" as const;

export type NhlVerdictKey = "best_angle" | "lean" | "watchlist" | "pass";

export type NhlModelTeam = {
  abbreviation: string;
  xgoals_pct: number | null;
  x_goals_for_per_60: number | null;
  x_goals_against_per_60: number | null;
  pp_xgoals_pct: number | null;
  pk_xgoals_pct: number | null;
  goalie_xgsaa_per_60: number | null;
  rest_days: number | null;
  series_wins: number;
  is_home: boolean;
  provider_metrics: BdlNhlTeamMetrics | null;
  calibrated_state: NhlCalibratedTeamState | null;
};

export type NhlModelMarket = {
  market_home_prob: number | null;
  market_open_home_prob: number | null;
  market_total_line: number | null;
  market_open_total_line: number | null;
  market_book_count: number;
  ml_home_bets_pct: number | null;
  ml_home_money_pct: number | null;
  total_over_bets_pct: number | null;
  total_over_money_pct: number | null;
};

export type NhlFeatureSnapshot = {
  home: NhlModelTeam;
  away: NhlModelTeam;
  market: NhlModelMarket;
  series: {
    series_abbrev: string | null;
    game_number_in_series: number;
    is_elimination_game: boolean;
  };
  game_type: 1 | 2 | 3;
  feature_season: number;
  provider_feature_season: number | null;
};

export type NhlModelMarketOutput = {
  pick: string;
  probability: number;
  confidence: number;
  verdict: NhlVerdictKey;
  model_market_gap_pct: number | null;
  notes: string[];
};

export type NhlModelOutput = {
  model_version: typeof NHL_REGULAR_MODEL_RELEASE;
  calibration_version: typeof NHL_REGULAR_CALIBRATION_RELEASE;
  decision_version: typeof NHL_REGULAR_DECISION_RELEASE;
  inputs_summary: {
    home: string;
    away: string;
    series: string | null;
    market_book_count: number;
    feature_season: number;
    provider_feature_season: number | null;
  };
  layers: {
    team_strength_goals: number;
    goalie_advantage_goals: number;
    special_teams_goals: number;
    rest_advantage_goals: number;
    home_ice_goals: number;
    series_context_goals: number;
    team_strength_diff_raw: number;
    special_teams_diff_raw: number;
    market_goal_diff: number;
    split_movement_goals: number;
  };
  independent_goal_diff: number;
  independent_total_goals: number;
  expected_goal_diff: number;
  expected_total_goals: number;
  projected_home_goals: number;
  projected_away_goals: number;
  moneyline: NhlModelMarketOutput;
  total: NhlModelMarketOutput;
  puck_line: NhlModelMarketOutput & { puck_line_value: number };
};

const ML_MARKET_WEIGHT = 0.30;
const TOTAL_MARKET_WEIGHT = 0.90;
const PUCKLINE_MARKET_WEIGHT = 0.45;
const ML_SLOPE = 0.78;
const LEAGUE_TOTAL = 6.10;
const HOME_SCORING_GOALS = 0.05;
const HOME_ELO_POINTS = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability: number): number {
  const p = clamp(probability, 0.03, 0.97);
  return Math.log(p / (1 - p));
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
  return 0.5 * (1 + sign * y);
}

function calibratedTeamState(team: NhlModelTeam): { elo: number; goalsFor: number; goalsAgainst: number } {
  if (team.calibrated_state) return team.calibrated_state;
  return {
    elo: 1500,
    goalsFor: team.provider_metrics?.goalsForPerGame ?? team.x_goals_for_per_60 ?? LEAGUE_TOTAL / 2,
    goalsAgainst: team.provider_metrics?.goalsAgainstPerGame ?? team.x_goals_against_per_60 ?? LEAGUE_TOTAL / 2,
  };
}

function sharpHomeNudge(market: NhlModelMarket): number {
  const tickets = market.ml_home_bets_pct;
  const money = market.ml_home_money_pct;
  if (tickets === null || money === null) return 0;
  return clamp((money - tickets) / 100 * 0.08, -0.012, 0.012);
}

function sharpTotalNudge(market: NhlModelMarket): number {
  const tickets = market.total_over_bets_pct;
  const money = market.total_over_money_pct;
  if (tickets === null || money === null) return 0;
  return clamp((money - tickets) / 100 * 0.55, -0.09, 0.09);
}

function movementHomeNudge(market: NhlModelMarket): number {
  if (market.market_home_prob === null || market.market_open_home_prob === null) return 0;
  return clamp((market.market_home_prob - market.market_open_home_prob) * 0.35, -0.015, 0.015);
}

function moneylineVerdict(probability: number, marketProbability: number | null): NhlVerdictKey {
  const conviction = Math.abs(probability - 0.5);
  const edge = marketProbability === null ? 0 : Math.abs(probability - marketProbability);
  if (conviction >= 0.08 && edge >= 0.018) return "best_angle";
  if (conviction >= 0.045 || edge >= 0.012) return "lean";
  return "watchlist";
}

function totalVerdict(independentGap: number | null): NhlVerdictKey {
  if (independentGap === null) return "pass";
  // The final score is intentionally anchored close to the market, so using
  // only final projection-minus-line would erase almost the entire totals
  // board. Release-pure tuning and holdout both supported the selected side
  // when the independent model differed by at least 0.20 goals. Market
  // movement and splits still adjust the final score and can change its side.
  if (Math.abs(independentGap) >= 0.20) return "lean";
  return "watchlist";
}

function pucklineVerdict(probability: number, marketProbability: number | null): NhlVerdictKey {
  const edge = marketProbability === null ? 0 : probability - marketProbability;
  if (probability >= 0.68 && edge >= 0.02) return "best_angle";
  if (probability >= 0.62 || edge >= 0.012) return "lean";
  return "watchlist";
}

export function nhlRegularModelV1(snapshot: NhlFeatureSnapshot): NhlModelOutput {
  const homeState = calibratedTeamState(snapshot.home);
  const awayState = calibratedTeamState(snapshot.away);
  const restGoals = snapshot.home.rest_days !== null && snapshot.away.rest_days !== null
    ? clamp((snapshot.home.rest_days - snapshot.away.rest_days) * 0.035, -0.16, 0.16)
    : 0;
  const homeRate = (homeState.goalsFor + awayState.goalsAgainst) / 2 + HOME_SCORING_GOALS + restGoals / 2;
  const awayRate = (awayState.goalsFor + homeState.goalsAgainst) / 2 - restGoals / 2;
  const scoringDiff = homeRate - awayRate;
  const eloDiffGoals = ((homeState.elo + HOME_ELO_POINTS) - awayState.elo) / 330;
  const teamStrengthGoals = 0.58 * scoringDiff + 0.42 * eloDiffGoals;
  const independentGoalDiff = teamStrengthGoals;
  const independentTotal = clamp(homeRate + awayRate, 4.7, 7.5);

  const marketHome = snapshot.market.market_home_prob;
  const marketGoalDiff = marketHome === null ? independentGoalDiff : logit(marketHome) / ML_SLOPE;
  const baseHomeProbability = marketHome === null
    ? logistic(ML_SLOPE * independentGoalDiff)
    : (1 - ML_MARKET_WEIGHT) * logistic(ML_SLOPE * independentGoalDiff) + ML_MARKET_WEIGHT * marketHome;
  const probabilityNudge = sharpHomeNudge(snapshot.market) + movementHomeNudge(snapshot.market);
  const homeProbability = clamp(baseHomeProbability + probabilityNudge, 0.20, 0.80);
  const expectedGoalDiff = (1 - ML_MARKET_WEIGHT) * independentGoalDiff + ML_MARKET_WEIGHT * marketGoalDiff + probabilityNudge / 0.12;

  const marketTotal = snapshot.market.market_total_line;
  const totalNudge = sharpTotalNudge(snapshot.market);
  const expectedTotal = clamp(
    marketTotal === null
      ? independentTotal + totalNudge
      : (1 - TOTAL_MARKET_WEIGHT) * independentTotal + TOTAL_MARKET_WEIGHT * marketTotal + totalNudge,
    4.5,
    8,
  );
  const projectedHome = Math.max(0, (expectedTotal + expectedGoalDiff) / 2);
  const projectedAway = Math.max(0, (expectedTotal - expectedGoalDiff) / 2);

  const homePick = homeProbability >= 0.5;
  const mlProbability = homePick ? homeProbability : 1 - homeProbability;
  const mlMarketProbability = marketHome === null ? null : (homePick ? marketHome : 1 - marketHome);
  const mlGap = mlMarketProbability === null ? null : mlProbability - mlMarketProbability;
  const mlPick = `${homePick ? snapshot.home.abbreviation : snapshot.away.abbreviation} ML`;

  const totalGap = marketTotal === null ? null : expectedTotal - marketTotal;
  const independentTotalGap = marketTotal === null ? null : independentTotal - marketTotal;
  const totalPickOver = (totalGap ?? 0) >= 0;
  const totalProbability = independentTotalGap === null
    ? 0.5
    : clamp(0.50 + Math.min(Math.abs(independentTotalGap), 0.20) * 0.125, 0.50, 0.525);
  const totalPick = marketTotal === null
    ? `Model ${expectedTotal.toFixed(1)}`
    : `${totalPickOver ? "OVER" : "UNDER"} ${marketTotal.toFixed(1)}`;

  const pucklineMarketWeight = marketHome === null ? 0 : PUCKLINE_MARKET_WEIGHT;
  const pucklineMean = (1 - pucklineMarketWeight) * independentGoalDiff + pucklineMarketWeight * marketGoalDiff + probabilityNudge / 0.12;
  const sigma = Math.sqrt(Math.max(4.5, expectedTotal));
  const homeMinus15 = 1 - normalCdf((1.5 - pucklineMean) / sigma);
  const homePlus15 = 1 - normalCdf((-1.5 - pucklineMean) / sigma);
  const homeFavorite = marketHome === null ? pucklineMean >= 0 : marketHome >= 0.5;
  const homeLine = homeFavorite ? -1.5 : 1.5;
  const homeCoverProbability = homeFavorite ? homeMinus15 : homePlus15;
  const pickHomePuckline = homeCoverProbability >= 0.5;
  const pucklineProbability = pickHomePuckline ? homeCoverProbability : 1 - homeCoverProbability;
  const pickLine = pickHomePuckline ? homeLine : -homeLine;
  const pucklinePick = `${pickHomePuckline ? snapshot.home.abbreviation : snapshot.away.abbreviation} ${pickLine > 0 ? "+" : ""}${pickLine.toFixed(1)}`;

  return {
    model_version: NHL_REGULAR_MODEL_RELEASE,
    calibration_version: NHL_REGULAR_CALIBRATION_RELEASE,
    decision_version: NHL_REGULAR_DECISION_RELEASE,
    inputs_summary: {
      home: snapshot.home.abbreviation,
      away: snapshot.away.abbreviation,
      series: snapshot.series.series_abbrev,
      market_book_count: snapshot.market.market_book_count,
      feature_season: snapshot.feature_season,
      provider_feature_season: snapshot.provider_feature_season,
    },
    layers: {
      team_strength_goals: teamStrengthGoals,
      goalie_advantage_goals: 0,
      special_teams_goals: 0,
      rest_advantage_goals: restGoals,
      home_ice_goals: HOME_SCORING_GOALS + 0.42 * HOME_ELO_POINTS / 330,
      series_context_goals: 0,
      team_strength_diff_raw: scoringDiff,
      special_teams_diff_raw: 0,
      market_goal_diff: marketGoalDiff,
      split_movement_goals: probabilityNudge / 0.12,
    },
    independent_goal_diff: independentGoalDiff,
    independent_total_goals: independentTotal,
    expected_goal_diff: expectedGoalDiff,
    expected_total_goals: expectedTotal,
    projected_home_goals: projectedHome,
    projected_away_goals: projectedAway,
    moneyline: {
      pick: mlPick,
      probability: mlProbability,
      confidence: mlProbability,
      verdict: moneylineVerdict(mlProbability, mlMarketProbability),
      model_market_gap_pct: mlGap,
      notes: [
        `Independent ${independentGoalDiff >= 0 ? "+" : ""}${independentGoalDiff.toFixed(2)} goals; market-blended ${expectedGoalDiff >= 0 ? "+" : ""}${expectedGoalDiff.toFixed(2)}.`,
      ],
    },
    total: {
      pick: totalPick,
      probability: totalProbability,
      confidence: totalProbability,
      verdict: totalVerdict(independentTotalGap),
      model_market_gap_pct: totalGap,
      notes: [`Independent ${independentTotal.toFixed(2)}; final projection ${expectedTotal.toFixed(2)}${marketTotal === null ? "" : ` vs ${marketTotal.toFixed(1)}`}.`],
    },
    puck_line: {
      pick: pucklinePick,
      probability: pucklineProbability,
      confidence: pucklineProbability,
      verdict: pucklineVerdict(pucklineProbability, null),
      model_market_gap_pct: null,
      notes: [`${(pucklineProbability * 100).toFixed(1)}% cover probability at ${pickLine > 0 ? "+" : ""}${pickLine.toFixed(1)}.`],
      puck_line_value: pickLine,
    },
  };
}
