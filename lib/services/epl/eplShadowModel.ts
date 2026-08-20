import {
  bivariatePoissonScoreDistribution,
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import type { BdlEplMatch, BdlEplTeamMatchStats } from "@/lib/providers/real_api/BallDontLieEplProvider";

export const EPL_SHADOW_MODEL_RELEASE = "epl_goals_coherent_2026_08_20_r16" as const;
export const EPL_SHADOW_CALIBRATION_RELEASE = "epl_grade_policy_2026_08_20_v21" as const;

export type EplModelConfig = {
  halfLifeDays: number;
  shrinkageMatches: number;
  xgWeight: number;
  dixonColesTau: number;
};

export const EPL_SHADOW_DEFAULT_CONFIG: Readonly<EplModelConfig> = {
  halfLifeDays: 365,
  shrinkageMatches: 4,
  xgWeight: 0.35,
  dixonColesTau: -0.1,
};

export type EplTrainingMatch = BdlEplMatch & {
  home_xg: number | null;
  away_xg: number | null;
};

type VenueSplit = { for: number; against: number; weight: number };
type TeamAccumulator = { home: VenueSplit; away: VenueSplit };

export type EplTeamStrength = {
  teamId: number;
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  effectiveMatches: number;
  source: "club_history" | "promoted_proxy";
};

export type EplShadowFit = {
  release: typeof EPL_SHADOW_MODEL_RELEASE;
  calibrationRelease: typeof EPL_SHADOW_CALIBRATION_RELEASE;
  trainedThrough: string;
  trainingMatches: number;
  leagueHomeRate: number;
  leagueAwayRate: number;
  config: EplModelConfig;
  strengths: Map<number, EplTeamStrength>;
  promotedProxy: Omit<EplTeamStrength, "teamId" | "effectiveMatches" | "source">;
};

export type EplShadowPrediction = {
  release: typeof EPL_SHADOW_MODEL_RELEASE;
  calibrationRelease: typeof EPL_SHADOW_CALIBRATION_RELEASE;
  lambdaHome: number;
  lambdaAway: number;
  expectedTotal: number;
  likelyScore: { home: number; away: number; probability: number };
  /** Highest-probability exact score satisfying the independently selected
   * Match Result, Total, and BTTS forecast directions. This is presentation
   * context, not the modal score and not an additional prediction head. */
  representativeScore: { home: number; away: number; probability: number } | null;
  medianTotal: number;
  mostLikelyTotal: number;
  probabilities: {
    home: number;
    draw: number;
    away: number;
    over25: number;
    under25: number;
    bttsYes: number;
    bttsNo: number;
  };
  /** Uncalibrated probabilities from the shared score distribution. Kept for
   * chronological calibration audits; member-facing reads use probabilities. */
  rawDerivedProbabilities: {
    over25: number;
    bttsYes: number;
  };
  homeStrengthSource: EplTeamStrength["source"];
  awayStrengthSource: EplTeamStrength["source"];
  confidence: "standard" | "limited";
};

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function effectiveGoals(goals: number, xg: number | null, xgWeight: number): number {
  return validNumber(xg) && xg >= 0 ? xgWeight * xg + (1 - xgWeight) * goals : goals;
}

export function joinEplMatchStats(matches: BdlEplMatch[], stats: BdlEplTeamMatchStats[]): EplTrainingMatch[] {
  const byMatchTeam = new Map(stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  return matches
    .filter((match) => match.status_state === "final" && validNumber(match.home_score) && validNumber(match.away_score))
    .map((match) => ({
      ...match,
      home_xg: byMatchTeam.get(`${match.id}:${match.home_team_id}`)?.expected_goals ?? null,
      away_xg: byMatchTeam.get(`${match.id}:${match.away_team_id}`)?.expected_goals ?? null,
    }));
}

function blankAccumulator(): TeamAccumulator {
  return {
    home: { for: 0, against: 0, weight: 0 },
    away: { for: 0, against: 0, weight: 0 },
  };
}

function shrunkRatio(value: number, weight: number, baseline: number, shrinkageMatches: number): number {
  return (value + shrinkageMatches * baseline) / ((weight + shrinkageMatches) * baseline);
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * quantile)];
}

export function fitEplShadowModel(
  matches: EplTrainingMatch[],
  asOfIso: string,
  config: EplModelConfig = EPL_SHADOW_DEFAULT_CONFIG,
): EplShadowFit {
  const asOf = Date.parse(asOfIso);
  const accumulators = new Map<number, TeamAccumulator>();
  let leagueHomeFor = 0;
  let leagueAwayFor = 0;
  let leagueWeight = 0;
  let trainedThrough = "";

  for (const match of matches) {
    const playedAt = Date.parse(match.date);
    if (!Number.isFinite(playedAt) || playedAt >= asOf || match.home_score === null || match.away_score === null) continue;
    const ageDays = Math.max(0, (asOf - playedAt) / 86_400_000);
    const weight = Math.pow(0.5, ageDays / config.halfLifeDays);
    const homeFor = effectiveGoals(match.home_score, match.home_xg, config.xgWeight);
    const awayFor = effectiveGoals(match.away_score, match.away_xg, config.xgWeight);
    const home = accumulators.get(match.home_team_id) ?? blankAccumulator();
    const away = accumulators.get(match.away_team_id) ?? blankAccumulator();
    home.home.for += weight * homeFor;
    home.home.against += weight * awayFor;
    home.home.weight += weight;
    away.away.for += weight * awayFor;
    away.away.against += weight * homeFor;
    away.away.weight += weight;
    accumulators.set(match.home_team_id, home);
    accumulators.set(match.away_team_id, away);
    leagueHomeFor += weight * homeFor;
    leagueAwayFor += weight * awayFor;
    leagueWeight += weight;
    if (!trainedThrough || match.date > trainedThrough) trainedThrough = match.date;
  }

  const leagueHomeRate = leagueWeight > 0 ? leagueHomeFor / leagueWeight : 1.5;
  const leagueAwayRate = leagueWeight > 0 ? leagueAwayFor / leagueWeight : 1.2;
  const strengths = new Map<number, EplTeamStrength>();
  for (const [teamId, acc] of accumulators) {
    strengths.set(teamId, {
      teamId,
      homeAttack: shrunkRatio(acc.home.for, acc.home.weight, leagueHomeRate, config.shrinkageMatches),
      homeDefense: shrunkRatio(acc.home.against, acc.home.weight, leagueAwayRate, config.shrinkageMatches),
      awayAttack: shrunkRatio(acc.away.for, acc.away.weight, leagueAwayRate, config.shrinkageMatches),
      awayDefense: shrunkRatio(acc.away.against, acc.away.weight, leagueHomeRate, config.shrinkageMatches),
      effectiveMatches: acc.home.weight + acc.away.weight,
      source: "club_history",
    });
  }

  const all = [...strengths.values()];
  const promotedProxy = {
    homeAttack: percentile(all.map((row) => row.homeAttack), 0.25),
    homeDefense: percentile(all.map((row) => row.homeDefense), 0.75),
    awayAttack: percentile(all.map((row) => row.awayAttack), 0.25),
    awayDefense: percentile(all.map((row) => row.awayDefense), 0.75),
  };

  return {
    release: EPL_SHADOW_MODEL_RELEASE,
    calibrationRelease: EPL_SHADOW_CALIBRATION_RELEASE,
    trainedThrough,
    trainingMatches: matches.filter((match) => Date.parse(match.date) < asOf).length,
    leagueHomeRate,
    leagueAwayRate,
    config: { ...config },
    strengths,
    promotedProxy,
  };
}

function strengthFor(fit: EplShadowFit, teamId: number): EplTeamStrength {
  return fit.strengths.get(teamId) ?? {
    teamId,
    ...fit.promotedProxy,
    effectiveMatches: 0,
    source: "promoted_proxy",
  };
}

function clampLambda(value: number): number {
  return Math.max(0.2, Math.min(3.8, value));
}

export function predictEplMatch(fit: EplShadowFit, homeTeamId: number, awayTeamId: number): EplShadowPrediction {
  const home = strengthFor(fit, homeTeamId);
  const away = strengthFor(fit, awayTeamId);
  const lambdaHome = clampLambda(fit.leagueHomeRate * home.homeAttack * away.awayDefense);
  const lambdaAway = clampLambda(fit.leagueAwayRate * away.awayAttack * home.homeDefense);
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, fit.config.dixonColesTau);
  const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  // Chronologically selected on 2025-26 calibration matches and evaluated
  // on the untouched final quarter. Neutral shrinkage preserves which side
  // the shared score distribution favors; shrinking toward a >50% league
  // base rate incorrectly flipped marginal Under/No forecasts.
  const over25 = 0.6 * markets.total.over + 0.4 * 0.5;
  const bttsYes = 0.65 * markets.btts.yes + 0.35 * 0.5;
  let likelyScore = { home: 0, away: 0, probability: joint[0][0] };
  for (let homeGoals = 0; homeGoals < joint.length; homeGoals++) {
    for (let awayGoals = 0; awayGoals < joint[homeGoals].length; awayGoals++) {
      if (joint[homeGoals][awayGoals] > likelyScore.probability) {
        likelyScore = { home: homeGoals, away: awayGoals, probability: joint[homeGoals][awayGoals] };
      }
    }
  }
  const resultSide = markets.match_result.home >= markets.match_result.draw && markets.match_result.home >= markets.match_result.away
    ? "home"
    : markets.match_result.away >= markets.match_result.draw
      ? "away"
      : "draw";
  const totalSide = over25 >= 0.5 ? "over" : "under";
  const bttsSide = bttsYes >= 0.5 ? "yes" : "no";
  let representativeScore: EplShadowPrediction["representativeScore"] = null;
  for (let homeGoals = 0; homeGoals < joint.length; homeGoals++) {
    for (let awayGoals = 0; awayGoals < joint[homeGoals].length; awayGoals++) {
      const resultMatches = resultSide === "home"
        ? homeGoals > awayGoals
        : resultSide === "away"
          ? awayGoals > homeGoals
          : homeGoals === awayGoals;
      const totalMatches = totalSide === "over" ? homeGoals + awayGoals > 2.5 : homeGoals + awayGoals < 2.5;
      const bttsMatches = bttsSide === "yes" ? homeGoals > 0 && awayGoals > 0 : homeGoals === 0 || awayGoals === 0;
      const probability = joint[homeGoals][awayGoals];
      if (resultMatches && totalMatches && bttsMatches && (!representativeScore || probability > representativeScore.probability)) {
        representativeScore = { home: homeGoals, away: awayGoals, probability };
      }
    }
  }
  const limited = home.source === "promoted_proxy" || away.source === "promoted_proxy";
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
    rawDerivedProbabilities: {
      over25: markets.total.over,
      bttsYes: markets.btts.yes,
    },
    homeStrengthSource: home.source,
    awayStrengthSource: away.source,
    confidence: limited ? "limited" : "standard",
  };
}
