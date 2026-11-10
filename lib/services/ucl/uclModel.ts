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
import { deriveUclStrengthScoreJoint, uclJointExpectedGoals } from "./uclEloConsensus";
import { uclScoreDistribution } from "./uclScoreDistribution";
import type { UclCurrentStrengthPrior } from "./uclCurrentStrengthPrior";
import type { UclEloPair } from "./uclEloStrengthFoundation";
import { fitUclPaidStats, UCL_PAID_STATS_INPUT_RELEASE, type UclPaidTrainingMatch } from "./uclPaidStatsFit";

export const UCL_MODEL_RELEASE = "ucl_goals_coherent_2026_11_10_r23_licensed_ucl_epl_stats" as const;
export const UCL_LEGACY_R22_MODEL_RELEASE = "ucl_goals_coherent_2026_11_04_r22_current_strength_scoring_prior" as const;
export const UCL_LEGACY_R22_CALIBRATION_RELEASE = "ucl_grade_policy_2026_11_04_r25_current_strength_scoring_prior" as const;
export const UCL_LEGACY_R21_MODEL_RELEASE = "ucl_goals_coherent_2026_11_04_r21_multibook_full_pregame_paths" as const;
export const UCL_BASELINE_MODEL_RELEASE = "ucl_goals_coherent_2026_10_06_r7_target_excluded_opening_market_score" as const;
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
  opponentFit?: { iterations: number; converged: boolean; uniqueMatches: number };
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
  release: typeof UCL_MODEL_RELEASE | typeof UCL_LEGACY_R22_MODEL_RELEASE;
  calibrationRelease: typeof UCL_CALIBRATION_RELEASE | typeof UCL_LEGACY_R22_CALIBRATION_RELEASE;
  adjustment: UclTravelRestContext & {
    homeMultiplier: number;
    awayMultiplier: number;
    neutralVenue: boolean;
    strengthPrior: "local_public_elo_consensus" | "shared_ucl_cross_league_scale" | "dated_current_strength_residual_prior" | "licensed_ucl_epl_results_xg";
    currentStrengthPrior?: { release: string; source: UclCurrentStrengthPrior["source"]; coefficientPer400: number; homeRating: number|null; awayRating: number|null };
    effectiveMatches: { home: number; away: number };
    opponentFit?: UclFit["opponentFit"];
    licensedStats?: {
      release: typeof UCL_PAID_STATS_INPUT_RELEASE; availableAt: string; sourceHash: string;
      uclRows: number; eplRows: number; homeAttack: number; homeDefense: number; awayAttack: number; awayDefense: number;
      uclHomeRate: number; uclAwayRate: number; priorExposure: number;
    };
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

/** Regularized Poisson attack/defense fit. Each club shares its strength across
 * venues and is evaluated against the actual opponent. Gamma mode-one priors
 * identify the attack/defense scales and retain the existing four-match prior
 * exposure. This is a statistical prior, not market evidence or a score bonus. */
export function fitUclOpponentModel(matches: EplTrainingMatch[], asOfIso: string, prior?: UclCurrentStrengthPrior): UclFit {
  if (prior && (!(Date.parse(prior.source.capturedAt) < Date.parse(asOfIso)) || !Number.isFinite(prior.coefficientPer400) || prior.coefficientPer400 <= 0)) throw Error("UCL strength prior unavailable before fixture");
  const asOf = Date.parse(asOfIso);
  const byId = new Map<number,EplTrainingMatch>();
  for (const m of matches) {
    if (!Number.isFinite(Date.parse(m.date)) || Date.parse(m.date) >= asOf || m.status_state !== "final"
      || m.home_score === null || m.away_score === null) continue;
    const prior = byId.get(m.id);
    const identity = (r:EplTrainingMatch) => JSON.stringify([r.date,r.home_team_id,r.away_team_id,r.home_score,r.away_score,r.home_xg,r.away_xg]);
    if (prior && identity(prior) !== identity(m)) throw new Error(`Conflicting UCL scoring fixture ${m.id}`);
    if (![m.home_score,m.away_score].every(g=>Number.isFinite(g)&&g>=0)) throw new Error(`Invalid UCL regulation goals ${m.id}`);
    byId.set(m.id,m);
  }
  const priorRows = [...byId.values()];
  const rows = priorRows.map(m => ({ home: m.home_team_id, away: m.away_team_id,
    homeGoals: effectiveGoals(m.home_score!, m.home_xg), awayGoals: effectiveGoals(m.away_score!, m.away_xg),
    weight: Math.pow(.5, (asOf - Date.parse(m.date)) / 86_400_000 / UCL_MODEL_CONFIG.halfLifeDays) }));
  const ids = [...new Set([...rows.flatMap(m => [m.home, m.away]), ...(prior?.ratings.keys() ?? [])])];
  // Today's attested strength is prior knowledge for today's static ability,
  // not a historical pre-match rating substituted into a replay. Mode-one
  // residual Gamma priors keep precision independent of an arbitrary Elo zero.
  const ratings = [...(prior?.ratings.values() ?? [])];
  const reference = ratings.length ? ratings.reduce((s,v)=>s+v,0)/ratings.length : 0;
  const offset = (id:number) => prior?.ratings.has(id) ? Math.exp(prior.coefficientPer400*(prior.ratings.get(id)!-reference)/400) : 1;
  const pairOffset = (own:number,opponent:number) => offset(own)/offset(opponent);
  const attack = new Map(ids.map(id => [id, 1])), defense = new Map(ids.map(id => [id, 1]));
  const weight = rows.reduce((s,m) => s + m.weight, 0);
  let homeRate = weight ? rows.reduce((s,m) => s + m.weight * m.homeGoals, 0) / weight : 1.5;
  let awayRate = weight ? rows.reduce((s,m) => s + m.weight * m.awayGoals, 0) / weight : 1.2;
  // A positive rate is required even in a synthetic all-zero cohort.
  homeRate = Math.max(1e-8, homeRate); awayRate = Math.max(1e-8, awayRate);
  const exposure = UCL_MODEL_CONFIG.shrinkageMatches * (homeRate + awayRate) / 2;
  let iterations = 0, converged = !rows.length;
  for (; iterations < (prior ? 2048 : 256) && !converged; iterations++) {
    const before = [...attack.values(), ...defense.values(), homeRate, awayRate];
    for (const id of ids) {
      let scored = exposure, predicted = exposure;
      for (const m of rows) {
        if (m.home === id) { scored += m.weight * m.homeGoals; predicted += m.weight * homeRate * pairOffset(m.home,m.away) * defense.get(m.away)!; }
        if (m.away === id) { scored += m.weight * m.awayGoals; predicted += m.weight * awayRate * pairOffset(m.away,m.home) * defense.get(m.home)!; }
      }
      attack.set(id, scored / predicted);
    }
    for (const id of ids) {
      let conceded = exposure, predicted = exposure;
      for (const m of rows) {
        if (m.home === id) { conceded += m.weight * m.awayGoals; predicted += m.weight * awayRate * pairOffset(m.away,m.home) * attack.get(m.away)!; }
        if (m.away === id) { conceded += m.weight * m.homeGoals; predicted += m.weight * homeRate * pairOffset(m.home,m.away) * attack.get(m.home)!; }
      }
      defense.set(id, conceded / predicted);
    }
    if (weight) {
      homeRate = Math.max(1e-8, rows.reduce((s,m) => s + m.weight * m.homeGoals, 0)
        / rows.reduce((s,m) => s + m.weight * pairOffset(m.home,m.away) * attack.get(m.home)! * defense.get(m.away)!, 0));
      awayRate = Math.max(1e-8, rows.reduce((s,m) => s + m.weight * m.awayGoals, 0)
        / rows.reduce((s,m) => s + m.weight * pairOffset(m.away,m.home) * attack.get(m.away)! * defense.get(m.home)!, 0));
    }
    const after = [...attack.values(), ...defense.values(), homeRate, awayRate];
    converged = after.every((v,i) => Math.abs(Math.log(v / before[i]!)) < 1e-8);
  }
  if (!converged) throw new Error("UCL opponent-adjusted scoring fit did not converge");
  const strengths = new Map<number,UclStrength>();
  for (const id of ids) strengths.set(id, { teamId: id, homeAttack: attack.get(id)!*offset(id), awayAttack: attack.get(id)!*offset(id),
    homeDefense: defense.get(id)!/offset(id), awayDefense: defense.get(id)!/offset(id),
    effectiveMatches: rows.reduce((s,m) => s + (m.home === id || m.away === id ? m.weight : 0), 0), source: rows.some(m=>m.home===id||m.away===id) ? "club_history" : "promoted_proxy" });
  return { leagueHomeRate: homeRate, leagueAwayRate: awayRate, strengths,
    proxy: { homeAttack: 1, awayAttack: 1, homeDefense: 1, awayDefense: 1 },
    opponentFit: { iterations, converged, uniqueMatches: rows.length } };
}

function strengthFor(fit: UclFit, teamId: number): UclStrength {
  return fit.strengths.get(teamId) ?? { teamId, ...fit.proxy, effectiveMatches: 0, source: "promoted_proxy" };
}

function predictUclBaseline(fit: UclFit, homeTeamId: number, awayTeamId: number, uncapped = false) {
  const home = strengthFor(fit, homeTeamId);
  const away = strengthFor(fit, awayTeamId);
  const minRate = fit.opponentFit ? 1e-8 : .2;
  return {
    lambdaHome: Math.max(minRate, Math.min(uncapped ? Infinity : 3.8, fit.leagueHomeRate * home.homeAttack * away.awayDefense)),
    lambdaAway: Math.max(minRate, Math.min(uncapped ? Infinity : 3.8, fit.leagueAwayRate * away.awayAttack * home.homeDefense)),
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

function summarize(lambdaHome: number, lambdaAway: number, coherentJoint?: ReturnType<typeof bivariatePoissonScoreDistribution>): Omit<EplShadowPrediction,
  "release" | "calibrationRelease" | "homeStrengthSource" | "awayStrengthSource" | "confidence"> {
  const joint = coherentJoint ?? bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
  const expected = uclJointExpectedGoals(joint);
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
    lambdaHome: expected.home,
    lambdaAway: expected.away,
    expectedTotal: expected.home + expected.away,
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
    coherentJoint,
  };
}

type UclPredictionInput = {
  training: EplTrainingMatch[];
  match: BdlUclMatch;
  history: BdlUclMatch[];
  context: UclCompetitionContext;
};

function fitAndPredictUclInternal(
  input: UclPredictionInput & { elo?: UclEloPair; strengthPrior?: UclCurrentStrengthPrior },
  release: typeof UCL_LEGACY_R22_MODEL_RELEASE | typeof UCL_BASELINE_MODEL_RELEASE | typeof UCL_LEGACY_R21_MODEL_RELEASE,
) {
  const fit = release === UCL_BASELINE_MODEL_RELEASE ? fitUclModel(input.training, input.match.date)
    : fitUclOpponentModel(input.training, input.match.date, input.strengthPrior);
  const baseline = predictUclBaseline(fit, input.match.home_team_id, input.match.away_team_id, !!input.strengthPrior);
  const rest = buildUclTravelRestContext(input.match, input.history);
  const neutralMultiplier = input.context.neutralVenue ? Math.sqrt(fit.leagueAwayRate / fit.leagueHomeRate) : 1;
  const homeMultiplier = fatigueMultiplier(rest.homeRestDays, rest.homeMatchesLast14Days) * neutralMultiplier;
  const awayMultiplier = fatigueMultiplier(rest.awayRestDays, rest.awayMatchesLast14Days)
    * (input.strengthPrior && input.context.neutralVenue ? 1/neutralMultiplier : 1)
    * (!(input.strengthPrior && input.context.neutralVenue) && rest.awayTravelKm !== null && rest.awayTravelKm >= 2_000 ? 0.96 : 1);
  const minRate = fit.opponentFit ? 1e-8 : .2;
  const lambdaHome = Math.max(minRate, baseline.lambdaHome * homeMultiplier);
  const lambdaAway = Math.max(minRate, baseline.lambdaAway * awayMultiplier);
  const baseJoint = input.strengthPrior ? uclScoreDistribution(lambdaHome,lambdaAway,UCL_MODEL_CONFIG.dixonColesTau)
    : bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
  const coherentJoint = input.strengthPrior ? baseJoint : input.elo ? deriveUclStrengthScoreJoint(baseJoint, input.elo) : undefined;
  return {
    release,
    calibrationRelease: release === UCL_LEGACY_R21_MODEL_RELEASE ? "ucl_grade_policy_2026_11_04_r24_multibook_full_pregame_paths" as const : UCL_LEGACY_R22_CALIBRATION_RELEASE,
    ...summarize(lambdaHome, lambdaAway, coherentJoint),
    homeStrengthSource: baseline.homeStrengthSource,
    awayStrengthSource: baseline.awayStrengthSource,
    confidence: baseline.confidence,
    adjustment: {
      ...rest,
      homeMultiplier,
      awayMultiplier,
      neutralVenue: input.context.neutralVenue === true,
      effectiveMatches: { home: strengthFor(fit,input.match.home_team_id).effectiveMatches, away: strengthFor(fit,input.match.away_team_id).effectiveMatches },
      ...(input.strengthPrior ? {currentStrengthPrior:{release:input.strengthPrior.release,source:input.strengthPrior.source,coefficientPer400:input.strengthPrior.coefficientPer400,
        homeRating:input.strengthPrior.ratings.get(input.match.home_team_id)??null,awayRating:input.strengthPrior.ratings.get(input.match.away_team_id)??null}} : {}),
      strengthPrior: input.strengthPrior ? "dated_current_strength_residual_prior" as const : input.elo ? "local_public_elo_consensus" as const : "shared_ucl_cross_league_scale" as const,
      ...(fit.opponentFit ? { opponentFit: fit.opponentFit } : {}),
    },
  };
}

/** Explicit retired R22/R21/R7 comparators. Production uses the licensed-input
 * function below; a retired source cannot acquire the active release stamp. */
export function fitAndPredictUcl(input: UclPredictionInput & { strengthPrior: UclCurrentStrengthPrior }): UclPrediction;
export function fitAndPredictUcl(input: UclPredictionInput & { elo: UclEloPair }): ReturnType<typeof fitAndPredictUclInternal>;
export function fitAndPredictUcl(input: UclPredictionInput): ReturnType<typeof fitAndPredictUclInternal>;
export function fitAndPredictUcl(input: UclPredictionInput & { elo?: UclEloPair; strengthPrior?: UclCurrentStrengthPrior }): UclPrediction | ReturnType<typeof fitAndPredictUclInternal> {
  return fitAndPredictUclInternal(input, input.strengthPrior ? UCL_LEGACY_R22_MODEL_RELEASE : input.elo ? UCL_LEGACY_R21_MODEL_RELEASE : UCL_BASELINE_MODEL_RELEASE);
}

/** Historical r7 comparator only; ineligible for new active-release writes. */
export function fitAndPredictUclBaseline(input: UclPredictionInput) {
  return fitAndPredictUclInternal(input, UCL_BASELINE_MODEL_RELEASE);
}

export function fitAndPredictUclPaidStats(input: UclPredictionInput & {
  paidTraining: UclPaidTrainingMatch[]; availableAt: string;
}): UclPrediction {
  if (!Number.isFinite(Date.parse(input.availableAt)) || Date.parse(input.availableAt) >= Date.parse(input.match.date))
    throw Error("Licensed UCL inputs unavailable before fixture");
  const fit = fitUclPaidStats(input.paidTraining, input.match.date), rates = fit.rates.get("ucl")!;
  const home = input.match.home_team_id, away = input.match.away_team_id;
  const homeKnown = fit.attack.has(home), awayKnown = fit.attack.has(away);
  const rest = buildUclTravelRestContext(input.match, input.history);
  const neutral = input.context.neutralVenue ? Math.sqrt(rates.a / rates.h) : 1;
  const homeMultiplier = fatigueMultiplier(rest.homeRestDays, rest.homeMatchesLast14Days) * neutral;
  const awayMultiplier = fatigueMultiplier(rest.awayRestDays, rest.awayMatchesLast14Days) / neutral;
  // An unseen club has the explicit released mode-one cohort prior, never a
  // fabricated club rating or claimed observed history.
  const homeAttack = fit.attack.get(home) ?? 1, homeDefense = fit.defense.get(home) ?? 1;
  const awayAttack = fit.attack.get(away) ?? 1, awayDefense = fit.defense.get(away) ?? 1;
  const lambdaHome = rates.h * homeAttack * awayDefense * homeMultiplier;
  const lambdaAway = rates.a * awayAttack * homeDefense * awayMultiplier;
  const joint = uclScoreDistribution(lambdaHome, lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
  return {
    release: UCL_MODEL_RELEASE, calibrationRelease: UCL_CALIBRATION_RELEASE,
    ...summarize(lambdaHome, lambdaAway, joint), homeStrengthSource: homeKnown ? "club_history" : "promoted_proxy",
    awayStrengthSource: awayKnown ? "club_history" : "promoted_proxy", confidence: homeKnown && awayKnown ? "standard" : "limited",
    adjustment: { ...rest, homeMultiplier, awayMultiplier, neutralVenue: input.context.neutralVenue === true,
      strengthPrior: "licensed_ucl_epl_results_xg",
      effectiveMatches: { home: fit.effectiveMatches.get(home) ?? 0, away: fit.effectiveMatches.get(away) ?? 0 },
      opponentFit: { iterations: fit.iterations, converged: fit.converged, uniqueMatches: fit.rows },
      licensedStats: { release: UCL_PAID_STATS_INPUT_RELEASE, availableAt: input.availableAt, sourceHash: fit.sourceHash,
        uclRows: fit.uclRows, eplRows: fit.eplRows, homeAttack, homeDefense, awayAttack, awayDefense,
        uclHomeRate: rates.h, uclAwayRate: rates.a, priorExposure: fit.exposure },
    },
  };
}
