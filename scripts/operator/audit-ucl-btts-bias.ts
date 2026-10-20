import { BallDontLieUclProvider, type BdlUclMatch } from "../../lib/providers/real_api/BallDontLieUclProvider";
import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import { buildUclCompetitionContexts, regulationScore } from "../../lib/services/ucl/uclCompetitionContext";
import { partitionUclChronologicalMatches } from "../../lib/services/ucl/uclChronologicalEvaluation";
import { reconcileUclMeanPreserving } from "../../lib/services/ucl/uclEloConsensus";
import { normalizeUclEloClub } from "../../lib/services/ucl/uclEloStrengthFoundation";
import { fitAndPredictUclBaseline, joinUclMatchStats, UCL_MODEL_CONFIG } from "../../lib/services/ucl/uclModel";

type ForecastRow = {
  match: BdlUclMatch;
  lambdaHome: number;
  lambdaAway: number;
  raw: number;
  actual: 0 | 1;
  homeScored: 0 | 1;
  awayScored: 0 | 1;
  homeScoreRate: number;
  awayScoreRate: number;
  homeConcedeRate: number;
  awayConcedeRate: number;
  homeXgFor: number;
  awayXgFor: number;
  homeXgAgainst: number;
  awayXgAgainst: number;
  homeSotFor: number;
  awaySotFor: number;
  homeSotAgainst: number;
  awaySotAgainst: number;
  homeBigChancesFor: number;
  awayBigChancesFor: number;
  homeBigChancesAgainst: number;
  awayBigChancesAgainst: number;
  homeBoxShotsFor: number;
  awayBoxShotsFor: number;
  homeBoxShotsAgainst: number;
  awayBoxShotsAgainst: number;
  homeDomesticScoreRate: number;
  awayDomesticScoreRate: number;
  homeDomesticConcedeRate: number;
  awayDomesticConcedeRate: number;
  homeDomesticGoalsFor: number;
  awayDomesticGoalsFor: number;
  homeDomesticGoalsAgainst: number;
  awayDomesticGoalsAgainst: number;
  homeDomesticSotFor: number;
  awayDomesticSotFor: number;
  homeDomesticSotAgainst: number;
  awayDomesticSotAgainst: number;
  homeDomesticShotsFor: number;
  awayDomesticShotsFor: number;
  homeDomesticShotsAgainst: number;
  awayDomesticShotsAgainst: number;
};

type DomesticMatch = {
  date: string;
  league: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  homeSot: number | null;
  awaySot: number | null;
  homeShots: number | null;
  awayShots: number | null;
};

const DOMESTIC_SEASONS = ["1920", "2021", "2122", "2223", "2324", "2425", "2526", "2627"] as const;
const DOMESTIC_LEAGUES = ["E0", "D1", "I1", "SP1", "F1", "N1", "P1", "B1", "T1", "G1", "SC0"] as const;

function parseCsv(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { values.push(current); current = ""; }
    else current += char;
  }
  values.push(current);
  return values;
}

function footballDataDate(value: string): string | null {
  const parts = value.trim().split(/[\/-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [day, month, rawYear] = parts;
  const year = rawYear! < 100 ? 2000 + rawYear! : rawYear!;
  return new Date(Date.UTC(year, month! - 1, day!)).toISOString();
}

async function fetchDomesticFile(season: string, league: string): Promise<DomesticMatch[]> {
  const response = await fetch(`https://football-data.co.uk/mmz4281/${season}/${league}.csv`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Domestic BTTS source ${season}/${league} returned ${response.status}`);
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsv(lines[0] ?? "");
  const at = (name: string) => header.indexOf(name);
  const required = [at("Date"), at("HomeTeam"), at("AwayTeam"), at("FTHG"), at("FTAG")];
  if (required.some((index) => index < 0)) throw new Error(`Domestic BTTS source ${season}/${league} schema mismatch`);
  const numeric = (row: string[], index: number) => {
    const value = Number(row[index]);
    return index >= 0 && Number.isFinite(value) ? value : null;
  };
  return lines.slice(1).flatMap((line): DomesticMatch[] => {
    const row = parseCsv(line);
    const date = footballDataDate(row[at("Date")] ?? "");
    const homeGoals = numeric(row, at("FTHG"));
    const awayGoals = numeric(row, at("FTAG"));
    if (!date || homeGoals === null || awayGoals === null) return [];
    return [{
      date,
      league,
      home: normalizeUclEloClub(row[at("HomeTeam")] ?? ""),
      away: normalizeUclEloClub(row[at("AwayTeam")] ?? ""),
      homeGoals,
      awayGoals,
      homeSot: numeric(row, at("HST")),
      awaySot: numeric(row, at("AST")),
      homeShots: numeric(row, at("HS")),
      awayShots: numeric(row, at("AS")),
    }];
  });
}

async function fetchDomesticMatches(): Promise<DomesticMatch[]> {
  const jobs = DOMESTIC_SEASONS.flatMap((season) => DOMESTIC_LEAGUES.map((league) => ({ season, league })));
  const rows: DomesticMatch[][] = [];
  for (let index = 0; index < jobs.length; index += 6) {
    rows.push(...await Promise.all(jobs.slice(index, index + 6).map(({ season, league }) => fetchDomesticFile(season, league))));
  }
  return rows.flat().sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

type Metrics = {
  n: number;
  actualYes: number;
  predictedYes: number;
  accuracy: number;
  noRecall: number;
  brier: number;
  logLoss: number;
  auc: number;
};

type FittedLogistic = {
  means: number[];
  scales: number[];
  beta: number[];
};

const clip = (value: number) => Math.max(1e-8, Math.min(1 - 1e-8, value));
const logit = (value: number) => Math.log(clip(value) / (1 - clip(value)));
const sigmoid = (value: number) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

function solve(matrix: number[][], vector: number[]): number[] {
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < matrix.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < matrix.length; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = Math.abs(augmented[column]![column]!) < 1e-10 ? 1e-10 : augmented[column]![column]!;
    for (let index = column; index <= matrix.length; index += 1) augmented[column]![index] = augmented[column]![index]! / divisor;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let index = column; index <= matrix.length; index += 1) {
        augmented[row]![index] = augmented[row]![index]! - factor * augmented[column]![index]!;
      }
    }
  }
  return augmented.map((row) => row[matrix.length]!);
}

function fitLogistic(features: number[][], outcomes: number[], l2: number): FittedLogistic {
  const width = features[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) => features.reduce((sum, row) => sum + row[column]!, 0) / features.length);
  const scales = Array.from({ length: width }, (_, column) => {
    const variance = features.reduce((sum, row) => sum + (row[column]! - means[column]!) ** 2, 0) / features.length;
    return Math.max(1e-8, Math.sqrt(variance));
  });
  const design = features.map((row) => [1, ...row.map((value, column) => (value - means[column]!) / scales[column]!)]);
  const beta = Array(width + 1).fill(0) as number[];
  beta[0] = logit(outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const gradient = Array(beta.length).fill(0) as number[];
    const hessian = Array.from({ length: beta.length }, () => Array(beta.length).fill(0) as number[]);
    for (let row = 0; row < design.length; row += 1) {
      const x = design[row]!;
      const probability = sigmoid(x.reduce((sum, value, column) => sum + value * beta[column]!, 0));
      const weight = Math.max(1e-8, probability * (1 - probability));
      for (let left = 0; left < beta.length; left += 1) {
        gradient[left] += x[left]! * (outcomes[row]! - probability);
        for (let right = 0; right < beta.length; right += 1) hessian[left]![right] += weight * x[left]! * x[right]!;
      }
    }
    for (let index = 1; index < beta.length; index += 1) {
      gradient[index] -= l2 * beta[index]!;
      hessian[index]![index] += l2;
    }
    const step = solve(hessian, gradient);
    for (let index = 0; index < beta.length; index += 1) beta[index] += step[index]!;
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return { means, scales, beta };
}

function predictLogistic(model: FittedLogistic, features: number[]): number {
  const design = [1, ...features.map((value, index) => (value - model.means[index]!) / model.scales[index]!)];
  return sigmoid(design.reduce((sum, value, index) => sum + value * model.beta[index]!, 0));
}

function auc(rows: Array<{ probability: number; actual: 0 | 1 }>): number {
  const positives = rows.filter((row) => row.actual === 1);
  const negatives = rows.filter((row) => row.actual === 0);
  if (!positives.length || !negatives.length) return 0.5;
  let score = 0;
  for (const positive of positives) for (const negative of negatives) {
    if (positive.probability > negative.probability) score += 1;
    else if (positive.probability === negative.probability) score += 0.5;
  }
  return score / (positives.length * negatives.length);
}

function metrics(rows: ForecastRow[], probabilities: number[]): Metrics {
  const reads = rows.map((row, index) => ({ actual: row.actual, probability: clip(probabilities[index]!) }));
  const actualNo = reads.filter((row) => row.actual === 0);
  return {
    n: reads.length,
    actualYes: reads.filter((row) => row.actual === 1).length,
    predictedYes: reads.filter((row) => row.probability >= 0.5).length,
    accuracy: reads.filter((row) => (row.probability >= 0.5 ? 1 : 0) === row.actual).length / reads.length,
    noRecall: actualNo.filter((row) => row.probability < 0.5).length / Math.max(1, actualNo.length),
    brier: reads.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / reads.length,
    logLoss: -reads.reduce((sum, row) => sum + (row.actual ? Math.log(row.probability) : Math.log(1 - row.probability)), 0) / reads.length,
    auc: auc(reads),
  };
}

function otherMarketMetrics(rows: ForecastRow[]) {
  let resultCorrect = 0;
  let resultBrier = 0;
  let resultLogLoss = 0;
  let totalCorrect = 0;
  let totalBrier = 0;
  let totalLogLoss = 0;
  let teamScoreAbsoluteError = 0;
  for (const row of rows) {
    const settled = regulationScore(row.match).score!;
    const joint = bivariatePoissonScoreDistribution(row.lambdaHome, row.lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
    const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
    const actualResult = settled.home > settled.away ? "home" : settled.home < settled.away ? "away" : "draw";
    const forecastResult = (["home", "draw", "away"] as const).reduce((best, side) =>
      markets.match_result[side] > markets.match_result[best] ? side : best, "home");
    if (forecastResult === actualResult) resultCorrect += 1;
    for (const side of ["home", "draw", "away"] as const) {
      const actual = side === actualResult ? 1 : 0;
      resultBrier += (markets.match_result[side] - actual) ** 2 / 3;
    }
    resultLogLoss -= Math.log(clip(markets.match_result[actualResult]));
    const actualOver = settled.home + settled.away > 2.5 ? 1 : 0;
    const forecastOver = markets.total.over >= 0.5 ? 1 : 0;
    if (forecastOver === actualOver) totalCorrect += 1;
    totalBrier += (markets.total.over - actualOver) ** 2;
    totalLogLoss -= actualOver ? Math.log(clip(markets.total.over)) : Math.log(clip(1 - markets.total.over));
    teamScoreAbsoluteError += Math.abs(row.lambdaHome - settled.home) + Math.abs(row.lambdaAway - settled.away);
  }
  const denominator = Math.max(1, rows.length);
  return {
    n: rows.length,
    matchResultAccuracy: resultCorrect / denominator,
    matchResultBrier: resultBrier / denominator,
    matchResultLogLoss: resultLogLoss / denominator,
    totalAccuracy: totalCorrect / denominator,
    totalBrier: totalBrier / denominator,
    totalLogLoss: totalLogLoss / denominator,
    teamScoreMae: teamScoreAbsoluteError / (2 * denominator),
  };
}

const directFeatures = {
  platt: (row: ForecastRow) => [logit(row.raw)],
  structured: (row: ForecastRow) => [
    logit(row.raw),
    Math.log(Math.min(row.lambdaHome, row.lambdaAway)),
    Math.log(Math.max(row.lambdaHome, row.lambdaAway)),
    Math.abs(row.lambdaHome - row.lambdaAway),
  ],
  scoring_shape: (row: ForecastRow) => [
    Math.log(Math.min(row.lambdaHome, row.lambdaAway)),
    Math.log(Math.max(row.lambdaHome, row.lambdaAway)),
    Math.abs(row.lambdaHome - row.lambdaAway),
  ],
  historical_scoring: (row: ForecastRow) => [
    logit(row.raw),
    logit(row.homeScoreRate),
    logit(row.awayScoreRate),
    logit(row.homeConcedeRate),
    logit(row.awayConcedeRate),
    Math.log(row.homeXgFor),
    Math.log(row.awayXgFor),
    Math.log(row.homeXgAgainst),
    Math.log(row.awayXgAgainst),
  ],
} as const;

function candidatePredictions(
  name: keyof typeof directFeatures | "team_scoring_hurdle" | "historical_team_hurdle" | "historical_hurdle_calibrated" | "chance_quality_hurdle" | "chance_quality_calibrated" | "chance_quality_stacked" | "domestic_stacked",
  train: ForecastRow[],
  target: ForecastRow[],
  l2: number,
): { probabilities: number[]; coefficients: unknown } {
  if (name === "team_scoring_hurdle" || name === "historical_team_hurdle" || name === "historical_hurdle_calibrated"
    || name === "chance_quality_hurdle" || name === "chance_quality_calibrated" || name === "chance_quality_stacked" || name === "domestic_stacked") {
    const useHistory = name !== "team_scoring_hurdle";
    const useChanceQuality = name === "chance_quality_hurdle" || name === "chance_quality_calibrated" || name === "chance_quality_stacked" || name === "domestic_stacked";
    const useDomestic = name === "domestic_stacked";
    const sideFeature = (row: ForecastRow, home: boolean) => !useHistory
      ? [Math.log(home ? row.lambdaHome : row.lambdaAway), home ? 1 : 0]
      : [
        Math.log(home ? row.lambdaHome : row.lambdaAway),
        logit(home ? row.homeScoreRate : row.awayScoreRate),
        logit(home ? row.awayConcedeRate : row.homeConcedeRate),
        Math.log(home ? row.homeXgFor : row.awayXgFor),
        Math.log(home ? row.awayXgAgainst : row.homeXgAgainst),
        ...(useChanceQuality ? [
          Math.log(home ? row.homeSotFor : row.awaySotFor),
          Math.log(home ? row.awaySotAgainst : row.homeSotAgainst),
          Math.log(home ? row.homeBigChancesFor : row.awayBigChancesFor),
          Math.log(home ? row.awayBigChancesAgainst : row.homeBigChancesAgainst),
          Math.log(home ? row.homeBoxShotsFor : row.awayBoxShotsFor),
          Math.log(home ? row.awayBoxShotsAgainst : row.homeBoxShotsAgainst),
        ] : []),
        ...(useDomestic ? [
          logit(home ? row.homeDomesticScoreRate : row.awayDomesticScoreRate),
          logit(home ? row.awayDomesticConcedeRate : row.homeDomesticConcedeRate),
          Math.log(home ? row.homeDomesticGoalsFor : row.awayDomesticGoalsFor),
          Math.log(home ? row.awayDomesticGoalsAgainst : row.homeDomesticGoalsAgainst),
          Math.log(home ? row.homeDomesticSotFor : row.awayDomesticSotFor),
          Math.log(home ? row.awayDomesticSotAgainst : row.homeDomesticSotAgainst),
          Math.log(home ? row.homeDomesticShotsFor : row.awayDomesticShotsFor),
          Math.log(home ? row.awayDomesticShotsAgainst : row.homeDomesticShotsAgainst),
        ] : []),
        home ? 1 : 0,
      ];
    const sideFeatures = train.flatMap((row) => [sideFeature(row, true), sideFeature(row, false)]);
    const sideOutcomes = train.flatMap((row) => [row.homeScored, row.awayScored]);
    const model = fitLogistic(sideFeatures, sideOutcomes, l2);
    const product = (row: ForecastRow) => predictLogistic(model, sideFeature(row, true)) * predictLogistic(model, sideFeature(row, false));
    if (name === "chance_quality_stacked" || name === "domestic_stacked") {
      const calibration = fitLogistic(
        train.map((row) => [logit(row.raw), logit(product(row))]),
        train.map((row) => row.actual),
        l2,
      );
      return {
        probabilities: target.map((row) => predictLogistic(calibration, [logit(row.raw), logit(product(row))])),
        coefficients: { scoring: model, stack: calibration },
      };
    }
    if (name === "historical_hurdle_calibrated" || name === "chance_quality_calibrated") {
      const calibration = fitLogistic(train.map((row) => [logit(product(row))]), train.map((row) => row.actual), l2);
      return {
        probabilities: target.map((row) => predictLogistic(calibration, [logit(product(row))])),
        coefficients: { scoring: model, bttsCalibration: calibration },
      };
    }
    return { probabilities: target.map(product), coefficients: model };
  }
  const feature = directFeatures[name];
  const model = fitLogistic(train.map(feature), train.map((row) => row.actual), l2);
  return { probabilities: target.map((row) => predictLogistic(model, feature(row))), coefficients: model };
}

function structuralAudit(rows: ForecastRow[], probabilities: number[]) {
  let scoreMae = 0;
  let maxResultResidual = 0;
  let maxTotalResidual = 0;
  let maxBttsResidual = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const settled = regulationScore(row.match).score!;
    const base = bivariatePoissonScoreDistribution(row.lambdaHome, row.lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
    const before = deriveSoccerMarketProbabilities({ joint: base, totalLine: 2.5 });
    const joint = reconcileUclMeanPreserving(base, before.match_result, before.total.over, probabilities[index]!);
    const after = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
    let expectedHome = 0;
    let expectedAway = 0;
    for (let home = 0; home < joint.length; home += 1) for (let away = 0; away < joint[home]!.length; away += 1) {
      expectedHome += home * joint[home]![away]!;
      expectedAway += away * joint[home]![away]!;
    }
    scoreMae += Math.abs(expectedHome - settled.home) + Math.abs(expectedAway - settled.away);
    maxResultResidual = Math.max(maxResultResidual,
      Math.abs(after.match_result.home - before.match_result.home),
      Math.abs(after.match_result.draw - before.match_result.draw),
      Math.abs(after.match_result.away - before.match_result.away));
    maxTotalResidual = Math.max(maxTotalResidual, Math.abs(after.total.over - before.total.over));
    maxBttsResidual = Math.max(maxBttsResidual, Math.abs(after.btts.yes - probabilities[index]!));
  }
  return { teamScoreMae: scoreMae / (2 * rows.length), maxResultResidual, maxTotalResidual, maxBttsResidual };
}

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const forward2026 = process.argv.includes("--forward-2026");
  const expanded = process.argv.includes("--expanded-history") || forward2026;
  const domesticConfirmation = process.argv.includes("--domestic-confirmation");
  const allHistoryInputs = expanded && process.argv.includes("--all-history-inputs");
  const allHistoryFeatures = forward2026 || (expanded && process.argv.includes("--all-history-features"));
  const provider = new BallDontLieUclProvider(apiKey);
  const seasons = domesticConfirmation || forward2026 ? [2020, 2021, 2022, 2023, 2024, 2025, 2026] : expanded ? [2020, 2021, 2022, 2023, 2024, 2025] : [2024, 2025];
  const [history, domestic, teamCohorts] = await Promise.all([
    provider.listHistoricalMatches(seasons),
    domesticConfirmation ? fetchDomesticMatches() : Promise.resolve([]),
    domesticConfirmation ? Promise.all(seasons.map((season) => provider.listTeams(season))) : Promise.resolve([]),
  ]);
  const matches = history.matches;
  const teamNames = new Map(teamCohorts.flat().map((team) => [team.id, normalizeUclEloClub(team.name)]));
  const finalIds = matches.filter((match) => match.status_state === "final").map((match) => match.id);
  const stats = await provider.listTeamMatchStats(finalIds);
  const training = joinUclMatchStats(matches, stats);
  const contexts = buildUclCompetitionContexts(matches);
  const statsByMatchTeam = new Map(stats.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  const partition = domesticConfirmation || forward2026
    ? {
      train: matches.filter((match) => match.status_state === "final" && match.season <= 2024),
      calibration: matches.filter((match) => match.status_state === "final" && match.season === 2025),
      holdout: matches.filter((match) => match.status_state === "final" && match.season === 2026),
    }
    : expanded
    ? {
      train: matches.filter((match) => match.status_state === "final" && match.season <= 2023),
      calibration: matches.filter((match) => match.status_state === "final" && match.season === 2024),
      holdout: matches.filter((match) => match.status_state === "final" && match.season === 2025),
    }
    : partitionUclChronologicalMatches(matches);
  const { train, calibration, holdout } = partition;
  const forecast = (block: BdlUclMatch[]) => block.flatMap((match): ForecastRow[] => {
    const settled = regulationScore(match).score;
    const context = contexts.get(match.id);
    if (!settled || !context) return [];
    const rollingTraining = expanded && !allHistoryInputs
      ? training.filter((row) => row.season >= match.season - 1)
      : training;
    const prediction = fitAndPredictUclBaseline({ training: rollingTraining, match, history: matches, context });
    const prior = matches.filter((row) => row.status_state === "final"
      && Date.parse(row.date) < Date.parse(match.date)
      && (!expanded || allHistoryInputs || allHistoryFeatures || row.season >= match.season - 1));
    const priorSides = prior.flatMap((row) => {
      const score = regulationScore(row).score;
      return score ? [{ match: row, teamId: row.home_team_id, goalsFor: score.home, goalsAgainst: score.away, opponentId: row.away_team_id },
        { match: row, teamId: row.away_team_id, goalsFor: score.away, goalsAgainst: score.home, opponentId: row.home_team_id }] : [];
    });
    const leagueScoreRate = priorSides.length ? priorSides.filter((row) => row.goalsFor > 0).length / priorSides.length : 0.7;
    const allXg = priorSides.flatMap((row) => {
      const value = statsByMatchTeam.get(`${row.match.id}:${row.teamId}`)?.expected_goals;
      return typeof value === "number" && value >= 0 ? [value] : [];
    });
    const leagueXg = allXg.length ? allXg.reduce((sum, value) => sum + value, 0) / allXg.length : 1.4;
    const leagueAverage = (field: "shots_on_target" | "big_chances" | "shots_inside_box", fallback: number) => {
      const values = priorSides.flatMap((row) => {
        const value = statsByMatchTeam.get(`${row.match.id}:${row.teamId}`)?.[field];
        return typeof value === "number" && value >= 0 ? [value] : [];
      });
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
    };
    const leagueSot = leagueAverage("shots_on_target", 4.5);
    const leagueBigChances = leagueAverage("big_chances", 2);
    const leagueBoxShots = leagueAverage("shots_inside_box", 9);
    const teamEvidence = (teamId: number) => {
      let weight = 0;
      let scored = 0;
      let conceded = 0;
      let xgFor = 0;
      let xgForWeight = 0;
      let xgAgainst = 0;
      let xgAgainstWeight = 0;
      const chance = {
        sotFor: 0, sotForWeight: 0, sotAgainst: 0, sotAgainstWeight: 0,
        bigChancesFor: 0, bigChancesForWeight: 0, bigChancesAgainst: 0, bigChancesAgainstWeight: 0,
        boxShotsFor: 0, boxShotsForWeight: 0, boxShotsAgainst: 0, boxShotsAgainstWeight: 0,
      };
      for (const row of priorSides.filter((value) => value.teamId === teamId)) {
        const ageDays = (Date.parse(match.date) - Date.parse(row.match.date)) / 86_400_000;
        const recency = Math.pow(0.5, Math.max(0, ageDays) / UCL_MODEL_CONFIG.halfLifeDays);
        weight += recency;
        scored += recency * (row.goalsFor > 0 ? 1 : 0);
        conceded += recency * (row.goalsAgainst > 0 ? 1 : 0);
        const ownXg = statsByMatchTeam.get(`${row.match.id}:${teamId}`)?.expected_goals;
        const opponentXg = statsByMatchTeam.get(`${row.match.id}:${row.opponentId}`)?.expected_goals;
        if (typeof ownXg === "number" && ownXg >= 0) { xgFor += recency * ownXg; xgForWeight += recency; }
        if (typeof opponentXg === "number" && opponentXg >= 0) { xgAgainst += recency * opponentXg; xgAgainstWeight += recency; }
        const own = statsByMatchTeam.get(`${row.match.id}:${teamId}`);
        const opponent = statsByMatchTeam.get(`${row.match.id}:${row.opponentId}`);
        const add = (value: number | null | undefined, sum: keyof typeof chance, count: keyof typeof chance) => {
          if (typeof value === "number" && value >= 0) { chance[sum] += recency * value; chance[count] += recency; }
        };
        add(own?.shots_on_target, "sotFor", "sotForWeight");
        add(opponent?.shots_on_target, "sotAgainst", "sotAgainstWeight");
        add(own?.big_chances, "bigChancesFor", "bigChancesForWeight");
        add(opponent?.big_chances, "bigChancesAgainst", "bigChancesAgainstWeight");
        add(own?.shots_inside_box, "boxShotsFor", "boxShotsForWeight");
        add(opponent?.shots_inside_box, "boxShotsAgainst", "boxShotsAgainstWeight");
      }
      const shrink = 6;
      return {
        scoreRate: (scored + shrink * leagueScoreRate) / (weight + shrink),
        concedeRate: (conceded + shrink * leagueScoreRate) / (weight + shrink),
        xgFor: (xgFor + shrink * leagueXg) / (xgForWeight + shrink),
        xgAgainst: (xgAgainst + shrink * leagueXg) / (xgAgainstWeight + shrink),
        sotFor: (chance.sotFor + shrink * leagueSot) / (chance.sotForWeight + shrink),
        sotAgainst: (chance.sotAgainst + shrink * leagueSot) / (chance.sotAgainstWeight + shrink),
        bigChancesFor: (chance.bigChancesFor + shrink * leagueBigChances) / (chance.bigChancesForWeight + shrink),
        bigChancesAgainst: (chance.bigChancesAgainst + shrink * leagueBigChances) / (chance.bigChancesAgainstWeight + shrink),
        boxShotsFor: (chance.boxShotsFor + shrink * leagueBoxShots) / (chance.boxShotsForWeight + shrink),
        boxShotsAgainst: (chance.boxShotsAgainst + shrink * leagueBoxShots) / (chance.boxShotsAgainstWeight + shrink),
      };
    };
    const homeEvidence = teamEvidence(match.home_team_id);
    const awayEvidence = teamEvidence(match.away_team_id);
    const domesticEvidence = (teamId: number) => {
      const club = teamNames.get(teamId);
      const cutoff = Date.parse(match.date);
      const eligible = domestic.filter((row) => Date.parse(row.date) < cutoff);
      const leagueRows = eligible.filter((row) => row.home === club || row.away === club);
      const league = leagueRows.at(-1)?.league;
      const comparison = eligible.filter((row) => row.league === league);
      const leagueSides = comparison.flatMap((row) => [
        { goalsFor: row.homeGoals, goalsAgainst: row.awayGoals, sotFor: row.homeSot, sotAgainst: row.awaySot, shotsFor: row.homeShots, shotsAgainst: row.awayShots },
        { goalsFor: row.awayGoals, goalsAgainst: row.homeGoals, sotFor: row.awaySot, sotAgainst: row.homeSot, shotsFor: row.awayShots, shotsAgainst: row.homeShots },
      ]);
      const mean = (values: Array<number | null>, fallback: number) => {
        const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
        return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : fallback;
      };
      const baseline = {
        scoreRate: mean(leagueSides.map((row) => row.goalsFor > 0 ? 1 : 0), 0.7),
        concedeRate: mean(leagueSides.map((row) => row.goalsAgainst > 0 ? 1 : 0), 0.7),
        goalsFor: mean(leagueSides.map((row) => row.goalsFor), 1.4),
        goalsAgainst: mean(leagueSides.map((row) => row.goalsAgainst), 1.4),
        sotFor: mean(leagueSides.map((row) => row.sotFor), 4.5),
        sotAgainst: mean(leagueSides.map((row) => row.sotAgainst), 4.5),
        shotsFor: mean(leagueSides.map((row) => row.shotsFor), 12),
        shotsAgainst: mean(leagueSides.map((row) => row.shotsAgainst), 12),
      };
      const sums = { weight: 0, scoreRate: 0, concedeRate: 0, goalsFor: 0, goalsAgainst: 0, sotFor: 0, sotAgainst: 0, shotsFor: 0, shotsAgainst: 0 };
      for (const row of leagueRows) {
        const home = row.home === club;
        const ageDays = (cutoff - Date.parse(row.date)) / 86_400_000;
        const weight = Math.pow(0.5, Math.max(0, ageDays) / UCL_MODEL_CONFIG.halfLifeDays);
        const side = home
          ? { goalsFor: row.homeGoals, goalsAgainst: row.awayGoals, sotFor: row.homeSot, sotAgainst: row.awaySot, shotsFor: row.homeShots, shotsAgainst: row.awayShots }
          : { goalsFor: row.awayGoals, goalsAgainst: row.homeGoals, sotFor: row.awaySot, sotAgainst: row.homeSot, shotsFor: row.awayShots, shotsAgainst: row.homeShots };
        sums.weight += weight;
        sums.scoreRate += weight * (side.goalsFor > 0 ? 1 : 0);
        sums.concedeRate += weight * (side.goalsAgainst > 0 ? 1 : 0);
        for (const field of ["goalsFor", "goalsAgainst", "sotFor", "sotAgainst", "shotsFor", "shotsAgainst"] as const) {
          const value = side[field];
          if (value !== null) sums[field] += weight * value;
        }
      }
      const shrink = 8;
      const shrunk = (field: keyof typeof baseline) => (sums[field] + shrink * baseline[field]) / (sums.weight + shrink);
      return {
        scoreRate: shrunk("scoreRate"), concedeRate: shrunk("concedeRate"),
        goalsFor: shrunk("goalsFor"), goalsAgainst: shrunk("goalsAgainst"),
        sotFor: shrunk("sotFor"), sotAgainst: shrunk("sotAgainst"),
        shotsFor: shrunk("shotsFor"), shotsAgainst: shrunk("shotsAgainst"),
      };
    };
    const homeDomestic = domesticEvidence(match.home_team_id);
    const awayDomestic = domesticEvidence(match.away_team_id);
    return [{
      match,
      lambdaHome: prediction.lambdaHome,
      lambdaAway: prediction.lambdaAway,
      raw: prediction.probabilities.bttsYes,
      actual: settled.home > 0 && settled.away > 0 ? 1 : 0,
      homeScored: settled.home > 0 ? 1 : 0,
      awayScored: settled.away > 0 ? 1 : 0,
      homeScoreRate: homeEvidence.scoreRate,
      awayScoreRate: awayEvidence.scoreRate,
      homeConcedeRate: homeEvidence.concedeRate,
      awayConcedeRate: awayEvidence.concedeRate,
      homeXgFor: homeEvidence.xgFor,
      awayXgFor: awayEvidence.xgFor,
      homeXgAgainst: homeEvidence.xgAgainst,
      awayXgAgainst: awayEvidence.xgAgainst,
      homeSotFor: homeEvidence.sotFor,
      awaySotFor: awayEvidence.sotFor,
      homeSotAgainst: homeEvidence.sotAgainst,
      awaySotAgainst: awayEvidence.sotAgainst,
      homeBigChancesFor: homeEvidence.bigChancesFor,
      awayBigChancesFor: awayEvidence.bigChancesFor,
      homeBigChancesAgainst: homeEvidence.bigChancesAgainst,
      awayBigChancesAgainst: awayEvidence.bigChancesAgainst,
      homeBoxShotsFor: homeEvidence.boxShotsFor,
      awayBoxShotsFor: awayEvidence.boxShotsFor,
      homeBoxShotsAgainst: homeEvidence.boxShotsAgainst,
      awayBoxShotsAgainst: awayEvidence.boxShotsAgainst,
      homeDomesticScoreRate: homeDomestic.scoreRate,
      awayDomesticScoreRate: awayDomestic.scoreRate,
      homeDomesticConcedeRate: homeDomestic.concedeRate,
      awayDomesticConcedeRate: awayDomestic.concedeRate,
      homeDomesticGoalsFor: homeDomestic.goalsFor,
      awayDomesticGoalsFor: awayDomestic.goalsFor,
      homeDomesticGoalsAgainst: homeDomestic.goalsAgainst,
      awayDomesticGoalsAgainst: awayDomestic.goalsAgainst,
      homeDomesticSotFor: homeDomestic.sotFor,
      awayDomesticSotFor: awayDomestic.sotFor,
      homeDomesticSotAgainst: homeDomestic.sotAgainst,
      awayDomesticSotAgainst: awayDomestic.sotAgainst,
      homeDomesticShotsFor: homeDomestic.shotsFor,
      awayDomesticShotsFor: awayDomestic.shotsFor,
      homeDomesticShotsAgainst: homeDomestic.shotsAgainst,
      awayDomesticShotsAgainst: awayDomestic.shotsAgainst,
    }];
  });
  const trainRows = forecast(train);
  const selectionRows = forecast(calibration);
  const confirmationRows = forecast(holdout);
  const rawSelection = metrics(selectionRows, selectionRows.map((row) => row.raw));
  const candidateNames = domesticConfirmation
    ? ["domestic_stacked"] as const
    : forward2026
      ? ["chance_quality_stacked"] as const
    : ["platt", "structured", "scoring_shape", "team_scoring_hurdle", "historical_scoring", "historical_team_hurdle", "historical_hurdle_calibrated", "chance_quality_hurdle", "chance_quality_calibrated", "chance_quality_stacked"] as const;
  const l2Grid = domesticConfirmation ? [1, 10, 25, 50, 100] as const : forward2026 ? [10] as const : [0.01, 0.1, 1, 10] as const;
  const trials = candidateNames.flatMap((name) => l2Grid.map((l2) => {
    const candidate = candidatePredictions(name, trainRows, selectionRows, l2);
    return { name, l2, metrics: metrics(selectionRows, candidate.probabilities) };
  }));
  const eligible = trials.filter((trial) => trial.metrics.brier < rawSelection.brier
    && trial.metrics.logLoss < rawSelection.logLoss
    && trial.metrics.auc >= rawSelection.auc
    && trial.metrics.accuracy >= rawSelection.accuracy
    && trial.metrics.noRecall >= rawSelection.noRecall);
  const selected = [...eligible].sort((left, right) => left.metrics.brier - right.metrics.brier
    || left.metrics.logLoss - right.metrics.logLoss)[0] ?? null;
  const combined = [...trainRows, ...selectionRows];
  const confirmationCandidate = selected
    ? candidatePredictions(selected.name, combined, confirmationRows, selected.l2)
    : null;
  const frozenConfirmationCandidate = selected
    ? candidatePredictions(selected.name, trainRows, confirmationRows, selected.l2)
    : null;
  const stabilityBlends = confirmationCandidate && frozenConfirmationCandidate
    ? [0.25, 0.5, 0.75].map((refitWeight) => ({
      refitWeight,
      metrics: metrics(confirmationRows, confirmationCandidate.probabilities.map((probability, index) => sigmoid(
        refitWeight * logit(probability)
          + (1 - refitWeight) * logit(frozenConfirmationCandidate.probabilities[index]!),
      ))),
    }))
    : [];
  const rawConfirmation = metrics(confirmationRows, confirmationRows.map((row) => row.raw));
  const selectedConfirmation = confirmationCandidate ? metrics(confirmationRows, confirmationCandidate.probabilities) : null;
  const accepted = selectedConfirmation !== null
    && selectedConfirmation.brier < rawConfirmation.brier
    && selectedConfirmation.logLoss < rawConfirmation.logLoss
    && selectedConfirmation.auc >= rawConfirmation.auc
    && selectedConfirmation.accuracy >= rawConfirmation.accuracy
    && selectedConfirmation.noRecall > rawConfirmation.noRecall;
  console.log(JSON.stringify({
    mode: "read_only_no_runtime_change",
    cohort: domesticConfirmation
      ? "domestic_scoring_2020_2024_train_2025_selection_2026_untouched_confirmation"
      : forward2026
        ? "frozen_chance_quality_l2_10_2020_2024_train_2025_selection_2026_forward_read"
      : expanded
      ? `expanded_2020_2023_train_2024_selection_2025_confirmation_${allHistoryInputs ? "all_history_inputs" : allHistoryFeatures ? "rolling_baseline_all_history_scoring_features" : "rolling_two_season_inputs"}`
      : "frozen_manifest_2024_train_2025_split",
    providerHistory: history.telemetry,
    rows: { train: trainRows.length, selection: selectionRows.length, confirmation: confirmationRows.length },
    raw: {
      selection: rawSelection,
      confirmation: rawConfirmation,
      otherMarkets: {
        selection: otherMarketMetrics(selectionRows),
        confirmation: otherMarketMetrics(confirmationRows),
      },
      selectionStructure: structuralAudit(selectionRows, selectionRows.map((row) => row.raw)),
      confirmationStructure: structuralAudit(confirmationRows, confirmationRows.map((row) => row.raw)),
    },
    selectionTrials: trials,
    selected: selected && confirmationCandidate ? {
      ...selected,
      confirmation: selectedConfirmation,
      coefficients: confirmationCandidate.coefficients,
      selectionStructure: structuralAudit(selectionRows, candidatePredictions(selected.name, trainRows, selectionRows, selected.l2).probabilities),
      confirmationStructure: structuralAudit(confirmationRows, confirmationCandidate.probabilities),
    } : null,
    stabilityDiagnostic: selected && frozenConfirmationCandidate ? {
      policy: "freeze_selection_fit_without_refitting_on_selection_block",
      confirmation: metrics(confirmationRows, frozenConfirmationCandidate.probabilities),
      structure: structuralAudit(confirmationRows, frozenConfirmationCandidate.probabilities),
      exploratoryRefitBlends: stabilityBlends,
    } : null,
    accepted,
    gate: !selected
      ? "no_candidate_improves_all_selection_gates"
      : accepted
        ? "candidate_passed_selection_and_confirmation_gates"
        : "candidate_improved_no_detection_but_failed_confirmation_probability_quality_do_not_publish",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
