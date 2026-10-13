/* eslint-disable @typescript-eslint/no-explicit-any -- versioned historical snapshot is validated at its storage boundary */
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
type ExtendedMatch = EplTrainingMatch & { homeStats: BdlEplTeamMatchStats | null; awayStats: BdlEplTeamMatchStats | null };
type Example = { season: number; matchId: number; homeObservation: boolean; x: number[]; y: number; actualOpponent: number };
type Scaler = { mean: number[]; sd: number[] };
type Fit = { weights: number[]; scaler: Scaler; l2: number };
type MatchForecast = { season: number; matchId: number; home: number; away: number; actualHome: number; actualAway: number };
type Metrics = ReturnType<typeof metrics>;

const SNAPSHOT_KEY = "soccer::english_premier_league::historical-foundation::through-2025";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const safeLog = (value: number) => Math.log(Math.max(1e-9, Math.min(1 - 1e-9, value)));

function enrich(matches: EplTrainingMatch[], stats: BdlEplTeamMatchStats[]): ExtendedMatch[] {
  const byMatchTeam = new Map(stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  return matches.map((match) => ({
    ...match,
    homeStats: byMatchTeam.get(`${match.id}:${match.home_team_id}`) ?? null,
    awayStats: byMatchTeam.get(`${match.id}:${match.away_team_id}`) ?? null,
  }));
}

type TeamRow = {
  date: string;
  goalsFor: number;
  goalsAgainst: number;
  shotsFor: number | null;
  shotsAgainst: number | null;
  sotFor: number | null;
  sotAgainst: number | null;
  possession: number | null;
  points: number;
};

function teamRows(history: ExtendedMatch[], teamId: number): TeamRow[] {
  return history.flatMap((match) => {
    if (match.home_team_id !== teamId && match.away_team_id !== teamId) return [];
    const home = match.home_team_id === teamId;
    const own = home ? match.homeStats : match.awayStats;
    const opponent = home ? match.awayStats : match.homeStats;
    const goalsFor = home ? match.home_score! : match.away_score!;
    const goalsAgainst = home ? match.away_score! : match.home_score!;
    return [{
      date: match.date,
      goalsFor,
      goalsAgainst,
      shotsFor: finite(own?.shots) ? own!.shots : null,
      shotsAgainst: finite(opponent?.shots) ? opponent!.shots : null,
      sotFor: finite(own?.shots_on_target) ? own!.shots_on_target : null,
      sotAgainst: finite(opponent?.shots_on_target) ? opponent!.shots_on_target : null,
      possession: finite(own?.possession_pct) ? own!.possession_pct : null,
      points: goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
    }];
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function average(rows: TeamRow[], key: keyof Omit<TeamRow, "date">, fallback: number) {
  const values = rows.map((row) => row[key]).filter((value): value is number => finite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function profile(history: ExtendedMatch[], teamId: number, window: number) {
  const rows = teamRows(history, teamId).slice(-window);
  return {
    games: rows.length,
    goalsFor: average(rows, "goalsFor", 1.35),
    goalsAgainst: average(rows, "goalsAgainst", 1.35),
    shotsFor: average(rows, "shotsFor", 12),
    shotsAgainst: average(rows, "shotsAgainst", 12),
    sotFor: average(rows, "sotFor", 4.2),
    sotAgainst: average(rows, "sotAgainst", 4.2),
    possession: average(rows, "possession", 50),
    points: average(rows, "points", 1.35),
    lastDate: rows.at(-1)?.date ?? null,
  };
}

function daysRest(lastDate: string | null, kickoff: string): number {
  if (!lastDate) return 7;
  return clamp((Date.parse(kickoff) - Date.parse(lastDate)) / 86_400_000, 2, 21);
}

function featureVector(input: {
  history: ExtendedMatch[];
  match: ExtendedMatch;
  ownTeamId: number;
  opponentTeamId: number;
  isHome: boolean;
  baselineLambda: number;
}) {
  const own5 = profile(input.history, input.ownTeamId, 5);
  const own10 = profile(input.history, input.ownTeamId, 10);
  const opponent5 = profile(input.history, input.opponentTeamId, 5);
  const opponent10 = profile(input.history, input.opponentTeamId, 10);
  const ownAttack = 0.55 * own10.sotFor / 4.2 + 0.25 * own10.shotsFor / 12 + 0.2 * own10.goalsFor / 1.35;
  const opponentWeakness = 0.55 * opponent10.sotAgainst / 4.2 + 0.25 * opponent10.shotsAgainst / 12 + 0.2 * opponent10.goalsAgainst / 1.35;
  const baselineLambda = finite(input.baselineLambda) ? input.baselineLambda : input.isHome ? 1.5 : 1.2;
  return [
    Math.log(clamp(baselineLambda, 0.2, 4.2)),
    Number(input.isHome),
    own5.goalsFor, own5.goalsAgainst, own5.sotFor, own5.sotAgainst, own5.shotsFor, own5.shotsAgainst, own5.possession / 50, own5.points / 3,
    own10.goalsFor, own10.goalsAgainst, own10.sotFor, own10.sotAgainst,
    opponent5.goalsFor, opponent5.goalsAgainst, opponent5.sotFor, opponent5.sotAgainst, opponent5.shotsFor, opponent5.shotsAgainst, opponent5.possession / 50, opponent5.points / 3,
    opponent10.goalsFor, opponent10.goalsAgainst, opponent10.sotFor, opponent10.sotAgainst,
    ownAttack, opponentWeakness, ownAttack * opponentWeakness,
    daysRest(own5.lastDate, input.match.date), daysRest(opponent5.lastDate, input.match.date),
    Math.log1p(own10.games), Math.log1p(opponent10.games),
  ];
}

function buildExamples(all: ExtendedMatch[]): Example[] {
  const output: Example[] = [];
  for (const season of [...new Set(all.map((match) => match.season))].sort()) {
    const seasonRows = all.filter((match) => match.season === season).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const earlier = all.filter((match) => match.season < season);
    const completed: ExtendedMatch[] = [];
    const rounds = new Map<string, ExtendedMatch[]>();
    for (const match of seasonRows) {
      const key = String(match.round_number ?? match.date.slice(0, 10));
      rounds.set(key, [...(rounds.get(key) ?? []), match]);
    }
    for (const round of rounds.values()) {
      const history = [...earlier, ...completed];
      const fit = fitEplShadowModel(history, round[0]!.date);
      for (const match of round) {
        const baseline = predictEplMatch(fit, match.home_team_id, match.away_team_id);
        output.push({
          season,
          matchId: match.id,
          homeObservation: true,
          x: featureVector({ history, match, ownTeamId: match.home_team_id, opponentTeamId: match.away_team_id, isHome: true, baselineLambda: baseline.lambdaHome }),
          y: match.home_score!,
          actualOpponent: match.away_score!,
        });
        output.push({
          season,
          matchId: match.id,
          homeObservation: false,
          x: featureVector({ history, match, ownTeamId: match.away_team_id, opponentTeamId: match.home_team_id, isHome: false, baselineLambda: baseline.lambdaAway }),
          y: match.away_score!,
          actualOpponent: match.home_score!,
        });
      }
      completed.push(...round);
    }
  }
  return output;
}

function scaler(rows: Example[]): Scaler {
  const width = rows[0]!.x.length;
  const mean = Array.from({ length: width }, (_, index) => rows.reduce((sum, row) => sum + row.x[index]!, 0) / rows.length);
  const sd = mean.map((value, index) => Math.max(1e-5, Math.sqrt(rows.reduce((sum, row) => sum + (row.x[index]! - value) ** 2, 0) / rows.length)));
  return { mean, sd };
}

function vector(row: Example, scale: Scaler): number[] {
  return [1, ...row.x.map((value, index) => (value - scale.mean[index]!) / scale.sd[index]!)];
}

function train(rows: Example[], l2: number): Fit {
  const scale = scaler(rows);
  const weights = Array(rows[0]!.x.length + 1).fill(0);
  weights[0] = Math.log(rows.reduce((sum, row) => sum + row.y, 0) / rows.length);
  for (let iteration = 0; iteration < 4_000; iteration++) {
    const gradient = Array(weights.length).fill(0);
    for (const row of rows) {
      const x = vector(row, scale);
      const eta = clamp(x.reduce((sum, value, index) => sum + value * weights[index]!, 0), -1.6, 1.5);
      const lambda = Math.exp(eta);
      for (let index = 0; index < weights.length; index++) gradient[index] += (lambda - row.y) * x[index]!;
    }
    for (let index = 1; index < weights.length; index++) gradient[index] += l2 * weights[index]!;
    const rate = 0.035 / Math.sqrt(1 + iteration / 200);
    const maxGradient = Math.max(...gradient.map((value) => Math.abs(value / rows.length)));
    for (let index = 0; index < weights.length; index++) weights[index] -= rate * gradient[index]! / rows.length;
    if (maxGradient < 1e-7) break;
  }
  return { weights, scaler: scale, l2 };
}

function predict(fit: Fit, row: Example): number {
  const x = vector(row, fit.scaler);
  return clamp(Math.exp(clamp(x.reduce((sum, value, index) => sum + value * fit.weights[index]!, 0), -1.6, 1.5)), 0.2, 4.2);
}

function forecasts(rows: Example[], fit: Fit): MatchForecast[] {
  const byMatch = new Map<number, Example[]>();
  for (const row of rows) byMatch.set(row.matchId, [...(byMatch.get(row.matchId) ?? []), row]);
  return [...byMatch.values()].flatMap((pair) => {
    const home = pair.find((row) => row.homeObservation);
    const away = pair.find((row) => !row.homeObservation);
    return home && away ? [{ season: home.season, matchId: home.matchId, home: predict(fit, home), away: predict(fit, away), actualHome: home.y, actualAway: away.y }] : [];
  });
}

function sideFromJoint(home: number, away: number, tau: number) {
  const joint = bivariatePoissonScoreDistribution(home, away, tau);
  const market = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  let likely = { home: 0, away: 0, probability: joint[0]![0]! };
  for (let h = 0; h < joint.length; h++) for (let a = 0; a < joint[h]!.length; a++) if (joint[h]![a]! > likely.probability) likely = { home: h, away: a, probability: joint[h]![a]! };
  const side = selectEplMatchResultSide({
    lambdaHome: home,
    lambdaAway: away,
    likelyScore: likely,
    probabilities: { home: market.match_result.home, draw: market.match_result.draw, away: market.match_result.away, over25: market.total.over, under25: market.total.under, bttsYes: market.btts.yes, bttsNo: market.btts.no },
  }).side;
  return { joint, market, side };
}

function correlation(a: number[], b: number[]): number | null {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index]! - meanB), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0) * b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominator > 0 ? numerator / denominator : null;
}

function metrics(rows: MatchForecast[], tau: number) {
  const evaluated = rows.map((row) => ({ ...row, ...sideFromJoint(row.home, row.away, tau) }));
  const sides: Side[] = ["home", "draw", "away"];
  const projectedTeams = rows.flatMap((row) => [row.home, row.away]);
  const actualTeams = rows.flatMap((row) => [row.actualHome, row.actualAway]);
  const projectedTotals = rows.map((row) => row.home + row.away);
  const actualTotals = rows.map((row) => row.actualHome + row.actualAway);
  const projectedMargins = rows.map((row) => row.home - row.away);
  const actualMargins = rows.map((row) => row.actualHome - row.actualAway);
  const probability = (row: (typeof evaluated)[number], side: Side) => row.market.match_result[side];
  const actual = (row: MatchForecast): Side => row.actualHome > row.actualAway ? "home" : row.actualHome < row.actualAway ? "away" : "draw";
  const over = (row: (typeof evaluated)[number]) => 0.6 * row.market.total.over + 0.4 * 0.5;
  const btts = (row: (typeof evaluated)[number]) => 0.65 * row.market.btts.yes + 0.35 * 0.5;
  return {
    matches: rows.length,
    resultAccuracy: evaluated.filter((row) => row.side === actual(row)).length / rows.length,
    resultBrier: evaluated.reduce((sum, row) => sum + sides.reduce((inner, side) => inner + (probability(row, side) - Number(side === actual(row))) ** 2, 0), 0) / rows.length,
    resultLogLoss: evaluated.reduce((sum, row) => sum - safeLog(probability(row, actual(row))), 0) / rows.length,
    teamScoreMae: projectedTeams.reduce((sum, value, index) => sum + Math.abs(value - actualTeams[index]!), 0) / projectedTeams.length,
    totalMae: projectedTotals.reduce((sum, value, index) => sum + Math.abs(value - actualTotals[index]!), 0) / rows.length,
    marginMae: projectedMargins.reduce((sum, value, index) => sum + Math.abs(value - actualMargins[index]!), 0) / rows.length,
    teamScoreCorrelation: correlation(projectedTeams, actualTeams),
    totalCorrelation: correlation(projectedTotals, actualTotals),
    marginCorrelation: correlation(projectedMargins, actualMargins),
    projectedTeamSd: Math.sqrt(projectedTeams.reduce((sum, value) => sum + (value - projectedTeams.reduce((a, b) => a + b, 0) / projectedTeams.length) ** 2, 0) / projectedTeams.length),
    totalBrier: evaluated.reduce((sum, row) => sum + (over(row) - Number(row.actualHome + row.actualAway > 2.5)) ** 2, 0) / rows.length,
    bttsBrier: evaluated.reduce((sum, row) => sum + (btts(row) - Number(row.actualHome > 0 && row.actualAway > 0)) ** 2, 0) / rows.length,
    totalAccuracy: evaluated.filter((row) => (over(row) >= 0.5) === (row.actualHome + row.actualAway > 2.5)).length / rows.length,
    bttsAccuracy: evaluated.filter((row) => (btts(row) >= 0.5) === (row.actualHome > 0 && row.actualAway > 0)).length / rows.length,
    selectedSides: Object.fromEntries(sides.map((side) => [side, evaluated.filter((row) => row.side === side).length])),
  };
}

function incumbentForecasts(all: ExtendedMatch[], season: number): MatchForecast[] {
  const seasonRows = all.filter((match) => match.season === season).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const earlier = all.filter((match) => match.season < season);
  const completed: ExtendedMatch[] = [];
  const rounds = new Map<string, ExtendedMatch[]>();
  for (const match of seasonRows) {
    const key = String(match.round_number ?? match.date.slice(0, 10));
    rounds.set(key, [...(rounds.get(key) ?? []), match]);
  }
  const output: MatchForecast[] = [];
  for (const round of rounds.values()) {
    const fit = fitEplShadowModel([...earlier, ...completed], round[0]!.date);
    for (const match of round) {
      const prediction = predictEplMatch(fit, match.home_team_id, match.away_team_id);
      output.push({ season, matchId: match.id, home: prediction.lambdaHome, away: prediction.lambdaAway, actualHome: match.home_score!, actualAway: match.away_score! });
    }
    completed.push(...round);
  }
  return output;
}

function selectionScore(candidate: Metrics, incumbent: Metrics) {
  const binaryPenalty = Math.max(0, candidate.totalBrier - incumbent.totalBrier - 0.002) + Math.max(0, candidate.bttsBrier - incumbent.bttsBrier - 0.002);
  return candidate.teamScoreMae + 0.16 * candidate.resultLogLoss + 0.08 * candidate.marginMae + 8 * binaryPenalty;
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.from("lab_response_snapshots").select("payload").eq("snapshot_key", SNAPSHOT_KEY).single();
  if (error) throw error;
  const payload = data.payload as any;
  const all = enrich(payload.trainingMatches as EplTrainingMatch[], payload.teamStats as BdlEplTeamMatchStats[]);
  const examples = buildExamples(all);
  const invalidExamples = examples.flatMap((row) => row.x.flatMap((value, index) => Number.isFinite(value) ? [] : [{ season: row.season, matchId: row.matchId, homeObservation: row.homeObservation, index, value }]));
  if (invalidExamples.length) throw new Error(`Non-finite feature values: ${JSON.stringify(invalidExamples.slice(0, 20))}`);
  const trainRows = examples.filter((row) => row.season === 2022 || row.season === 2023);
  const validationRows = examples.filter((row) => row.season === 2024);
  const holdoutRows = examples.filter((row) => row.season === 2025);
  const incumbentValidationByTau = [-0.05, -0.1, -0.15].map((tau) => ({ tau, metrics: metrics(incumbentForecasts(all, 2024), tau) }));
  const incumbentValidation = incumbentValidationByTau.find((row) => row.tau === -0.1)!.metrics;
  const trials = [0.01, 0.1, 1, 10].flatMap((l2) => {
    const fit = train(trainRows, l2);
    const predicted = forecasts(validationRows, fit);
    return [-0.05, -0.1, -0.15].map((tau) => {
      const candidate = metrics(predicted, tau);
      return { l2, tau, candidate, score: selectionScore(candidate, incumbentValidation) };
    });
  }).sort((a, b) => a.score - b.score);
  const selected = trials[0]!;
  const finalFit = train([...trainRows, ...validationRows], selected.l2);
  const incumbentHoldout = metrics(incumbentForecasts(all, 2025), -0.1);
  const candidateHoldout = metrics(forecasts(holdoutRows, finalFit), selected.tau);
  console.log(JSON.stringify({
    protocol: "2022_2023_train__2024_selection__2025_untouched_holdout",
    providerCalls: 0,
    features: trainRows[0]!.x.length,
    observations: { train: trainRows.length, selection: validationRows.length, holdout: holdoutRows.length },
    selected,
    selection: { incumbent: incumbentValidation, candidate: selected.candidate },
    holdout: { incumbent: incumbentHoldout, candidate: candidateHoldout },
    topTrials: trials.slice(0, 8),
    coefficientSummary: finalFit.weights.map((weight, index) => ({ index, weight })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 12),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
