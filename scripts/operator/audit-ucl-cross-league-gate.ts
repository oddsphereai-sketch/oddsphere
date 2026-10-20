import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import { reconcileUclMeanPreserving } from "../../lib/services/ucl/uclEloConsensus";

type Match = {
  season: string;
  league: string;
  date: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  homeSot: number;
  awaySot: number;
};

type State = {
  at: number;
  weight: number;
  scored: number;
  conceded: number;
  goalsFor: number;
  goalsAgainst: number;
  sotFor: number;
  sotAgainst: number;
  homeGoals: number;
  awayGoals: number;
  matches: number;
};

type FeatureRow = {
  match: Match;
  lambdaHome: number;
  lambdaAway: number;
  baseBtts: number;
  baseResult: { home: number; draw: number; away: number };
  baseOver: number;
  homeSide: number[];
  awaySide: number[];
  homeScored: 0 | 1;
  awayScored: 0 | 1;
  actualBtts: 0 | 1;
  weakerWeight: number;
  direct: number[];
};

type Logistic = { means: number[]; scales: number[]; beta: number[] };
type Metrics = { n: number; actualYes: number; predictedYes: number; accuracy: number; noRecall: number; brier: number; logLoss: number; auc: number };

const SEASONS = ["1415", "1516", "1617", "1718", "1819", "1920", "2021", "2122", "2223", "2324", "2425"] as const;
const LEAGUES = ["E0", "D1", "I1", "SP1", "F1", "N1", "P1", "B1", "T1", "G1", "SC0"] as const;
const HALF_LIFE_MS = 365 * 86_400_000;
const SHRINK = 8;
const DIXON_COLES_TAU = -0.1;
const clip = (value: number) => Math.max(1e-8, Math.min(1 - 1e-8, value));
const logit = (value: number) => Math.log(clip(value) / (1 - clip(value)));
const sigmoid = (value: number) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

function normalizeClub(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fc|cf|afc|calcio|football club|futbol club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

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

function date(value: string): string | null {
  const parts = value.trim().split(/[\/-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [day, month, rawYear] = parts;
  const year = rawYear! < 100 ? 2000 + rawYear! : rawYear!;
  return new Date(Date.UTC(year, month! - 1, day!)).toISOString();
}

async function fetchFile(season: string, league: string): Promise<Match[]> {
  const response = await fetch(`https://football-data.co.uk/mmz4281/${season}/${league}.csv`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return [];
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsv(lines[0] ?? "");
  const at = (name: string) => header.indexOf(name);
  if (["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "HST", "AST"].some((name) => at(name) < 0)) return [];
  return lines.slice(1).flatMap((line): Match[] => {
    const row = parseCsv(line);
    const played = date(row[at("Date")] ?? "");
    const numbers = [Number(row[at("FTHG")]), Number(row[at("FTAG")]), Number(row[at("HST")]), Number(row[at("AST")])];
    if (!played || numbers.some((value) => !Number.isFinite(value))) return [];
    return [{ season, league, date: played, home: normalizeClub(row[at("HomeTeam")] ?? ""), away: normalizeClub(row[at("AwayTeam")] ?? ""),
      homeGoals: numbers[0]!, awayGoals: numbers[1]!, homeSot: numbers[2]!, awaySot: numbers[3]! }];
  });
}

async function fetchMatches(): Promise<Match[]> {
  const jobs = SEASONS.flatMap((season) => LEAGUES.map((league) => ({ season, league })));
  const rows: Match[][] = [];
  for (let index = 0; index < jobs.length; index += 8) rows.push(...await Promise.all(jobs.slice(index, index + 8).map(({ season, league }) => fetchFile(season, league))));
  return rows.flat().sort((left, right) => Date.parse(left.date) - Date.parse(right.date) || left.league.localeCompare(right.league) || left.home.localeCompare(right.home));
}

function empty(at: number): State {
  return { at, weight: 0, scored: 0, conceded: 0, goalsFor: 0, goalsAgainst: 0, sotFor: 0, sotAgainst: 0,
    homeGoals: 0, awayGoals: 0, matches: 0 };
}

function decay(state: State, at: number): State {
  const factor = Math.pow(0.5, Math.max(0, at - state.at) / HALF_LIFE_MS);
  return { at, weight: state.weight * factor, scored: state.scored * factor, conceded: state.conceded * factor,
    goalsFor: state.goalsFor * factor, goalsAgainst: state.goalsAgainst * factor, sotFor: state.sotFor * factor, sotAgainst: state.sotAgainst * factor,
    homeGoals: state.homeGoals * factor, awayGoals: state.awayGoals * factor, matches: state.matches * factor };
}

function solve(matrix: number[][], vector: number[]): number[] {
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < matrix.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < matrix.length; row += 1) if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = Math.abs(augmented[column]![column]!) < 1e-10 ? 1e-10 : augmented[column]![column]!;
    for (let index = column; index <= matrix.length; index += 1) augmented[column]![index] = augmented[column]![index]! / divisor;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let index = column; index <= matrix.length; index += 1) augmented[row]![index] -= factor * augmented[column]![index]!;
    }
  }
  return augmented.map((row) => row[matrix.length]!);
}

function fit(features: number[][], outcomes: number[], l2 = 25): Logistic {
  const width = features[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) => features.reduce((sum, row) => sum + row[column]!, 0) / features.length);
  const scales = Array.from({ length: width }, (_, column) => Math.max(1e-8, Math.sqrt(features.reduce((sum, row) => sum + (row[column]! - means[column]!) ** 2, 0) / features.length)));
  const design = features.map((row) => [1, ...row.map((value, column) => (value - means[column]!) / scales[column]!)]);
  const beta = Array(width + 1).fill(0) as number[];
  beta[0] = logit(outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length);
  for (let iteration = 0; iteration < 100; iteration += 1) {
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
    for (let index = 1; index < beta.length; index += 1) { gradient[index] -= l2 * beta[index]!; hessian[index]![index] += l2; }
    const step = solve(hessian, gradient);
    for (let index = 0; index < beta.length; index += 1) beta[index] += step[index]!;
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return { means, scales, beta };
}

function predict(model: Logistic, features: number[]): number {
  const row = [1, ...features.map((value, index) => (value - model.means[index]!) / model.scales[index]!)];
  return sigmoid(row.reduce((sum, value, index) => sum + value * model.beta[index]!, 0));
}

function buildRows(matches: Match[]): FeatureRow[] {
  const teams = new Map<string, State>();
  const leagues = new Map<string, State>();
  const recent = new Map<string, Array<{ scored: number; conceded: number; goalsFor: number; goalsAgainst: number; sotFor: number; sotAgainst: number }>>();
  const rows: FeatureRow[] = [];
  for (const match of matches) {
    const at = Date.parse(match.date);
    const league = decay(leagues.get(match.league) ?? empty(at), at);
    const home = decay(teams.get(`${match.league}:${match.home}`) ?? empty(at), at);
    const away = decay(teams.get(`${match.league}:${match.away}`) ?? empty(at), at);
    const leagueScoreRate = (league.scored + SHRINK * 0.72) / (league.weight + SHRINK);
    const leagueGoals = (league.goalsFor + SHRINK * 1.35) / (league.weight + SHRINK);
    const leagueSot = (league.sotFor + SHRINK * 4.4) / (league.weight + SHRINK);
    const venueHome = (league.homeGoals + SHRINK * 1.45) / (league.matches + SHRINK);
    const venueAway = (league.awayGoals + SHRINK * 1.2) / (league.matches + SHRINK);
    const shrunk = (state: State) => ({
      scoring: (state.scored + SHRINK * leagueScoreRate) / (state.weight + SHRINK),
      conceding: (state.conceded + SHRINK * leagueScoreRate) / (state.weight + SHRINK),
      goalsFor: (state.goalsFor + SHRINK * leagueGoals) / (state.weight + SHRINK),
      goalsAgainst: (state.goalsAgainst + SHRINK * leagueGoals) / (state.weight + SHRINK),
      sotFor: (state.sotFor + SHRINK * leagueSot) / (state.weight + SHRINK),
      sotAgainst: (state.sotAgainst + SHRINK * leagueSot) / (state.weight + SHRINK),
    });
    const h = shrunk(home);
    const a = shrunk(away);
    const homeRecent = recent.get(`${match.league}:${match.home}`) ?? [];
    const awayRecent = recent.get(`${match.league}:${match.away}`) ?? [];
    const rolling = (history: typeof homeRecent, size: number) => {
      const window = history.slice(-size);
      const count = Math.max(1, window.length);
      return [
        window.reduce((sum, row) => sum + row.scored, 0) / count,
        window.reduce((sum, row) => sum + row.conceded, 0) / count,
        window.reduce((sum, row) => sum + row.goalsFor, 0) / count / leagueGoals,
        window.reduce((sum, row) => sum + row.goalsAgainst, 0) / count / leagueGoals,
        window.reduce((sum, row) => sum + row.sotFor, 0) / count / leagueSot,
        window.reduce((sum, row) => sum + row.sotAgainst, 0) / count / leagueSot,
        Math.min(1, window.length / size),
      ];
    };
    const homeRolling = rolling(homeRecent, 5);
    const awayRolling = rolling(awayRecent, 5);
    const homeRolling10 = rolling(homeRecent, 10);
    const awayRolling10 = rolling(awayRecent, 10);
    const lambdaHome = Math.max(0.2, Math.min(3.8, venueHome * h.goalsFor / leagueGoals * a.goalsAgainst / leagueGoals));
    const lambdaAway = Math.max(0.2, Math.min(3.8, venueAway * a.goalsFor / leagueGoals * h.goalsAgainst / leagueGoals));
    const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, DIXON_COLES_TAU);
    const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
    const side = (own: typeof h, opponent: typeof h, lambda: number, weight: number, isHome: boolean) => [
      logit(1 - Math.exp(-lambda)), logit(own.scoring), logit(opponent.conceding),
      Math.log(own.goalsFor / leagueGoals), Math.log(opponent.goalsAgainst / leagueGoals),
      Math.log(own.sotFor / leagueSot), Math.log(opponent.sotAgainst / leagueSot),
      Math.log1p(weight), isHome ? 1 : 0,
    ];
    const homeSide = side(h, a, lambdaHome, home.weight, true);
    const awaySide = side(a, h, lambdaAway, away.weight, false);
    const homeScoringRisk = h.scoring * a.conceding;
    const awayScoringRisk = a.scoring * h.conceding;
    const homeRecentRisk = homeRolling[0]! * awayRolling[1]!;
    const awayRecentRisk = awayRolling[0]! * homeRolling[1]!;
    const direct = [logit(markets.btts.yes), logit(markets.btts.yes) ** 2 * Math.sign(logit(markets.btts.yes)),
      lambdaHome, lambdaAway, lambdaHome + lambdaAway, Math.abs(lambdaHome - lambdaAway), Math.min(lambdaHome, lambdaAway),
      lambdaHome * lambdaAway, ...homeSide, ...awaySide, ...homeRolling, ...awayRolling, ...homeRolling10, ...awayRolling10,
      homeScoringRisk, awayScoringRisk, Math.min(homeScoringRisk, awayScoringRisk), homeScoringRisk * awayScoringRisk,
      homeRecentRisk, awayRecentRisk, Math.min(homeRecentRisk, awayRecentRisk), homeRecentRisk * awayRecentRisk,
      Math.min(home.weight, away.weight), leagueScoreRate];
    rows.push({ match, lambdaHome, lambdaAway, baseBtts: markets.btts.yes, baseResult: markets.match_result, baseOver: markets.total.over,
      homeSide, awaySide,
      homeScored: match.homeGoals > 0 ? 1 : 0, awayScored: match.awayGoals > 0 ? 1 : 0,
      actualBtts: match.homeGoals > 0 && match.awayGoals > 0 ? 1 : 0, weakerWeight: Math.min(home.weight, away.weight), direct });
    home.weight += 1; home.scored += Number(match.homeGoals > 0); home.conceded += Number(match.awayGoals > 0); home.goalsFor += match.homeGoals; home.goalsAgainst += match.awayGoals; home.sotFor += match.homeSot; home.sotAgainst += match.awaySot;
    away.weight += 1; away.scored += Number(match.awayGoals > 0); away.conceded += Number(match.homeGoals > 0); away.goalsFor += match.awayGoals; away.goalsAgainst += match.homeGoals; away.sotFor += match.awaySot; away.sotAgainst += match.homeSot;
    league.weight += 2; league.scored += Number(match.homeGoals > 0) + Number(match.awayGoals > 0); league.conceded += Number(match.awayGoals > 0) + Number(match.homeGoals > 0); league.goalsFor += match.homeGoals + match.awayGoals; league.goalsAgainst += match.awayGoals + match.homeGoals; league.sotFor += match.homeSot + match.awaySot; league.sotAgainst += match.awaySot + match.homeSot;
    league.homeGoals += match.homeGoals; league.awayGoals += match.awayGoals; league.matches += 1;
    const homeEntry = { scored: Number(match.homeGoals > 0), conceded: Number(match.awayGoals > 0), goalsFor: match.homeGoals, goalsAgainst: match.awayGoals, sotFor: match.homeSot, sotAgainst: match.awaySot };
    const awayEntry = { scored: Number(match.awayGoals > 0), conceded: Number(match.homeGoals > 0), goalsFor: match.awayGoals, goalsAgainst: match.homeGoals, sotFor: match.awaySot, sotAgainst: match.homeSot };
    recent.set(`${match.league}:${match.home}`, [...homeRecent.slice(-9), homeEntry]);
    recent.set(`${match.league}:${match.away}`, [...awayRecent.slice(-9), awayEntry]);
    teams.set(`${match.league}:${match.home}`, home); teams.set(`${match.league}:${match.away}`, away); leagues.set(match.league, league);
  }
  return rows;
}

function auc(rows: Array<{ probability: number; actual: 0 | 1 }>): number {
  const positives = rows.filter((row) => row.actual === 1);
  const negatives = rows.filter((row) => row.actual === 0);
  let score = 0;
  for (const positive of positives) for (const negative of negatives) score += positive.probability > negative.probability ? 1 : positive.probability === negative.probability ? 0.5 : 0;
  return positives.length && negatives.length ? score / (positives.length * negatives.length) : 0.5;
}

function metrics(rows: FeatureRow[], probabilities: number[]): Metrics {
  const values = rows.map((row, index) => ({ actual: row.actualBtts, probability: clip(probabilities[index]!) }));
  const no = values.filter((row) => row.actual === 0);
  return { n: rows.length, actualYes: values.filter((row) => row.actual === 1).length, predictedYes: values.filter((row) => row.probability >= 0.5).length,
    accuracy: values.filter((row) => Number(row.probability >= 0.5) === row.actual).length / rows.length,
    noRecall: no.filter((row) => row.probability < 0.5).length / no.length,
    brier: values.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / rows.length,
    logLoss: -values.reduce((sum, row) => sum + (row.actual ? Math.log(row.probability) : Math.log(1 - row.probability)), 0) / rows.length,
    auc: auc(values) };
}

function specialist(model: Logistic, row: FeatureRow) {
  const home = predict(model, row.homeSide);
  const away = predict(model, row.awaySide);
  return { home, away, btts: clip(home * away) };
}

function gateFeatures(row: FeatureRow, read: ReturnType<typeof specialist>): number[] {
  const residual = logit(read.btts) - logit(row.baseBtts);
  return [logit(row.baseBtts), residual, residual * Math.abs(residual), Math.min(read.home, read.away),
    Math.abs(row.lambdaHome - row.lambdaAway), Math.log1p(row.weakerWeight)];
}

function structure(rows: FeatureRow[], probabilities: number[]) {
  let scoreError = 0;
  let resultResidual = 0;
  let totalResidual = 0;
  let bttsResidual = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const base = bivariatePoissonScoreDistribution(row.lambdaHome, row.lambdaAway, DIXON_COLES_TAU);
    const joint = reconcileUclMeanPreserving(base, row.baseResult, row.baseOver, probabilities[index]!);
    const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
    let home = 0;
    let away = 0;
    for (let h = 0; h < joint.length; h += 1) for (let a = 0; a < joint[h]!.length; a += 1) { home += h * joint[h]![a]!; away += a * joint[h]![a]!; }
    scoreError += Math.abs(home - row.match.homeGoals) + Math.abs(away - row.match.awayGoals);
    resultResidual = Math.max(resultResidual, Math.abs(markets.match_result.home - row.baseResult.home), Math.abs(markets.match_result.draw - row.baseResult.draw), Math.abs(markets.match_result.away - row.baseResult.away));
    totalResidual = Math.max(totalResidual, Math.abs(markets.total.over - row.baseOver));
    bttsResidual = Math.max(bttsResidual, Math.abs(markets.btts.yes - probabilities[index]!));
  }
  return { teamScoreMae: scoreError / (2 * rows.length), maxResultResidual: resultResidual, maxTotalResidual: totalResidual, maxBttsResidual: bttsResidual };
}

function directProbability(row: FeatureRow, model: Logistic, blend: number, offset = 0, slope = 1): number {
  const learned = predict(model, row.direct);
  return sigmoid(slope * ((1 - blend) * logit(row.baseBtts) + blend * logit(learned)) + offset);
}

function developDirect(rows: FeatureRow[]) {
  const folds = [
    { validation: "2324", trainThrough: "2223" },
    { validation: "2425", trainThrough: "2324" },
  ] as const;
  const candidates = [1, 5, 25, 100].flatMap((l2) => [0.25, 0.5, 0.75, 1].map((blend) => ({ l2, blend })));
  const results = candidates.map((candidate) => {
    const predictions: Array<{ row: FeatureRow; probability: number; fold: string }> = [];
    const foldMetrics = folds.map((fold) => {
      const train = rows.filter((row) => row.match.season <= fold.trainThrough);
      const validation = rows.filter((row) => row.match.season === fold.validation);
      const model = fit(train.map((row) => row.direct), train.map((row) => row.actualBtts), candidate.l2);
      const probability = validation.map((row) => directProbability(row, model, candidate.blend));
      predictions.push(...validation.map((row, index) => ({ row, probability: probability[index]!, fold: fold.validation })));
      return { fold: fold.validation, baseline: metrics(validation, validation.map((row) => row.baseBtts)), candidate: metrics(validation, probability) };
    });
    const pooledRows = predictions.map((item) => item.row);
    const pooledProbability = predictions.map((item) => item.probability);
    return { ...candidate, foldMetrics, pooled: { baseline: metrics(pooledRows, pooledRows.map((row) => row.baseBtts)), candidate: metrics(pooledRows, pooledProbability) } };
  });
  console.log(JSON.stringify({ mode: "opened_development_only", featureCount: rows[0]?.direct.length ?? 0, folds, candidates: results }, null, 2));
}

function developCalibration(rows: FeatureRow[]) {
  const folds = [
    { validation: "2324", trainThrough: "2223" },
    { validation: "2425", trainThrough: "2324" },
  ] as const;
  const models = new Map<string, Logistic>();
  for (const fold of folds) for (const l2 of [1, 5, 25, 100]) {
    const train = rows.filter((row) => row.match.season <= fold.trainThrough);
    models.set(`${fold.validation}:${l2}`, fit(train.map((row) => row.direct), train.map((row) => row.actualBtts), l2));
  }
  const results = [1, 5, 25, 100].flatMap((l2) => [0.25, 0.5, 0.75, 1].flatMap((blend) =>
    [1, 1.15, 1.3, 1.45].flatMap((slope) => [-0.12, -0.1, -0.08, -0.06, -0.04, -0.02, 0].map((offset) => {
      const foldMetrics = folds.map((fold) => {
        const validation = rows.filter((row) => row.match.season === fold.validation);
        const baseline = metrics(validation, validation.map((row) => row.baseBtts));
        const candidate = metrics(validation, validation.map((row) => directProbability(row, models.get(`${fold.validation}:${l2}`)!, blend, offset, slope)));
        return { fold: fold.validation, baseline, candidate };
      });
      const passes = foldMetrics.every(({ baseline, candidate }) => candidate.accuracy > baseline.accuracy
        && candidate.noRecall > baseline.noRecall && candidate.brier < baseline.brier && candidate.logLoss < baseline.logLoss && candidate.auc > baseline.auc);
      const margin = Math.min(...foldMetrics.flatMap(({ baseline, candidate }) => [
        candidate.accuracy - baseline.accuracy,
        candidate.noRecall - baseline.noRecall,
        baseline.brier - candidate.brier,
        baseline.logLoss - candidate.logLoss,
        candidate.auc - baseline.auc,
      ]));
      return { l2, blend, slope, offset, passes, margin, foldMetrics };
    }))));
  const passing = results.filter((row) => row.passes).sort((left, right) => right.margin - left.margin);
  const near = results.sort((left, right) => right.margin - left.margin).slice(0, 12);
  console.log(JSON.stringify({ mode: "opened_development_calibration", passing, bestAvailable: near }, null, 2));
}

async function main() {
  const matches = await fetchMatches();
  const rows = buildRows(matches);
  if (process.argv.includes("--develop-direct")) {
    developDirect(rows);
    return;
  }
  if (process.argv.includes("--develop-calibration")) {
    developCalibration(rows);
    return;
  }
  const train = rows.filter((row) => row.match.season <= "2223");
  const gateRows = rows.filter((row) => row.match.season === "2324");
  const confirmation = rows.filter((row) => row.match.season === "2425");
  const scorer = fit(train.flatMap((row) => [row.homeSide, row.awaySide]), train.flatMap((row) => [row.homeScored, row.awayScored]));
  const gateReads = gateRows.map((row) => specialist(scorer, row));
  const gate = fit(gateRows.map((row, index) => gateFeatures(row, gateReads[index]!)), gateRows.map((row) => row.actualBtts));
  const candidate = confirmation.map((row) => { const read = specialist(scorer, row); return predict(gate, gateFeatures(row, read)); });
  const baseline = confirmation.map((row) => row.baseBtts);
  const raw = metrics(confirmation, baseline);
  const gated = metrics(confirmation, candidate);
  const rawStructure = structure(confirmation, baseline);
  const candidateStructure = structure(confirmation, candidate);
  const accepted = gated.accuracy > raw.accuracy && gated.noRecall > raw.noRecall && gated.brier < raw.brier && gated.logLoss < raw.logLoss
    && gated.auc > raw.auc && candidateStructure.teamScoreMae <= rawStructure.teamScoreMae && candidateStructure.maxResultResidual <= 1e-8
    && candidateStructure.maxTotalResidual <= 1e-8 && candidateStructure.maxBttsResidual <= 1e-8;
  console.log(JSON.stringify({ mode: "read_only_no_runtime_change", cohort: "2014_2023_scorer_2023_24_gate_2024_25_untouched_confirmation",
    coverage: { matches: matches.length, train: train.length, gate: gateRows.length, confirmation: confirmation.length, leagues: [...new Set(matches.map((row) => row.league))] },
    confirmation: { baseline: raw, candidate: gated, rawStructure, candidateStructure }, scorer, gate, accepted,
    gateResult: accepted ? "cross_league_gate_passed_all_confirmation_gates" : "cross_league_gate_failed_confirmation_do_not_transport" }, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
