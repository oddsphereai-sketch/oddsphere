import type { BdlUclMatch, BdlUclTeamMatchStats } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { bivariatePoissonScoreDistribution, medianTotalFromDistribution, mostLikelyTotalFromDistribution } from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import {
  type EplShadowPrediction,
  type EplTrainingMatch,
} from "@/lib/services/epl/eplShadowModel";
import type { UclCompetitionContext } from "./uclCompetitionContext";
import { regulationScore } from "./uclCompetitionContext";
import { UCL_PREVIEW_GRADE_RELEASE } from "./uclPreviewGrade";

export const UCL_MODEL_RELEASE = "ucl_goals_coherent_2026_09_03_r6_authenticated_match_stats_manifest" as const;
export const UCL_CALIBRATION_RELEASE = UCL_PREVIEW_GRADE_RELEASE;
export { UCL_COHERENT_MARKET_OUTCOME_RELEASE } from "./uclCoherentMarketOutcome";
export { UCL_COHERENT_MARKET_OUTCOME_RELEASE as UCL_COHERENT_OUTCOME_RELEASE } from "./uclCoherentMarketOutcome";

export const UCL_MODEL_CONFIG = {
  halfLifeDays: 365,
  shrinkageMatches: 4,
  xgWeight: 0.35,
  dixonColesTau: -0.1,
} as const;

type VenueSplit = { for: number; against: number; weight: number };
type TeamAccumulator = { home: VenueSplit; away: VenueSplit };
type UclStrength = {
  teamId: number;
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  effectiveMatches: number;
  source: "club_history" | "promoted_proxy";
};

type UclFit = {
  leagueHomeRate: number;
  leagueAwayRate: number;
  strengths: Map<number, UclStrength>;
  proxy: Omit<UclStrength, "teamId" | "effectiveMatches" | "source">;
};

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
  const byMatchTeam = new Map(stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  return matches.flatMap((raw) => {
    const match = trainingMatch(raw);
    if (!match || match.status_state !== "final" || match.home_score === null || match.away_score === null) return [];
    return [{
      ...match,
      home_xg: specialIds.has(match.id) ? null : byMatchTeam.get(`${match.id}:${match.home_team_id}`)?.expected_goals ?? null,
      away_xg: specialIds.has(match.id) ? null : byMatchTeam.get(`${match.id}:${match.away_team_id}`)?.expected_goals ?? null,
    }];
  });
}

function blankAccumulator(): TeamAccumulator {
  return { home: { for: 0, against: 0, weight: 0 }, away: { for: 0, against: 0, weight: 0 } };
}

function effectiveGoals(goals: number, xg: number | null): number {
  return typeof xg === "number" && Number.isFinite(xg) && xg >= 0
    ? UCL_MODEL_CONFIG.xgWeight * xg + (1 - UCL_MODEL_CONFIG.xgWeight) * goals
    : goals;
}

function shrunkRatio(value: number, weight: number, baseline: number): number {
  return (value + UCL_MODEL_CONFIG.shrinkageMatches * baseline)
    / ((weight + UCL_MODEL_CONFIG.shrinkageMatches) * baseline);
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * quantile)]!;
}

/** UCL-owned fit. Only rows strictly before asOf participate. */
export function fitUclModel(matches: EplTrainingMatch[], asOfIso: string): UclFit {
  const asOf = Date.parse(asOfIso);
  const accumulators = new Map<number, TeamAccumulator>();
  let leagueHomeFor = 0;
  let leagueAwayFor = 0;
  let leagueWeight = 0;
  for (const match of matches) {
    const playedAt = Date.parse(match.date);
    if (!Number.isFinite(playedAt) || playedAt >= asOf || match.home_score === null || match.away_score === null) continue;
    const weight = Math.pow(0.5, Math.max(0, (asOf - playedAt) / 86_400_000) / UCL_MODEL_CONFIG.halfLifeDays);
    const homeFor = effectiveGoals(match.home_score, match.home_xg);
    const awayFor = effectiveGoals(match.away_score, match.away_xg);
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
  }
  const leagueHomeRate = leagueWeight > 0 ? leagueHomeFor / leagueWeight : 1.5;
  const leagueAwayRate = leagueWeight > 0 ? leagueAwayFor / leagueWeight : 1.2;
  const strengths = new Map<number, UclStrength>();
  for (const [teamId, acc] of accumulators) {
    strengths.set(teamId, {
      teamId,
      homeAttack: shrunkRatio(acc.home.for, acc.home.weight, leagueHomeRate),
      homeDefense: shrunkRatio(acc.home.against, acc.home.weight, leagueAwayRate),
      awayAttack: shrunkRatio(acc.away.for, acc.away.weight, leagueAwayRate),
      awayDefense: shrunkRatio(acc.away.against, acc.away.weight, leagueHomeRate),
      effectiveMatches: acc.home.weight + acc.away.weight,
      source: "club_history",
    });
  }
  const all = [...strengths.values()];
  return {
    leagueHomeRate,
    leagueAwayRate,
    strengths,
    proxy: {
      homeAttack: percentile(all.map((row) => row.homeAttack), 0.25),
      homeDefense: percentile(all.map((row) => row.homeDefense), 0.75),
      awayAttack: percentile(all.map((row) => row.awayAttack), 0.25),
      awayDefense: percentile(all.map((row) => row.awayDefense), 0.75),
    },
  };
}

function strengthFor(fit: UclFit, teamId: number): UclStrength {
  return fit.strengths.get(teamId) ?? { teamId, ...fit.proxy, effectiveMatches: 0, source: "promoted_proxy" };
}

function predictUclBaseline(fit: UclFit, homeTeamId: number, awayTeamId: number) {
  const home = strengthFor(fit, homeTeamId);
  const away = strengthFor(fit, awayTeamId);
  return {
    lambdaHome: Math.max(0.2, Math.min(3.8, fit.leagueHomeRate * home.homeAttack * away.awayDefense)),
    lambdaAway: Math.max(0.2, Math.min(3.8, fit.leagueAwayRate * away.awayAttack * home.homeDefense)),
    homeStrengthSource: home.source,
    awayStrengthSource: away.source,
    confidence: home.source === "promoted_proxy" || away.source === "promoted_proxy" ? "limited" as const : "standard" as const,
  };
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
  const uniqueHistory = [...new Map(history.map((row) => [row.id, row])).values()];
  const priorFor = (teamId: number) => uniqueHistory
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
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
  const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  const over25 = markets.total.over;
  const bttsYes = markets.btts.yes;
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
  const fit = fitUclModel(input.training, input.match.date);
  const baseline = predictUclBaseline(fit, input.match.home_team_id, input.match.away_team_id);
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
