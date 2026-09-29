import type { BdlNhlTeamMetrics } from "../providers/nhl/_ballDontLieNhlClient";
import type { NhlCalibratedTeamState } from "./nhlRegularPriors2026";

export const NHL_REGULAR_MODEL_RELEASE = "nhl_regular_2026_r3_professional_joint_score" as const;
export const NHL_REGULAR_CALIBRATION_RELEASE = "nhl_regular_calibration_2026_r3_professional_joint_score" as const;
export const NHL_REGULAR_DECISION_RELEASE = "nhl_regular_decision_2026_r3_professional_joint_score" as const;

export type NhlVerdictKey = "best_angle" | "lean" | "watchlist" | "pass";

export type NhlModelTeam = {
  abbreviation: string;
  xgoals_pct: number | null;
  x_goals_for_per_60: number | null;
  x_goals_against_per_60: number | null;
  five_x_goals_for_per_60: number | null;
  five_x_goals_against_per_60: number | null;
  pp_x_goals_for_per_60: number | null;
  pk_x_goals_against_per_60: number | null;
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
  best_home_ml_prob: number | null;
  best_away_ml_prob: number | null;
  market_open_home_prob: number | null;
  market_total_line: number | null;
  market_open_total_line: number | null;
  same_book_home_prob_move: number | null;
  same_book_total_move: number | null;
  market_home_puck_line: number | null;
  market_away_puck_line: number | null;
  market_home_puck_prob: number | null;
  market_away_puck_prob: number | null;
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

const ML_MARKET_WEIGHT = 0.20;
const ML_SLOPE = 0.78;
const LEAGUE_TOTAL = 6.10;
const HOME_ELO_POINTS = 40;
const ABILITY_WEIGHT = 0.45;
const SCORE_BETA = [
  2.9780546116531066, 0.1796256256709038, 0.19790828165857607,
  0.1916787455944218, 0.21571727756307035, 0.31307021298110915,
  0.043241636066699105, 0.3101399816597343, 0.05952024232239039,
  0.213239319922914, -0.011341534853054044, -0.03964933962980568,
  -0.017808995904590084, -0.12139146738681414, 0.05824064025009689,
  0.3687578559301108, 0.07458718668794515, -0.11097641372547018,
  0.04338959014834951, 0.08307004907456006,
] as const;
const ABILITY_BETA = [
  -0.17236562564475472, 0.7948403714740907, 0.37042700976601217,
  -0.6233355872095584, -0.03540520777115418, -0.014228820288914758,
  -0.015795062368390175, -0.06228140429571857,
] as const;

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

function dot(values: readonly number[], coefficients: readonly number[]): number {
  return values.reduce((sum, value, index) => sum + value * (coefficients[index] ?? 0), 0);
}

function calibratedTeamState(team: NhlModelTeam): { elo: number; goalsFor: number; goalsAgainst: number } {
  if (team.calibrated_state) return team.calibrated_state;
  return {
    elo: 1500,
    goalsFor: team.provider_metrics?.goalsForPerGame ?? team.x_goals_for_per_60 ?? LEAGUE_TOTAL / 2,
    goalsAgainst: team.provider_metrics?.goalsAgainstPerGame ?? team.x_goals_against_per_60 ?? LEAGUE_TOTAL / 2,
  };
}

function scoreFeatures(team: NhlModelTeam, opponent: NhlModelTeam): number[] {
  const state = calibratedTeamState(team);
  const opponentState = calibratedTeamState(opponent);
  const xgf = team.x_goals_for_per_60 ?? state.goalsFor;
  const opponentXga = opponent.x_goals_against_per_60 ?? opponentState.goalsAgainst;
  const fiveXgf = team.five_x_goals_for_per_60 ?? 2.35;
  const opponentFiveXga = opponent.five_x_goals_against_per_60 ?? 2.35;
  const ppXgf = team.pp_x_goals_for_per_60 ?? 0.52;
  const opponentPkXga = opponent.pk_x_goals_against_per_60 ?? 0.52;
  const teamRest = team.rest_days;
  const opponentRest = opponent.rest_days;
  const restDiff = teamRest === null || opponentRest === null
    ? 0
    : clamp(teamRest - opponentRest, -4, 4);
  const teamPoints = team.provider_metrics?.pointsPct ?? 0.5;
  const opponentPoints = opponent.provider_metrics?.pointsPct ?? 0.5;
  const teamShots = team.provider_metrics?.shotsForPerGame ?? 30;
  const opponentShotsAgainst = opponent.provider_metrics?.shotsAgainstPerGame ?? 30;
  return [
    1,
    team.is_home ? 1 : 0,
    state.goalsFor - 3.05,
    opponentState.goalsAgainst - 3.05,
    xgf - 3.05,
    opponentXga - 3.05,
    (teamShots - 30) / 10,
    (opponentShotsAgainst - 30) / 10,
    fiveXgf - 2.35,
    opponentFiveXga - 2.35,
    ppXgf - 0.52,
    opponentPkXga - 0.52,
    state.goalsFor - xgf,
    opponentState.goalsAgainst - opponentXga,
    teamPoints - opponentPoints,
    (state.elo + (team.is_home ? HOME_ELO_POINTS : 0) - opponentState.elo) / 400,
    restDiff,
    teamRest !== null && teamRest <= 1.5 ? 1 : 0,
    opponentRest !== null && opponentRest <= 1.5 ? 1 : 0,
    0,
  ];
}

function poissonPmf(lambda: number, maximum = 12): number[] {
  const values = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maximum; goals += 1) {
    values.push(values[goals - 1]! * lambda / goals);
  }
  values[maximum] = values[maximum]! + Math.max(0, 1 - values.reduce((sum, value) => sum + value, 0));
  return values;
}

function jointDistribution(homeGoals: number, awayGoals: number): {
  homeWin: number;
  margin: Map<number, number>;
  total: Map<number, number>;
} {
  const homePmf = poissonPmf(homeGoals);
  const awayPmf = poissonPmf(awayGoals);
  const margin = new Map<number, number>();
  const total = new Map<number, number>();
  let homeRegulation = 0;
  let tie = 0;
  for (let home = 0; home < homePmf.length; home += 1) {
    for (let away = 0; away < awayPmf.length; away += 1) {
      const probability = homePmf[home]! * awayPmf[away]!;
      margin.set(home - away, (margin.get(home - away) ?? 0) + probability);
      total.set(home + away, (total.get(home + away) ?? 0) + probability);
      if (home > away) homeRegulation += probability;
      else if (home === away) tie += probability;
    }
  }
  const overtimeHome = logistic(0.42 * (homeGoals - awayGoals));
  return { homeWin: homeRegulation + tie * overtimeHome, margin, total };
}

function probabilityAbove(distribution: ReadonlyMap<number, number>, line: number): number {
  let probability = 0;
  for (const [value, mass] of distribution) if (value > line) probability += mass;
  return probability;
}

function probabilityBelow(distribution: ReadonlyMap<number, number>, line: number): number {
  let probability = 0;
  for (const [value, mass] of distribution) if (value < line) probability += mass;
  return probability;
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
  if (market.same_book_home_prob_move === null) return 0;
  return clamp(market.same_book_home_prob_move * 0.35, -0.015, 0.015);
}

function moneylineVerdict(probability: number, marketProbability: number | null): NhlVerdictKey {
  const conviction = Math.abs(probability - 0.5);
  const edge = marketProbability === null ? 0 : probability - marketProbability;
  if (conviction >= 0.12 && edge >= 0.018) return "best_angle";
  if (conviction >= 0.08 || edge >= 0.025) return "lean";
  return "watchlist";
}

function totalVerdict(projectedGap: number | null): NhlVerdictKey {
  if (projectedGap === null) return "pass";
  if (Math.abs(projectedGap) >= 0.50) return "best_angle";
  if (Math.abs(projectedGap) >= 0.15) return "lean";
  return "watchlist";
}

function pucklineVerdict(probability: number, marketProbability: number | null): NhlVerdictKey {
  const edge = marketProbability === null ? 0 : probability - marketProbability;
  if (probability >= 0.70 && (marketProbability === null || edge >= 0.02)) return "best_angle";
  if (probability >= 0.58 || edge >= 0.012) return "lean";
  return "watchlist";
}

export function nhlRegularModelV1(snapshot: NhlFeatureSnapshot): NhlModelOutput {
  const homeFeatures = scoreFeatures(snapshot.home, snapshot.away);
  const awayFeatures = scoreFeatures(snapshot.away, snapshot.home);
  const scoreHome = clamp(dot(homeFeatures, SCORE_BETA), 1.25, 5.25);
  const scoreAway = clamp(dot(awayFeatures, SCORE_BETA), 1.25, 5.25);
  const scoreMargin = scoreHome - scoreAway;
  const abilityFeatures = [
    1,
    scoreMargin,
    homeFeatures[15]!,
    homeFeatures[14]!,
    (homeFeatures[4]! + homeFeatures[8]!) - (awayFeatures[4]! + awayFeatures[8]!),
    (awayFeatures[5]! + awayFeatures[9]!) - (homeFeatures[5]! + homeFeatures[9]!),
    homeFeatures[16]!,
    homeFeatures[17]! - awayFeatures[17]!,
  ];
  const abilityHomeProbability = logistic(dot(abilityFeatures, ABILITY_BETA));
  const abilityMargin = logit(abilityHomeProbability) / ML_SLOPE;
  const independentGoalDiff = (1 - ABILITY_WEIGHT) * scoreMargin + ABILITY_WEIGHT * abilityMargin;
  const independentTotal = clamp(scoreHome + scoreAway, 4.5, 8);

  const marketHome = snapshot.market.market_home_prob;
  const marketGoalDiff = marketHome === null ? independentGoalDiff : logit(marketHome) / ML_SLOPE;
  const probabilityNudge = sharpHomeNudge(snapshot.market) + movementHomeNudge(snapshot.market);
  const expectedGoalDiff = (1 - ML_MARKET_WEIGHT) * independentGoalDiff + ML_MARKET_WEIGHT * marketGoalDiff + probabilityNudge / 0.12;

  const marketTotal = snapshot.market.market_total_line;
  const totalNudge = sharpTotalNudge(snapshot.market);
  const totalMovement = snapshot.market.same_book_total_move !== null
    ? clamp(snapshot.market.same_book_total_move * 0.35, -0.25, 0.25)
    : 0;
  const expectedTotal = clamp(independentTotal + totalMovement + totalNudge, 4.5, 8);
  const projectedHome = Math.max(0, (expectedTotal + expectedGoalDiff) / 2);
  const projectedAway = Math.max(0, (expectedTotal - expectedGoalDiff) / 2);
  const finalDistribution = jointDistribution(projectedHome, projectedAway);
  const homeProbability = clamp(finalDistribution.homeWin, 0.20, 0.80);

  const homePick = homeProbability >= 0.5;
  const mlProbability = homePick ? homeProbability : 1 - homeProbability;
  const mlMarketProbability = homePick
    ? snapshot.market.best_home_ml_prob
    : snapshot.market.best_away_ml_prob;
  const mlGap = mlMarketProbability === null ? null : mlProbability - mlMarketProbability;
  const mlPick = `${homePick ? snapshot.home.abbreviation : snapshot.away.abbreviation} ML`;

  const totalGap = marketTotal === null ? null : expectedTotal - marketTotal;
  const overProbability = marketTotal === null ? 0.5 : probabilityAbove(finalDistribution.total, marketTotal);
  const underProbability = marketTotal === null ? 0.5 : probabilityBelow(finalDistribution.total, marketTotal);
  const totalPickOver = overProbability >= underProbability;
  const nonPushProbability = overProbability + underProbability;
  const totalProbability = nonPushProbability <= 0
    ? 0.5
    : (totalPickOver ? overProbability : underProbability) / nonPushProbability;
  const totalPick = marketTotal === null
    ? `Model ${expectedTotal.toFixed(1)}`
    : `${totalPickOver ? "OVER" : "UNDER"} ${marketTotal.toFixed(1)}`;

  const homeFavorite = marketHome === null ? expectedGoalDiff >= 0 : marketHome >= 0.5;
  const homeLine = snapshot.market.market_home_puck_line ?? (homeFavorite ? -1.5 : 1.5);
  const awayLine = snapshot.market.market_away_puck_line ?? -homeLine;
  let homeCoverProbability = 0;
  for (const [margin, probability] of finalDistribution.margin) {
    if (margin + homeLine > 0) homeCoverProbability += probability;
  }
  const pickHomePuckline = homeCoverProbability >= 0.5;
  const pucklineProbability = pickHomePuckline ? homeCoverProbability : 1 - homeCoverProbability;
  const pucklineMarketProbability = pickHomePuckline
    ? snapshot.market.market_home_puck_prob
    : snapshot.market.market_away_puck_prob;
  const pickLine = pickHomePuckline ? homeLine : awayLine;
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
      team_strength_goals: independentGoalDiff,
      goalie_advantage_goals: SCORE_BETA[13] * homeFeatures[13]! - SCORE_BETA[13] * awayFeatures[13]!,
      special_teams_goals: (SCORE_BETA[10] * homeFeatures[10]! + SCORE_BETA[11] * homeFeatures[11]!) - (SCORE_BETA[10] * awayFeatures[10]! + SCORE_BETA[11] * awayFeatures[11]!),
      rest_advantage_goals: SCORE_BETA[16] * (homeFeatures[16]! - awayFeatures[16]!),
      home_ice_goals: SCORE_BETA[1]!,
      series_context_goals: 0,
      team_strength_diff_raw: scoreMargin,
      special_teams_diff_raw: (homeFeatures[10]! + homeFeatures[11]!) - (awayFeatures[10]! + awayFeatures[11]!),
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
      verdict: totalVerdict(totalGap),
      model_market_gap_pct: totalGap,
      notes: [`Independent ${independentTotal.toFixed(2)}; final projection ${expectedTotal.toFixed(2)}${marketTotal === null ? "" : ` vs ${marketTotal.toFixed(1)}`}.`],
    },
    puck_line: {
      pick: pucklinePick,
      probability: pucklineProbability,
      confidence: pucklineProbability,
      verdict: pucklineVerdict(pucklineProbability, pucklineMarketProbability),
      model_market_gap_pct: pucklineMarketProbability === null ? null : pucklineProbability - pucklineMarketProbability,
      notes: [`${(pucklineProbability * 100).toFixed(1)}% cover probability at ${pickLine > 0 ? "+" : ""}${pickLine.toFixed(1)}.`],
      puck_line_value: pickLine,
    },
  };
}
