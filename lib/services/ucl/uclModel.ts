import type { BdlUclMatch, BdlUclTeamMatchStats } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { bivariatePoissonScoreDistribution, medianTotalFromDistribution, mostLikelyTotalFromDistribution } from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import {
  EPL_SHADOW_DEFAULT_CONFIG,
  fitEplShadowModel,
  joinEplMatchStats,
  predictEplMatch,
  type EplShadowPrediction,
  type EplTrainingMatch,
} from "@/lib/services/epl/eplShadowModel";
import type { UclCompetitionContext } from "./uclCompetitionContext";
import { regulationScore } from "./uclCompetitionContext";

export const UCL_MODEL_RELEASE = "ucl_goals_coherent_2026_09_03_r1_cross_league_regulation" as const;
export const UCL_CALIBRATION_RELEASE = "ucl_grade_policy_2026_09_03_r1_positive_forecast_ev" as const;
export const UCL_COHERENT_OUTCOME_RELEASE = "ucl_coherent_market_outcome_2026_09_03_r1_target_excluded" as const;

export type UclTravelRestContext = {
  homeRestDays: number | null;
  awayRestDays: number | null;
  homeMatchesLast14Days: number;
  awayMatchesLast14Days: number;
  awayTravelKm: number | null;
  evidenceScope: "ucl_schedule_only";
};

export type UclPrediction = EplShadowPrediction & {
  release: typeof UCL_MODEL_RELEASE;
  calibrationRelease: typeof UCL_CALIBRATION_RELEASE;
  adjustment: UclTravelRestContext & {
    homeMultiplier: number;
    awayMultiplier: number;
    neutralVenue: boolean;
    strengthPrior: "shared_ucl_cross_league_scale";
  };
};

function trainingMatch(match: BdlUclMatch): BdlUclMatch | null {
  const settled = regulationScore(match).score;
  return settled ? { ...match, home_score: settled.home, away_score: settled.away } : null;
}

export function joinUclMatchStats(matches: BdlUclMatch[], stats: BdlUclTeamMatchStats[]): EplTrainingMatch[] {
  const specialIds = new Set(matches.filter((match) => match.status_detail === "AET" || match.status_detail === "FT-Pens" || match.status === "STATUS_FINAL_AET" || match.status === "STATUS_FINAL_PEN").map((match) => match.id));
  return joinEplMatchStats(matches.flatMap((match) => trainingMatch(match) ?? []), stats)
    .map((match) => specialIds.has(match.id) ? { ...match, home_xg: null, away_xg: null } : match);
}

function daysBetween(later: string, earlier: string): number | null {
  const delta = Date.parse(later) - Date.parse(earlier);
  return Number.isFinite(delta) && delta >= 0 ? delta / 86_400_000 : null;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function venue(match: BdlUclMatch): { lat: number; lon: number } | null {
  return typeof match.venue_latitude === "number" && typeof match.venue_longitude === "number"
    ? { lat: match.venue_latitude, lon: match.venue_longitude }
    : null;
}

export function buildUclTravelRestContext(match: BdlUclMatch, history: BdlUclMatch[]): UclTravelRestContext {
  const kickoff = Date.parse(match.date);
  const priorFor = (teamId: number) => history
    .filter((row) => Date.parse(row.date) < kickoff && (row.home_team_id === teamId || row.away_team_id === teamId))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const homePrior = priorFor(match.home_team_id);
  const awayPrior = priorFor(match.away_team_id);
  const within14 = (rows: BdlUclMatch[]) => rows.filter((row) => kickoff - Date.parse(row.date) <= 14 * 86_400_000).length;
  const awayHomeVenue = awayPrior.find((row) => row.home_team_id === match.away_team_id && venue(row)) ?? null;
  const awayTravelKm = awayHomeVenue && venue(match) ? haversineKm(venue(awayHomeVenue)!, venue(match)!) : null;
  return {
    homeRestDays: homePrior[0] ? daysBetween(match.date, homePrior[0].date) : null,
    awayRestDays: awayPrior[0] ? daysBetween(match.date, awayPrior[0].date) : null,
    homeMatchesLast14Days: within14(homePrior),
    awayMatchesLast14Days: within14(awayPrior),
    awayTravelKm,
    evidenceScope: "ucl_schedule_only",
  };
}

function fatigueMultiplier(restDays: number | null, matchesLast14: number): number {
  const shortRest = restDays !== null && restDays < 4 ? 0.97 : 1;
  const congestion = matchesLast14 >= 3 ? 0.98 : 1;
  return shortRest * congestion;
}

function summarize(lambdaHome: number, lambdaAway: number): Omit<EplShadowPrediction,
  "release" | "calibrationRelease" | "homeStrengthSource" | "awayStrengthSource" | "confidence"> {
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, EPL_SHADOW_DEFAULT_CONFIG.dixonColesTau);
  const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  const over25 = 0.6 * markets.total.over + 0.4 * 0.5;
  const bttsYes = 0.65 * markets.btts.yes + 0.35 * 0.5;
  let likelyScore = { home: 0, away: 0, probability: joint[0]![0]! };
  for (let home = 0; home < joint.length; home++) for (let away = 0; away < joint[home]!.length; away++) {
    if (joint[home]![away]! > likelyScore.probability) likelyScore = { home, away, probability: joint[home]![away]! };
  }
  const result = markets.match_result.home >= markets.match_result.draw && markets.match_result.home >= markets.match_result.away
    ? "home" : markets.match_result.away >= markets.match_result.draw ? "away" : "draw";
  const total = over25 >= 0.5 ? "over" : "under";
  const btts = bttsYes >= 0.5 ? "yes" : "no";
  let representativeScore: EplShadowPrediction["representativeScore"] = null;
  for (let home = 0; home < joint.length; home++) for (let away = 0; away < joint[home]!.length; away++) {
    const resultMatches = result === "home" ? home > away : result === "away" ? away > home : home === away;
    const totalMatches = total === "over" ? home + away > 2.5 : home + away < 2.5;
    const bttsMatches = btts === "yes" ? home > 0 && away > 0 : home === 0 || away === 0;
    if (resultMatches && totalMatches && bttsMatches && (!representativeScore || joint[home]![away]! > representativeScore.probability)) {
      representativeScore = { home, away, probability: joint[home]![away]! };
    }
  }
  return {
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
  };
}

export function fitAndPredictUcl(input: {
  training: EplTrainingMatch[];
  match: BdlUclMatch;
  history: BdlUclMatch[];
  context: UclCompetitionContext;
}): UclPrediction {
  const fit = fitEplShadowModel(input.training, input.match.date);
  const baseline = predictEplMatch(fit, input.match.home_team_id, input.match.away_team_id);
  const rest = buildUclTravelRestContext(input.match, input.history);
  const neutralMultiplier = input.context.neutralVenue ? Math.sqrt(fit.leagueAwayRate / fit.leagueHomeRate) : 1;
  const homeMultiplier = fatigueMultiplier(rest.homeRestDays, rest.homeMatchesLast14Days) * neutralMultiplier;
  const awayMultiplier = fatigueMultiplier(rest.awayRestDays, rest.awayMatchesLast14Days)
    * (rest.awayTravelKm !== null && rest.awayTravelKm >= 2_000 ? 0.96 : 1);
  return {
    release: UCL_MODEL_RELEASE,
    calibrationRelease: UCL_CALIBRATION_RELEASE,
    ...summarize(Math.max(0.2, baseline.lambdaHome * homeMultiplier), Math.max(0.2, baseline.lambdaAway * awayMultiplier)),
    homeStrengthSource: baseline.homeStrengthSource,
    awayStrengthSource: baseline.awayStrengthSource,
    confidence: baseline.confidence,
    adjustment: {
      ...rest,
      homeMultiplier,
      awayMultiplier,
      neutralVenue: input.context.neutralVenue === true,
      strengthPrior: "shared_ucl_cross_league_scale",
    },
  };
}
