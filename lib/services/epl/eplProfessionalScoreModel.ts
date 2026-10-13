import type { BdlEplTeamMatchStats } from "@/lib/providers/real_api/BallDontLieEplProvider";
import { bivariatePoissonScoreDistribution, medianTotalFromDistribution, mostLikelyTotalFromDistribution } from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import {
  EPL_SHADOW_CALIBRATION_RELEASE,
  EPL_SHADOW_MODEL_RELEASE,
  fitEplShadowModel,
  predictEplMatch,
  type EplShadowFit,
  type EplShadowPrediction,
  type EplTrainingMatch,
} from "./eplShadowModel";

export const EPL_PROFESSIONAL_SCORE_RELEASE = "epl_professional_score_2026_10_13_r1_total_margin_matchup" as const;

export const EPL_PROFESSIONAL_SCORE_CONFIG = {
  halfLifeDays: 365,
  shrinkageMatches: 10,
  xgWeight: 0.2,
  processWeight: 0.3,
  dixonColesTau: -0.15,
  candidateMarginWeight: 0.75,
} as const;

type ExtendedMatch = EplTrainingMatch & {
  homeStats: BdlEplTeamMatchStats | null;
  awayStats: BdlEplTeamMatchStats | null;
};

type TeamFactors = {
  attack: number;
  defenseWeakness: number;
  effectiveMatches: number;
};

export type EplProfessionalScoreFit = {
  release: typeof EPL_PROFESSIONAL_SCORE_RELEASE;
  modelRelease: typeof EPL_SHADOW_MODEL_RELEASE;
  incumbent: EplShadowFit;
  baseHome: number;
  baseAway: number;
  factors: Map<number, TeamFactors>;
  history: ExtendedMatch[];
  baselines: { shots: number; shotsOnTarget: number; possession: number; xg: number };
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function weightedMean(rows: Array<{ value: number; weight: number }>, fallback: number): number {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return totalWeight > 0 ? rows.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight : fallback;
}

function effectiveGoal(goal: number, xg: number | null): number {
  return finite(xg) && xg >= 0
    ? (1 - EPL_PROFESSIONAL_SCORE_CONFIG.xgWeight) * goal + EPL_PROFESSIONAL_SCORE_CONFIG.xgWeight * xg
    : goal;
}

function enrichedMatches(matches: EplTrainingMatch[], stats: BdlEplTeamMatchStats[]): ExtendedMatch[] {
  const byMatchTeam = new Map(stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  return matches.map((match) => ({
    ...match,
    homeStats: byMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? null,
    awayStats: byMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? null,
  }));
}

function statBaseline(rows: ExtendedMatch[], key: keyof BdlEplTeamMatchStats, fallback: number): number {
  const values = rows.flatMap((row) => [row.homeStats?.[key], row.awayStats?.[key]])
    .filter((value): value is number => finite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

export function fitEplProfessionalScoreModel(
  matches: EplTrainingMatch[],
  stats: BdlEplTeamMatchStats[],
  asOfIso: string,
): EplProfessionalScoreFit {
  const asOf = Date.parse(asOfIso);
  const history = enrichedMatches(matches, stats)
    .filter((match) => Date.parse(match.date) < asOf && match.home_score !== null && match.away_score !== null);
  const weighted = history.map((match) => ({
    match,
    weight: Math.pow(0.5, Math.max(0, (asOf - Date.parse(match.date)) / 86_400_000) / EPL_PROFESSIONAL_SCORE_CONFIG.halfLifeDays),
  }));
  const baseHome = weightedMean(weighted.map(({ match, weight }) => ({ value: effectiveGoal(match.home_score!, match.home_xg), weight })), 1.5);
  const baseAway = weightedMean(weighted.map(({ match, weight }) => ({ value: effectiveGoal(match.away_score!, match.away_xg), weight })), 1.2);
  const teamIds = [...new Set(history.flatMap((match) => [match.home_team_id, match.away_team_id]))];
  const factors = new Map(teamIds.map((teamId) => [teamId, { attack: 1, defenseWeakness: 1, effectiveMatches: 0 }]));

  for (let iteration = 0; iteration < 32; iteration++) {
    const attackResiduals = new Map<number, Array<{ value: number; weight: number }>>();
    const defenseResiduals = new Map<number, Array<{ value: number; weight: number }>>();
    const add = (map: Map<number, Array<{ value: number; weight: number }>>, id: number, value: number, weight: number) =>
      map.set(id, [...(map.get(id) ?? []), { value, weight }]);
    for (const { match, weight } of weighted) {
      const home = factors.get(match.home_team_id)!;
      const away = factors.get(match.away_team_id)!;
      const predictedHome = clamp(baseHome * home.attack * away.defenseWeakness, 0.15, 4.5);
      const predictedAway = clamp(baseAway * away.attack * home.defenseWeakness, 0.15, 4.5);
      const homeResidual = Math.log((effectiveGoal(match.home_score!, match.home_xg) + 0.35) / (predictedHome + 0.35));
      const awayResidual = Math.log((effectiveGoal(match.away_score!, match.away_xg) + 0.35) / (predictedAway + 0.35));
      add(attackResiduals, match.home_team_id, homeResidual, weight);
      add(defenseResiduals, match.away_team_id, homeResidual, weight);
      add(attackResiduals, match.away_team_id, awayResidual, weight);
      add(defenseResiduals, match.home_team_id, awayResidual, weight);
    }
    for (const teamId of teamIds) {
      const current = factors.get(teamId)!;
      const attackRows = attackResiduals.get(teamId) ?? [];
      const defenseRows = defenseResiduals.get(teamId) ?? [];
      const effectiveMatches = attackRows.reduce((sum, row) => sum + row.weight, 0);
      const reliability = effectiveMatches / (effectiveMatches + EPL_PROFESSIONAL_SCORE_CONFIG.shrinkageMatches);
      current.attack = Math.exp((Math.log(current.attack) + 0.42 * weightedMean(attackRows, 0)) * reliability);
      current.defenseWeakness = Math.exp((Math.log(current.defenseWeakness) + 0.42 * weightedMean(defenseRows, 0)) * reliability);
      current.effectiveMatches = effectiveMatches;
    }
    for (const key of ["attack", "defenseWeakness"] as const) {
      const meanLog = teamIds.reduce((sum, id) => sum + Math.log(factors.get(id)![key]), 0) / Math.max(1, teamIds.length);
      for (const id of teamIds) factors.get(id)![key] /= Math.exp(meanLog);
    }
  }

  return {
    release: EPL_PROFESSIONAL_SCORE_RELEASE,
    modelRelease: EPL_SHADOW_MODEL_RELEASE,
    incumbent: fitEplShadowModel(matches, asOfIso),
    baseHome,
    baseAway,
    factors,
    history,
    baselines: {
      shots: statBaseline(history, "shots", 12),
      shotsOnTarget: statBaseline(history, "shots_on_target", 4.2),
      possession: statBaseline(history, "possession_pct", 50),
      xg: statBaseline(history, "expected_goals", (baseHome + baseAway) / 2),
    },
  };
}

function processProfile(fit: EplProfessionalScoreFit, teamId: number) {
  const rows = fit.history.filter((match) => match.home_team_id === teamId || match.away_team_id === teamId).slice(-8);
  const observations = rows.map((match) => {
    const home = match.home_team_id === teamId;
    return { own: home ? match.homeStats : match.awayStats, opponent: home ? match.awayStats : match.homeStats };
  });
  const average = (values: Array<number | null | undefined>, fallback: number) => {
    const present = values.filter((value): value is number => finite(value));
    return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : fallback;
  };
  const logBlend = (parts: Array<{ ratio: number; weight: number }>) => {
    const usable = parts.filter((part) => finite(part.ratio) && part.ratio > 0);
    const total = usable.reduce((sum, part) => sum + part.weight, 0);
    return total > 0 ? usable.reduce((sum, part) => sum + part.weight * Math.log(clamp(part.ratio, 0.55, 1.8)), 0) / total : 0;
  };
  const attack = logBlend([
    { ratio: average(observations.map((row) => row.own?.shots_on_target), fit.baselines.shotsOnTarget) / fit.baselines.shotsOnTarget, weight: 0.5 },
    { ratio: average(observations.map((row) => row.own?.shots), fit.baselines.shots) / fit.baselines.shots, weight: 0.25 },
    { ratio: average(observations.map((row) => row.own?.possession_pct), fit.baselines.possession) / fit.baselines.possession, weight: 0.1 },
    { ratio: average(observations.map((row) => row.own?.expected_goals), fit.baselines.xg) / fit.baselines.xg, weight: 0.15 },
  ]);
  const defenseWeakness = logBlend([
    { ratio: average(observations.map((row) => row.opponent?.shots_on_target), fit.baselines.shotsOnTarget) / fit.baselines.shotsOnTarget, weight: 0.6 },
    { ratio: average(observations.map((row) => row.opponent?.shots), fit.baselines.shots) / fit.baselines.shots, weight: 0.25 },
    { ratio: average(observations.map((row) => row.opponent?.expected_goals), fit.baselines.xg) / fit.baselines.xg, weight: 0.15 },
  ]);
  const reliability = rows.length / (rows.length + 4);
  return { attack: attack * reliability, defenseWeakness: defenseWeakness * reliability };
}

function summarize(lambdaHome: number, lambdaAway: number): EplShadowPrediction {
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, EPL_PROFESSIONAL_SCORE_CONFIG.dixonColesTau);
  const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  const over25 = 0.6 * markets.total.over + 0.4 * 0.5;
  const bttsYes = 0.65 * markets.btts.yes + 0.35 * 0.5;
  let likelyScore = { home: 0, away: 0, probability: joint[0]![0]! };
  for (let home = 0; home < joint.length; home++) for (let away = 0; away < joint[home]!.length; away++) {
    if (joint[home]![away]! > likelyScore.probability) likelyScore = { home, away, probability: joint[home]![away]! };
  }
  const resultSide = markets.match_result.home >= markets.match_result.draw && markets.match_result.home >= markets.match_result.away
    ? "home" : markets.match_result.away >= markets.match_result.draw ? "away" : "draw";
  const totalSide = over25 >= 0.5 ? "over" : "under";
  const bttsSide = bttsYes >= 0.5 ? "yes" : "no";
  let representativeScore: EplShadowPrediction["representativeScore"] = null;
  for (let home = 0; home < joint.length; home++) for (let away = 0; away < joint[home]!.length; away++) {
    const resultMatches = resultSide === "home" ? home > away : resultSide === "away" ? away > home : home === away;
    const totalMatches = totalSide === "over" ? home + away > 2.5 : home + away < 2.5;
    const bttsMatches = bttsSide === "yes" ? home > 0 && away > 0 : home === 0 || away === 0;
    if (resultMatches && totalMatches && bttsMatches && (!representativeScore || joint[home]![away]! > representativeScore.probability)) {
      representativeScore = { home, away, probability: joint[home]![away]! };
    }
  }
  return {
    release: EPL_SHADOW_MODEL_RELEASE,
    calibrationRelease: EPL_SHADOW_CALIBRATION_RELEASE,
    lambdaHome,
    lambdaAway,
    expectedTotal: lambdaHome + lambdaAway,
    likelyScore,
    representativeScore,
    medianTotal: medianTotalFromDistribution(joint),
    mostLikelyTotal: mostLikelyTotalFromDistribution(joint),
    probabilities: {
      home: markets.match_result.home,
      draw: markets.match_result.draw,
      away: markets.match_result.away,
      over25,
      under25: 1 - over25,
      bttsYes,
      bttsNo: 1 - bttsYes,
    },
    rawDerivedProbabilities: { over25: markets.total.over, bttsYes: markets.btts.yes },
    homeStrengthSource: "club_history",
    awayStrengthSource: "club_history",
    confidence: "standard",
  };
}

export function predictEplProfessionalMatch(
  fit: EplProfessionalScoreFit,
  homeTeamId: number,
  awayTeamId: number,
): EplShadowPrediction {
  const incumbent = predictEplMatch(fit.incumbent, homeTeamId, awayTeamId);
  const home = fit.factors.get(homeTeamId) ?? { attack: 1, defenseWeakness: 1, effectiveMatches: 0 };
  const away = fit.factors.get(awayTeamId) ?? { attack: 1, defenseWeakness: 1, effectiveMatches: 0 };
  const homeProcess = processProfile(fit, homeTeamId);
  const awayProcess = processProfile(fit, awayTeamId);
  const candidateHome = clamp(
    fit.baseHome * home.attack * away.defenseWeakness
      * Math.exp(EPL_PROFESSIONAL_SCORE_CONFIG.processWeight * (homeProcess.attack + awayProcess.defenseWeakness)),
    0.2,
    4.2,
  );
  const candidateAway = clamp(
    fit.baseAway * away.attack * home.defenseWeakness
      * Math.exp(EPL_PROFESSIONAL_SCORE_CONFIG.processWeight * (awayProcess.attack + homeProcess.defenseWeakness)),
    0.2,
    4.2,
  );
  const total = incumbent.lambdaHome + incumbent.lambdaAway;
  const margin = (1 - EPL_PROFESSIONAL_SCORE_CONFIG.candidateMarginWeight) * (incumbent.lambdaHome - incumbent.lambdaAway)
    + EPL_PROFESSIONAL_SCORE_CONFIG.candidateMarginWeight * (candidateHome - candidateAway);
  const maximumMargin = Math.max(0, total - 0.4);
  const boundedMargin = clamp(margin, -maximumMargin, maximumMargin);
  const prediction = summarize((total + boundedMargin) / 2, (total - boundedMargin) / 2);
  const limited = home.effectiveMatches === 0 || away.effectiveMatches === 0;
  return {
    ...prediction,
    homeStrengthSource: limited && home.effectiveMatches === 0 ? "promoted_proxy" : "club_history",
    awayStrengthSource: limited && away.effectiveMatches === 0 ? "promoted_proxy" : "club_history",
    confidence: limited ? "limited" : "standard",
  };
}
