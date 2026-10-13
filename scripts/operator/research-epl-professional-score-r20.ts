/* eslint-disable @typescript-eslint/no-explicit-any -- versioned historical snapshot is validated at the storage boundary */
import { createClient } from "@supabase/supabase-js";
import type { BdlEplTeamMatchStats } from "../../lib/providers/real_api/BallDontLieEplProvider";
import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import {
  fitEplShadowModel,
  predictEplMatch,
  selectEplMatchResultSide,
  type EplTrainingMatch,
} from "../../lib/services/epl/eplShadowModel";

type Side = "home" | "draw" | "away";
type CandidateConfig = {
  halfLifeDays: 240 | 365;
  shrinkageMatches: 6 | 10;
  xgWeight: 0.2 | 0.35;
  processWeight: 0.15 | 0.3;
  dixonColesTau: -0.1 | -0.15;
};
type ExtendedMatch = EplTrainingMatch & {
  homeStats: BdlEplTeamMatchStats | null;
  awayStats: BdlEplTeamMatchStats | null;
};
type TeamFactors = { attack: number; defenseWeakness: number; effectiveMatches: number };
type CandidateFit = {
  baseHome: number;
  baseAway: number;
  factors: Map<number, TeamFactors>;
  history: ExtendedMatch[];
  baselines: { shots: number; shotsOnTarget: number; possession: number; xg: number };
  config: CandidateConfig;
};
type Forecast = {
  home: number;
  away: number;
  probabilities: { home: number; draw: number; away: number; over: number; btts: number };
  side: Side;
};
type Evaluated = Forecast & {
  actualHome: number;
  actualAway: number;
  actualSide: Side;
};
type Metric = {
  matches: number;
  resultAccuracy: number;
  resultBrier: number;
  resultLogLoss: number;
  teamScoreMae: number;
  totalMae: number;
  marginMae: number;
  totalBrier: number;
  bttsBrier: number;
  totalAccuracy: number;
  bttsAccuracy: number;
  projectedTeamSd: number;
  actualTeamSd: number;
  teamScoreCorrelation: number | null;
  totalCorrelation: number | null;
  marginCorrelation: number | null;
  selectedSides: Record<Side, number>;
};

const SNAPSHOT_KEY = "soccer::english_premier_league::historical-foundation::through-2025";
const safeLog = (value: number) => Math.log(Math.max(1e-9, Math.min(1 - 1e-9, value)));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function actualSide(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function weightedMean(rows: Array<{ value: number; weight: number }>, fallback: number): number {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return totalWeight > 0 ? rows.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight : fallback;
}

function effectiveGoal(goal: number, xg: number | null, xgWeight: number): number {
  return finite(xg) && xg >= 0 ? (1 - xgWeight) * goal + xgWeight * xg : goal;
}

function enrich(matches: EplTrainingMatch[], stats: BdlEplTeamMatchStats[]): ExtendedMatch[] {
  const byMatchTeam = new Map(stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  return matches.map((match) => ({
    ...match,
    homeStats: byMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? null,
    awayStats: byMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? null,
  }));
}

function baseline(rows: ExtendedMatch[], key: keyof BdlEplTeamMatchStats, fallback: number): number {
  const values = rows.flatMap((row) => [row.homeStats?.[key], row.awayStats?.[key]])
    .filter((value): value is number => finite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function fitCandidate(matches: ExtendedMatch[], asOfIso: string, config: CandidateConfig): CandidateFit {
  const asOf = Date.parse(asOfIso);
  const history = matches.filter((match) => Date.parse(match.date) < asOf && match.home_score !== null && match.away_score !== null);
  const weighted = history.map((match) => ({
    match,
    weight: Math.pow(0.5, Math.max(0, (asOf - Date.parse(match.date)) / 86_400_000) / config.halfLifeDays),
  }));
  const baseHome = weightedMean(weighted.map(({ match, weight }) => ({ value: effectiveGoal(match.home_score!, match.home_xg, config.xgWeight), weight })), 1.5);
  const baseAway = weightedMean(weighted.map(({ match, weight }) => ({ value: effectiveGoal(match.away_score!, match.away_xg, config.xgWeight), weight })), 1.2);
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
      const targetHome = effectiveGoal(match.home_score!, match.home_xg, config.xgWeight);
      const targetAway = effectiveGoal(match.away_score!, match.away_xg, config.xgWeight);
      const homeResidual = Math.log((targetHome + 0.35) / (predictedHome + 0.35));
      const awayResidual = Math.log((targetAway + 0.35) / (predictedAway + 0.35));
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
      const reliability = effectiveMatches / (effectiveMatches + config.shrinkageMatches);
      const attackStep = weightedMean(attackRows, 0);
      const defenseStep = weightedMean(defenseRows, 0);
      current.attack = Math.exp((Math.log(current.attack) + 0.42 * attackStep) * reliability);
      current.defenseWeakness = Math.exp((Math.log(current.defenseWeakness) + 0.42 * defenseStep) * reliability);
      current.effectiveMatches = effectiveMatches;
    }
    const normalize = (key: "attack" | "defenseWeakness") => {
      const meanLog = teamIds.reduce((sum, id) => sum + Math.log(factors.get(id)![key]), 0) / Math.max(1, teamIds.length);
      for (const id of teamIds) factors.get(id)![key] /= Math.exp(meanLog);
    };
    normalize("attack");
    normalize("defenseWeakness");
  }
  return {
    baseHome,
    baseAway,
    factors,
    history,
    baselines: {
      shots: baseline(history, "shots", 12),
      shotsOnTarget: baseline(history, "shots_on_target", 4.2),
      possession: baseline(history, "possession_pct", 50),
      xg: baseline(history, "expected_goals", (baseHome + baseAway) / 2),
    },
    config,
  };
}

function teamProcess(fit: CandidateFit, teamId: number) {
  const rows = fit.history.filter((match) => match.home_team_id === teamId || match.away_team_id === teamId).slice(-8);
  const observations = rows.map((match) => {
    const home = match.home_team_id === teamId;
    const own = home ? match.homeStats : match.awayStats;
    const opponent = home ? match.awayStats : match.homeStats;
    return { own, opponent };
  });
  const avg = (values: Array<number | null | undefined>, fallback: number) => {
    const present = values.filter((value): value is number => finite(value));
    return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : fallback;
  };
  const logBlend = (parts: Array<{ ratio: number; weight: number }>) => {
    const usable = parts.filter((part) => finite(part.ratio) && part.ratio > 0);
    const total = usable.reduce((sum, part) => sum + part.weight, 0);
    return total > 0 ? usable.reduce((sum, part) => sum + part.weight * Math.log(clamp(part.ratio, 0.55, 1.8)), 0) / total : 0;
  };
  const attack = logBlend([
    { ratio: avg(observations.map((row) => row.own?.shots_on_target), fit.baselines.shotsOnTarget) / fit.baselines.shotsOnTarget, weight: 0.5 },
    { ratio: avg(observations.map((row) => row.own?.shots), fit.baselines.shots) / fit.baselines.shots, weight: 0.25 },
    { ratio: avg(observations.map((row) => row.own?.possession_pct), fit.baselines.possession) / fit.baselines.possession, weight: 0.1 },
    { ratio: avg(observations.map((row) => row.own?.expected_goals), fit.baselines.xg) / fit.baselines.xg, weight: 0.15 },
  ]);
  const defenseWeakness = logBlend([
    { ratio: avg(observations.map((row) => row.opponent?.shots_on_target), fit.baselines.shotsOnTarget) / fit.baselines.shotsOnTarget, weight: 0.6 },
    { ratio: avg(observations.map((row) => row.opponent?.shots), fit.baselines.shots) / fit.baselines.shots, weight: 0.25 },
    { ratio: avg(observations.map((row) => row.opponent?.expected_goals), fit.baselines.xg) / fit.baselines.xg, weight: 0.15 },
  ]);
  const reliability = rows.length / (rows.length + 4);
  return { attack: attack * reliability, defenseWeakness: defenseWeakness * reliability };
}

function forecastFromLambdas(lambdaHome: number, lambdaAway: number, tau: number): Forecast {
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, tau);
  const market = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  let likely = { home: 0, away: 0, probability: joint[0]![0]! };
  for (let h = 0; h < joint.length; h++) for (let a = 0; a < joint[h]!.length; a++) {
    if (joint[h]![a]! > likely.probability) likely = { home: h, away: a, probability: joint[h]![a]! };
  }
  const arbitration = selectEplMatchResultSide({
    lambdaHome,
    lambdaAway,
    likelyScore: likely,
    probabilities: {
      home: market.match_result.home,
      draw: market.match_result.draw,
      away: market.match_result.away,
      over25: market.total.over,
      under25: market.total.under,
      bttsYes: market.btts.yes,
      bttsNo: market.btts.no,
    },
  });
  return {
    home: lambdaHome,
    away: lambdaAway,
    side: arbitration.side,
    probabilities: {
      home: market.match_result.home,
      draw: market.match_result.draw,
      away: market.match_result.away,
      over: 0.6 * market.total.over + 0.4 * 0.5,
      btts: 0.65 * market.btts.yes + 0.35 * 0.5,
    },
  };
}

function predictCandidate(fit: CandidateFit, homeTeamId: number, awayTeamId: number): Forecast {
  const home = fit.factors.get(homeTeamId) ?? { attack: 1, defenseWeakness: 1, effectiveMatches: 0 };
  const away = fit.factors.get(awayTeamId) ?? { attack: 1, defenseWeakness: 1, effectiveMatches: 0 };
  const homeProcess = teamProcess(fit, homeTeamId);
  const awayProcess = teamProcess(fit, awayTeamId);
  const homeProcessMultiplier = Math.exp(fit.config.processWeight * (homeProcess.attack + awayProcess.defenseWeakness));
  const awayProcessMultiplier = Math.exp(fit.config.processWeight * (awayProcess.attack + homeProcess.defenseWeakness));
  const lambdaHome = clamp(fit.baseHome * home.attack * away.defenseWeakness * homeProcessMultiplier, 0.2, 4.2);
  const lambdaAway = clamp(fit.baseAway * away.attack * home.defenseWeakness * awayProcessMultiplier, 0.2, 4.2);
  return forecastFromLambdas(lambdaHome, lambdaAway, fit.config.dixonColesTau);
}

function predictIncumbent(history: ExtendedMatch[], match: ExtendedMatch): Forecast {
  const prediction = predictEplMatch(fitEplShadowModel(history, match.date), match.home_team_id, match.away_team_id);
  return {
    home: prediction.lambdaHome,
    away: prediction.lambdaAway,
    side: selectEplMatchResultSide(prediction).side,
    probabilities: {
      home: prediction.probabilities.home,
      draw: prediction.probabilities.draw,
      away: prediction.probabilities.away,
      over: prediction.probabilities.over25,
      btts: prediction.probabilities.bttsYes,
    },
  };
}

function evaluateSeason(all: ExtendedMatch[], season: number, config: CandidateConfig | null): Evaluated[] {
  const seasonRows = all.filter((match) => match.season === season).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const earlier = all.filter((match) => match.season < season);
  const groups = new Map<string, ExtendedMatch[]>();
  for (const match of seasonRows) {
    const key = String(match.round_number ?? match.date.slice(0, 10));
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  const completed: ExtendedMatch[] = [];
  const output: Evaluated[] = [];
  for (const round of groups.values()) {
    const history = [...earlier, ...completed];
    const fit = config ? fitCandidate(history, round[0]!.date, config) : null;
    for (const match of round) {
      const forecast = fit ? predictCandidate(fit, match.home_team_id, match.away_team_id) : predictIncumbent(history, match);
      output.push({ ...forecast, actualHome: match.home_score!, actualAway: match.away_score!, actualSide: actualSide(match.home_score!, match.away_score!) });
    }
    completed.push(...round);
  }
  return output;
}

function evaluateHybridSeason(all: ExtendedMatch[], season: number, config: CandidateConfig, candidateMarginWeight: number): Evaluated[] {
  const seasonRows = all.filter((match) => match.season === season).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const earlier = all.filter((match) => match.season < season);
  const groups = new Map<string, ExtendedMatch[]>();
  for (const match of seasonRows) {
    const key = String(match.round_number ?? match.date.slice(0, 10));
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  const completed: ExtendedMatch[] = [];
  const output: Evaluated[] = [];
  for (const round of groups.values()) {
    const history = [...earlier, ...completed];
    const candidateFit = fitCandidate(history, round[0]!.date, config);
    const incumbentFit = fitEplShadowModel(history, round[0]!.date);
    for (const match of round) {
      const incumbent = predictEplMatch(incumbentFit, match.home_team_id, match.away_team_id);
      const candidate = predictCandidate(candidateFit, match.home_team_id, match.away_team_id);
      const total = incumbent.lambdaHome + incumbent.lambdaAway;
      const incumbentMargin = incumbent.lambdaHome - incumbent.lambdaAway;
      const candidateMargin = candidate.home - candidate.away;
      const margin = (1 - candidateMarginWeight) * incumbentMargin + candidateMarginWeight * candidateMargin;
      const maximumMargin = Math.max(0, total - 0.4);
      const boundedMargin = clamp(margin, -maximumMargin, maximumMargin);
      const forecast = forecastFromLambdas((total + boundedMargin) / 2, (total - boundedMargin) / 2, config.dixonColesTau);
      output.push({ ...forecast, actualHome: match.home_score!, actualAway: match.away_score!, actualSide: actualSide(match.home_score!, match.away_score!) });
    }
    completed.push(...round);
  }
  return output;
}

function correlation(a: number[], b: number[]): number | null {
  if (a.length < 2 || a.length !== b.length) return null;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index]! - meanB), 0);
  const denomA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0));
  const denomB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denomA > 0 && denomB > 0 ? numerator / (denomA * denomB) : null;
}

function sd(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function metrics(rows: Evaluated[]): Metric {
  const sideIndex: Record<Side, number> = { home: 0, draw: 1, away: 2 };
  const projectedTeams = rows.flatMap((row) => [row.home, row.away]);
  const actualTeams = rows.flatMap((row) => [row.actualHome, row.actualAway]);
  const projectedTotals = rows.map((row) => row.home + row.away);
  const actualTotals = rows.map((row) => row.actualHome + row.actualAway);
  const projectedMargins = rows.map((row) => row.home - row.away);
  const actualMargins = rows.map((row) => row.actualHome - row.actualAway);
  const probabilityVector = (row: Evaluated) => [row.probabilities.home, row.probabilities.draw, row.probabilities.away];
  return {
    matches: rows.length,
    resultAccuracy: rows.filter((row) => row.side === row.actualSide).length / rows.length,
    resultBrier: rows.reduce((sum, row) => sum + probabilityVector(row).reduce((inner, probability, index) => inner + (probability - Number(index === sideIndex[row.actualSide])) ** 2, 0), 0) / rows.length,
    resultLogLoss: rows.reduce((sum, row) => sum - safeLog(probabilityVector(row)[sideIndex[row.actualSide]]!), 0) / rows.length,
    teamScoreMae: projectedTeams.reduce((sum, value, index) => sum + Math.abs(value - actualTeams[index]!), 0) / projectedTeams.length,
    totalMae: projectedTotals.reduce((sum, value, index) => sum + Math.abs(value - actualTotals[index]!), 0) / rows.length,
    marginMae: projectedMargins.reduce((sum, value, index) => sum + Math.abs(value - actualMargins[index]!), 0) / rows.length,
    totalBrier: rows.reduce((sum, row) => sum + (row.probabilities.over - Number(row.actualHome + row.actualAway > 2.5)) ** 2, 0) / rows.length,
    bttsBrier: rows.reduce((sum, row) => sum + (row.probabilities.btts - Number(row.actualHome > 0 && row.actualAway > 0)) ** 2, 0) / rows.length,
    totalAccuracy: rows.filter((row) => (row.probabilities.over >= 0.5) === (row.actualHome + row.actualAway > 2.5)).length / rows.length,
    bttsAccuracy: rows.filter((row) => (row.probabilities.btts >= 0.5) === (row.actualHome > 0 && row.actualAway > 0)).length / rows.length,
    projectedTeamSd: sd(projectedTeams),
    actualTeamSd: sd(actualTeams),
    teamScoreCorrelation: correlation(projectedTeams, actualTeams),
    totalCorrelation: correlation(projectedTotals, actualTotals),
    marginCorrelation: correlation(projectedMargins, actualMargins),
    selectedSides: {
      home: rows.filter((row) => row.side === "home").length,
      draw: rows.filter((row) => row.side === "draw").length,
      away: rows.filter((row) => row.side === "away").length,
    },
  };
}

function selectionScore(candidate: Metric, incumbent: Metric): number {
  const binaryPenalty = Math.max(0, candidate.totalBrier - incumbent.totalBrier - 0.002)
    + Math.max(0, candidate.bttsBrier - incumbent.bttsBrier - 0.002);
  return candidate.teamScoreMae + 0.18 * candidate.resultLogLoss + 8 * binaryPenalty;
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.from("lab_response_snapshots").select("payload").eq("snapshot_key", SNAPSHOT_KEY).single();
  if (error) throw error;
  const payload = data.payload as any;
  const all = enrich(payload.trainingMatches as EplTrainingMatch[], payload.teamStats as BdlEplTeamMatchStats[]);
  const incumbentSelectionRows = evaluateSeason(all, 2024, null);
  const incumbentSelection = metrics(incumbentSelectionRows);
  const configs: CandidateConfig[] = [];
  for (const halfLifeDays of [240, 365] as const)
    for (const shrinkageMatches of [6, 10] as const)
      for (const xgWeight of [0.2, 0.35] as const)
        for (const processWeight of [0.15, 0.3] as const)
          for (const dixonColesTau of [-0.1, -0.15] as const)
            configs.push({ halfLifeDays, shrinkageMatches, xgWeight, processWeight, dixonColesTau });
  const trials = configs.map((config) => {
    const candidate = metrics(evaluateSeason(all, 2024, config));
    return { config, candidate, score: selectionScore(candidate, incumbentSelection) };
  }).sort((a, b) => a.score - b.score);
  const selected = trials[0]!;
  const hybridTrials = [0.25, 0.5, 0.75, 1].map((candidateMarginWeight) => {
    const candidate = metrics(evaluateHybridSeason(all, 2024, selected.config, candidateMarginWeight));
    return { candidateMarginWeight, candidate, score: selectionScore(candidate, incumbentSelection) };
  }).sort((a, b) => a.score - b.score);
  const selectedHybrid = hybridTrials[0]!;
  const incumbentHoldout = metrics(evaluateSeason(all, 2025, null));
  const candidateHoldout = metrics(evaluateSeason(all, 2025, selected.config));
  const hybridHoldout = metrics(evaluateHybridSeason(all, 2025, selected.config, selectedHybrid.candidateMarginWeight));
  console.log(JSON.stringify({
    protocol: "2022_2023_foundation__2024_selection__2025_untouched_holdout",
    candidateFamily: "shared_attack_defence_poisson_with_prior_match_process_features",
    providerCalls: 0,
    rows: all.length,
    selected,
    selection: { incumbent: incumbentSelection, candidate: selected.candidate },
    holdout: { incumbent: incumbentHoldout, candidate: candidateHoldout },
    coherentTotalMarginHybrid: {
      selection: { incumbent: incumbentSelection, selected: selectedHybrid, trials: hybridTrials },
      holdout: { incumbent: incumbentHoldout, candidate: hybridHoldout },
    },
    topTrials: trials.slice(0, 8),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
